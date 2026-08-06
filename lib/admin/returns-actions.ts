'use server';

import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { requirePermission } from '@/lib/admin/guard';
import { createInAppNotification, queueChannelNotification } from '@/lib/notifications/notify';
import type { Database } from '@/types/database.types';

type ReturnRequestUpdate = Database['public']['Tables']['return_requests']['Update'];

export type ReturnActionResult = { error?: string } | { success: true };

interface ReturnRequestRow {
  retailer_id: string;
  order_id: string;
  status: string;
}

export async function approveReturnAction(returnId: string, note: string): Promise<ReturnActionResult> {
  const user = await requirePermission('orders.return.manage');
  const supabase = createClient();

  const { data: existing } = await supabase
    .from('return_requests')
    .select('retailer_id, order_id, status')
    .eq('id', returnId)
    .maybeSingle<ReturnRequestRow>();

  if (!existing) return { error: 'Return request not found.' };
  if (existing.status !== 'requested') return { error: 'This return request has already been resolved.' };

  const payload: ReturnRequestUpdate = {
    status: 'approved',
    resolved_by: user.id,
    resolved_at: new Date().toISOString(),
    resolution_note: note || null,
  };

  const { error } = await supabase.from('return_requests').update(payload as unknown as never).eq('id', returnId);
  if (error) return { error: error.message };

  const notifyInput = {
    recipientId: existing.retailer_id,
    title: 'Return request approved',
    body: `Your return request for order has been approved.${note ? ` Note: ${note}` : ''}`,
    linkUrl: `/retailer/orders/${existing.order_id}`,
  };
  await createInAppNotification(notifyInput);
  await queueChannelNotification('whatsapp', notifyInput);

  revalidatePath('/admin/returns');
  return { success: true };
}

export async function rejectReturnAction(returnId: string, note: string): Promise<ReturnActionResult> {
  const user = await requirePermission('orders.return.manage');
  const supabase = createClient();

  const { data: existing } = await supabase
    .from('return_requests')
    .select('retailer_id, order_id, status')
    .eq('id', returnId)
    .maybeSingle<ReturnRequestRow>();

  if (!existing) return { error: 'Return request not found.' };
  if (existing.status !== 'requested') return { error: 'This return request has already been resolved.' };

  if (!note.trim()) return { error: 'Please provide a reason for rejecting this return request.' };

  const payload: ReturnRequestUpdate = {
    status: 'rejected',
    resolved_by: user.id,
    resolved_at: new Date().toISOString(),
    resolution_note: note,
  };

  const { error } = await supabase.from('return_requests').update(payload as unknown as never).eq('id', returnId);
  if (error) return { error: error.message };

  await createInAppNotification({
    recipientId: existing.retailer_id,
    title: 'Return request rejected',
    body: `Your return request was not approved. Reason: ${note}`,
    linkUrl: `/retailer/orders/${existing.order_id}`,
  });

  revalidatePath('/admin/returns');
  return { success: true };
}
