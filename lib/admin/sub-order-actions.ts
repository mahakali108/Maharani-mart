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
  await requirePermission('sellers.manage');
  if (!isUuid(orderId) || !isUuid(subOrderId)) {
    return { ok: false, error: 'Invalid order or sub-order identifier.' };
  }
  if (!ALLOWED_STATUSES.includes(nextStatus)) {
    return { ok: false, error: 'Unsupported sub-order status.' };
  }

  const supabase = createClient();
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
    await supabase.rpc(
      'restore_sub_order_stock' as never,
      { p_sub_order_id: subOrderId } as never
    );

    const { data: subRow } = await supabase
      .from('sub_orders' as never)
      .select('coins_share_paise')
      .eq('id', subOrderId)
      .maybeSingle<{ coins_share_paise: number }>();

    if (subRow && Number(subRow.coins_share_paise) > 0) {
      await supabase.rpc(
        'refund_sub_order_coins' as never,
        {
          p_sub_order_id: subOrderId,
          p_amount_paise: Number(subRow.coins_share_paise),
          p_reason: reason?.trim() || `Sub-order ${nextStatus}`,
        } as never
      );
    }
  }

  revalidatePath(`/admin/orders/${orderId}`);
  revalidatePath(`/retailer/orders/${orderId}`);
  revalidatePath('/seller/orders');
  return { ok: true };
}
