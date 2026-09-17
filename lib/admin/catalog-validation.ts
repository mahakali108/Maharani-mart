/**
 * Shared catalog validation — ONE implementation of the rules that every
 * catalog write path must apply identically.
 *
 * WHY THIS EXISTS
 * ---------------
 * Before Phase 3 the product form validated with a small zod schema inline in
 * `lib/admin/products-actions.ts` and nothing else validated at all. GST was
 * accepted as any number 0–100 (so `7` or `99` were legal), `hsn_code` was
 * never collected even though the column has existed since 0001, and the
 * barcode was accepted as free text with no checksum check. Adding a CSV
 * import would have meant writing those rules a second time, and the two
 * copies would drift.
 *
 * This module is the single source. The product form action and the CSV
 * importer both call `validateProductDraft`, so a value that is legal in the
 * form is legal in an import and vice versa.
 *
 * PURE BY DESIGN — no Supabase, no `next/*`, no env, no secrets. That is what
 * lets it be imported from a Server Action, from a Route Handler and from the
 * unit tests in `tests/catalog-validation.test.ts` alike.
 *
 * WHAT IS *NOT* HERE
 * ------------------
 * Uniqueness of SKU/barcode, and the existence of a brand/category id, cannot
 * be decided without the database, so those checks stay in the callers (which
 * already translate Postgres unique violations into friendly messages).
 */

/**
 * Statutory Indian GST slabs.
 *
 * GST rates in India are set by the GST Council, not chosen by a seller, so
 * accepting an arbitrary 0–100 value produced invoices with rates no tax
 * filing recognises. These are the published slabs (0.25% and 3% cover rough
 * precious stones / metals and are included for completeness).
 */
export const VALID_GST_RATES = [0, 0.25, 3, 5, 12, 18, 28] as const;

export type GstRate = (typeof VALID_GST_RATES)[number];

/** Slab list as a display string for error messages ("0, 0.25, 3, 5, 12, 18 or 28"). */
export const GST_RATE_LABEL = VALID_GST_RATES.join(', ');

export function isValidGstRate(value: number): value is GstRate {
  return (VALID_GST_RATES as readonly number[]).includes(value);
}

/**
 * Parse a GST rate from user or CSV input.
 * Returns null when the value is not a finite, non-negative number or not a
 * published slab. An empty string is "no opinion" and is handled by callers.
 */
export function parseGstRate(raw: unknown): GstRate | null {
  const value = typeof raw === 'number' ? raw : Number(String(raw ?? '').trim());
  if (!Number.isFinite(value) || value < 0) return null;
  return isValidGstRate(value) ? value : null;
}

/**
 * HSN (Harmonised System of Nomenclature) code.
 *
 * India uses 2, 4, 6 or 8 digit HSN codes on invoices (2 digits for turnover
 * above ₹5cr, 4 above ₹50cr, 6/8 for exports and detailed filings). Odd digit
 * counts are never valid, so accepting them would produce an invoice that a
 * GST return rejects. Digits are stored exactly as typed — an HSN code is a
 * code, not a number, so leading zeros must survive.
 */
const VALID_HSN_LENGTHS = [2, 4, 6, 8];

export function validateHsnCode(
  raw: string | null | undefined
): { ok: true; value: string | null } | { ok: false; error: string } {
  const value = (raw ?? '').trim();
  if (!value) return { ok: true, value: null };
  if (!/^\d+$/.test(value)) {
    return { ok: false, error: 'HSN code must contain digits only.' };
  }
  if (!VALID_HSN_LENGTHS.includes(value.length)) {
    return {
      ok: false,
      error: `HSN code must be ${VALID_HSN_LENGTHS.join(', ')} digits long.`,
    };
  }
  return { ok: true, value };
}

/**
 * EAN/UPC check digit (mod-10, the standard retail barcode algorithm).
 * Accepts EAN-8, UPC-A (12), EAN-13 and ITF-14. Returns false for any other
 * length, for non-digits, and for a code whose check digit does not match —
 * which is the typo class that matters most, because a mistyped barcode never
 * scans at the counter and the mistake is invisible on screen.
 */
export function eanChecksumValid(code: string): boolean {
  if (!/^\d+$/.test(code)) return false;
  if (![8, 12, 13, 14].includes(code.length)) return false;
  const digits = code.split('').map(Number);
  const check = digits.pop() as number;
  // Weights alternate 1/3 counted from the check digit outwards, so the first
  // weight depends on whether the payload length is odd or even.
  const firstWeight = digits.length % 2 === 0 ? 1 : 3;
  const sum = digits.reduce(
    (total, digit, index) => total + digit * (index % 2 === 0 ? firstWeight : firstWeight === 1 ? 3 : 1),
    0
  );
  return (10 - (sum % 10)) % 10 === check;
}

export function validateBarcode(
  raw: string | null | undefined
): { ok: true; value: string | null } | { ok: false; error: string } {
  const value = (raw ?? '').trim();
  if (!value) return { ok: true, value: null };
  if (!/^\d+$/.test(value)) {
    return { ok: false, error: 'Barcode must contain digits only (EAN/UPC).' };
  }
  if (![8, 12, 13, 14].includes(value.length)) {
    return { ok: false, error: 'Barcode must be 8, 12, 13 or 14 digits (EAN-8, UPC-A, EAN-13 or ITF-14).' };
  }
  if (!eanChecksumValid(value)) {
    return { ok: false, error: 'Barcode check digit is invalid — re-check the number printed on the pack.' };
  }
  return { ok: true, value };
}

/** Parse a rupee amount. Returns null for anything that is not a finite number. */
export function parseMoney(raw: unknown): number | null {
  const value = typeof raw === 'number' ? raw : Number(String(raw ?? '').trim());
  if (!Number.isFinite(value)) return null;
  return Math.round(value * 100) / 100;
}

/** Parse a whole count (units per case, MOQ, lead time). Null when not a whole number. */
export function parseCount(raw: unknown): number | null {
  const value = typeof raw === 'number' ? raw : Number(String(raw ?? '').trim());
  if (!Number.isFinite(value) || !Number.isInteger(value)) return null;
  return value;
}

/** The shape a caller hands over before validation. Everything is untrusted text. */
export interface ProductDraft {
  name: unknown;
  unit: unknown;
  unitsPerCase: unknown;
  /** MRP per piece — printed retail price, kept for margin reporting. */
  mrp: unknown;
  /** GST-INCLUSIVE selling price of one full case (the pricing source of truth). */
  casePrice: unknown;
  /** Purchase cost. Admin-only; never returned to a retailer. */
  costPrice: unknown;
  gstPercent: unknown;
  hsnCode: unknown;
  barcode: unknown;
  leadTimeDays: unknown;
  moq: unknown;
}

/** Validated, trimmed, typed values ready for a database write. */
export interface ValidatedProduct {
  name: string;
  unit: string;
  unitsPerCase: number;
  mrp: number;
  casePrice: number;
  costPrice: number | null;
  gstPercent: GstRate;
  hsnCode: string | null;
  barcode: string | null;
  leadTimeDays: number;
  moq: number;
}

/**
 * Field keys a validation error can attach to.
 *
 * `margin` is a cross-field complaint with no single input, and
 * `brandId`/`categoryId` are relation selects on the product form — the shared
 * validator cannot check that a chosen id exists, but the caller reports those
 * errors under the same shape so one error panel can render them all.
 */
export type ProductFieldKey = keyof ProductDraft | 'margin' | 'brandId' | 'categoryId';

export type FieldErrors = Partial<Record<ProductFieldKey, string>>;

export type ProductValidationResult =
  | { ok: true; value: ValidatedProduct }
  | { ok: false; errors: FieldErrors };

/** Collapse whitespace and cap length, so a pasted block cannot become a product name. */
function cleanText(raw: unknown, max: number): string {
  return String(raw ?? '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);
}

/**
 * Derived GST-INCLUSIVE selling price of one piece at the entered case price.
 * Mirrors `piecePriceFromCase` in lib/retailer/case-pricing.ts, repeated here
 * only because that module is a large pricing engine and this file must stay
 * dependency-free; both round half-up to 2dp.
 */
export function derivedPiecePrice(casePrice: number, unitsPerCase: number): number {
  if (unitsPerCase <= 0) return 0;
  return Math.round((casePrice / unitsPerCase) * 100) / 100;
}

/**
 * Validate one product draft.
 *
 * Cross-field rules included here (they are the ones a single-field schema
 * cannot express):
 *   - MOQ must be a positive whole number of pieces.
 *   - The selling price must not be below purchase cost. The comparison uses
 *     the GST-INCLUSIVE piece price against `cost_price`, which is negative
 *     margin under EITHER cost convention (a GST-inclusive cost is always ≥
 *     the GST-exclusive one), so this can never reject a profitable product.
 */
export function validateProductDraft(draft: ProductDraft): ProductValidationResult {
  const errors: FieldErrors = {};

  const name = cleanText(draft.name, 160);
  if (name.length < 2) errors.name = 'Enter a product name (at least 2 characters).';

  const unit = cleanText(draft.unit, 24);
  if (!unit) errors.unit = 'Enter a unit (e.g. carton, box, pcs).';

  const unitsPerCase = parseCount(draft.unitsPerCase);
  if (unitsPerCase === null || unitsPerCase < 1) {
    errors.unitsPerCase = 'Units per case must be a whole number of 1 or more.';
  } else if (unitsPerCase > 10_000) {
    errors.unitsPerCase = 'Units per case looks too large — check the value.';
  }

  const mrp = parseMoney(draft.mrp);
  if (mrp === null || mrp < 0) errors.mrp = 'Enter an MRP of 0 or more.';

  const casePrice = parseMoney(draft.casePrice);
  if (casePrice === null || casePrice < 0) {
    errors.casePrice = 'Enter a case selling price of 0 or more.';
  }

  const costPrice =
    String(draft.costPrice ?? '').trim() === '' ? null : parseMoney(draft.costPrice);
  if (String(draft.costPrice ?? '').trim() !== '' && (costPrice === null || costPrice < 0)) {
    errors.costPrice = 'Enter a purchase cost of 0 or more, or leave it blank.';
  }

  const gstRaw = String(draft.gstPercent ?? '').trim();
  let gstPercent: GstRate | null = null;
  if (gstRaw === '') {
    gstPercent = 0;
  } else {
    gstPercent = parseGstRate(gstRaw);
    if (gstPercent === null) {
      errors.gstPercent = `GST must be one of the published slabs: ${GST_RATE_LABEL}.`;
    }
  }

  const hsn = validateHsnCode(draft.hsnCode as string | null | undefined);
  let hsnCode: string | null = null;
  if (!hsn.ok) errors.hsnCode = hsn.error;
  else hsnCode = hsn.value;

  const ean = validateBarcode(draft.barcode as string | null | undefined);
  let barcode: string | null = null;
  if (!ean.ok) errors.barcode = ean.error;
  else barcode = ean.value;

  const leadTimeDays = parseCount(draft.leadTimeDays);
  if (leadTimeDays === null || leadTimeDays < 0) {
    errors.leadTimeDays = 'Lead time must be 0 or more days.';
  } else if (leadTimeDays > 365) {
    errors.leadTimeDays = 'Lead time of more than a year is not supported.';
  }

  const moq = parseCount(draft.moq);
  if (moq === null || moq < 1) errors.moq = 'MOQ must be a whole number of 1 piece or more.';

  // Cross-field: no selling below cost. Only evaluated when every input it
  // needs is itself valid, so an admin fixing a typo is never also shown a
  // margin complaint about the number they just mistyped.
  if (
    casePrice !== null &&
    casePrice > 0 &&
    unitsPerCase !== null &&
    unitsPerCase >= 1 &&
    costPrice !== null &&
    costPrice > 0
  ) {
    const piece = derivedPiecePrice(casePrice, unitsPerCase);
    if (piece < costPrice) {
      errors.margin = `A case of ₹${casePrice.toFixed(2)} over ${unitsPerCase} piece(s) is ₹${piece.toFixed(
        2
      )}/piece, which is below the ₹${costPrice.toFixed(2)} purchase cost. Raise the case price or correct the cost.`;
    }
  }

  if (Object.keys(errors).length > 0) return { ok: false, errors };

  return {
    ok: true,
    value: {
      name,
      unit,
      unitsPerCase: unitsPerCase as number,
      mrp: mrp as number,
      casePrice: casePrice as number,
      costPrice,
      gstPercent: gstPercent as GstRate,
      hsnCode,
      barcode,
      leadTimeDays: leadTimeDays as number,
      moq: moq as number,
    },
  };
}

/** First error message, for surfaces that can only show one line at a time. */
export function firstError(errors: FieldErrors): string {
  return Object.values(errors).find((message): message is string => Boolean(message)) ?? 'Invalid input.';
}
