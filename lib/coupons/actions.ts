'use server';

import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { requirePermission } from '@/lib/admin/guard';
import { loadCartCouponLines } from './cart-lines';
import { validateCouponForOrder } from './validate';

export type CouponActionResult =
  | { error: string }
  | { success: true; code: string; discount: number }
  | { success: true; removed: true };

/**
 * Applies a coupon code to the caller's cart.
 *
 * The retailer id, cart lines and every limit come from the authenticated
 * server session and fresh database reads — the client contributes only the
 * raw code. The coupon is validated by the single authoritative validator,
 * and only a VALID coupon is stored as the retailer's active coupon. The
 * stored row is a pointer (coupon_id); the discount is never persisted from
 * the client and is recomputed server-side at cart render and at order time.
 */
export async function applyCouponAction(rawCode: string): Promise<CouponActionResult> {
  const user = await requirePermission('orders.create');
  if (user.role !== 'retailer') return { error: 'Only a retailer can apply coupons to this cart.' };

  const code = (rawCode ?? '').trim().toUpperCase();
  if (!code) return { error: 'Enter a coupon code to apply.' };
  if (code.length > 40) return { error: 'That coupon code is too long.' };

  const supabase = createClient();

  // Price overrides are area-scoped, so the retailer's area is read first —
  // the same order of operations as the quote path.
  const { data: retailer } = await supabase
    .from('retailers')
    .select('area_id')
    .eq('id', user.id)
    .maybeSingle<{ area_id: string }>();

  const lines = await loadCartCouponLines(supabase, user.id, retailer?.area_id ?? null);
  if (lines.error) {
    return { error: 'Your cart could not be priced right now. Please try again.' };
  }
  if (lines.lines.length === 0) {
    return { error: 'Add at least one orderable product to the cart to use a coupon.' };
  }

  const result = await validateCouponForOrder(supabase, { retailerId: user.id, code, lines: lines.lines });
  if (!result.valid) return { error: result.message };

  // Store only the pointer; delete-then-insert keeps at most one active coupon.
  const { error: removeError } = await supabase
    .from('retailer_active_coupons')
    .delete()
    .eq('retailer_id', user.id);
  if (removeError) return { error: 'The coupon could not be saved. Please try again.' };

  const { error: insertError } = await supabase
    .from('retailer_active_coupons')
    .insert({ retailer_id: user.id, coupon_id: result.coupon.id } as unknown as never);
  if (insertError) return { error: 'The coupon could not be saved. Please try again.' };

  revalidatePath('/retailer/cart');
  revalidatePath('/retailer/checkout');
  revalidatePath('/retailer/coupons');
  return { success: true, code: result.coupon.code, discount: result.discount };
}

/** Removes the coupon currently applied to the caller's cart. */
export async function removeCouponAction(): Promise<CouponActionResult> {
  const user = await requirePermission('orders.create');
  if (user.role !== 'retailer') return { error: 'Only a retailer can change this cart.' };

  const supabase = createClient();
  const { error } = await supabase
    .from('retailer_active_coupons')
    .delete()
    .eq('retailer_id', user.id);
  if (error) return { error: 'The coupon could not be removed. Please try again.' };

  revalidatePath('/retailer/cart');
  revalidatePath('/retailer/checkout');
  revalidatePath('/retailer/coupons');
  return { success: true, removed: true };
}
