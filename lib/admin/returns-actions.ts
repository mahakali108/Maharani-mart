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
    .select('retailer_id, order_id, order_item_id, status')
    .eq('id', returnId)
    .maybeSingle<ReturnRequestRow & { order_item_id: string | null }>();

  if (!existing) return { error: 'Return request not found.' };
  if (existing.status !== 'requested') return { error: 'This return request has already been resolved.' };

  // Book the returned goods back into inventory (RETURN movements). The
  // RPC puts stock back into the batches it was dispatched from when the
  // FEFO allocations are known, otherwise at the aggregate product level.
  // Runs BEFORE the status flip so a failure cannot approve-without-stock.
  const { error: returnError } = await supabase.rpc('return_order_stock' as never, {
    p_order_id: existing.order_id,
    p_order_item_id: existing.order_item_id,
  } as never);
  if (returnError) return { error: `Return could not be booked into stock: ${returnError.message}` };

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
  revalidatePath('/admin/inventory');
  revalidatePath('/admin/inventory/batches');
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
