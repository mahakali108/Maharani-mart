'use server';

import { z } from 'zod';
import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { requirePermission } from '@/lib/admin/guard';
import type { Database } from '@/types/database.types';
import { indiaTodayDateKey } from '@/lib/datetime/india';

export type FollowUpResult = { error?: string } | { success: true };

type FollowUpInsert = Database['public']['Tables']['follow_ups']['Insert'];

const createSchema = z.object({
  retailerId: z.string().uuid('Select a retailer.'),
  dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Choose a due date.'),
  note: z.string().trim().min(3, 'Write a short reminder note.').max(500),
  orderId: z.string().uuid().optional(),
});

/**
 * Creates a follow-up reminder for an ASSIGNED retailer. The assignment
 * check mirrors checkInVisitAction: the app-level filter gives a clean
 * error, and the follow_ups RLS (migration 0039) repeats the same condition
 * at the database boundary.
 */
export async function createFollowUpAction(input: z.input<typeof createSchema>): Promise<FollowUpResult> {
  const user = await requirePermission('followups.manage.own');

  const parsed = createSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? 'Check the reminder details.' };

  // A reminder can only be for today or the future — backdating a reminder
  // would rewrite what the salesman was supposed to do.
  if (parsed.data.dueDate < indiaTodayDateKey()) {
    return { error: 'Pick today or a future date for the reminder.' };
  }

  const supabase = createClient();

  const { data: assignedRetailer } = await supabase
    .from('retailers')
    .select('id')
    .eq('id', parsed.data.retailerId)
    .eq('assigned_salesman_id', user.id)
    .maybeSingle<{ id: string }>();
  if (!assignedRetailer) return { error: 'This retailer is not assigned to you.' };

  const payload: FollowUpInsert = {
    retailer_id: assignedRetailer.id,
    owner_id: user.id,
    due_date: parsed.data.dueDate,
    note: parsed.data.note,
    status: 'open',
    order_id: parsed.data.orderId || null,
  };

  const { error } = await supabase.from('follow_ups').insert(payload as unknown as never);
  if (error) return { error: error.message };

  revalidatePath('/salesman/follow-ups');
  revalidatePath('/salesman/dashboard');
  revalidatePath('/admin/follow-ups');
  return { success: true };
}

interface OpenFollowUpRow {
  id: string;
  status: string;
  owner_id: string;
}

async function loadOwnFollowUp(
  supabase: ReturnType<typeof createClient>,
  followUpId: string,
  userId: string
): Promise<{ error: string } | { row: OpenFollowUpRow }> {
  if (!followUpId) return { error: 'Reminder not found.' };
  const { data } = await supabase
    .from('follow_ups')
    .select('id, status, owner_id')
    .eq('id', followUpId)
    .eq('owner_id', userId)
    .maybeSingle<OpenFollowUpRow>();
  if (!data) return { error: 'Reminder not found or not yours.' };
  return { row: data };
}

/** open → done. Records when the salesman actually acted on it. */
export async function completeFollowUpAction(followUpId: string): Promise<FollowUpResult> {
  const user = await requirePermission('followups.manage.own');
  const supabase = createClient();

  const found = await loadOwnFollowUp(supabase, followUpId, user.id);
  if ('error' in found) return { error: found.error };
  if (found.row.status !== 'open') return { error: 'This reminder is already closed.' };

  const { error } = await supabase
    .from('follow_ups')
    .update({
      status: 'done',
      completed_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    } as unknown as never)
    .eq('id', followUpId)
    .eq('owner_id', user.id)
    .eq('status', 'open');

  if (error) return { error: error.message };

  revalidatePath('/salesman/follow-ups');
  revalidatePath('/salesman/dashboard');
  revalidatePath('/admin/follow-ups');
  return { success: true };
}

/** open → cancelled. History is kept — nothing is ever deleted. */
export async function cancelFollowUpAction(followUpId: string): Promise<FollowUpResult> {
  const user = await requirePermission('followups.manage.own');
  const supabase = createClient();

  const found = await loadOwnFollowUp(supabase, followUpId, user.id);
  if ('error' in found) return { error: found.error };
  if (found.row.status !== 'open') return { error: 'This reminder is already closed.' };

  const { error } = await supabase
    .from('follow_ups')
    .update({ status: 'cancelled', updated_at: new Date().toISOString() } as unknown as never)
    .eq('id', followUpId)
    .eq('owner_id', user.id)
    .eq('status', 'open');

  if (error) return { error: error.message };

  revalidatePath('/salesman/follow-ups');
  revalidatePath('/salesman/dashboard');
  revalidatePath('/admin/follow-ups');
  return { success: true };
}
