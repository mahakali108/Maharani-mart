'use server';

import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { requirePermission } from '@/lib/admin/guard';
import { isUuid } from '@/lib/admin/seller-validation';

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

export async function adminTransitionSubOrderAction(
  orderId: string,
  subOrderId: string,
  nextStatus: AdminSubOrderStatus,
  reason?: string
): Promise<SubOrderActionResult> {
  await requirePermission('sellers.offers.manage');
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

  if (nextStatus === 'cancelled' || nextStatus === 'returned') {
    const { error: stockError } = await supabase.rpc(
      'restore_sub_order_stock' as never,
      { p_sub_order_id: subOrderId } as never
    );

    if (stockError) return { ok: false, error: 'Sub-order status changed, but stock restoration failed; contact support before retrying.' };

    if (coinShare > 0) {
      const { error: refundError } = await supabase.rpc(
        'refund_sub_order_coins' as never,
        {
          p_sub_order_id: subOrderId,
          p_amount_paise: coinShare,
          p_reason: reason?.trim() || `Sub-order ${nextStatus}`,
        } as never
      );
      if (refundError) return { ok: false, error: 'Sub-order status changed, but Coins restoration failed; contact support before retrying.' };
    }
  }

  revalidatePath(`/admin/orders/${orderId}`);
  revalidatePath(`/retailer/orders/${orderId}`);
  revalidatePath('/seller/orders');
  return { ok: true };
}
