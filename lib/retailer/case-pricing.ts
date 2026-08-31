/**
 * Case-based pricing engine (pure, side-effect free).
 *
 * BUSINESS MODEL
 * --------------
 * The CASE is the primary pricing unit. A product (via its sellable pack) has:
 *   - units_per_case  : how many pieces are inside one case (>= 1)
 *   - case_price      : the fixed, GST-INCLUSIVE selling price of ONE full case.
 *
 * The per-piece price is NEVER entered or stored manually. It is always derived:
 *   piecePrice = case_price / units_per_case
 *
 * Selling prices are GST-INCLUSIVE end to end. GST is never added on top of a
 * displayed selling price. At checkout the GST component is *extracted* from the
 * inclusive price (price * gst / (100 + gst)) so the invoice can show it.
 *
 * Quantity slabs (product_pricing_tiers) are evaluated on the total PIECES the
 * retailer buys (= pack quantity * units_per_case). Tiers use a half-open
 * [min_quantity, max_quantity) range; max_quantity NULL means "unbounded".
 * Priority is predictable: the matching tier with the largest min_quantity wins.
 *
 * These functions are intentionally pure so the exact same arithmetic runs on
 * the server (authoritative billing in lib/orders/quote-order) and in client
 * components (live cart/detail previews). Server re-quotation is still the
 * source of truth before an order is written.
 */

export interface PricingTier {
  id?: string;
  min_quantity: number;
  max_quantity: number | null;
  price_per_piece: number;
  rule_type?: 'default' | 'case' | 'bulk';
  label?: string | null;
  is_active?: boolean;
}

export function round2(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

/** Derived per-piece selling price from the fixed case price. Never stored. */
export function piecePriceFromCase(casePrice: number, unitsPerCase: number): number {
  if (!unitsPerCase || unitsPerCase < 1) return round2(casePrice);
  return round2(casePrice / unitsPerCase);
}

/**
 * Picks the applicable tier for a given number of pieces using a half-open
 * [min, max) range. The matching tier with the greatest min_quantity wins,
 * so bulk tiers naturally take priority as quantity grows. Returns null when
 * no tier matches (caller falls back to the derived piece price).
 */
export function pickApplicableTier(tiers: PricingTier[], pieces: number): PricingTier | null {
  const active = (tiers ?? []).filter((t) => t.is_active !== false);
  let best: PricingTier | null = null;
  for (const tier of active) {
    if (tier.min_quantity <= pieces && (tier.max_quantity === null || tier.max_quantity === undefined || pieces < tier.max_quantity)) {
      if (!best || tier.min_quantity > best.min_quantity) best = tier;
    }
  }
  return best;
}

export interface CaseLineBreakdown {
  pieces: number;
  piecePrice: number;
  casePrice: number;
  /** GST-INCLUSIVE total for the whole line. */
  total: number;
  /** GST amount already contained inside `total`. */
  gst: number;
  /** Total excluding the GST component (total - gst). */
  subtotal: number;
}

/**
 * Computes the GST-inclusive line total for `packQuantity` packs/cases of a
 * pack with the given case price, units-per-case and pricing tiers.
 *
 *   pieces       = packQuantity * unitsPerCase
 *   piecePrice   = applicable tier price (or case_price / unitsPerCase)
 *   total        = piecePrice * pieces          (GST-inclusive)
 *   gst          = total * gst / (100 + gst)    (extracted, not added)
 *   subtotal     = total - gst
 */
export function caseLineBreakdown(input: {
  casePrice: number;
  unitsPerCase: number;
  tiers?: PricingTier[];
  packQuantity: number;
  gstPercent: number;
}): CaseLineBreakdown {
  const { casePrice, unitsPerCase, tiers = [], packQuantity, gstPercent } = input;
  const units = unitsPerCase > 0 ? unitsPerCase : 1;
  const pieces = Math.max(1, Math.round(packQuantity)) * units;

  const tier = pickApplicableTier(tiers, pieces);
  const piecePrice = tier ? round2(tier.price_per_piece) : piecePriceFromCase(casePrice, units);

  const total = round2(piecePrice * pieces);
  const gst = round2((total * gstPercent) / (100 + gstPercent));
  const subtotal = round2(total - gst);

  return { pieces, piecePrice, casePrice: round2(casePrice), total, gst, subtotal };
}

/** Extracts the GST component contained inside a GST-inclusive amount. */
export function gstComponentFromInclusive(inclusive: number, gstPercent: number): number {
  return round2((inclusive * gstPercent) / (100 + gstPercent));
}

/**
 * Validates a set of tiers for a pack. Returns an error string, or null when
 * the tiers are internally consistent.
 *
 * Rules:
 *  - min_quantity >= 1
 *  - max_quantity, when set, must be > min_quantity
 *  - price_per_piece >= 0
 *  - ranges must not overlap (half-open [min, max))
 */
export function validateTiers(tiers: PricingTier[]): string | null {
  const rows = (tiers ?? []).filter((t) => t.is_active !== false);
  if (rows.length === 0) return null;

  for (const tier of rows) {
    if (!Number.isInteger(tier.min_quantity) || tier.min_quantity < 1) {
      return 'Each pricing rule needs a minimum quantity of at least 1.';
    }
    if (tier.max_quantity !== null && tier.max_quantity !== undefined) {
      if (!Number.isInteger(tier.max_quantity)) return 'Maximum quantity must be a whole number.';
      if (tier.max_quantity <= tier.min_quantity) {
        return 'A pricing rule maximum must be greater than its minimum.';
      }
    }
    if (typeof tier.price_per_piece !== 'number' || !isFinite(tier.price_per_piece) || tier.price_per_piece < 0) {
      return 'A pricing rule price cannot be negative.';
    }
  }

  // Overlap detection on the half-open [min, max) ranges.
  const sorted = [...rows].sort((a, b) => a.min_quantity - b.min_quantity);
  for (let i = 0; i < sorted.length - 1; i++) {
    const current = sorted[i]!;
    const next = sorted[i + 1]!;
    const currentEnd = current.max_quantity ?? Number.MAX_SAFE_INTEGER;
    if (currentEnd > next.min_quantity) {
      return 'Pricing rules cannot overlap. Adjust the quantity ranges.';
    }
  }
  return null;
}
