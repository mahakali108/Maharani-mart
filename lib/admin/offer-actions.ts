'use server';

import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { requirePermission } from '@/lib/admin/guard';
import { requireSuperAdmin } from '@/lib/admin/control-center/guard';
import { recordSuperAdminAudit } from '@/lib/admin/super-admin-audit';
import {
  parsePaise,
  parsePositiveInt,
  validateSellerReason,
} from '@/lib/admin/seller-validation';
import { checkProductCanBeSold, checkSellerCanTrade } from '@/lib/compliance/catalog-compliance';
import { checkSellerOfferGate, mapSellerGateError } from '@/lib/seller/offer-gate';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type OfferActionResult = { ok: true } | { ok: false; error: string };

function revalidateOfferPages(packId?: string) {
  revalidatePath('/admin/offers');
  if (packId) revalidatePath(`/admin/catalog/${packId}`);
}

type SessionClient = Awaited<ReturnType<typeof createClient>>;

/**
 * Launch gate for an existing offer (marketplace switch + current Seller
 * Agreement accepted by the seller's owner). Admins are bound by it too; the
 * database enforces the same rule (migration 0098).
 */
async function offerLaunchGate(supabase: SessionClient, offerId: string): Promise<OfferActionResult> {
  const { data: offer, error } = await supabase
    .from('seller_offers' as never)
    .select('seller_id')
    .eq('id', offerId)
    .maybeSingle<{ seller_id: string }>();
  if (error) return { ok: false, error: error.message };
  if (!offer) return { ok: false, error: 'Offer not found.' };
  const gate = await checkSellerOfferGate(supabase, offer.seller_id);
  return gate.open ? { ok: true } : { ok: false, error: gate.error };
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

  const supabase = (await createClient());
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

  const supabase = (await createClient());
  // Approval publishes the offer. Rejection is always allowed.
  if (decision === 'approved') {
    const gate = await offerLaunchGate(supabase, offerId);
    if (!gate.ok) return gate;
  }
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
  if (error) return { ok: false, error: mapSellerGateError(error.message) ?? error.message };
  if (!data || (data as unknown[]).length === 0) return { ok: false, error: 'Offer not found.' };

  await recordSuperAdminAudit(supabase, {
    actorId: user.id,
    actorRole: user.role,
    action: decision === 'approved' ? 'OFFER_APPROVED' : 'OFFER_REJECTED',
    afterData: { offer_id: offerId, moderation_status: decision },
    reason: decision === 'rejected' ? trimmed : 'Seller offer approved',
  });

  revalidateOfferPages();
  return { ok: true };
}

/**
 * Super Admin removal of a prohibited or non-compliant seller listing.
 * Marks the offer rejected AND inactive in a single atomic update with a
 * mandatory reason prefixed `[PROHIBITED]` (trigger 0109 logs `removed_prohibited`
 * in `product_moderation_history` while preserving order/cart history).
 */
export async function removeProhibitedOfferAction(
  offerId: string,
  reason: string
): Promise<OfferActionResult> {
  const actor = await requireSuperAdmin();
  if (!UUID_RE.test(offerId)) return { ok: false, error: 'Invalid offer.' };
  const trimmed = (reason ?? '').trim().slice(0, 480);
  if (trimmed.length < 8) {
    return {
      ok: false,
      error: 'Provide a clear policy or compliance reason (at least 8 characters) to remove a prohibited listing.',
    };
  }

  const supabase = await createClient();
  const { data, error } = await supabase
    .from('seller_offers' as never)
    .update({
      moderation_status: 'rejected',
      is_active: false,
      moderation_by: actor.id,
      moderated_at: new Date().toISOString(),
      moderation_reason: `[PROHIBITED] ${trimmed}`,
    } as never)
    .eq('id', offerId)
    .select('id, seller_id, pack_id');
  if (error) return { ok: false, error: mapSellerGateError(error.message) ?? error.message };
  if (!data || (data as unknown[]).length === 0) return { ok: false, error: 'Offer not found.' };

  const row = (data as unknown as Array<{ id: string; seller_id?: string; pack_id?: string }>)[0];
  await recordSuperAdminAudit(supabase, {
    actorId: actor.id,
    actorRole: actor.role,
    action: 'OFFER_REMOVED_PROHIBITED',
    afterData: { offer_id: offerId, seller_id: row?.seller_id ?? null, moderation_status: 'rejected', is_active: false },
    reason: trimmed,
  });

  revalidateOfferPages(row?.pack_id);
  if (row?.seller_id) revalidatePath(`/admin/sellers/${row.seller_id}`);
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

  const supabase = (await createClient());
  // Deactivation is always allowed. Activation needs the launch gate.
  if (isActive) {
    const gate = await offerLaunchGate(supabase, offerId);
    if (!gate.ok) return gate;
  }
  const { data, error } = await supabase
    .from('seller_offers' as never)
    .update({ is_active: isActive } as never)
    .eq('id', offerId)
    .select('id');
  if (error) return { ok: false, error: mapSellerGateError(error.message) ?? error.message };
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

  const supabase = (await createClient());
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
  // Offers are created active (column default), so creation is gated too.
  const launchGate = await checkSellerOfferGate(supabase, sellerId);
  if (!launchGate.open) return { ok: false, error: launchGate.error };

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
    return { ok: false, error: mapSellerGateError(error.message) ?? error.message };
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

  const supabase = (await createClient());
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
