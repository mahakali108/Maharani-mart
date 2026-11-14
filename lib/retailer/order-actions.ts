'use server';

import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { requirePermission } from '@/lib/admin/guard';
import { createInAppNotification } from '@/lib/notifications/notify';
import { mergeLinesIntoCart } from '@/lib/retailer/cart-merge';
import { validatePackForCart } from '@/lib/retailer/cart-service';
import { loadMarketplaceOfferQuotes } from '@/lib/retailer/marketplace-offers';
import { isReturnWindowOpen } from '@/lib/delivery/return-window';
import type { Database } from '@/types/database.types';
import { restoreAndVerifyCancellationCoins, tryAtomicOrderCancellation } from '@/lib/orders/cancellation-coins';
import { releaseOrderCoupon } from '@/lib/coupons/validate';

type ReturnRequestInsert = Database['public']['Tables']['return_requests']['Insert'];

export type RetailerOrderActionResult = { error?: string } | { success: true; skippedCount?: number };

export async function cancelOrderAction(orderId: string, reason: string): Promise<RetailerOrderActionResult> {
  const user = await requirePermission('orders.cancel');
  const supabase = (await createClient());

  // Preferred path: status, Coins refund and coupon release in one database
  // transaction. When it commits, the guarded update below matches no row and
  // the already-cancelled branch continues to ledger verification.
  await tryAtomicOrderCancellation(supabase, orderId, reason || 'Retailer cancelled order');

  // RLS (orders_retailer_cancel) already restricts this to the
  // caller's own pending orders — the .eq() filters here just make
  // the intent explicit and give a clean error instead of a silent
  // no-op update.
  const { data, error } = await supabase
    .from('orders')
    .update({ status: 'cancelled', cancelled_reason: reason || null } as unknown as never)
    .eq('id', orderId)
    .eq('retailer_id', user.id)
    .eq('status', 'pending')
    .select('id')
    .maybeSingle<{ id: string }>();

  if (error) return { error: 'Cancellation could not be confirmed. Check the order and contact support if needed.' };
  if (!data) {
    // Only the owner can retry verification for their already-cancelled order.
    const { data: existing, error: readError } = await supabase.from('orders')
      .select('status').eq('id', orderId).eq('retailer_id', user.id)
      .maybeSingle<{ status: string }>();
    if (readError || existing?.status !== 'cancelled') {
      return { error: 'This order can no longer be cancelled — it may already be processing.' };
    }
  }

  // The verifier calls reverseOrderWalletDebit using only the idempotent RPC,
  // then checks that every visible debit has its matching credit.
  const coins = await restoreAndVerifyCancellationCoins(supabase, orderId, user.id, reason || 'Retailer cancelled order', user.id);
  await releaseOrderCoupon(supabase, orderId);
  revalidatePath(`/retailer/orders/${orderId}`);
  revalidatePath('/retailer/orders');
  revalidatePath('/retailer/account/ledger');
  revalidatePath('/retailer/coupons');
  if ('error' in coins) return coins;
  return { success: true };
}

interface ReorderLine {
  packId: string;
  sellerOfferId?: string | null;
  quantity: number;
}

interface PackForReorder {
  id: string;
  moq: number;
  is_active: boolean;
  products: { is_active: boolean } | null;
}

/**
 * Adds the retailer's chosen reorder lines (packId + edited quantity,
 * from the /orders/[id]/reorder review screen) into their existing
 * cart.
 *
 * Never trusts the browser beyond "which pack, which quantity":
 *   - retailer identity comes from the server session, never the client;
 *   - the source order is verified to belong to the caller;
 *   - every pack is re-read from product_packs NOW, and any line whose
 *     pack/product went inactive, deleted, or whose quantity is a
 *     non-integer / below the CURRENT MOQ is skipped server-side and
 *     reported back — old quantities, old MOQs, and old prices are
 *     never carried forward (cart/checkout already resolve the current
 *     effective price via get_effective-price helpers, so stale money
 *     values structurally cannot re-enter the flow here).
 *
 * RLS stays the enforcement boundary: cart_owner restricts writes to
 * retailer_id = auth.uid().
 */
export async function addReorderLinesToCartAction(
  orderId: string,
  lines: ReorderLine[]
): Promise<RetailerOrderActionResult> {
  const user = await requirePermission('orders.create');
  if (user.role !== 'retailer') return { error: 'Only a retailer can reorder into this cart.' };
  if (lines.length === 0) return { error: 'Select at least one item to reorder.' };
  if (lines.length > 200) return { error: 'Too many order lines.' };

  const supabase = (await createClient());

  const { data: order } = await supabase
    .from('orders')
    .select('id')
    .eq('id', orderId)
    .eq('retailer_id', user.id)
    .maybeSingle<{ id: string }>();

  if (!order) return { error: 'Order not found.' };

  // Only packs that actually appeared in THIS order may be reordered —
  // the page only renders those, so rejecting anything else here also
  // closes the "add an arbitrary pack through the reorder endpoint"
  // tampering path.
  const { data: ownedItemData } = await supabase
    .from('order_items')
    .select('pack_id, seller_offer_id')
    .eq('order_id', orderId);
  const sourceKey = (packId: string, sellerOfferId?: string | null) =>
    `${packId}|${sellerOfferId ?? 'maharani'}`;
  const allowedSources = new Set(
    ((ownedItemData ?? []) as { pack_id: string | null; seller_offer_id: string | null }[])
      .filter((row): row is { pack_id: string; seller_offer_id: string | null } => Boolean(row.pack_id))
      .map((row) => sourceKey(row.pack_id, row.seller_offer_id))
  );

  const requestedLines = new Map<string, { packId: string; sellerOfferId: string | null; quantity: number }>();
  for (const line of lines) {
    const sellerOfferId = line.sellerOfferId ?? null;
    const key = sourceKey(line.packId, sellerOfferId);
    if (!line.packId || requestedLines.has(key)) continue;
    if (!Number.isInteger(line.quantity) || line.quantity < 1 || line.quantity > 100000) continue;
    if (!allowedSources.has(key)) continue;
    requestedLines.set(key, { packId: line.packId, sellerOfferId, quantity: line.quantity });
  }
  if (requestedLines.size === 0) return { error: 'None of the submitted items belong to this order.' };

  const { data: packData } = await supabase
    .from('product_packs')
    .select('id, moq, is_active, products ( is_active )')
    .in('id', [...new Set([...requestedLines.values()].map((line) => line.packId))]);

  const marketplace = await loadMarketplaceOfferQuotes(
    supabase,
    [...requestedLines.values()].map((line) => line.sellerOfferId).filter((id): id is string => Boolean(id))
  );
  const offerById = new Map(marketplace.offers.map((offer) => [offer.offerId, offer]));
  const validLines: { packId: string; sellerOfferId: string | null; quantity: number }[] = [];
  let skippedCount = 0;
  const packById = new Map(((packData ?? []) as unknown as PackForReorder[]).map((pack) => [pack.id, pack]));

  for (const { packId, sellerOfferId, quantity } of requestedLines.values()) {
    const pack = packById.get(packId);
    if (!pack || !pack.is_active || !pack.products?.is_active) {
      skippedCount += 1;
      continue;
    }
    if (sellerOfferId) {
      const offer = offerById.get(sellerOfferId);
      if (marketplace.error || !offer || offer.packId !== packId
          || quantity < offer.moq || !offer.inStock
          || (offer.stockQuantity ?? 0) < quantity) {
        skippedCount += 1;
        continue;
      }
    } else {
      if (quantity < pack.moq) {
        skippedCount += 1;
        continue;
      }
      // Reuse the full canonical Maharani cart validation, including today's
      // selling tiers, rather than copying a historical price.
      const validationError = await validatePackForCart(supabase, user.id, packId, quantity);
      if (validationError) { skippedCount += 1; continue; }
    }
    validLines.push({ packId, sellerOfferId, quantity });
  }

  if (validLines.length === 0) {
    return { error: 'None of those items can be reordered right now — they are unavailable or below the current minimum quantity.' };
  }

  // Same merge path as manual catalog adds — one implementation,
  // one semantic (increment existing cart lines, insert new ones).
  try {
    await mergeLinesIntoCart(supabase, user.id, validLines);
  } catch (error) {
    return { error: error instanceof Error ? error.message : 'The cart could not be updated.' };
  }

  revalidatePath('/retailer/cart');
  revalidatePath('/retailer', 'layout');
  return { success: true, skippedCount };
}

export async function requestReturnAction(
  orderId: string,
  orderItemId: string | null,
  reason: string
): Promise<RetailerOrderActionResult> {
  const user = await requirePermission('orders.return.request');

  if (!reason.trim()) return { error: 'Please describe the reason for the return.' };

  const supabase = (await createClient());

  // Return window (Phase 4): the deadline is snapshotted on the delivery at
  // completion. If the order predates the deliveries module (no delivery
  // row), the window is open — the legacy behaviour is unchanged.
  const { data: delivery } = await supabase
    .from('order_deliveries')
    .select('return_deadline')
    .eq('order_id', orderId)
    .maybeSingle<{ return_deadline: string | null }>();
  if (delivery?.return_deadline && !isReturnWindowOpen(delivery.return_deadline)) {
    return {
      error: `The return window for this order closed on ${delivery.return_deadline}. Contact support if something is wrong.`,
    };
  }

  const payload: ReturnRequestInsert = {
    order_id: orderId,
    order_item_id: orderItemId,
    retailer_id: user.id,
    reason: reason.trim(),
  };

  // RLS (return_requests_retailer_insert) independently enforces that
  // this order belongs to the caller and is 'delivered' — if either
  // is false, this insert is rejected at the database level.
  const { error } = await supabase.from('return_requests').insert(payload as unknown as never);
  if (error) {
    return {
      error: error.message.includes('row-level security')
        ? 'Return requests can only be made for your own delivered orders.'
        : error.message,
    };
  }

  // Notify every staff/admin — return requests need review, and this
  // architecture's notifications table has a single recipient per
  // row, so a small broadcast loop (staff counts are small in a
  // district-level distributor, not thousands) is the correct
  // approach rather than adding a new broadcast mechanism.
  const { data: staffProfiles } = await supabase
    .from('profiles')
    .select('id')
    .in('role', ['staff', 'admin', 'super_admin'])
    .eq('is_active', true)
    .returns<{ id: string }[]>();

  for (const staff of staffProfiles ?? []) {
    await createInAppNotification({
      recipientId: staff.id,
      title: 'New return request',
      body: `A retailer has requested a return: ${reason.trim()}`,
      linkUrl: '/admin/returns',
    });
  }

  revalidatePath(`/retailer/orders/${orderId}`);
  return { success: true };
}
