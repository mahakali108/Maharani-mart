'use server';

/**
 * Super Admin handling of HISTORICAL sub-orders.
 *
 * Context: Maharani Traders no longer operates a seller marketplace, so no new
 * seller sub-order can be created — checkout writes one centrally-owned order
 * (see lib/orders/create-order.ts). However, orders placed while the marketplace
 * existed still have `sub_orders` children, and those children carry real money
 * (gross/GST/coupon/Coins shares) and real shipments.
 *
 * This action lets an authorised administrator settle such a child honestly:
 * confirming, shipping, delivering, cancelling or returning it, using the same
 * atomic database functions the platform already shipped (0097
 * `close_sub_order_atomic`, 0069 `set_sub_order_status`). It is NOT a seller
 * feature — there is no seller session, no seller RLS branch and no seller
 * permission involved.
 *
 * Authorization: `orders.return.manage` (admin + super_admin), the permission
 * that already governs taking money/stock back on an order. The previous
 * implementation used a seller-specific permission (`sellers.offers.manage`)
 * which no longer exists.
 */

import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { requirePermission } from '@/lib/admin/guard';

export type SubOrderActionResult = { ok: true } | { ok: false; error: string };

const ALLOWED_STATUSES = [
  'confirmed',
  'processing',
  'shipped',
  'delivered',
  'cancelled',
  'returned',
  'failed',
] as const;

export type AdminSubOrderStatus = (typeof ALLOWED_STATUSES)[number];

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isUuid(value: unknown): value is string {
  return typeof value === 'string' && UUID_RE.test(value);
}

export async function adminTransitionSubOrderAction(
  orderId: string,
  subOrderId: string,
  nextStatus: AdminSubOrderStatus,
  reason?: string
): Promise<SubOrderActionResult> {
  await requirePermission('orders.return.manage');
  if (!isUuid(orderId) || !isUuid(subOrderId)) {
    return { ok: false, error: 'Invalid order or sub-order identifier.' };
  }
  if (!ALLOWED_STATUSES.includes(nextStatus)) {
    return { ok: false, error: 'Unsupported sub-order status.' };
  }

  const supabase = (await createClient());
  const { data: subRow, error: subReadError } = await supabase
    .from('sub_orders' as never)
    .select('parent_order_id, coins_share_paise')
    .eq('id', subOrderId)
    .maybeSingle<{ parent_order_id: string; coins_share_paise: number }>();
  if (subReadError || !subRow || subRow.parent_order_id !== orderId) {
    return { ok: false, error: 'Sub-order does not belong to this order or could not be verified.' };
  }
  const coinShare = Number(subRow.coins_share_paise);
  if (!Number.isSafeInteger(coinShare) || coinShare < 0) {
    return { ok: false, error: 'Sub-order Coins share could not be verified.' };
  }

  if (nextStatus === 'cancelled' || nextStatus === 'returned') {
    // ONE database transaction (close_sub_order_atomic, migration 0097):
    // child status, shipment, parent aggregation, stock release, the child's
    // wallet debit reversal and (when the whole order ends cancelled) the
    // coupon. If any part fails the database rolls all of it back, so a child
    // is never left cancelled with stock or Coins outstanding.
    const { data, error: closeError } = await supabase.rpc(
      'close_sub_order_atomic' as never,
      {
        p_parent_order_id: orderId,
        p_sub_order_id: subOrderId,
        p_status: nextStatus,
        p_reason: reason?.trim() || null,
      } as never
    );
    if (closeError) {
      const missing = closeError.code === 'PGRST202' || closeError.code === '42883'
        || /could not find the function|function .* does not exist/i.test(closeError.message ?? '');
      return {
        ok: false,
        error: missing
          ? 'Sub-orders cannot be cancelled or returned yet: the atomic cancellation update (migration 0097) is not installed. Nothing was changed.'
          : `Nothing was changed. ${closeError.message}`,
      };
    }
    const result = data as { atomic?: boolean; status?: string } | null;
    if (result?.atomic !== true || result.status !== nextStatus) {
      // No legacy three-step fallback: it could strand a cancelled child.
      return { ok: false, error: 'The sub-order change could not be confirmed. Refresh the order before retrying.' };
    }
  } else {
    const { error } = await supabase.rpc(
      'set_sub_order_status' as never,
      {
        p_sub_order_id: subOrderId,
        p_status: nextStatus,
        p_reason: reason?.trim() || null,
      } as never
    );
    if (error) {
      return { ok: false, error: error.message };
    }
  }

  revalidatePath(`/admin/orders/${orderId}`);
  revalidatePath(`/retailer/orders/${orderId}`);
  return { ok: true };
}
