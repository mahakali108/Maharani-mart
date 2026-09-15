'use server';

import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { requirePermission } from '@/lib/admin/guard';
import { createInAppNotification } from '@/lib/notifications/notify';
import {
  SUPPORT_STATUSES,
  SUPPORT_STATUS_LABELS,
  canTransitionStatus,
  type SupportStatus,
} from '@/lib/retailer/support';

export type AdminSupportActionResult = { success: boolean; message?: string; error?: string };

function revalidateSupportPaths(ticketId: string): void {
  revalidatePath('/admin/support');
  revalidatePath(`/admin/support/${ticketId}`);
  revalidatePath('/retailer/support');
  revalidatePath(`/retailer/support/${ticketId}`);
}

/**
 * Admin replies to a ticket. The caller must hold `support.manage`
 * (admin+ only in the permission matrix); RLS (0048) independently allows
 * only admin+ inserts on the messages table.
 */
export async function adminReplyToTicketAction(
  ticketId: string,
  body: string
): Promise<AdminSupportActionResult> {
  const user = await requirePermission('support.manage');
  const text = body?.trim() ?? '';
  if (text.length < 5 || text.length > 3000) {
    return { success: false, error: 'Message must be 5–3,000 characters.' };
  }

  const supabase = createClient();

  const { data: ticket } = await supabase
    .from('support_tickets')
    .select('id, ticket_number, retailer_id, status')
    .eq('id', ticketId)
    .maybeSingle<{ id: string; ticket_number: string; retailer_id: string; status: SupportStatus }>();
  if (!ticket) return { success: false, error: 'Ticket not found.' };

  const { error } = await supabase
    .from('support_ticket_messages')
    .insert({
      ticket_id: ticket.id,
      author_id: user.id,
      author_role: user.role === 'super_admin' ? 'super_admin' : 'admin',
      body: text,
    } as unknown as never);
  if (error) return { success: false, error: 'Could not send the reply.' };

  // An answer to a fresh "open" ticket moves it to in_progress.
  if (ticket.status === 'open') {
    await supabase
      .from('support_tickets')
      .update({ status: 'in_progress' } as unknown as never)
      .eq('id', ticket.id)
      .eq('status', 'open');
  }

  // Existing notification infrastructure: the retailer sees this in-app.
  try {
    await createInAppNotification({
      recipientId: ticket.retailer_id,
      title: `Support update on ${ticket.ticket_number}`,
      body: 'Your distributor replied to your support ticket.',
      linkUrl: `/retailer/support/${ticket.id}`,
    });
  } catch {
    // Best-effort — the reply itself is stored.
  }

  revalidateSupportPaths(ticket.id);
  return { success: true, message: 'Reply sent.' };
}

/**
 * Admin moves a ticket through the workflow (open → in_progress →
 * resolved → closed, with limited reversals). Every move is validated
 * against the transition table and RLS (0048, admin-only update).
 */
export async function updateTicketStatusAction(
  ticketId: string,
  nextStatus: SupportStatus
): Promise<AdminSupportActionResult> {
  await requirePermission('support.manage');
  if (!SUPPORT_STATUSES.includes(nextStatus)) {
    return { success: false, error: 'Unknown status.' };
  }

  const supabase = createClient();

  const { data: ticket } = await supabase
    .from('support_tickets')
    .select('id, ticket_number, retailer_id, status')
    .eq('id', ticketId)
    .maybeSingle<{ id: string; ticket_number: string; retailer_id: string; status: SupportStatus }>();
  if (!ticket) return { success: false, error: 'Ticket not found.' };
  if (!canTransitionStatus(ticket.status, nextStatus)) {
    return { success: false, error: `A ${SUPPORT_STATUS_LABELS[ticket.status].toLowerCase()} ticket cannot be moved to ${SUPPORT_STATUS_LABELS[nextStatus].toLowerCase()}.` };
  }

  const patch: Record<string, unknown> = { status: nextStatus };
  if (nextStatus === 'resolved') patch.resolved_at = new Date().toISOString();
  if (nextStatus === 'closed') patch.closed_at = new Date().toISOString();
  if (nextStatus === 'open' || nextStatus === 'in_progress') {
    patch.resolved_at = null;
    patch.closed_at = null;
  }

  const { error } = await supabase
    .from('support_tickets')
    .update(patch as unknown as never)
    .eq('id', ticket.id)
    .eq('status', ticket.status); // optimistic guard — no lost updates
  if (error) return { success: false, error: 'Could not update the status.' };

  try {
    await createInAppNotification({
      recipientId: ticket.retailer_id,
      title: `Ticket ${ticket.ticket_number} is now ${SUPPORT_STATUS_LABELS[nextStatus].toLowerCase()}`,
      body:
        nextStatus === 'resolved'
          ? 'Your issue was marked as resolved. You can reply here if anything is still wrong.'
          : `Your support ticket status changed to ${SUPPORT_STATUS_LABELS[nextStatus].toLowerCase()}.`,
      linkUrl: `/retailer/support/${ticket.id}`,
    });
  } catch {
    // Best-effort.
  }

  revalidateSupportPaths(ticket.id);
  return { success: true, message: `Status set to ${SUPPORT_STATUS_LABELS[nextStatus]}.` };
}
