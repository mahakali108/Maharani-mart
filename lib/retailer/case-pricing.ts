/**
 * Case + loose-piece wholesale pricing engine (pure, side-effect free).
 *
 * ─────────────────────────────────────────────────────────────────────────
 * BUSINESS MODEL
 * ─────────────────────────────────────────────────────────────────────────
 * A sellable pack (`product_packs`) carries:
 *
 *   units_per_case      how many pieces are inside one full case (>= 1)
 *   case_price          the fixed, GST-INCLUSIVE selling price of ONE full case
 *   allow_loose_pieces  whether a retailer may buy a partial case (default yes)
 *   moq                 minimum order quantity, measured in PIECES
 *
 * and it owns a set of quantity tiers (`product_pricing_tiers`) that price the
 * LOOSE remainder piece-by-piece:
 *
 *   1–6 pcs → ₹30/pc     7–12 pcs → ₹28/pc     13–20 pcs → ₹27/pc     …
 *
 * ─────────────────────────────────────────────────────────────────────────
 * THE ONE RULE THAT MATTERS
 * ─────────────────────────────────────────────────────────────────────────
 * Case pricing and loose-piece pricing are two different pricing systems and
 * they are NEVER mixed:
 *
 *   fullCases     = floor(Q / unitsPerCase)      priced at case_price, always
 *   looseQuantity = Q % unitsPerCase             priced at the loose tier that
 *                                                matches the REMAINDER (not Q)
 *
 * A full case is never repriced from a loose-piece rate, and a loose remainder
 * is never charged a case price. For Q = 85 with a 40-piece case that is
 * 2 × ₹1,000 + 5 × ₹30 = ₹2,150 — never 85 × ₹25 and never 3 × ₹1,000.
 *
 * When the admin has configured loose tiers, a remainder that no tier covers is
 * a GAP: it is reported as not orderable instead of silently being priced from
 * some other rule. A pack that has no loose tiers configured at all (every pack
 * that predates this feature, which carries a single derived 'default' tier)
 * keeps its historical behaviour: the remainder is priced at the derived
 * per-piece price (case_price / units_per_case).
 *
 * ─────────────────────────────────────────────────────────────────────────
 * MONEY & GST
 * ─────────────────────────────────────────────────────────────────────────
 * All selling prices are GST-INCLUSIVE. GST is never added on top of a price a
 * retailer was shown; it is *extracted* from the inclusive amount
 * (`gstComponentFromInclusive`). Every rupee amount produced here is computed
 * through integer paise, so `caseSubtotal + looseSubtotal === total` is exact
 * by construction and no binary float drift can reach an invoice.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * SINGLE SOURCE OF TRUTH
 * ─────────────────────────────────────────────────────────────────────────
 * `calculateCaseLoosePrice` is the ONLY implementation of this arithmetic in
 * the codebase. Product page, cart, checkout, the server-side quote
 * (`lib/orders/quote-order.ts`), order persistence and the admin preview all
 * call it — no UI is allowed to restate the formula. The module is pure and
 * free of `server-only` imports so the exact same code can run in a client
 * component for a live preview; the server always re-computes authoritatively
 * before anything is written.
 */

export interface PricingTier {
  id?: string;
  /** Inclusive lower bound, in pieces. */
  min_quantity: number;
  /** Exclusive upper bound, in pieces. NULL = unbounded (last tier). */
  max_quantity: number | null;
  price_per_piece: number;
  rule_type?: 'default' | 'case' | 'bulk' | 'loose';
  label?: string | null;
  is_active?: boolean;
}

const PAISE_PER_RUPEE = 100;

export function round2(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

/** Rupees → whole paise. The engine's arithmetic is integer-only from here. */
export function toPaise(rupees: number): number {
  if (!Number.isFinite(rupees)) return 0;
  return Math.round((rupees + Number.EPSILON) * PAISE_PER_RUPEE);
}

/** Whole paise → rupees (2 decimals). */
export function fromPaise(paise: number): number {
  return Math.trunc(paise) / PAISE_PER_RUPEE;
}

/** Derived per-piece selling price from the fixed case price. Never stored. */
export function piecePriceFromCase(casePrice: number, unitsPerCase: number): number {
  if (!unitsPerCase || unitsPerCase < 1) return round2(casePrice);
  return round2(casePrice / unitsPerCase);
}

/**
 * Picks the applicable tier for `pieces` using a half-open [min, max) range.
 * The matching tier with the greatest min_quantity wins, so deeper slabs take
 * priority as the quantity grows. Returns null when no tier matches.
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

// ----------------------------------------------------------------------------
// Loose-tier resolution
// ----------------------------------------------------------------------------

/** Highest piece count a loose remainder can ever have (case size - 1). */
export function maxLooseQuantity(unitsPerCase: number): number {
  const units = Math.trunc(unitsPerCase);
  return units > 1 ? units - 1 : 0;
}

/** True when a tier can apply to a loose remainder of this pack. */
function isLooseEligible(tier: PricingTier, unitsPerCase: number): boolean {
  if (tier.is_active === false) return false;
  const upper = tier.max_quantity ?? Number.POSITIVE_INFINITY;
  // A tier is usable for the remainder only if it can cover at least one
  // quantity below a full case, i.e. min_quantity <= unitsPerCase - 1.
  return tier.min_quantity >= 1 && tier.min_quantity < unitsPerCase && upper > tier.min_quantity;
}

export interface LooseTierSet {
  /** Tiers the engine may use to price a loose remainder, in slab order. */
  tiers: PricingTier[];
  /**
   * True when the admin explicitly configured loose slabs for this pack
   * (`rule_type = 'loose'`). When true, an uncovered remainder is a gap and
   * the quantity is not orderable; when false the pack falls back to the
   * derived per-piece price, exactly as it did before loose tiers existed.
   */
  explicit: boolean;
  /** Total piece count below one case that is priced by a loose rate at all. */
  configured: boolean;
}

/**
 * Splits a pack's active tiers into the set that may price the loose remainder.
 *
 * Admin-authored `loose` rows win outright. A pack that has none keeps using
 * its legacy slabs (`default` / `bulk`) restricted to the loose domain, so
 * every pack that predates this feature prices exactly as it did before.
 */
export function resolveLooseTierSet(tiers: PricingTier[] | undefined | null, unitsPerCase: number): LooseTierSet {
  const active = (tiers ?? []).filter((tier) => tier.is_active !== false);
  const explicitRows = active.filter((tier) => tier.rule_type === 'loose');
  const source = explicitRows.length > 0 ? explicitRows : active.filter((tier) => tier.rule_type !== 'case');
  const usable = source
    .filter((tier) => isLooseEligible(tier, unitsPerCase))
    .sort((a, b) => a.min_quantity - b.min_quantity);
  return {
    tiers: usable,
    explicit: explicitRows.length > 0,
    configured: usable.length > 0,
  };
}

/** The tier that prices `looseQuantity`, or null when nothing covers it. */
export function pickLooseTier(tiers: PricingTier[], looseQuantity: number): PricingTier | null {
  return pickApplicableTier(tiers, looseQuantity);
}

/**
 * Human-readable slab label from a stored half-open range, e.g.
 * (1, 7) → "1–6 pcs", (21, null) → "21+ pcs".
 */
export function tierRangeLabel(minQuantity: number, maxQuantityExclusive: number | null): string {
  if (maxQuantityExclusive === null || maxQuantityExclusive === undefined) return `${minQuantity}+ pcs`;
  const inclusiveMax = maxQuantityExclusive - 1;
  if (inclusiveMax <= minQuantity) return `${minQuantity} pc`;
  return `${minQuantity}–${inclusiveMax} pcs`;
}

/** Inclusive upper bound for a stored (exclusive) tier max. */
export function inclusiveMaxQuantity(maxQuantityExclusive: number | null | undefined, unitsPerCase: number): number {
  if (maxQuantityExclusive === null || maxQuantityExclusive === undefined) return maxLooseQuantity(unitsPerCase);
  return Math.min(maxQuantityExclusive - 1, maxLooseQuantity(unitsPerCase));
}

/**
 * Loose quantities (piece counts below one case) that NO configured tier
 * prices. Empty means the configuration is complete: every partial-case order
 * the retailer can enter is priced. Returned as inclusive [min, max] ranges.
 */
export function findLooseCoverageGaps(
  tiers: PricingTier[] | undefined | null,
  unitsPerCase: number
): { min: number; max: number }[] {
  const units = Math.trunc(unitsPerCase);
  const ceiling = maxLooseQuantity(units);
  if (ceiling < 1) return [];
  const usable = (tiers ?? []).filter((tier) => tier.is_active !== false && isLooseEligible(tier, units));
  if (usable.length === 0) return [{ min: 1, max: ceiling }];

  const covered = new Array<boolean>(ceiling + 1).fill(false);
  for (const tier of usable) {
    const from = Math.max(1, Math.trunc(tier.min_quantity));
    const to = Math.min(ceiling, (tier.max_quantity ?? ceiling + 1) - 1);
    for (let pieces = from; pieces <= to; pieces += 1) covered[pieces] = true;
  }

  const gaps: { min: number; max: number }[] = [];
  let runStart: number | null = null;
  for (let pieces = 1; pieces <= ceiling; pieces += 1) {
    const isGap = covered[pieces] !== true;
    if (isGap && runStart === null) runStart = pieces;
    if (!isGap && runStart !== null) {
      gaps.push({ min: runStart, max: pieces - 1 });
      runStart = null;
    }
  }
  if (runStart !== null) gaps.push({ min: runStart, max: ceiling });
  return gaps;
}

/** "1–6, 7–12, 13–20, 21–39" — the priced loose slabs, for messages and UI. */
export function formatLooseRanges(tiers: PricingTier[], unitsPerCase: number): string {
  const usable = [...(tiers ?? [])]
    .filter((tier) => tier.is_active !== false && isLooseEligible(tier, unitsPerCase))
    .sort((a, b) => a.min_quantity - b.min_quantity);
  return usable
    .map((tier) => `${tier.min_quantity}–${inclusiveMaxQuantity(tier.max_quantity, unitsPerCase)}`)
    .join(', ');
}

// ----------------------------------------------------------------------------
// THE canonical calculation
// ----------------------------------------------------------------------------

export type LoosePriceSource = 'tier' | 'derived' | 'gap' | 'none';

export interface CaseLoosePricingInput {
  /** Total PIECES the retailer wants to buy. */
  quantity: number;
  unitsPerCase: number;
  /** GST-INCLUSIVE price of one full case (the source of truth). */
  casePrice: number;
  /** Active pricing tiers of this exact pack/variant. */
  tiers?: PricingTier[] | null;
  /** GST percentage on the parent product (used to split, never to add). */
  gstPercent?: number;
  /** Minimum order quantity in PIECES. */
  moq?: number;
  /** When false the pack is only sold in whole cases (default: true). */
  allowLoosePieces?: boolean;
}

export interface CaseLoosePricing {
  /** Total pieces priced (whole number). */
  quantity: number;
  unitsPerCase: number;
  /** floor(quantity / unitsPerCase) — billed at `casePrice` each. */
  fullCases: number;
  /** quantity % unitsPerCase — billed at `looseUnitPrice` each. */
  looseQuantity: number;
  casePrice: number;
  /** GST-INCLUSIVE per-piece price applied to the remainder (null when a gap). */
  looseUnitPrice: number | null;
  /** The tier that produced `looseUnitPrice`, for UI labels. */
  looseTier: PricingTier | null;
  loosePriceSource: LoosePriceSource;
  /** Reference derived piece price (case_price / units_per_case). Display only. */
  derivedPiecePrice: number;
  /** GST-INCLUSIVE money for the full-case part. */
  caseSubtotal: number;
  /** GST-INCLUSIVE money for the loose part. */
  looseSubtotal: number;
  /** GST-INCLUSIVE line total — always exactly caseSubtotal + looseSubtotal. */
  total: number;
  /** GST component already contained inside `total`. */
  gst: number;
  /** `total - gst`, i.e. the GST-exclusive line value. */
  subtotal: number;
  /** Loose slabs the admin configured (for the retailer-facing price table). */
  looseTiers: PricingTier[];
  /** True when the quantity can actually be ordered at these prices. */
  orderable: boolean;
  /** Why `orderable` is false — written for a retailer, never technical. */
  message: string | null;
}

/** The zero-value result every early return starts from (nothing is priced). */
function emptyPricing(): CaseLoosePricing {
  return {
    quantity: 0,
    unitsPerCase: 0,
    fullCases: 0,
    looseQuantity: 0,
    casePrice: 0,
    looseUnitPrice: null,
    looseTier: null,
    loosePriceSource: 'none',
    derivedPiecePrice: 0,
    caseSubtotal: 0,
    looseSubtotal: 0,
    total: 0,
    gst: 0,
    subtotal: 0,
    looseTiers: [],
    orderable: false,
    message: null,
  };
}

/**
 * The single authoritative wholesale price for `quantity` pieces.
 *
 * Returns the full structured breakdown (cases, loose pieces, both prices,
 * both subtotals, GST split and an orderability verdict) so the cart, the
 * product page, the server quote, the order writer, the invoice and the admin
 * preview can all be built from ONE call with no duplicated formula.
 */
export function calculateCaseLoosePrice(input: CaseLoosePricingInput): CaseLoosePricing {
  const rawUnits = Number(input.unitsPerCase);
  const unitsPerCase = Number.isFinite(rawUnits) ? Math.trunc(rawUnits) : 0;
  const rawQuantity = Number(input.quantity);
  const quantity = Number.isFinite(rawQuantity) ? Math.trunc(rawQuantity) : 0;
  const casePrice = round2(Number.isFinite(Number(input.casePrice)) ? Number(input.casePrice) : 0);
  const gstPercent = Number.isFinite(Number(input.gstPercent)) && Number(input.gstPercent) > 0
    ? Number(input.gstPercent)
    : 0;
  const moq = Math.max(1, Math.trunc(Number.isFinite(Number(input.moq)) ? Number(input.moq) : 1) || 1);
  const allowLoosePieces = input.allowLoosePieces !== false;

  const looseSet = resolveLooseTierSet(input.tiers, unitsPerCase);
  const derivedPiecePrice = piecePriceFromCase(casePrice, unitsPerCase);

  const base: CaseLoosePricing = {
    ...emptyPricing(),
    quantity: Math.max(0, quantity),
    unitsPerCase,
    casePrice,
    derivedPiecePrice,
    looseTiers: looseSet.tiers,
  };

  // --- configuration guards: never invent a price for a broken pack --------
  if (!(unitsPerCase >= 1) || rawUnits !== unitsPerCase || unitsPerCase > 100000) {
    return { ...base, message: 'This pack needs a case size of at least 1 whole piece before it can be ordered.' };
  }
  if (!(casePrice >= 0)) {
    return { ...base, message: 'This pack has no valid case price yet. Please try again later.' };
  }
  if (Number.isFinite(rawQuantity) && rawQuantity !== quantity) {
    return { ...base, message: 'Quantity must be a whole number of pieces.' };
  }
  if (quantity < 1) {
    return { ...base, message: 'Enter a quantity of at least 1 piece.' };
  }
  if (quantity > 100000) {
    return { ...base, message: 'A single order line can be at most 100000 pieces.' };
  }
  if (quantity < moq) {
    return { ...base, message: `Minimum order quantity for this pack is ${moq} pcs.` };
  }

  const fullCases = Math.floor(quantity / unitsPerCase);
  const looseQuantity = quantity % unitsPerCase;

  if (looseQuantity > 0 && !allowLoosePieces) {
    const lower = fullCases * unitsPerCase;
    const nextCase = (fullCases + 1) * unitsPerCase;
    const options = [lower, nextCase].filter((value) => value >= moq).slice(0, 2);
    return {
      ...base,
      fullCases,
      looseQuantity,
      message:
        options.length > 0
          ? `This pack is sold in full cases of ${unitsPerCase} pcs only. Try ${options.join(' or ')} pcs.`
          : `This pack is sold in full cases of ${unitsPerCase} pcs only.`,
    };
  }

  // --- money: computed in integer paise, so the two parts add up exactly ---
  let looseUnitPrice: number | null = null;
  let looseTier: PricingTier | null = null;
  let loosePriceSource: LoosePriceSource = 'none';

  if (looseQuantity > 0) {
    looseTier = pickLooseTier(looseSet.tiers, looseQuantity);
    if (looseTier) {
      looseUnitPrice = round2(looseTier.price_per_piece);
      loosePriceSource = 'tier';
    } else if (looseSet.explicit) {
      // Deliberate configuration gap: refuse the quantity instead of silently
      // borrowing a price from a rule that was never meant to cover it. Nothing
      // is priced at all — a half-calculated total would be worse than none.
      const ranges = formatLooseRanges(looseSet.tiers, unitsPerCase);
      return {
        ...base,
        fullCases,
        looseQuantity,
        loosePriceSource: 'gap',
        message: ranges
          ? `${looseQuantity} loose pcs is not priced for this pack. Order loose quantities in these ranges: ${ranges} pcs — or add a full case of ${unitsPerCase} pcs.`
          : `Loose pieces are not priced for this pack yet. Order a full case of ${unitsPerCase} pcs.`,
      };
    } else {
      // Legacy pack: no loose slabs configured, so the derived case piece price
      // applies to the remainder exactly as it did before this feature.
      looseUnitPrice = derivedPiecePrice;
      loosePriceSource = 'derived';
    }
  }

  const casePaise = toPaise(casePrice) * fullCases;
  const loosePaise = looseUnitPrice === null ? 0 : toPaise(looseUnitPrice) * looseQuantity;
  const totalPaise = casePaise + loosePaise;
  const total = fromPaise(totalPaise);
  const gst = round2((total * gstPercent) / (100 + gstPercent));
  const subtotal = fromPaise(totalPaise - toPaise(gst));

  return {
    ...base,
    quantity,
    fullCases,
    looseQuantity,
    looseUnitPrice,
    looseTier,
    loosePriceSource,
    caseSubtotal: fromPaise(casePaise),
    looseSubtotal: fromPaise(loosePaise),
    total,
    gst,
    subtotal,
    // Every quantity that reaches this point has a price for both of its parts.
    orderable: true,
    message: null,
  };
}

/**
 * Convenience wrapper for "the retailer thinks in cases": converts a number of
 * whole cases into the canonical piece-based calculation.
 */
export function casesToPieces(cases: number, unitsPerCase: number): number {
  return Math.max(0, Math.trunc(cases)) * Math.max(1, Math.trunc(unitsPerCase));
}

/**
 * Quick-quantity suggestions for a pack: 1 pc, the MOQ, one loose tier boundary
 * and one/two full cases — deduped, sorted, and never used to restrict the
 * retailer (any valid quantity stays enterable).
 */
export function suggestedQuantities(input: {
  unitsPerCase: number;
  moq?: number;
  tiers?: PricingTier[] | null;
  allowLoosePieces?: boolean;
}): number[] {
  const unitsPerCase = Math.max(1, Math.trunc(input.unitsPerCase) || 1);
  const moq = Math.max(1, Math.trunc(input.moq ?? 1) || 1);
  const allowLoose = input.allowLoosePieces !== false;
  const values = new Set<number>();

  if (allowLoose) {
    values.add(1);
    values.add(Math.max(moq, 1));
    const tiers = resolveLooseTierSet(input.tiers, unitsPerCase).tiers;
    const lastTier = tiers[tiers.length - 1];
    const looseCeiling = maxLooseQuantity(unitsPerCase);
    if (lastTier) {
      const top = inclusiveMaxQuantity(lastTier.max_quantity, unitsPerCase);
      if (top >= 1 && top <= looseCeiling) values.add(top);
    }
    if (looseCeiling >= 1 && looseCeiling >= moq) values.add(looseCeiling);
  } else {
    values.add(unitsPerCase);
  }

  values.add(unitsPerCase);
  values.add(unitsPerCase * 2);

  return [...values]
    .filter((value) => Number.isInteger(value) && value >= moq && value <= 100000)
    .sort((a, b) => a - b)
    .slice(0, 6);
}

// ----------------------------------------------------------------------------
// Retailer-facing wording (shared so cart / page / invoice never drift)
// ----------------------------------------------------------------------------

export interface CaseLooseLineLabels {
  /** "2 Cases · 80 pcs" / "1 Case" / "6 pcs". */
  quantity: string;
  /** "1 Case × ₹1,000" */
  casePart: string;
  /** "6 pcs × ₹30" — null when there is no loose part. */
  loosePart: string | null;
  /** "Cases: 2 · Loose: 5" — the compact breakdown. */
  summary: string;
}

/**
 * Plain-language breakdown of a priced line. Money strings are produced by the
 * caller's formatter so this stays dependency-free: pass `formatMoney`.
 */
export function describeCaseLooseLine(
  pricing: CaseLoosePricing,
  formatMoney: (value: number) => string
): CaseLooseLineLabels {
  const { fullCases, looseQuantity, unitsPerCase } = pricing;
  const totalPieces = fullCases * unitsPerCase + looseQuantity;

  const casePart =
    fullCases > 0
      ? `${fullCases} Case${fullCases === 1 ? '' : 's'} × ${formatMoney(pricing.casePrice)}`
      : null;
  const loosePart =
    looseQuantity > 0 && pricing.looseUnitPrice !== null
      ? `${looseQuantity} pc${looseQuantity === 1 ? '' : 's'} × ${formatMoney(pricing.looseUnitPrice)}`
      : null;

  const quantity =
    fullCases > 0 && looseQuantity > 0
      ? `${fullCases} Case${fullCases === 1 ? '' : 's'} + ${looseQuantity} loose pc${looseQuantity === 1 ? '' : 's'} · ${totalPieces} pcs`
      : fullCases > 0
        ? `${fullCases} Case${fullCases === 1 ? '' : 's'} · ${totalPieces} pcs`
        : `${looseQuantity} pc${looseQuantity === 1 ? '' : 's'}`;

  return {
    quantity,
    casePart: casePart ?? `${formatMoney(0)}`,
    loosePart,
    summary: `Cases: ${fullCases} · Loose: ${looseQuantity}`,
  };
}

// ----------------------------------------------------------------------------
// Admin-side validation of a loose tier set
// ----------------------------------------------------------------------------

/** A tier exactly as the admin form holds it: BOTH bounds inclusive. */
export interface LooseTierDraft {
  minQty: number;
  /** Inclusive upper bound. Null means "up to the last piece before a case". */
  maxQty: number | null;
  pricePerPiece: number;
}

/** Converts a drafted inclusive range into a stored half-open tier row. */
export function looseTierDraftToRow(draft: LooseTierDraft, unitsPerCase: number): PricingTier {
  const ceiling = maxLooseQuantity(unitsPerCase);
  const maxInclusive = draft.maxQty === null ? ceiling : Math.trunc(draft.maxQty);
  return {
    min_quantity: Math.trunc(draft.minQty),
    // A loose tier always stores an explicit exclusive max so the slab can
    // never bleed into full-case territory.
    max_quantity: Math.min(maxInclusive + 1, Math.max(unitsPerCase, 2)),
    price_per_piece: round2(draft.pricePerPiece),
    rule_type: 'loose',
  };
}

/**
 * Validates an admin-authored set of loose tiers. Returns one message per
 * problem (empty array = the set is safe to save). Every rule the business
 * asked for is enforced here and nowhere else, so the client form and the
 * server action can never disagree.
 */
export function validateLooseTierSet(drafts: LooseTierDraft[], unitsPerCase: number): string[] {
  const errors: string[] = [];
  const units = Math.trunc(unitsPerCase);
  const rows = drafts ?? [];

  if (!Number.isInteger(units) || units < 1) {
    errors.push('Units per case must be a whole number of at least 1.');
    return errors;
  }
  const ceiling = maxLooseQuantity(units);
  if (ceiling < 1) {
    if (rows.length > 0) errors.push('A pack of 1 piece per case has no loose pieces to price — remove the loose tiers.');
    return errors;
  }

  const seen = new Set<string>();
  for (const row of rows) {
    const min = Number(row.minQty);
    const max = row.maxQty === null ? null : Number(row.maxQty);
    const price = Number(row.pricePerPiece);
    const label = Number.isFinite(min) && Number.isFinite(max ?? min) ? `${min}–${max ?? ceiling}` : 'A tier';

    if (!Number.isInteger(min) || min < 1) errors.push(`${label}: minimum quantity must be a whole number of at least 1.`);
    if (max !== null && (!Number.isInteger(max) || max < 1)) errors.push(`${label}: maximum quantity must be a whole number of at least 1.`);
    if (Number.isInteger(min) && max !== null && Number.isInteger(max) && max < min) {
      errors.push(`${label}: maximum quantity cannot be lower than the minimum quantity.`);
    }
    if (!Number.isFinite(price) || price <= 0) errors.push(`${label}: price per piece must be more than zero.`);
    if (max !== null && Number.isInteger(max) && max > ceiling) {
      errors.push(`${label}: a loose tier cannot reach ${units} pcs — that is a full case and is priced by the case price.`);
    }
    if (Number.isInteger(min) && min > ceiling) {
      errors.push(`${label}: loose tiers must start at ${ceiling} pcs or below (a full case is priced by the case price).`);
    }
    if (Number.isInteger(min) && (max === null || Number.isInteger(max))) {
      const key = `${min}-${max ?? ceiling}`;
      if (seen.has(key)) errors.push(`${label}: the same quantity range is listed twice.`);
      seen.add(key);
    }
  }

  // Overlap check on inclusive ranges (the stored form is half-open, but the
  // admin edits inclusive ranges so that is the contract being validated).
  const sortable = rows
    .map((row) => ({ min: Number(row.minQty), max: row.maxQty === null ? ceiling : Number(row.maxQty) }))
    .filter((row) => Number.isInteger(row.min) && Number.isInteger(row.max))
    .sort((a, b) => a.min - b.min);
  for (let index = 0; index < sortable.length - 1; index += 1) {
    const current = sortable[index]!;
    const next = sortable[index + 1]!;
    if (current.max >= next.min) {
      errors.push(
        `Overlapping ranges: ${current.min}–${current.max} pcs and ${next.min}–${next.max} pcs. Each loose quantity must belong to exactly one tier.`
      );
    }
  }

  // Two distinct messages for the same problem are noise — de-duplicate.
  return [...new Set(errors)];
}

/**
 * Whether a full loose configuration is complete: every quantity from 1 to
 * unitsPerCase - 1 is priced. Gaps are allowed by the engine (they block
 * checkout for that quantity only) but the admin UI shows them explicitly.
 */
export function isLooseConfigurationComplete(tiers: PricingTier[], unitsPerCase: number): boolean {
  return findLooseCoverageGaps(tiers, unitsPerCase).length === 0;
}

// ----------------------------------------------------------------------------
// Backwards-compatible adapter
// ----------------------------------------------------------------------------

export interface CaseLineBreakdown {
  pieces: number;
  cases: number;
  loosePieces: number;
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
 * Deprecated shape kept so older call sites and tests keep compiling. It is a
 * thin adapter over `calculateCaseLoosePrice` — it adds NO arithmetic of its
 * own, so there is still exactly one pricing formula in the codebase.
 *
 *   packQuantity  → whole cases (pieces = packQuantity × unitsPerCase)
 *   pieceQuantity → pieces, which may include a loose remainder
 */
export function caseLineBreakdown(input: {
  casePrice: number;
  unitsPerCase: number;
  tiers?: PricingTier[];
  packQuantity?: number;
  pieceQuantity?: number;
  gstPercent: number;
}): CaseLineBreakdown {
  const { casePrice, unitsPerCase, tiers = [], packQuantity, pieceQuantity, gstPercent } = input;
  const units = unitsPerCase > 0 ? Math.trunc(unitsPerCase) : 1;
  const pieces =
    pieceQuantity !== undefined && pieceQuantity !== null
      ? Math.max(1, Math.round(pieceQuantity))
      : Math.max(1, Math.round(packQuantity ?? 1)) * units;

  const pricing = calculateCaseLoosePrice({
    quantity: pieces,
    unitsPerCase: units,
    casePrice,
    tiers,
    gstPercent,
  });

  return {
    pieces: pricing.quantity,
    cases: pricing.fullCases,
    loosePieces: pricing.looseQuantity,
    piecePrice: pricing.looseUnitPrice ?? pricing.derivedPiecePrice,
    casePrice: pricing.casePrice,
    total: pricing.total,
    gst: pricing.gst,
    subtotal: pricing.subtotal,
  };
}

/** Extracts the GST component contained inside a GST-inclusive amount. */
export function gstComponentFromInclusive(inclusive: number, gstPercent: number): number {
  return round2((inclusive * gstPercent) / (100 + gstPercent));
}

/**
 * Validates a raw set of stored (half-open) tier rows — the shape used before
 * loose tiers existed. Kept for the legacy bulk-rule editor.
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
