import 'server-only';

import type { createClient } from '@/lib/supabase/server';
import type { MobileSession } from '@/lib/mobile/auth';
import { sameCartIntent, type CartIntentLine } from '@/lib/mobile/commerce-shared';
import { PRODUCT_CARD_SELECT, loadCatalogPricing, priceCatalogPack, type CatalogProductRow } from '@/lib/retailer/catalog';
import { toPaise } from '@/lib/retailer/case-pricing';
import { loadActiveCouponForRetailer } from '@/lib/coupons/validate';
import { quoteOrderForRetailer } from '@/lib/orders/quote-order';
import { formatAddressLine } from '@/lib/retailer/address-shared';
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
}

export interface ResolvedMobileAddress {
  id: string | null;
  display: MobileAddressOption;
  snapshot: { line: string; label?: string; receiverName?: string; phone?: string };
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

/** Customer-facing cart snapshot: identity + current server pricing + status-only stock. */
export async function loadMobileCart(session: MobileSession): Promise<{
  lines: MobileCartLine[];
  couponCode: string | null;
  couponUnavailable: boolean;
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
    return {
      id: row.cart_item_id,
      packId: row.pack_id,
      productId: row.product_id,
      productName: row.product_name,
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
      message: pricing?.message ?? (active ? null : 'This saved item is no longer available to order.'),
    };
  });

  return { lines, couponCode, couponUnavailable };
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

  const options: MobileAddressOption[] = (saved ?? []).map((row) => ({
    id: row.id,
    label: row.label,
    line: formatAddressLine(row),
    receiverName: row.receiver_name,
    phone: row.phone,
    isDefault: row.is_default,
  }));
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

/** Resolve and freeze only a saved address owned by this retailer or their profile address. */
export async function resolveMobileAddress(
  session: MobileSession,
  addressId: string | null
): Promise<ResolvedMobileAddress> {
  if (!addressId) {
    const profileAddress = (await loadMobileAddresses(session)).find((address) => address.id === null);
    if (!profileAddress) {
      throw new MobileCommerceError('invalid_request', 400, 'Add a saved delivery address or a registered shop address before continuing.');
    }
    return {
      id: null,
      display: profileAddress,
      snapshot: {
        line: profileAddress.line,
        label: profileAddress.label,
        receiverName: profileAddress.receiverName ?? undefined,
        phone: profileAddress.phone ?? undefined,
      },
    };
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
  };
  return {
    id: data.id,
    display,
    snapshot: {
      line: display.line,
      label: display.label,
      receiverName: display.receiverName ?? undefined,
      phone: display.phone ?? undefined,
    },
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

/**
 * The shell's live counters.
 *
 * The web retailer layout (`app/retailer/layout.tsx`) paints the cart badge and
 * the unread-notification badge from exactly two head-counts, and this is the
 * same pair through the same caller-scoped client: no number is ever derived on
 * the device, and no row content crosses the boundary — only the counts.
 *
 * Both reads are owner-filtered twice over: the explicit `.eq()` and the table's
 * own RLS (`cart_items.cart_owner`, `notifications.notifications_owner`), so a
 * caller can only ever count their own rows.
 */
export interface MobileShellCounts {
  /** Saved cart LINES (not piece quantity), as the web badge counts them. */
  cartCount: number;
  unreadNotificationCount: number;
}

export async function loadMobileShellCounts(session: MobileSession): Promise<MobileShellCounts> {
  const supabase = callerClient(session);
  const [
    { count: cartCount, error: cartError },
    { count: unreadCount, error: notificationError },
  ] = await Promise.all([
    supabase
      .from('cart_items')
      .select('id', { count: 'exact', head: true })
      .eq('retailer_id', session.userId),
    supabase
      .from('notifications')
      .select('id', { count: 'exact', head: true })
      .eq('recipient_id', session.userId)
      .eq('is_read', false),
  ]);

  if (cartError || notificationError) {
    throw databaseError('The shop counters could not be loaded. Please try again.');
  }
  return { cartCount: cartCount ?? 0, unreadNotificationCount: unreadCount ?? 0 };
}

/** A minimal equality check reused by route handlers and unit tests. */
export function isValidCartRequest(lines: CartIntentLine[]): boolean {
  return lines.length > 0
    && lines.length <= 200
    && lines.every((line) => Boolean(line.packId) && Number.isInteger(line.quantity) && line.quantity > 0 && line.quantity <= 100000)
    && new Set(lines.map((line) => line.packId.toLowerCase())).size === lines.length;
}
