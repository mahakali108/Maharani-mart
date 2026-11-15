'use server';

import { revalidatePath } from 'next/cache';
import { requirePermission } from '@/lib/admin/guard';
import { createTrustedDeliveryWriter } from '@/lib/delivery/trusted-writer';
import { createInAppNotification, queueChannelNotification, type NotifyInput } from '@/lib/notifications/notify';
import {
  RETURNS_ADMIN_ONLY,
  RETURNS_NOT_INSTALLED,
  RETURNS_WRITER_UNAVAILABLE,
  isReturnApprovalResult,
  isReturnRejectionResult,
  isReturnRequestId,
  isReturnRpcMissing,
  mapReturnApprovalError,
  mapReturnRejectionError,
} from '@/lib/returns/resolution';

export type ReturnActionResult = { error?: string } | { success: true };

type RpcClient = {
  rpc: (fn: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: { message: string; code?: string } | null }>;
};

function isAdminRole(role: string): boolean {
  return role === 'admin' || role === 'super_admin';
}

/**
 * Approves a return request. One database transaction (migration 0101):
 * the request and its order are locked, the acting Admin is re-verified by the
 * database, the stock is restored exactly once, the request becomes "approved"
 * and a history row is written — together or not at all. A repeat (double
 * click, retry after a timeout) is a replay: nothing is written again and the
 * retailer is not notified twice.
 *
 * No Coins are refunded and no loyalty points are reversed here. That rule is
 * an open owner decision; see lib/returns/resolution.ts.
 */
export async function approveReturnAction(returnId: string, note: string): Promise<ReturnActionResult> {
  const user = await requirePermission('orders.return.manage');
  if (!isAdminRole(user.role)) return { error: RETURNS_ADMIN_ONLY };
  if (!isReturnRequestId(returnId)) return { error: 'Return request not found.' };
  const cleanNote = typeof note === 'string' ? note.trim() : '';
  if (cleanNote.length > 1000) return { error: 'The note must be 1000 characters or fewer.' };

  const trusted = createTrustedDeliveryWriter();
  if (!trusted) return { error: RETURNS_WRITER_UNAVAILABLE };

  const { data, error } = await (trusted as unknown as RpcClient).rpc('approve_return_request_atomic', {
    p_return_request_id: returnId,
    p_actor_id: user.id,
    p_note: cleanNote || null,
  });
  if (error) {
    if (isReturnRpcMissing(error)) return { error: RETURNS_NOT_INSTALLED };
    return { error: mapReturnApprovalError(error.message) };
  }
  if (!isReturnApprovalResult(data)) {
    return { error: 'The return request could not be confirmed as approved. Refresh the page before trying again.' };
  }

  // After the commit, and only for the call that actually did the work.
  if (!data.replayed) {
    const notifyInput: NotifyInput = {
      recipientId: data.retailer_id,
      title: 'Return request approved',
      body: `Your return request for order ${data.order_number} has been approved.${cleanNote ? ` Note: ${cleanNote}` : ''}`,
      linkUrl: `/retailer/orders/${data.order_id}`,
      category: 'order',
    };
    await createInAppNotification(notifyInput);
    await queueChannelNotification('whatsapp', notifyInput);
  }

  revalidatePath('/admin/returns');
  revalidatePath('/admin/inventory');
  revalidatePath('/admin/inventory/batches');
  return { success: true };
}

/**
 * Rejects a return request. One database transaction (migration 0101): status
 * and history row together. Never touches stock or Coins.
 */
export async function rejectReturnAction(returnId: string, note: string): Promise<ReturnActionResult> {
  const user = await requirePermission('orders.return.manage');
  if (!isAdminRole(user.role)) return { error: RETURNS_ADMIN_ONLY };
  if (!isReturnRequestId(returnId)) return { error: 'Return request not found.' };
  const cleanNote = typeof note === 'string' ? note.trim() : '';
  if (cleanNote.length < 3 || cleanNote.length > 1000) {
    return { error: 'Please give a reason of 3 to 1000 characters for rejecting this return request.' };
  }

  const trusted = createTrustedDeliveryWriter();
  if (!trusted) return { error: RETURNS_WRITER_UNAVAILABLE };

  const { data, error } = await (trusted as unknown as RpcClient).rpc('reject_return_request_atomic', {
    p_return_request_id: returnId,
    p_actor_id: user.id,
    p_note: cleanNote,
  });
  if (error) {
    if (isReturnRpcMissing(error)) return { error: RETURNS_NOT_INSTALLED };
    return { error: mapReturnRejectionError(error.message) };
  }
  if (!isReturnRejectionResult(data)) {
    return { error: 'The return request could not be confirmed as rejected. Refresh the page before trying again.' };
  }

  if (!data.replayed) {
    await createInAppNotification({
      recipientId: data.retailer_id,
      title: 'Return request rejected',
      body: `Your return request for order ${data.order_number} was not approved. Reason: ${cleanNote}`,
      linkUrl: `/retailer/orders/${data.order_id}`,
      category: 'order',
    });
  }

  revalidatePath('/admin/returns');
  return { success: true };
}
