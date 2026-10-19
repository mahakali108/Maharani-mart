import 'server-only';

import type { createClient } from '@/lib/supabase/server';
import type { MobileSession } from '@/lib/mobile/auth';
import { cartCounts, sameCartIntent, type CartIntentLine } from '@/lib/mobile/commerce-shared';
import { PRODUCT_CARD_SELECT, loadCatalogPricing, priceCatalogPack, type CatalogProductRow } from '@/lib/retailer/catalog';
import { toPaise } from '@/lib/retailer/case-pricing';
import { loadActiveCouponForRetailer } from '@/lib/coupons/validate';
import { quoteOrderForRetailer } from '@/lib/orders/quote-order';
import { formatAddressLine, type AddressPayload } from '@/lib/retailer/address-shared';
import { checkDeliveryTerms, deliveryOrderBlocker } from '@/lib/config/delivery-serviceability';
import { loadCatalogAvailability } from '@/lib/retailer/catalog';

type SupabaseClient = ReturnType<typeof createClient>;

export type CommerceErrorCode =
  | 'invalid_request'
  | 'not_found'
  | 'conflict'
  | 'minimum_order_quantity'
  | 'coupon_invalid'
  | 'database_unavailable';

export class MobileCommerceError extends Error {
  constructor(
    readonly code: CommerceErrorCode,
    readonly status: number,
    message: string,
    readonly details?: Record<string, unknown>
  ) {
    super(message);
    this.name = 'MobileCommerceError';
  }
}

export interface MobileCartRpcRow {
  cart_item_id: string;
  pack_id: string;
  quantity: number;
  product_id: string | null;
  product_name: string | null;
  pack_name: string | null;
  units_per_case: number | null;
  moq: number | null;
  pack_active: boolean | null;
  product_active: boolean | null;
}

export interface MobileCartLine {
  id: string;
  packId: string;
  productId: string | null;
  productName: string | null;
  /**
   * Brand name as the catalogue shows it. A wholesale line has to be
   * identifiable at a glance — "Aashirvaad" is what distinguishes two 5 kg
   * atta bags that otherwise read identically in a cart list.
   */
  brandName: string | null;
  /** Pack image, else the product's primary image; null when neither exists. */
  imageUrl: string | null;
  packName: string | null;
  quantity: number;
  quantityUnit: 'pieces';
  /** Current retailer cart contract is whole pieces (step 1); MOQ is enforced separately. */
  quantityIncrement: 1;
  moq: number | null;
  unitsPerCase: number | null;
  unitPricePaise: number | null;
  lineTotalPaise: number | null;
  gstPercent: number | null;
  availability: 'in_stock' | 'out_of_stock' | 'unknown';
  orderable: boolean;
  message: string | null;
}

export interface MobileAddressOption {
  id: string | null;
  label: string;
  line: string;
  receiverName: string | null;
  phone: string | null;
  isDefault: boolean;
  /**
   * The structured fields behind [line], so a native address book can EDIT a
   * saved address instead of only picking one. Absent on the synthetic
   * registered-shop option (id null), which is not editable.
   */
  line1?: string;
  line2?: string | null;
  landmark?: string | null;
  city?: string;
  district?: string | null;
  state?: string | null;
  pincode?: string;
}

export interface ResolvedMobileAddress {
  id: string | null;
  display: MobileAddressOption;
  snapshot: { line: string; label?: string; receiverName?: string; phone?: string; district: string | null; state: string | null; pincode: string };
}

export interface MobileCheckoutQuote {
  lines: {
    packId: string;
    productId: string;
    productName: string;
    packName: string;
    quantity: number;
    quantityUnit: 'pieces';
    moq: number;
    unitsPerCase: number;
    unitPricePaise: number;
    lineTotalPaise: number;
    gstPercent: number;
    availability: 'in_stock' | 'out_of_stock' | 'unknown';
    orderable: boolean;
  }[];
  subtotalPaise: number;
  gstTotalPaise: number;
  discountTotalPaise: number;
  grandTotalPaise: number;
  /** Server-derived wallet/Coins balance before the quote's Coins application. */
  coinsBalancePaise: number;
  coinsUsedPaise: number;
  /** Wallet/Coins balance after applying this order, not the remaining order amount. */
  balanceAfterCoinsPaise: number;
  couponCode: string | null;
  address: MobileAddressOption;
}

interface RetailerAddressRow {
  id: string;
  label: string;
  receiver_name: string;
  phone: string;
  line1: string;
  line2: string | null;
  landmark: string | null;
  city: string;
  district: string | null;
  state: string | null;
  pincode: string;
  is_default: boolean;
}

function callerClient(session: MobileSession): SupabaseClient {
  return session.supabase as unknown as SupabaseClient;
}

function databaseError(message = 'The commerce service could not be loaded. Please try again.') {
  return new MobileCommerceError('database_unavailable', 503, message);
}

/** Read the authenticated retailer's cart, including identity for retired lines. */
export async function loadRetailerCartRows(session: MobileSession): Promise<MobileCartRpcRow[]> {
  const client = callerClient(session);
  const { data, error } = await (client as unknown as {
    rpc: (name: string, args?: Record<string, unknown>) => Promise<{ data: unknown; error: { message: string } | null }>;
  }).rpc('get_retailer_cart_lines');
  if (error || !Array.isArray(data)) throw databaseError();
  return data as MobileCartRpcRow[];
}

/**
 * The reason a cart line cannot be ordered, in customer language, or null when
 * the line is fine. Availability is checked before `active` because a retired
 * pack that is also out of stock reads more usefully as "out of stock".
 */
function cartLineBlocker(active: boolean, availability: 'in_stock' | 'out_of_stock' | 'unknown'): string | null {
  if (!active) return 'This saved item is no longer available to order. Remove it, or add a current pack instead.';
  if (availability === 'out_of_stock') return 'Out of stock right now. Remove it, or check back soon.';
  if (availability === 'unknown') return 'Availability could not be confirmed for this item yet. Try again in a moment.';
  return null;
}

/** Customer-facing cart snapshot: identity + current server pricing + status-only stock. */
export async function loadMobileCart(session: MobileSession): Promise<{
  lines: MobileCartLine[];
  couponCode: string | null;
  couponUnavailable: boolean;
  /**
   * Number of saved cart LINES — the same fact the web shell's cart badge
   * shows (`count of cart_items rows`), computed here so the native badge is
   * server-reported rather than a client-side guess.
   */
  lineCount: number;
  /** Total pieces across the lines. */
  itemCount: number;
}> {
  const supabase = callerClient(session);
  const rows = await loadRetailerCartRows(session);
  const productIds = [...new Set(rows.map((row) => row.product_id).filter((id): id is string => Boolean(id)))];

  let productById = new Map<string, CatalogProductRow>();
  let pricingData: Awaited<ReturnType<typeof loadCatalogPricing>> | null = null;
  if (productIds.length > 0) {
    const [{ data: products, error: productsError }, { data: retailer, error: retailerError }] = await Promise.all([
      supabase
        .from('products')
        .select(PRODUCT_CARD_SELECT)
        .in('id', productIds)
        .eq('is_active', true)
        .returns<CatalogProductRow[]>(),
      supabase
        .from('retailers')
        .select('area_id')
        .eq('id', session.userId)
        .maybeSingle<{ area_id: string | null }>(),
    ]);
    if (productsError || retailerError) throw databaseError();
    const activeProducts = products ?? [];
    productById = new Map(activeProducts.map((product) => [product.id, product]));
    pricingData = await loadCatalogPricing(supabase, activeProducts, session.userId, retailer?.area_id ?? null);
  }

  let couponCode: string | null = null;
  let couponUnavailable = false;
  try {
    const activeCoupon = await loadActiveCouponForRetailer(supabase, session.userId);
    couponCode = activeCoupon.coupon?.code ?? null;
    couponUnavailable = activeCoupon.error;
  } catch {
    couponUnavailable = true;
  }

  const lines = rows.map((row): MobileCartLine => {
    const product = row.product_id ? productById.get(row.product_id) : undefined;
    const pack = product?.product_packs.find((candidate) => candidate.id === row.pack_id && candidate.is_active);
    const active = row.pack_active === true && row.product_active === true && Boolean(product && pack && pricingData);
    const pricing = active && product && pack && pricingData
      ? priceCatalogPack(pack, product, pricingData, row.quantity)
      : null;
    const availability = pricingData?.availability.get(row.pack_id)?.state ?? 'unknown';
    const hasValidPriceAndQuantity = active && pricing?.orderable === true;
    // Unknown is not a promise: only the server's positive in-stock status may
    // make a line orderable. Checkout rechecks exact stock atomically later.
    const orderable = hasValidPriceAndQuantity && availability === 'in_stock';
    // Same precedence the catalogue card uses (lib/retailer/catalog.ts
    // `toPricedCard`): the pack's own artwork first, then the product's
    // primary image. The cart shows the exact variant that was added.
    const images = product ? [...product.product_images].sort((a, b) => a.sort_order - b.sort_order) : [];
    return {
      id: row.cart_item_id,
      packId: row.pack_id,
      productId: row.product_id,
      productName: row.product_name,
      brandName: product?.brands?.name ?? null,
      imageUrl: pack?.image_url || images[0]?.image_url || null,
      packName: row.pack_name,
      quantity: row.quantity,
      quantityUnit: 'pieces',
      quantityIncrement: 1,
      moq: row.moq,
      unitsPerCase: row.units_per_case,
      unitPricePaise: hasValidPriceAndQuantity && pricing ? toPaise(pricing.unitPrice) : null,
      lineTotalPaise: hasValidPriceAndQuantity && pricing ? toPaise(pricing.lineTotal) : null,
      gstPercent: product?.gst_percent ?? null,
      availability,
      orderable,
      // Every non-orderable line carries a REASON. The cart screen renders it
      // next to the disabled checkout button, so "why can't I check out?" is
      // answered in the shopper's own row instead of by a checkout-time
      // rejection. A healthy line stays silent (null).
      message: pricing?.message ?? cartLineBlocker(active, availability),
    };
  });

  return { lines, couponCode, couponUnavailable, ...cartCounts(lines) };
}

/** Server-side address choices. Profile text comes from the retailer row, never the checkout request. */
export async function loadMobileAddresses(session: MobileSession): Promise<MobileAddressOption[]> {
  const supabase = callerClient(session);
  const [{ data: saved, error: addressError }, { data: retailer, error: retailerError }] = await Promise.all([
    supabase
      .from('retailer_addresses')
      .select('id, label, receiver_name, phone, line1, line2, landmark, city, district, state, pincode, is_default')
      .eq('retailer_id', session.userId)
      .order('is_default', { ascending: false })
      .order('created_at', { ascending: true })
      .returns<RetailerAddressRow[]>(),
    supabase
      .from('retailers')
      .select('address')
      .eq('id', session.userId)
      .maybeSingle<{ address: string | null }>(),
  ]);
  if (addressError || retailerError) throw databaseError('Delivery addresses could not be loaded. Please try again.');

  const options: MobileAddressOption[] = (saved ?? []).map(toAddressOption);
  const profileAddress = retailer?.address?.trim();
  if (profileAddress) {
    options.push({
      id: null,
      label: 'Shop address',
      line: profileAddress,
      receiverName: session.fullName,
      phone: session.phone,
      isDefault: options.length === 0,
    });
  }
  return options;
}

/** Resolve and freeze only a structured saved address owned by this retailer. */
export async function resolveMobileAddress(
  session: MobileSession,
  addressId: string | null
): Promise<ResolvedMobileAddress> {
  if (!addressId) {
    throw new MobileCommerceError('invalid_request', 400, 'Select a saved delivery address with a district, state and PIN. Registered shop text alone cannot establish coverage.');
  }

  const supabase = callerClient(session);
  const { data, error } = await supabase
    .from('retailer_addresses')
    .select('id, label, receiver_name, phone, line1, line2, landmark, city, district, state, pincode, is_default')
    .eq('id', addressId)
    .eq('retailer_id', session.userId)
    .maybeSingle<RetailerAddressRow>();
  if (error) throw databaseError('The selected delivery address could not be verified. Please try again.');
  if (!data) throw new MobileCommerceError('not_found', 404, 'The selected delivery address was not found.');

  const display: MobileAddressOption = {
    id: data.id,
    label: data.label,
    line: formatAddressLine(data),
    receiverName: data.receiver_name,
    phone: data.phone,
    isDefault: data.is_default,
    city: data.city,
    district: data.district,
    state: data.state,
    pincode: data.pincode,
  };
  return {
    id: data.id,
    display,
    snapshot: {
      line: display.line,
      label: display.label,
      receiverName: display.receiverName ?? undefined,
      phone: display.phone ?? undefined,
      district: data.district,
      state: data.state,
      pincode: data.pincode,
    },
  };
}

/**
 * The column payload for one saved address.
 *
 * `state` defaults to Bihar exactly like the web form's writer: the shop is a
 * initially configured for Bihar. This is a form default, NOT proof that
 * any district or PIN is serviceable; checkout verifies the saved fields.
 */
function addressColumns(
  retailerId: string,
  value: AddressPayload
): Record<string, unknown> {
  return {
    retailer_id: retailerId,
    label: value.label,
    receiver_name: value.receiverName,
    phone: value.phone,
    line1: value.line1,
    line2: value.line2 ?? null,
    landmark: value.landmark ?? null,
    city: value.city,
    district: value.district ?? null,
    state: value.state ?? 'Bihar',
    pincode: value.pincode,
    is_default: value.isDefault ?? false,
  };
}

/** Clears `is_default` on the retailer's other addresses (default is exclusive). */
async function clearOtherDefaults(
  supabase: SupabaseClient,
  retailerId: string,
  keepId?: string
): Promise<void> {
  const query = supabase
    .from('retailer_addresses')
    .update({ is_default: false } as unknown as never)
    .eq('retailer_id', retailerId);
  if (keepId) await query.neq('id', keepId);
  else await query;
}

/**
 * When no default exists, make the first-saved address the default so checkout
 * always has a deterministic preselected address. Mirrors the web action.
 */
async function ensureDefaultAddress(supabase: SupabaseClient, retailerId: string): Promise<void> {
  const { data } = await supabase
    .from('retailer_addresses')
    .select('id, is_default')
    .eq('retailer_id', retailerId)
    .order('created_at', { ascending: true });
  const addresses = (data ?? []) as unknown as { id: string; is_default: boolean }[];
  const first = addresses[0];
  if (!first || addresses.some((row) => row.is_default)) return;
  await supabase
    .from('retailer_addresses')
    .update({ is_default: true } as unknown as never)
    .eq('id', first.id)
    .eq('retailer_id', retailerId);
}

/**
 * Create one saved address for the authenticated retailer.
 *
 * Identity comes from the session — never the request body — and RLS
 * (`retailer_addresses_owner_insert`) is the hard boundary behind the explicit
 * `.eq('retailer_id', …)` filters. Validation happens BEFORE this function is
 * called, using the same zod schema as the web form.
 */
export async function createMobileAddress(
  session: MobileSession,
  value: AddressPayload
): Promise<MobileAddressOption> {
  const supabase = callerClient(session);
  const payload = addressColumns(session.userId, value);
  const { data, error } = await supabase
    .from('retailer_addresses')
    .insert(payload as unknown as never)
    .select('id')
    .maybeSingle<{ id: string }>();
  if (error || !data) throw databaseError('The address could not be saved. Please try again.');

  if (payload.is_default === true) await clearOtherDefaults(supabase, session.userId, data.id);
  else await ensureDefaultAddress(supabase, session.userId);

  const created = { id: data.id, ...payload } as unknown as RetailerAddressRow;
  return { ...toAddressOption(created), id: data.id };
}

/**
 * Update one of the retailer's own saved addresses.
 *
 * The row is matched by BOTH `id` and `retailer_id`, so another retailer's
 * address can never be edited even if RLS were misconfigured, and a missing /
 * foreign row answers `404` without disclosing which of the two it was.
 */
export async function updateMobileAddress(
  session: MobileSession,
  addressId: string,
  value: AddressPayload
): Promise<MobileAddressOption> {
  const supabase = callerClient(session);
  const payload: Record<string, unknown> = {
    ...addressColumns(session.userId, value),
    updated_at: new Date().toISOString(),
  };
  const { data, error } = await supabase
    .from('retailer_addresses')
    .update(payload as unknown as never)
    .eq('id', addressId)
    .eq('retailer_id', session.userId)
    .select('id')
    .maybeSingle<{ id: string }>();
  if (error) throw databaseError('The address could not be updated. Please try again.');
  if (!data) throw new MobileCommerceError('not_found', 404, 'That saved address was not found.');

  if (payload.is_default === true) await clearOtherDefaults(supabase, session.userId, addressId);

  const saved = { id: addressId, ...payload } as unknown as RetailerAddressRow;
  return { ...toAddressOption(saved), id: addressId };
}

/** Make one of the retailer's own addresses the exclusive default. */
export async function setDefaultMobileAddress(
  session: MobileSession,
  addressId: string
): Promise<MobileAddressOption> {
  const supabase = callerClient(session);
  const { data, error } = await supabase
    .from('retailer_addresses')
    .update({ is_default: true } as unknown as never)
    .eq('id', addressId)
    .eq('retailer_id', session.userId)
    .select('id, label, receiver_name, phone, line1, line2, landmark, city, district, state, pincode, is_default')
    .maybeSingle<RetailerAddressRow>();
  if (error) throw databaseError('The default address could not be changed. Please try again.');
  if (!data) throw new MobileCommerceError('not_found', 404, 'That saved address was not found.');

  await clearOtherDefaults(supabase, session.userId, addressId);
  return toAddressOption({ ...data, is_default: true });
}

/**
 * Delete one of the retailer's own saved addresses, then keep the default
 * deterministic (the oldest remaining address becomes default when none is).
 */
export async function deleteMobileAddress(session: MobileSession, addressId: string): Promise<void> {
  const supabase = callerClient(session);
  const { data, error } = await supabase
    .from('retailer_addresses')
    .delete()
    .eq('id', addressId)
    .eq('retailer_id', session.userId)
    .select('id')
    .maybeSingle<{ id: string }>();
  if (error) throw databaseError('The address could not be deleted. Please try again.');
  if (!data) throw new MobileCommerceError('not_found', 404, 'That saved address was not found.');

  await ensureDefaultAddress(supabase, session.userId);
}

/** One saved row → the wire shape every address response uses. */
function toAddressOption(row: RetailerAddressRow): MobileAddressOption {
  return {
    id: row.id,
    label: row.label,
    line: formatAddressLine(row),
    receiverName: row.receiver_name,
    phone: row.phone,
    isDefault: row.is_default,
    line1: row.line1,
    line2: row.line2,
    landmark: row.landmark,
    city: row.city,
    district: row.district,
    state: row.state,
    pincode: row.pincode,
  };
}

/** Ensure the client is reviewing exactly the saved basket, not a different payload. */
export function assertCartIntentMatches(
  cartRows: Pick<MobileCartRpcRow, 'pack_id' | 'quantity'>[],
  requested: CartIntentLine[]
): void {
  const saved = cartRows.map((row) => ({ packId: row.pack_id, quantity: row.quantity }));
  if (cartRows.length === 0) {
    throw new MobileCommerceError('conflict', 409, 'Your cart is empty. Add products before checkout.');
  }
  if (!sameCartIntent(saved, requested)) {
    throw new MobileCommerceError('conflict', 409, 'Your cart changed. Refresh it and review the current items again.');
  }
}

/** Re-price current server cart lines and return the resolved address, stock status and Coins. */
export async function quoteMobileCheckout(
  session: MobileSession,
  requested: CartIntentLine[],
  addressId: string | null
): Promise<MobileCheckoutQuote> {
  const supabase = callerClient(session);
  const [cartRows, address, activeCoupon] = await Promise.all([
    loadRetailerCartRows(session),
    resolveMobileAddress(session, addressId),
    loadActiveCouponForRetailer(supabase, session.userId),
  ]);
  assertCartIntentMatches(cartRows, requested);
  if (activeCoupon.error) throw databaseError('The applied coupon could not be verified. Please try again.');

  const lines = cartRows.map((row) => ({ packId: row.pack_id, quantity: row.quantity }));
  const result = await quoteOrderForRetailer({
    retailerId: session.userId,
    lines,
    supabase,
    couponCode: activeCoupon.coupon?.code ?? null,
  });
  if ('error' in result) {
    const min = /minimum order quantity .*? is (\d+) pcs/i.exec(result.error)?.[1];
    if (min) throw new MobileCommerceError('minimum_order_quantity', 422, result.error, { minQuantity: Number(min) });
    if (result.code === 'coupon_invalid') throw new MobileCommerceError('coupon_invalid', 422, result.error);
    throw new MobileCommerceError('conflict', 409, result.error);
  }

  const quote = result.quote;
  const delivery = await checkDeliveryTerms(supabase, address.snapshot);
  if (!delivery.ok) {
    throw new MobileCommerceError(delivery.code === 'database_unavailable' ? 'database_unavailable' : 'conflict',
      delivery.code === 'database_unavailable' ? 503 : 409, delivery.message);
  }
  const deliveryBlocker = deliveryOrderBlocker(delivery, toPaise(quote.grandTotal));
  if (deliveryBlocker) throw new MobileCommerceError('conflict', 409, deliveryBlocker);
  const availability = await loadCatalogAvailability(supabase, quote.lines.map((line) => line.packId));
  return {
    lines: quote.lines.map((line) => {
      const stockState = availability.get(line.packId)?.state ?? 'unknown';
      return {
        packId: line.packId,
        productId: line.productId,
        productName: line.productName,
        packName: line.packName,
        quantity: line.quantity,
        quantityUnit: 'pieces' as const,
        moq: line.moq,
        unitsPerCase: line.unitsPerCase,
        unitPricePaise: toPaise(line.unitPrice),
        lineTotalPaise: toPaise(line.lineTotal),
        gstPercent: line.gstPercent,
        availability: stockState,
        // A quote with an unknown stock state is still a server quote, not an
        // availability promise. The UI may proceed only after an explicit
        // in-stock result; the atomic order RPC independently checks quantity.
        orderable: stockState === 'in_stock',
      };
    }),
    subtotalPaise: toPaise(quote.subtotal),
    gstTotalPaise: toPaise(quote.gstTotal),
    discountTotalPaise: toPaise(quote.discountTotal),
    grandTotalPaise: toPaise(quote.grandTotal),
    coinsBalancePaise: quote.coins.balancePaise,
    coinsUsedPaise: quote.coins.usedPaise,
    balanceAfterCoinsPaise: quote.coins.balanceAfterPaise,
    couponCode: quote.coupon?.code ?? null,
    address: address.display,
  };
}

/** A minimal equality check reused by route handlers and unit tests. */
export function isValidCartRequest(lines: CartIntentLine[]): boolean {
  return lines.length > 0
    && lines.length <= 200
    && lines.every((line) => Boolean(line.packId) && Number.isInteger(line.quantity) && line.quantity > 0 && line.quantity <= 100000)
    && new Set(lines.map((line) => line.packId.toLowerCase())).size === lines.length;
}
