import 'server-only';

import { createClient } from '@/lib/supabase/server';
import { validateCouponForOrder } from '@/lib/coupons/validate';
import { roundMoney } from '@/lib/orders/credit';
import { getProductPriceOverrides, resolvePackCasePrice } from '@/lib/retailer/effective-price';
import { calculateRetailerPiecePrice, type RetailerPiecePricing } from '@/lib/retailer/retailer-pricing';
import type { PricingTier } from '@/lib/retailer/case-pricing';
import { loadPackTiers } from '@/lib/retailer/pricing-data';
import { getRetailerWalletPosition, rupeesToPaise } from '@/lib/retailer/wallet';
import { loadMarketplaceOfferQuotes } from '@/lib/retailer/marketplace-offers';
import { computeCoinPayment, coinBalancePaise, type CoinPayment } from '@/lib/coins/math';

export interface RequestedQuoteLine {
  packId: string;
  /**
   * Total PIECES the retailer wants (0026 onward — before this migration the
   * same field counted whole packs/cases). A line may therefore be a partial
   * case (6 pcs), exactly one case (40 pcs) or a case count plus a remainder
   * (46 pcs = 1 case + 6 loose).
   */
  quantity: number;
  /**
   * Seller offer identity for split-order lines (0064 line_key 's:<offer>').
   * Omitted/null means the legacy Maharani pack line ('m'). The SAME pack may
   * appear once as a Maharani line AND once per seller offer.
   */
  sellerOfferId?: string | null;
}

/**
 * One persisted `order_items` row for the current retailer piece quote.
 * `quantity` and `quantityPieces` are the same whole-piece count, and
 * `unit_price × quantity = line_total` exactly. Historical orders may still
 * contain case-backed rows; new retailer checkout never splits a line by case.
 */
export interface QuotedOrderItem {
  quantity: number;
  quantityUnit: 'pieces';
  /** Pieces this row covers, snapshotted for invoice/reorder/dispatch. */
  quantityPieces: number;
  unitsPerCase: number;
  /** GST-INCLUSIVE price of ONE row unit. */
  unitPrice: number;
  /** GST-INCLUSIVE line total for this row. */
  lineTotal: number;
  /** GST-exclusive value of the row. */
  subtotal: number;
  /** GST component already contained inside `lineTotal`. */
  gst: number;
}

export interface QuotedOrderLine {
  productId: string;
  productName: string;
  /** Scoping ids for coupon eligibility (0051); null when the product has none. */
  categoryId: string | null;
  brandId: string | null;
  packId: string;
  packName: string;
  /** Pieces ordered. */
  quantity: number;
  moq: number;
  unitsPerCase: number;
  pieces: number;
  cases: number;
  loosePieces: number;
  piecePrice: number;
  casePrice: number;
  /**
   * Effective GST-INCLUSIVE price per piece actually charged on this line
   * (`lineTotal / pieces`), for display only. The persisted rows never use it:
   * each `order_items` row carries its own exact `unit_price`, so a mixed
   * line cannot introduce a rounding drift anywhere in accounting.
   */
  unitPrice: number;
  gstPercent: number;
  /** Line total EXCLUDING the GST component. */
  subtotal: number;
  /** GST component already contained inside `lineTotal`. */
  gst: number;
  /** GST-INCLUSIVE line total. */
  lineTotal: number;
  /** Case price used (source of truth), and the loose rate that was applied. */
  looseUnitPrice: number | null;
  loosePriceSource: 'tier' | 'derived' | 'gap' | 'none';
  /** The loose slab that priced the remainder, when one applied. */
  looseTier: PricingTier | null;
  /** Exactly one piece-backed row is persisted for this current retailer quote. */
  items: QuotedOrderItem[];
  /** Split-order identity: the seller offer behind this line, or null (legacy pack line). */
  sellerOfferId?: string | null;
}

export interface QuotedCoupon {
  id: string;
  code: string;
  /** Rupees subtracted from the GST-inclusive grand total. */
  discount: number;
}

export interface OrderQuote {
  retailerId: string;
  subtotal: number;
  gstTotal: number;
  discountTotal: number;
  grandTotal: number;
  lines: QuotedOrderLine[];
  /**
   * 🪙 Coins position for THIS order. Authoritative: computed from the wallet
   * ledger and the quoted total, never from anything the client sent.
   */
  coins: CoinPayment;
  /** Set when a valid coupon was revalidated and applied (0051). */
  coupon: QuotedCoupon | null;
  /**
   * Fulfilment profile derived from the quoted lines (0064): all_seller means
   * no pack-stock lines — checkout needs no Maharani warehouse. Omitted for
   * legacy quotes (always all_maharani).
   */
  fulfilmentProfile?: 'all_maharani' | 'mixed' | 'all_seller';
}

export type QuoteOrderResult =
  | { error: string; code?: 'coupon_invalid' }
  | { quote: OrderQuote };

/**
 * Legacy GST calculation helper (GST added on top of a pre-tax price).
 *
 * The case-based pricing model is GST-INCLUSIVE, so this helper is only kept
 * for backwards compatibility with older call sites/tests. New pricing paths
 * use `calculateCaseLoosePrice`, which treats the selling price as inclusive
 * and extracts the GST component instead of adding it.
 */
export function calculateTaxedLine(unitPrice: number, quantity: number, gstPercent: number) {
  const subtotal = roundMoney(unitPrice * quantity);
  const gst = roundMoney((subtotal * gstPercent) / 100);
  return { subtotal, gst, total: roundMoney(subtotal + gst) };
}

interface RetailerForQuote {
  id: string;
  area_id: string;
  status: 'pending_approval' | 'active' | 'suspended';
}

interface PackForQuote {
  id: string;
  product_id: string;
  pack_name: string;
  base_price: number;
  ptr: number | null;
  case_price: number;
  units_per_case: number;
  moq: number;
  is_active: boolean;
  // category_id/brand_id feed the coupon eligibility engine (0051) without a
  // second read; they are never rendered as pricing.
  products: {
    id: string;
    name: string;
    gst_percent: number;
    is_active: boolean;
    category_id: string | null;
    brand_id: string | null;
  } | null;
}

export function normalizeQuoteLines(lines: RequestedQuoteLine[]): { error: string } | { lines: Map<string, number> } {
  if (lines.length === 0) return { error: 'Add at least one product to the order.' };
  if (lines.length > 200) return { error: 'An order can contain at most 200 different packs.' };

  const normalized = new Map<string, number>();
  for (const line of lines) {
    // `quantity` is a piece count: any whole number of pieces is acceptable,
    // whether or not it lines up with a full case.
    if (!line.packId || !Number.isInteger(line.quantity) || line.quantity < 1 || line.quantity > 100000) {
      return { error: 'Every order line must have a valid whole number of pieces.' };
    }
    if (normalized.has(line.packId)) return { error: 'The same pack cannot be added more than once.' };
    normalized.set(line.packId, line.quantity);
  }
  return { lines: normalized };
}

/**
 * Authoritative, read-only order validation and quote path. It reuses the same
 * catalog, MOQ, case + loose-piece, GST-inclusive and coin rules as order
 * creation. Callers may present this quote, but createOrderForRetailer always
 * quotes again before a write so a stale AI/cart quote can never become an
 * order unchecked.
 *
 * NOTHING about money comes from the client. The browser contributes only
 * "which pack, how many pieces". Case price, loose tier, tier selection,
 * discount, GST and every total are re-read and re-computed here from
 * Supabase, through the same pure engine the UI previews with.
 */
export async function quoteOrderForRetailer({
  retailerId,
  lines,
  supabase = createClient(),
  couponCode,
}: {
  retailerId: string;
  lines: RequestedQuoteLine[];
  supabase?: ReturnType<typeof createClient>;
  /**
   * Raw coupon code, if the retailer has one applied to the cart. The code is
   * REVALIDATED here against fresh database state — an expired, exhausted or
   * ineligible coupon fails the whole quote rather than billing a stale
   * discount. No discount VALUE is ever accepted from the caller.
   */
  couponCode?: string | null;
}): Promise<QuoteOrderResult> {
  // Split-order lines (same pack via a seller offer) need line-identity
  // normalisation and offer pricing; legacy callers take the original path
  // unchanged below.
  if (lines.some((line) => Boolean(line.sellerOfferId))) {
    return quoteSplitOrderForRetailer({ retailerId, lines, supabase, couponCode });
  }
  const normalizedResult = normalizeQuoteLines(lines);
  if ('error' in normalizedResult) return normalizedResult;
  const normalized = normalizedResult.lines;

  const { data: retailer, error: retailerError } = await supabase
    .from('retailers')
    .select('id, area_id, status')
    .eq('id', retailerId)
    .maybeSingle<RetailerForQuote>();

  if (retailerError || !retailer) return { error: 'Retailer not found or not assigned to you.' };
  if (retailer.status !== 'active') return { error: 'Orders can only be created for an active retailer.' };

  // Authoritative coin position from the wallet ledger (integer paise). The
  // helper falls back to the legacy mirror columns if the wallet RPCs are not
  // yet deployed, so this never breaks an existing quote path.
  // 🪙 The authoritative balance for this quote, read from the wallet ledger.
  const walletPosition = await getRetailerWalletPosition(supabase, retailer.id);

  const { data: packData, error: packError } = await supabase
    .from('product_packs')
    .select(
      'id, product_id, pack_name, base_price, ptr, case_price, units_per_case, moq, is_active, products ( id, name, gst_percent, is_active, category_id, brand_id )'
    )
    .in('id', [...normalized.keys()]);
  if (packError) return { error: 'The product catalog could not be loaded. Please try again.' };

  const packs = (packData ?? []) as unknown as PackForQuote[];
  const packById = new Map(packs.map((pack) => [pack.id, pack]));
  for (const [packId, quantity] of normalized) {
    const pack = packById.get(packId);
    if (!pack?.products) return { error: 'One of the selected packs no longer exists.' };
    if (!pack.is_active || !pack.products.is_active) {
      return { error: `${pack.products.name} (${pack.pack_name}) is no longer available.` };
    }
    // MOQ is a PIECE floor and never forces a full case.
    if (quantity < pack.moq) {
      return {
        error: `Minimum order quantity for ${pack.products.name} (${pack.pack_name}) is ${pack.moq} pcs.`,
      };
    }
  }

  const productIds = [...new Set(packs.map((pack) => pack.product_id))];
  const overrides = await getProductPriceOverrides(supabase, productIds, retailer.id, retailer.area_id);
  const tierMap = await loadPackTiers(supabase, [...normalized.keys()]);

  let subtotal = 0;
  let gstTotal = 0;
  const quotedLines: QuotedOrderLine[] = [];
  for (const [packId, quantity] of normalized) {
    const pack = packById.get(packId)!;
    const product = pack.products!;

    const casePrice = roundMoney(resolvePackCasePrice(pack, overrides.get(pack.product_id) ?? null));
    // Retailer piece pricing: quantity Q is billed as Q × (per-piece tier rate).
    // The case price is INTERNAL only — it is never shown to the retailer and is
    // used here solely as the derived-per-piece fallback when a pack has no
    // configured selling tiers. The same function the product page, cart and
    // checkout preview with, re-run authoritatively before anything is written.
    // The existing retailer cart/quote contract accepts whole-piece quantities
    // at a one-piece increment; MOQ is a separate piece floor. `allow_loose_pieces`
    // is not part of this current retailer piece-pricing rule.
    const pricing: RetailerPiecePricing = calculateRetailerPiecePrice({
      quantity,
      unitsPerCase: pack.units_per_case,
      casePrice,
      tiers: tierMap.get(packId) ?? [],
      gstPercent: product.gst_percent,
      moq: pack.moq,
    });

    // The engine has the final say on orderability: an unwhole quantity, an
    // unpriced tier gap or a below-MOQ request is rejected here rather than
    // being silently priced by another rule.
    if (!pricing.orderable) {
      return {
        error: `${product.name} (${pack.pack_name}): ${pricing.message ?? 'That quantity cannot be ordered right now.'}`,
      };
    }

    // One exact row per line, billed in PIECES at the applicable tier rate so
    // unit_price × quantity = line_total holds exactly (in paise). The retailer
    // buys pieces — there is no case/loose split to persist.
    const item: QuotedOrderItem = {
      quantity,
      quantityUnit: 'pieces',
      quantityPieces: quantity,
      unitsPerCase: pack.units_per_case,
      unitPrice: pricing.unitPrice,
      lineTotal: pricing.lineTotal,
      subtotal: pricing.subtotal,
      gst: pricing.gst,
    };

    subtotal = roundMoney(subtotal + pricing.subtotal);
    gstTotal = roundMoney(gstTotal + pricing.gst);

    quotedLines.push({
      productId: pack.product_id,
      productName: product.name,
      categoryId: product.category_id,
      brandId: product.brand_id,
      packId,
      packName: pack.pack_name,
      quantity,
      moq: pack.moq,
      unitsPerCase: pack.units_per_case,
      pieces: pricing.quantity,
      cases: 0,
      loosePieces: 0,
      piecePrice: pricing.unitPrice,
      // Internal only — never rendered to a retailer.
      casePrice: 0,
      unitPrice: pricing.unitPrice,
      gstPercent: product.gst_percent,
      subtotal: pricing.subtotal,
      gst: pricing.gst,
      lineTotal: pricing.lineTotal,
      looseUnitPrice: pricing.unitPrice,
      loosePriceSource: pricing.priceSource,
      looseTier: pricing.tier,
      items: [item],
    });
  }

  // COUPON (0051) — the ONLY discount layer. It is applied to the GST-inclusive
  // grand total as a rupee reduction: per-line GST extraction (above) is left
  // completely untouched, order_items rows are unchanged, and
  // `discount_total`/`grand_total` on the persisted order reconcile exactly.
  let discountTotal = 0;
  let quotedCoupon: QuotedCoupon | null = null;
  const code = (couponCode ?? '').trim().toUpperCase();
  if (code) {
    const couponLines = quotedLines.map((line) => ({
      productId: line.productId,
      categoryId: line.categoryId,
      brandId: line.brandId,
      subtotal: line.subtotal,
    }));
    const validation = await validateCouponForOrder(supabase, {
      retailerId: retailer.id,
      code,
      lines: couponLines,
    });
    if (!validation.valid) {
      return { error: validation.message, code: 'coupon_invalid' };
    }
    discountTotal = validation.discount;
    quotedCoupon = { id: validation.coupon.id, code: validation.coupon.code, discount: validation.discount };
  }

  const grandTotal = roundMoney(subtotal + gstTotal - discountTotal);
  // 🪙 Coins: the server decides how much of this total the balance covers. The
  // remainder is what the shop pays on delivery — an order is never refused for
  // lack of coins.
  const coins = computeCoinPayment({
    orderTotalPaise: rupeesToPaise(grandTotal),
    balancePaise: coinBalancePaise(walletPosition.creditLimitPaise, walletPosition.outstandingPaise),
  });
  return {
    quote: {
      retailerId: retailer.id,
      subtotal,
      gstTotal,
      discountTotal,
      grandTotal,
      lines: quotedLines,
      coins,
      coupon: quotedCoupon,
    },
  };
}

/**
 * Split-order quote (0064 line identity): the same authoritative rules as
 * quoteOrderForRetailer, extended so one pack can appear BOTH as a Maharani
 * line and as seller-offer lines. Seller lines are priced from the offer
 * snapshot (integer paise) through the SAME GST-inclusive engine; MOQ comes
 * from the offer. Offer state (active/moderation/seller) is revalidated here
 * and again at cart mutation and inside create_order_atomic_v2.
 */
export async function quoteSplitOrderForRetailer({
  retailerId,
  lines,
  supabase = createClient(),
  couponCode,
}: {
  retailerId: string;
  lines: RequestedQuoteLine[];
  supabase?: ReturnType<typeof createClient>;
  couponCode?: string | null;
}): Promise<QuoteOrderResult> {
  const identities = new Map<string, { packId: string; sellerOfferId: string | null; quantity: number }>();
  if (lines.length === 0) return { error: 'Add at least one product to the order.' };
  if (lines.length > 200) return { error: 'An order can contain at most 200 different packs.' };
  for (const line of lines) {
    if (!line.packId || !Number.isInteger(line.quantity) || line.quantity < 1 || line.quantity > 100000) {
      return { error: 'Every order line must have a valid whole number of pieces.' };
    }
    const sellerOfferId = line.sellerOfferId ?? null;
    const key = `${line.packId}|${sellerOfferId ?? 'm'}`;
    if (identities.has(key)) {
      return { error: 'The same pack cannot be added more than once.' };
    }
    identities.set(key, { packId: line.packId, sellerOfferId, quantity: line.quantity });
  }

  const { data: retailer, error: retailerError } = await supabase
    .from('retailers')
    .select('id, area_id, status')
    .eq('id', retailerId)
    .maybeSingle<RetailerForQuote>();
  if (retailerError || !retailer) return { error: 'Retailer not found or not assigned to you.' };
  if (retailer.status !== 'active') return { error: 'Orders can only be created for an active retailer.' };

  const walletPosition = await getRetailerWalletPosition(supabase, retailer.id);

  const packIds = [...new Set([...identities.values()].map((entry) => entry.packId))];
  const { data: packData, error: packError } = await supabase
    .from('product_packs')
    .select(
      'id, product_id, pack_name, base_price, ptr, case_price, units_per_case, moq, is_active, products ( id, name, gst_percent, is_active, category_id, brand_id )'
    )
    .in('id', packIds);
  if (packError) return { error: 'The product catalog could not be loaded. Please try again.' };
  const packs = (packData ?? []) as unknown as PackForQuote[];
  const packById = new Map(packs.map((pack) => [pack.id, pack]));

  interface OfferForQuote {
    id: string;
    seller_id: string;
    pack_id: string;
    product_id: string;
    fulfilment_type: 'seller' | 'maharani';
    unit_price_paise: number;
    moq: number;
    stock_quantity: number | null;
    is_active: boolean;
    moderation_status: 'pending' | 'approved' | 'rejected';
  }
  const offerIds = [...identities.values()]
    .map((entry) => entry.sellerOfferId)
    .filter((id): id is string => Boolean(id));
  let offerById = new Map<string, OfferForQuote>();
  if (offerIds.length > 0) {
    // Retailers cannot read seller_offers/sellers directly. 0069 exposes only
    // the live trading fields required to quote these persisted offer ids.
    const { offers, error: offersError } = await loadMarketplaceOfferQuotes(supabase, offerIds);
    if (offersError) return { error: 'The seller offers could not be loaded. Please try again.' };
    offerById = new Map(offers.map((row) => [row.offerId, {
      id: row.offerId,
      seller_id: row.sellerId,
      pack_id: row.packId,
      product_id: row.productId,
      fulfilment_type: row.fulfilmentType,
      unit_price_paise: row.unitPricePaise,
      moq: row.moq,
      stock_quantity: row.stockQuantity,
      is_active: true,
      moderation_status: 'approved' as const,
    }]));
    for (const entry of identities.values()) {
      if (!entry.sellerOfferId) continue;
      const offer = offerById.get(entry.sellerOfferId);
      if (!offer || offer.pack_id !== entry.packId) {
        return { error: 'One of the selected seller offers is no longer available.' };
      }
    }
  }

  const productIds = [...new Set(packs.map((pack) => pack.product_id))];
  const overrides = await getProductPriceOverrides(supabase, productIds, retailer.id, retailer.area_id);
  const tierMap = await loadPackTiers(supabase, packIds);

  let subtotal = 0;
  let gstTotal = 0;
  let packStockLines = 0;
  let sellerStockLines = 0;
  const quotedLines: QuotedOrderLine[] = [];
  for (const entry of identities.values()) {
    const pack = packById.get(entry.packId);
    if (!pack?.products) return { error: 'One of the selected packs no longer exists.' };
    const product = pack.products;
    const offer = entry.sellerOfferId ? offerById.get(entry.sellerOfferId) : undefined;

    if (!offer) {
      if (!pack.is_active || !product.is_active) {
        return { error: `${product.name} (${pack.pack_name}) is no longer available.` };
      }
    }

    const quantity = entry.quantity;
    const moq = offer ? Math.max(offer.moq, 1) : pack.moq;
    if (quantity < moq) {
      return {
        error: `Minimum order quantity for ${product.name} (${pack.pack_name}) is ${moq} pcs.`,
      };
    }
    if (offer && (offer.stock_quantity ?? 0) < quantity) {
      return {
        error: `Only ${Math.max(offer.stock_quantity ?? 0, 0)} pcs are currently available for ${product.name} (${pack.pack_name}).`,
      };
    }

    let pricing: RetailerPiecePricing;
    if (offer) {
      if (offer.product_id !== pack.product_id) {
        return { error: 'One of the selected seller offers no longer matches this pack.' };
      }
      pricing = calculateRetailerPiecePrice({
        quantity,
        unitsPerCase: pack.units_per_case,
        casePrice: 0,
        tiers: [],
        gstPercent: product.gst_percent,
        moq,
        derivedPiecePrice: offer.unit_price_paise / 100,
      });
    } else {
      const casePrice = roundMoney(resolvePackCasePrice(pack, overrides.get(pack.product_id) ?? null));
      pricing = calculateRetailerPiecePrice({
        quantity,
        unitsPerCase: pack.units_per_case,
        casePrice,
        tiers: tierMap.get(pack.id) ?? [],
        gstPercent: product.gst_percent,
        moq,
      });
    }

    if (!pricing.orderable) {
      return {
        error: `${product.name} (${pack.pack_name}): ${pricing.message ?? 'That quantity cannot be ordered right now.'}`,
      };
    }

    if (offer) {
      if (offer.fulfilment_type === 'seller') {
        sellerStockLines += 1;
      } else {
        packStockLines += 1;
      }
    } else {
      packStockLines += 1;
    }

    const item: QuotedOrderItem = {
      quantity,
      quantityUnit: 'pieces',
      quantityPieces: quantity,
      unitsPerCase: pack.units_per_case,
      unitPrice: pricing.unitPrice,
      lineTotal: pricing.lineTotal,
      subtotal: pricing.subtotal,
      gst: pricing.gst,
    };
    subtotal = roundMoney(subtotal + pricing.subtotal);
    gstTotal = roundMoney(gstTotal + pricing.gst);

    quotedLines.push({
      productId: pack.product_id,
      productName: product.name,
      categoryId: product.category_id,
      brandId: product.brand_id,
      packId: entry.packId,
      packName: pack.pack_name,
      quantity,
      moq,
      unitsPerCase: pack.units_per_case,
      pieces: pricing.quantity,
      cases: 0,
      loosePieces: 0,
      piecePrice: pricing.unitPrice,
      casePrice: 0,
      unitPrice: pricing.unitPrice,
      gstPercent: product.gst_percent,
      subtotal: pricing.subtotal,
      gst: pricing.gst,
      lineTotal: pricing.lineTotal,
      looseUnitPrice: pricing.unitPrice,
      loosePriceSource: pricing.priceSource,
      looseTier: pricing.tier,
      items: [item],
      sellerOfferId: entry.sellerOfferId,
    });
  }

  let discountTotal = 0;
  let quotedCoupon: QuotedCoupon | null = null;
  const code = (couponCode ?? '').trim().toUpperCase();
  if (code) {
    const couponLines = quotedLines.map((line) => ({
      productId: line.productId,
      categoryId: line.categoryId,
      brandId: line.brandId,
      subtotal: line.subtotal,
    }));
    const validation = await validateCouponForOrder(supabase, {
      retailerId: retailer.id,
      code,
      lines: couponLines,
    });
    if (!validation.valid) {
      return { error: validation.message, code: 'coupon_invalid' };
    }
    discountTotal = validation.discount;
    quotedCoupon = { id: validation.coupon.id, code: validation.coupon.code, discount: validation.discount };
  }

  const grandTotal = roundMoney(subtotal + gstTotal - discountTotal);
  const coins = computeCoinPayment({
    orderTotalPaise: rupeesToPaise(grandTotal),
    balancePaise: coinBalancePaise(walletPosition.creditLimitPaise, walletPosition.outstandingPaise),
  });

  const fulfilmentProfile =
    packStockLines > 0 && sellerStockLines > 0
      ? 'mixed'
      : sellerStockLines > 0
        ? 'all_seller'
        : 'all_maharani';

  return {
    quote: {
      retailerId: retailer.id,
      subtotal,
      gstTotal,
      discountTotal,
      grandTotal,
      lines: quotedLines,
      coins,
      coupon: quotedCoupon,
      fulfilmentProfile,
    },
  };
}
