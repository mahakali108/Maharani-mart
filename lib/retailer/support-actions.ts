'use server';

import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { requireUser } from '@/lib/auth/session';
import { createInAppNotification } from '@/lib/notifications/notify';
import { indiaTodayDateKey } from '@/lib/datetime/india';
import {
  SUPPORT_PRIORITIES,
  SUPPORT_STATUSES,
  SUPPORT_TOPICS,
  generateTicketNumber,
  isTicketOpen,
  type SupportPriority,
  type SupportStatus,
  type SupportTopic,
} from '@/lib/retailer/support';

export type SupportActionResult =
  | { error: string }
  | { ticketId: string; ticketNumber: string };

const SUBJECT_RE = /^[A-Za-z0-9 .,!?'&()/-]+$/;

function randomTicketSuffix(): string {
  // 4 chars from an unambiguous base36 set, uppercase.
  const alphabet = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  let out = '';
  for (let i = 0; i < 4; i += 1) out += alphabet[Math.floor(Math.random() * alphabet.length)];
  return out;
}

/** Best-effort: wake every admin/super_admin so a new ticket is seen. */
async function notifyAdmins(supabase: ReturnType<typeof createClient>, ticket: { ticketNumber: string; subject: string; id: string }): Promise<void> {
  try {
    // Targeted cast: the supabase-js generated-types overload resolves this
    // chain to `never` (same quirk the rest of the codebase works around).
    const { data: admins } = await (supabase
      .from('profiles')
      .select('id')
      .in('role', ['admin', 'super_admin'])
      .eq('is_active', true)
      .limit(50)) as unknown as { data: { id: string }[] | null };
    for (const admin of admins ?? []) {
      await createInAppNotification({
        recipientId: admin.id,
        title: `New support ticket ${ticket.ticketNumber}`,
        body: `${ticket.subject}`,
        linkUrl: `/admin/support/${ticket.id}`,
      });
    }
  } catch {
    // Notification fan-out is best-effort; the ticket itself already exists.
  }
}

/**
 * Creates a support ticket for the CURRENT retailer.
 *
 * Security: requireUser + explicit retailer role check (defense in depth);
 * the Supabase insert runs under the caller's RLS policy (0048) which also
 * requires retailer_id = auth.uid(). The order link is re-verified to belong
 * to the caller when supplied. The ticket number is generated here, never
 * trusted from the client.
 */
export async function createSupportTicketAction(input: {
  subject: string;
  topic: SupportTopic;
  priority: SupportPriority;
  orderId: string | null;
  description: string;
}): Promise<SupportActionResult> {
  const user = await requireUser();
  if (user.role !== 'retailer') return { error: 'Only a retailer can raise a support ticket.' };

  const subject = input.subject?.trim() ?? '';
  const description = input.description?.trim() ?? '';
  const topic = SUPPORT_TOPICS.includes(input.topic) ? input.topic : null;
  const priority = SUPPORT_PRIORITIES.includes(input.priority) ? input.priority : null;

  if (subject.length < 10 || subject.length > 120) {
    return { error: 'Subject must be 10–120 characters.' };
  }
  if (!SUBJECT_RE.test(subject)) {
    return { error: 'Subject contains unsupported characters.' };
  }
  if (!topic) return { error: 'Choose a category.' };
  if (!priority) return { error: 'Choose a priority.' };
  if (description.length < 10 || description.length > 3000) {
    return { error: 'Describe the issue in 10–3,000 characters.' };
  }

  const supabase = createClient();

  // When an order is attached it must be the caller's own order.
  if (input.orderId) {
    const { data: order } = await supabase
      .from('orders')
      .select('id, order_number')
      .eq('id', input.orderId)
      .eq('retailer_id', user.id)
      .maybeSingle<{ id: string; order_number: string }>();
    if (!order) return { error: 'Order not found.' };
  }

  const today = indiaTodayDateKey();
  let lastError: Error | null = null;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const ticketNumber = generateTicketNumber(today, randomTicketSuffix());
    const { data: ticket, error } = await supabase
      .from('support_tickets')
      .insert({
        ticket_number: ticketNumber,
        retailer_id: user.id,
        subject,
        topic,
        priority,
        order_id: input.orderId || null,
        status: 'open',
      } as unknown as never)
      .select('id, ticket_number')
      .single<{ id: string; ticket_number: string }>();

    if (error) {
      // Unique-violation → retry with a fresh suffix; anything else fails.
      if (error.code === '23505') {
        lastError = error;
        continue;
      }
      return { error: 'Could not create the ticket. Please try again.' };
    }
    if (!ticket) {
      lastError = new Error('missing ticket row');
      continue;
    }

    const { error: messageError } = await supabase
      .from('support_ticket_messages')
      .insert({
        ticket_id: ticket.id,
        author_id: user.id,
        author_role: 'retailer',
        body: description,
      } as unknown as never);
    if (messageError) return { error: 'Ticket was created but the first message failed. Please try again.' };

    await notifyAdmins(supabase, { ticketNumber: ticket.ticket_number, subject, id: ticket.id });

    revalidatePath('/retailer/support');
    revalidatePath(`/retailer/support/${ticket.id}`);
    return { ticketId: ticket.id, ticketNumber: ticket.ticket_number };
  }

  return { error: lastError?.message ?? 'Could not create the ticket. Please try again.' };
}

/**
 * Appends a message to the caller's own ticket while it is open/in_progress.
 * RLS (0048) additionally blocks inserts on resolved/closed tickets.
 */
export async function replyToSupportTicketAction(
  ticketId: string,
  body: string
): Promise<{ error?: string; success?: boolean }> {
  const user = await requireUser();
  if (user.role !== 'retailer') return { error: 'Only a retailer can reply to a support ticket.' };

  const text = body?.trim() ?? '';
  if (text.length < 5 || text.length > 3000) return { error: 'Message must be 5–3,000 characters.' };

  const supabase = createClient();

  const { data: ticket } = await supabase
    .from('support_tickets')
    .select('id, status')
    .eq('id', ticketId)
    .eq('retailer_id', user.id)
    .maybeSingle<{ id: string; status: SupportStatus }>();
  if (!ticket) return { error: 'Ticket not found.' };
  if (!SUPPORT_STATUSES.includes(ticket.status) || !isTicketOpen(ticket.status)) {
    return { error: 'This ticket is closed for replies. Raise a new ticket if you need more help.' };
  }

  const { error } = await supabase
    .from('support_ticket_messages')
    .insert({
      ticket_id: ticket.id,
      author_id: user.id,
      author_role: 'retailer',
      body: text,
    } as unknown as never);
  if (error) return { error: 'Could not send the message. Please try again.' };

  revalidatePath(`/retailer/support/${ticket.id}`);
  revalidatePath('/retailer/support');
  return { success: true };
}
