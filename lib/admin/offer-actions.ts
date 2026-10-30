'use server';

import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { requirePermission } from '@/lib/admin/guard';
import {
  parsePaise,
  parsePositiveInt,
  validateSellerReason,
} from '@/lib/admin/seller-validation';
import { checkProductCanBeSold, checkSellerCanTrade } from '@/lib/compliance/catalog-compliance';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type OfferActionResult = { ok: true } | { ok: false; error: string };

function revalidateOfferPages(packId?: string) {
  revalidatePath('/admin/offers');
  if (packId) revalidatePath(`/admin/catalog/${packId}`);
}

/**
 * Set (append) an admin price floor for a pack. The floor table is append-only
 * history (0063 trigger refuses updates/deletes) and is enforced on every
 * offer write and re-checked at cart mutation and checkout.
 */
export async function setOfferFloorAction(
  packId: string,
  floorRupees: string,
  note?: string
): Promise<OfferActionResult> {
  await requirePermission('sellers.offers.manage');
  if (!UUID_RE.test(packId)) return { ok: false, error: 'Invalid pack.' };
  const floorPaise = parsePaise(floorRupees);
  if (floorPaise === null) return { ok: false, error: 'Enter a valid floor price (₹ up to 2 decimals).' };
  const trimmedNote = (note ?? '').trim().slice(0, 300) || null;

  const supabase = createClient();
  const { error } = await supabase
    .from('offer_price_floors' as never)
    .insert({
      pack_id: packId,
      floor_paise: floorPaise,
      note: trimmedNote,
    } as never);
  if (error) return { ok: false, error: error.message };

  revalidateOfferPages(packId);
  return { ok: true };
}

/**
 * Admin moderation of an offer (approve/reject). The 0063 trigger refuses
 * moderation-state changes by non-admins even through a direct API call.
 */
export async function moderateOfferAction(
  offerId: string,
  decision: 'approved' | 'rejected',
  reason?: string
): Promise<OfferActionResult> {
  const user = await requirePermission('sellers.offers.manage');
  if (!UUID_RE.test(offerId)) return { ok: false, error: 'Invalid offer.' };
  if (decision !== 'approved' && decision !== 'rejected') {
    return { ok: false, error: 'Invalid moderation decision.' };
  }
  const trimmed = (reason ?? '').trim().slice(0, 500);
  if (decision === 'rejected' && trimmed.length < 3) {
    return { ok: false, error: 'Give a short reason for rejection (the seller may ask why).' };
  }

  const supabase = createClient();
  const { data, error } = await supabase
    .from('seller_offers' as never)
    .update({
      moderation_status: decision,
      moderation_by: user.id,
      moderated_at: new Date().toISOString(),
      moderation_reason: decision === 'rejected' ? trimmed : null,
    } as never)
    .eq('id', offerId)
    .select('id, pack_id');
  if (error) return { ok: false, error: error.message };
  if (!data || (data as unknown[]).length === 0) return { ok: false, error: 'Offer not found.' };

  revalidateOfferPages();
  return { ok: true };
}

/**
 * Activate/deactivate an offer. Deactivation is the ONLY removal path —
 * offers referenced by carts or order history are never deleted (0063 has no
 * delete policy; cart/order FKs are ON DELETE RESTRICT).
 */
export async function setOfferActiveAction(
  offerId: string,
  isActive: boolean
): Promise<OfferActionResult> {
  await requirePermission('sellers.offers.manage');
  if (!UUID_RE.test(offerId)) return { ok: false, error: 'Invalid offer.' };

  const supabase = createClient();
  const { data, error } = await supabase
    .from('seller_offers' as never)
    .update({ is_active: isActive } as never)
    .eq('id', offerId)
    .select('id');
  if (error) return { ok: false, error: error.message };
  if (!data || (data as unknown[]).length === 0) return { ok: false, error: 'Offer not found.' };

  revalidateOfferPages();
  return { ok: true };
}

/**
 * Admin-managed offer creation on behalf of a seller. The active-tenant seller
 * portal also supports offers; moderation is a separate admin operation.
 * New offers start in pending moderation, and the 0063 floor
 * trigger re-checks the admin minimum server-side.
 */
export async function createOfferAction(formData: FormData): Promise<OfferActionResult> {
  await requirePermission('sellers.offers.manage');
  const sellerId = String(formData.get('sellerId') ?? '');
  const packId = String(formData.get('packId') ?? '');
  const fulfilmentType = String(formData.get('fulfilmentType') ?? 'seller');
  if (!UUID_RE.test(sellerId) || !UUID_RE.test(packId)) {
    return { ok: false, error: 'Invalid seller or pack.' };
  }
  if (fulfilmentType !== 'seller' && fulfilmentType !== 'maharani') {
    return { ok: false, error: 'Invalid fulfilment type.' };
  }

  const unitPricePaise = parsePaise(formData.get('unitPrice'));
  if (unitPricePaise === null) return { ok: false, error: 'Enter a valid offer price (₹ up to 2 decimals).' };
  const moq = parsePositiveInt(formData.get('moq'), 100_000);
  if (moq === null) return { ok: false, error: 'MOQ must be a whole number of at least 1 piece.' };

  let stockQuantity: number | null = null;
  if (fulfilmentType === 'seller') {
    stockQuantity = parsePositiveInt(formData.get('stockQuantity') ?? '0');
    if (stockQuantity === null) {
      return { ok: false, error: 'Seller-fulfilled offers need a whole stock quantity.' };
    }
  }

  const supabase = createClient();
  // The pack owns its product identity — never trust a client-sent product id.
  const { data: pack, error: packError } = await supabase
    .from('product_packs')
    .select('id, product_id, is_active')
    .eq('id', packId)
    .maybeSingle<{ id: string; product_id: string; is_active: boolean }>();
  if (packError) return { ok: false, error: packError.message };
  if (!pack || !pack.is_active) return { ok: false, error: 'That pack is not active.' };
  const [productGate, sellerGate] = await Promise.all([
    checkProductCanBeSold(supabase, pack.product_id),
    checkSellerCanTrade(supabase, sellerId),
  ]);
  if (!productGate.ok) return { ok: false, error: productGate.error };
  if (!sellerGate.ok) return sellerGate;

  const { data, error } = await supabase
    .from('seller_offers' as never)
    .insert({
      seller_id: sellerId,
      product_id: pack.product_id,
      pack_id: packId,
      fulfilment_type: fulfilmentType,
      seller_sku: String(formData.get('sellerSku') ?? '').trim().slice(0, 64) || null,
      unit_price_paise: unitPricePaise,
      moq,
      stock_quantity: stockQuantity,
      moderation_status: 'pending',
    } as never)
    .select('id')
    .maybeSingle<{ id: string }>();
  if (error) {
    if (error.message.includes('PRICE_BELOW_FLOOR')) {
      return { ok: false, error: 'The offer price is below the admin minimum for this pack.' };
    }
    if (error.code === '23505') {
      return { ok: false, error: 'This seller already has an active offer for that pack.' };
    }
    return { ok: false, error: error.message };
  }
  if (!data) return { ok: false, error: 'The offer could not be created.' };

  revalidateOfferPages(packId);
  return { ok: true };
}

/** Update an offer's price/stock/MOQ (identity fields are DB-immutable). */
export async function updateOfferAction(formData: FormData): Promise<OfferActionResult> {
  await requirePermission('sellers.offers.manage');
  const offerId = String(formData.get('offerId') ?? '');
  if (!UUID_RE.test(offerId)) return { ok: false, error: 'Invalid offer.' };

  const unitPricePaise = parsePaise(formData.get('unitPrice'));
  if (unitPricePaise === null) return { ok: false, error: 'Enter a valid offer price (₹ up to 2 decimals).' };
  const moq = parsePositiveInt(formData.get('moq'), 100_000);
  if (moq === null) return { ok: false, error: 'MOQ must be a whole number of at least 1 piece.' };
  const stockQuantity = parsePositiveInt(formData.get('stockQuantity'));
  if (stockQuantity === null) return { ok: false, error: 'Stock must be a whole number of pieces.' };

  const supabase = createClient();
  const { data, error } = await supabase
    .from('seller_offers' as never)
    .update({
      unit_price_paise: unitPricePaise,
      moq,
      stock_quantity: stockQuantity,
    } as never)
    .eq('id', offerId)
    .select('id');
  if (error) {
    if (error.message.includes('PRICE_BELOW_FLOOR')) {
      return { ok: false, error: 'The offer price is below the admin minimum for this pack.' };
    }
    return { ok: false, error: error.message };
  }
  if (!data || (data as unknown[]).length === 0) return { ok: false, error: 'Offer not found.' };

  revalidateOfferPages();
  return { ok: true };
}

/** Rejection of a pending seller application and offer moderation share this. */
export async function rejectOfferWithReasonAction(
  offerId: string,
  reason: string
): Promise<OfferActionResult> {
  const reasonError = validateSellerReason(reason, 'rejection');
  if (reasonError) return { ok: false, error: reasonError };
  return moderateOfferAction(offerId, 'rejected', reason);
}
