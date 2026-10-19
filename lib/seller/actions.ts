'use server';

import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { requireActiveSeller } from '@/lib/seller/guard';
import {
  isUuid,
  normalizeSellerInput,
  parsePaise,
  validateSellerInput,
} from '@/lib/admin/seller-validation';

export type SellerActionResult =
  | { ok: true }
  | { ok: false; error: string; fieldErrors?: Record<string, string> };

export interface SellerTierInput {
  minQuantity: number;
  maxQuantity: number | null;
  unitPriceRupees: string;
}

function revalidateSellerPortal() {
  revalidatePath('/seller/dashboard');
  revalidatePath('/seller/profile');
  revalidatePath('/seller/offers');
  revalidatePath('/seller/orders');
  revalidatePath('/admin/sellers');
  revalidatePath('/admin/offers');
}

function mapOfferWriteError(message: string): string {
  if (message.includes('PRICE_BELOW_FLOOR')) {
    return 'Price is below the admin minimum floor for this pack.';
  }
  if (message.includes('TIER_ABOVE_BASE_PRICE')) {
    return 'A quantity-tier price cannot exceed the base offer unit price.';
  }
  if (message.includes('TIER_BELOW_MOQ')) {
    return 'Every quantity tier must start at or above the offer MOQ.';
  }
  if (message.includes('uq_seller_offers_active_pack') || message.includes('duplicate key')) {
    return 'You already have an active offer for this pack. Edit the existing offer instead.';
  }
  if (message.includes('SELLER_NOT_ACTIVE')) {
    return 'Only an active seller can activate or trade offers.';
  }
  return message;
}

export async function updateSellerProfileAction(formData: FormData): Promise<SellerActionResult> {
  await requireActiveSeller();
  const input = normalizeSellerInput({
    businessName: String(formData.get('businessName') ?? ''),
    contactName: String(formData.get('contactName') ?? ''),
    phone: String(formData.get('phone') ?? ''),
    email: String(formData.get('email') ?? ''),
    gstin: String(formData.get('gstin') ?? ''),
    pan: String(formData.get('pan') ?? ''),
    addressLine: String(formData.get('addressLine') ?? ''),
  });

  const fieldErrors = validateSellerInput(input);
  if (Object.keys(fieldErrors).length > 0) {
    return { ok: false, error: 'Please fix the highlighted profile fields.', fieldErrors };
  }

  const supabase = createClient();
  const { error } = await supabase.rpc(
    'seller_update_own_profile' as never,
    {
      p_business_name: input.businessName,
      p_contact_name: input.contactName,
      p_phone: input.phone,
      p_email: input.email,
      p_gstin: input.gstin,
      p_pan: input.pan,
      p_address_line: input.addressLine,
    } as never
  );

  if (error) {
    if (error.message.toLowerCase().includes('uq_sellers_business_name') || error.message.toLowerCase().includes('duplicate')) {
      return {
        ok: false,
        error: 'A seller with this business name already exists.',
        fieldErrors: { businessName: 'Already registered.' },
      };
    }
    return { ok: false, error: error.message };
  }

  revalidateSellerPortal();
  return { ok: true };
}

export async function sellerCreateOfferAction(formData: FormData): Promise<SellerActionResult> {
  const { user, seller } = await requireActiveSeller();
  const packId = String(formData.get('packId') ?? '').trim();
  const fulfilmentType = String(formData.get('fulfilmentType') ?? '').trim();
  const unitPriceRaw = String(formData.get('unitPrice') ?? '');
  const moqRaw = Number(formData.get('moq') ?? '1');
  const stockRaw = String(formData.get('stockQuantity') ?? '').trim();
  const sellerSku = String(formData.get('sellerSku') ?? '').trim() || null;

  const fieldErrors: Record<string, string> = {};
  if (!isUuid(packId)) fieldErrors.packId = 'Choose a valid product pack.';
  if (fulfilmentType !== 'seller' && fulfilmentType !== 'maharani') {
    fieldErrors.fulfilmentType = 'Choose seller or Maharani fulfilment.';
  }
  const unitPricePaise = parsePaise(unitPriceRaw);
  if (unitPricePaise === null) {
    fieldErrors.unitPrice = 'Enter a positive price in ₹ (up to 2 decimals).';
  }
  if (!Number.isInteger(moqRaw) || moqRaw < 1 || moqRaw > 100_000) {
    fieldErrors.moq = 'MOQ must be a whole number from 1 to 100,000.';
  }
  let stockQuantity: number | null = null;
  if (fulfilmentType === 'seller') {
    const parsedStock = Number(stockRaw);
    if (stockRaw === '' || !Number.isInteger(parsedStock) || parsedStock < 0 || parsedStock > 2_000_000_000) {
      fieldErrors.stockQuantity = 'Seller-fulfilled offers require an on-hand stock quantity (0 or more).';
    } else {
      stockQuantity = parsedStock;
    }
  }
  if (sellerSku && sellerSku.length > 64) {
    fieldErrors.sellerSku = 'Seller SKU must be 64 characters or fewer.';
  }
  if (Object.keys(fieldErrors).length > 0) {
    return { ok: false, error: 'Please fix the highlighted offer fields.', fieldErrors };
  }

  const supabase = createClient();
  const { data: pack, error: packError } = await supabase
    .from('product_packs')
    .select('id, product_id, is_active')
    .eq('id', packId)
    .maybeSingle<{ id: string; product_id: string; is_active: boolean }>();

  if (packError || !pack || !pack.is_active) {
    return { ok: false, error: 'Selected product pack was not found or is inactive.' };
  }

  // Note: moderation_status is always 'pending' on seller insert; the DB
  // trigger trg_a_seller_offer_portal_write & trg_enforce_seller_offer_rules
  // enforce this at the database boundary as well.
  const { error } = await supabase.from('seller_offers' as never).insert({
    seller_id: seller.id,
    product_id: pack.product_id,
    pack_id: pack.id,
    fulfilment_type: fulfilmentType,
    seller_sku: sellerSku,
    unit_price_paise: unitPricePaise,
    moq: moqRaw,
    stock_quantity: stockQuantity,
    is_active: true,
    moderation_status: 'pending',
    created_by: user.id,
  } as never);

  if (error) {
    return { ok: false, error: mapOfferWriteError(error.message) };
  }

  revalidateSellerPortal();
  return { ok: true };
}

export async function sellerUpdateOfferTermsAction(formData: FormData): Promise<SellerActionResult> {
  const { seller } = await requireActiveSeller();
  const offerId = String(formData.get('offerId') ?? '').trim();
  const unitPriceRaw = String(formData.get('unitPrice') ?? '');
  const moqRaw = Number(formData.get('moq') ?? '1');
  const sellerSku = String(formData.get('sellerSku') ?? '').trim() || null;

  if (!isUuid(offerId)) {
    return { ok: false, error: 'Invalid offer identifier.' };
  }
  const unitPricePaise = parsePaise(unitPriceRaw);
  if (unitPricePaise === null) {
    return { ok: false, error: 'Enter a valid positive unit price in ₹.' };
  }
  if (!Number.isInteger(moqRaw) || moqRaw < 1 || moqRaw > 100_000) {
    return { ok: false, error: 'MOQ must be a whole number between 1 and 100,000.' };
  }
  if (sellerSku && sellerSku.length > 64) {
    return { ok: false, error: 'Seller SKU must be 64 characters or fewer.' };
  }

  const supabase = createClient();
  // Never send moderation_status from a seller client: trg_enforce_seller_offer_rules
  // forbids direct moderation column edits by non-admins, and
  // trg_zz_remoderate_seller_offer_terms automatically resets moderation_status
  // to 'pending' when price, MOQ, or SKU changes.
  const { data, error } = await supabase
    .from('seller_offers' as never)
    .update({
      unit_price_paise: unitPricePaise,
      moq: moqRaw,
      seller_sku: sellerSku,
    } as never)
    .eq('id', offerId)
    .eq('seller_id', seller.id)
    .select('id');

  if (error) {
    return { ok: false, error: mapOfferWriteError(error.message) };
  }
  if (!data || (data as unknown[]).length === 0) {
    return { ok: false, error: 'Offer not found for your seller account.' };
  }

  revalidateSellerPortal();
  return { ok: true };
}

export async function sellerSetOfferStockAction(
  offerId: string,
  stockQuantity: number
): Promise<SellerActionResult> {
  await requireActiveSeller();
  if (!isUuid(offerId)) {
    return { ok: false, error: 'Invalid offer identifier.' };
  }
  if (!Number.isInteger(stockQuantity) || stockQuantity < 0 || stockQuantity > 2_000_000_000) {
    return { ok: false, error: 'Stock must be a whole number from 0 to 2,000,000,000.' };
  }

  const supabase = createClient();
  const { error } = await supabase.rpc(
    'seller_set_offer_stock' as never,
    { p_offer_id: offerId, p_stock_quantity: stockQuantity } as never
  );

  if (error) {
    return { ok: false, error: error.message };
  }

  revalidateSellerPortal();
  return { ok: true };
}

export async function sellerSetOfferActiveAction(
  offerId: string,
  isActive: boolean
): Promise<SellerActionResult> {
  const { seller } = await requireActiveSeller();
  if (!isUuid(offerId)) {
    return { ok: false, error: 'Invalid offer identifier.' };
  }

  const supabase = createClient();
  const { data, error } = await supabase
    .from('seller_offers' as never)
    .update({ is_active: Boolean(isActive) } as never)
    .eq('id', offerId)
    .eq('seller_id', seller.id)
    .select('id');

  if (error) {
    return { ok: false, error: mapOfferWriteError(error.message) };
  }
  if (!data || (data as unknown[]).length === 0) {
    return { ok: false, error: 'Offer not found for your seller account.' };
  }

  revalidateSellerPortal();
  return { ok: true };
}

export async function sellerReplaceOfferTiersAction(
  offerId: string,
  tiers: SellerTierInput[]
): Promise<SellerActionResult> {
  await requireActiveSeller();
  if (!isUuid(offerId)) {
    return { ok: false, error: 'Invalid offer identifier.' };
  }
  if (!Array.isArray(tiers) || tiers.length > 20) {
    return { ok: false, error: 'You can configure up to 20 quantity tiers per offer.' };
  }

  const payload: {
    min_quantity: number;
    max_quantity: number | null;
    unit_price_paise: number;
  }[] = [];

  for (const tier of tiers) {
    const minQ = Number(tier.minQuantity);
    const maxQ =
      tier.maxQuantity === null || tier.maxQuantity === undefined || String(tier.maxQuantity) === ''
        ? null
        : Number(tier.maxQuantity);
    const pricePaise = parsePaise(String(tier.unitPriceRupees ?? ''));

    if (!Number.isInteger(minQ) || minQ < 1 || minQ > 100_000) {
      return { ok: false, error: 'Tier minimum quantity must be a whole number from 1 to 100,000.' };
    }
    if (maxQ !== null && (!Number.isInteger(maxQ) || maxQ < minQ || maxQ > 100_000)) {
      return { ok: false, error: 'Tier maximum quantity must be at least the minimum quantity.' };
    }
    if (pricePaise === null) {
      return { ok: false, error: 'Each tier requires a valid positive unit price in ₹.' };
    }
    payload.push({
      min_quantity: minQ,
      max_quantity: maxQ,
      unit_price_paise: pricePaise,
    });
  }

  payload.sort((a, b) => a.min_quantity - b.min_quantity);
  for (let i = 1; i < payload.length; i += 1) {
    const prev = payload[i - 1]!;
    const curr = payload[i]!;
    if (curr.min_quantity <= prev.min_quantity || prev.max_quantity === null || curr.min_quantity <= prev.max_quantity) {
      return {
        ok: false,
        error: 'Quantity tiers must have strictly increasing, non-overlapping ranges.',
      };
    }
  }

  const supabase = createClient();
  const { error } = await supabase.rpc(
    'seller_replace_offer_tiers' as never,
    { p_offer_id: offerId, p_tiers: payload } as never
  );

  if (error) {
    return { ok: false, error: mapOfferWriteError(error.message) };
  }

  revalidateSellerPortal();
  return { ok: true };
}

export async function sellerUpdateSubOrderAction(
  subOrderId: string,
  status: 'confirmed' | 'processing' | 'shipped' | 'cancelled',
  courier?: string,
  awb?: string
): Promise<SellerActionResult> {
  await requireActiveSeller();
  if (!isUuid(subOrderId)) {
    return { ok: false, error: 'Invalid sub-order identifier.' };
  }
  if (!['confirmed', 'processing', 'shipped', 'cancelled'].includes(status)) {
    return { ok: false, error: 'Unsupported seller fulfilment transition.' };
  }

  const supabase = createClient();
  const { error } = await supabase.rpc(
    'seller_update_sub_order' as never,
    {
      p_sub_order_id: subOrderId,
      p_status: status,
      p_courier: courier?.trim() || null,
      p_awb: awb?.trim() || null,
    } as never
  );

  if (error) {
    return { ok: false, error: error.message };
  }

  revalidateSellerPortal();
  return { ok: true };
}
