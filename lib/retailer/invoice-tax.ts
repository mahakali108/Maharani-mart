/**
 * GST invoice tax split — pure helpers.
 *
 * Prices in this platform are GST-INCLUSIVE: every stored `line_total`
 * already contains the tax. These helpers only EXTRACT the tax component
 * from stored amounts and decide how it splits into CGST/SGST (intra-state)
 * or IGST (inter-state) based on the state codes inside the two GSTINs.
 *
 * Rules (real data only — nothing invented):
 *  - Both the company GSTIN (COMPANY_GSTIN) and the retailer GSTIN
 *    (retailers.gstin) must be valid 15-char GSTINs, otherwise the tax is
 *    shown as a single "GST" line (unsplit) — never guessed.
 *  - Same state code (first two digits of the GSTIN)  → CGST = half, SGST = rest.
 *  - Different state codes                             → the whole tax is IGST.
 */

export type TaxSplitMode = 'intra' | 'inter' | 'unsplit';

/**
 * Syntactic GSTIN check (15 chars): 2-digit state code, alphabetic PAN start,
 * alphanumeric middle, 'Z' entity marker, one check character. This is a
 * display-rule guard for the CGST/SGST-vs-IGST decision — not a GSTIN
 * authority check (that is the GSTN's job), so it stays deliberately simple.
 */
const GSTIN_RE = /^[0-9]{2}[A-Z][A-Z0-9]{9}[0-9A-Z]Z[0-9A-Z]$/;

/** Normalises a GSTIN (upper-cased, trimmed) or null when empty. */
export function normalizeGstin(gstin: string | null | undefined): string | null {
  const value = (gstin ?? '').trim().toUpperCase();
  return value.length > 0 ? value : null;
}

/** True for a syntactically valid 15-character GSTIN. */
export function isValidGstin(gstin: string | null | undefined): boolean {
  return GSTIN_RE.test(normalizeGstin(gstin) ?? '');
}

/** The 2-digit state code of a valid GSTIN, else null. */
export function gstinStateCode(gstin: string | null | undefined): string | null {
  const value = normalizeGstin(gstin);
  return value && isValidGstin(value) ? value.slice(0, 2) : null;
}

/**
 * intra  = both GSTINs valid and same state (CGST + SGST)
 * inter  = both GSTINs valid, different states (IGST)
 * unsplit = anything else — display the tax as one GST line
 */
export function classifyTaxSplit(
  companyGstin: string | null | undefined,
  retailerGstin: string | null | undefined
): TaxSplitMode {
  const companyState = gstinStateCode(companyGstin);
  const retailerState = gstinStateCode(retailerGstin);
  if (!companyState || !retailerState) return 'unsplit';
  return companyState === retailerState ? 'intra' : 'inter';
}

export function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

/** GST component extracted from a GST-inclusive line total. */
export function computeLineTax(lineTotal: number, gstPercent: number): number {
  if (!(lineTotal > 0) || !(gstPercent > 0)) return 0;
  return lineTotal - lineTotal / (1 + gstPercent / 100);
}

export interface InvoiceLineTaxInput {
  /** Stable key (e.g. pack id) for the invoice line. */
  lineKey: string;
  lineTotal: number;
  gstPercent: number;
}

export interface InvoiceLineTax extends InvoiceLineTaxInput {
  /** Exact (unrounded) tax on the line. */
  tax: number;
  cgst: number;
  sgst: number;
  igst: number;
}

export interface InvoiceTaxSummary {
  mode: TaxSplitMode;
  lines: InvoiceLineTax[];
  /** Rounded-to-paisa sums for display. tax ≈ order.gst_total (stored value wins). */
  totals: { tax: number; cgst: number; sgst: number; igst: number };
}

/**
 * Extracts and splits the GST of every invoice line. Per-line amounts are
 * rounded to paisa for display; CGST + SGST always reconciles to the rounded
 * line tax (SGST is the remainder, so there is never a drift greater than
 * zero). Totals are the exact sums rounded once.
 */
export function computeInvoiceTaxLines(
  mode: TaxSplitMode,
  inputs: InvoiceLineTaxInput[]
): InvoiceTaxSummary {
  let exactTax = 0;
  let exactCgst = 0;
  let exactSgst = 0;
  let exactIgst = 0;

  const lines: InvoiceLineTax[] = inputs.map((input) => {
    const tax = computeLineTax(input.lineTotal, input.gstPercent);
    let cgst = 0;
    let sgst = 0;
    let igst = 0;
    if (mode === 'intra') {
      cgst = round2(tax / 2);
      sgst = round2(tax) - cgst;
    } else if (mode === 'inter') {
      igst = round2(tax);
    }
    exactTax += tax;
    exactCgst += tax / 2;
    exactSgst += tax / 2;
    exactIgst += tax;
    return { ...input, tax, cgst, sgst, igst };
  });

  // In an unsplit display the CGST/SGST/IGST columns are not shown, but the
  // exact split amounts are still tracked for testing consistency.
  const totals =
    mode === 'intra'
      ? { tax: round2(exactTax), cgst: round2(exactCgst), sgst: round2(exactSgst), igst: 0 }
      : mode === 'inter'
        ? { tax: round2(exactTax), cgst: 0, sgst: 0, igst: round2(exactIgst) }
        : { tax: round2(exactTax), cgst: 0, sgst: 0, igst: 0 };

  return { mode, lines, totals };
}
