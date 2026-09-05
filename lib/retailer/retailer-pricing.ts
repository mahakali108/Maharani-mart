import {
  fromPaise,
  piecePriceFromCase,
  resolveLooseTierSet,
  round2,
  toPaise,
  type PricingTier,
} from '@/lib/retailer/case-pricing';

/**
 * SMALL-RETAILER B2B PIECE MODEL — the single retailer-facing pricing engine.
 *
 * The retailer buys PIECES, never cases. Quantity Q is priced as Q × (the
 * per-piece rate of the selling tier that covers Q). Cases, case prices,
 * units-per-case, supplier cost and admin margin are INTERNAL concepts for the
 * seller / warehouse and must never reach the retailer.
 *
 * The internal case model (`calculateCaseLoosePrice`) is deliberately left
 * untouched: it still powers supplier ordering, warehouse stock, internal
 * costing and any future wholesale. This module is the RETAILER lens.
 */

/** Where the per-piece rate came from. */
export type RetailerPieceSource = 'tier' | 'derived' | 'none';

/** A retailer-priced line. `lineTotal` is the GST-inclusive amount. */
export interface RetailerPiecePricing {
  /** Total number of pieces ordered (billing quantity). */
  quantity: number;
  /** GST-inclusive rate per piece (₹). */
  unitPrice: number;
  /** The selling tier that priced this quantity, if any. */
  tier: PricingTier | null;
  /** Whether `unitPrice` came from a configured selling tier or was derived. */
  priceSource: RetailerPieceSource;
  /** The active tiers shown to the retailer as a quantity discount table. */
  tiers: PricingTier[];
  /** GST-inclusive line total (quantity × unitPrice). */
  lineTotal: number;
  /** GST component that is already inside `lineTotal`. */
  gst: number;
  /** Sub-total (lineTotal − gst). */
  subtotal: number;
  /** Whether this quantity can be ordered as written. */
  orderable: boolean;
  /** Human-readable reason when not orderable; otherwise null. */
  message: string | null;
}

export interface RetailerPiecePricingInput {
  quantity: number;
  /** Internal case size, used only to derive a fallback piece rate when no
   *  selling tiers are configured. It is NOT a retailer buying requirement. */
  unitsPerCase: number;
  /** Internal GST-inclusive case price, used only as the derivation fallback. */
  casePrice: number;
  /** Active selling tiers (loose / non-case) for this variant. */
  tiers?: PricingTier[] | null;
  /** GST (inclusive) for the variant, used to split the inclusive total. */
  gstPercent?: number;
  /** Minimum order quantity in pieces. */
  moq?: number;
  /**
   * Server-resolved GST-inclusive per-piece rate used when the variant has no
   * configured selling tiers. When provided it replaces the internal
   * `casePrice / unitsPerCase` derivation, so a retailer-facing surface never
   * has to carry the internal case price through to the browser.
   */
  derivedPiecePrice?: number;
}

/**
 * Pick the selling tier that prices `quantity` pieces. The topmost slab is
 * extended so the retailer can order 80, 92, 200… pcs without a case boundary.
 */
export function pickRetailerPieceTier(
  tiers: PricingTier[] | null | undefined,
  quantity: number
): PricingTier | null {
  const active = (tiers ?? [])
    .filter((tier) => tier.is_active !== false && tier.min_quantity >= 1)
    .sort((a, b) => a.min_quantity - b.min_quantity);

  for (const tier of active) {
    if (tier.min_quantity <= quantity && (tier.max_quantity === null || tier.max_quantity === undefined || quantity < tier.max_quantity)) {
      return tier;
    }
  }

  // No tier contains `quantity` (it sits above every slab): keep the best rate
  // by extending the deepest tier.
  return active.length > 0 ? (active[active.length - 1] ?? null) : null;
}

/** Build the retailer-facing tier table for the selected variant. */
function retailerTierTable(
  tiers: PricingTier[] | null | undefined,
  unitsPerCase: number,
  casePrice: number,
  derivedPiecePrice?: number
): { tiers: PricingTier[]; priceSource: RetailerPieceSource; unitPrice: number } {
  const resolved = resolveLooseTierSet(tiers ?? [], unitsPerCase);
  if (resolved.tiers.length > 0) {
    return { tiers: resolved.tiers, priceSource: 'tier', unitPrice: 0 };
  }
  const derived = derivedPiecePrice && derivedPiecePrice > 0
    ? derivedPiecePrice
    : piecePriceFromCase(casePrice, unitsPerCase);
  return { tiers: [], priceSource: 'derived', unitPrice: derived };
}

/**
 * Price `quantity` pieces for the retailer.
 *
 * `lineTotal` is GST-INCLUSIVE. GST is extracted (never added on top) and the
 * totals are computed in integer paise so `quantity × unitPrice` equals the
 * line total exactly.
 */
export function calculateRetailerPiecePrice(input: RetailerPiecePricingInput): RetailerPiecePricing {
  const {
    quantity: rawQuantity,
    unitsPerCase,
    casePrice,
    tiers,
    gstPercent = 0,
    moq,
    derivedPiecePrice,
  } = input;

  const quantity = Math.trunc(rawQuantity);
  const validShape =
    rawQuantity > 0 &&
    rawQuantity <= 100_000 &&
    Number.isInteger(rawQuantity);

  const { tiers: table, priceSource, unitPrice: derivedUnitPrice } = retailerTierTable(
    tiers,
    unitsPerCase,
    casePrice,
    derivedPiecePrice
  );

  const tier = pickRetailerPieceTier(table, quantity);
  const source: RetailerPieceSource = tier ? 'tier' : priceSource;
  const unitPrice = tier ? tier.price_per_piece : derivedUnitPrice;

  // Integer-paise arithmetic so the GST-inclusive line total is exact.
  const totalPaise = toPaise(round2(unitPrice)) * quantity;
  const lineTotal = fromPaise(totalPaise);
  const gst = gstPercent > 0 ? fromPaise(Math.round((totalPaise * gstPercent) / (100 + gstPercent))) : 0;
  const subtotal = round2(lineTotal - gst);

  let orderable = validShape;
  let message: string | null = null;

  if (!validShape) {
    message =
      rawQuantity <= 0
        ? 'Enter a quantity of at least 1 piece.'
        : rawQuantity > 100_000
          ? 'That quantity is too large. Please contact us.'
          : 'Quantity must be a whole number of pieces.';
  } else if (moq != null && moq > 0 && quantity < moq) {
    orderable = false;
    message = `Minimum order quantity is ${moq} pcs.`;
  } else if (unitPrice <= 0) {
    orderable = false;
    message = 'Please set a selling price for this pack before ordering.';
  }

  return {
    quantity,
    unitPrice: round2(unitPrice),
    tier: tier ?? null,
    priceSource: source,
    tiers: table,
    lineTotal,
    gst: round2(gst),
    subtotal,
    orderable,
    message: orderable ? null : message,
  };
}
