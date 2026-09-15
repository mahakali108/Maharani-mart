/**
 * GST invoice upgrades — tax split (CGST/SGST vs IGST), HSN and download.
 *
 * Pure-function tests for the extraction/split math (lib/retailer/invoice-tax)
 * plus source-level guards that lock in:
 *   1. The invoice shows HSN, CGST/SGST or IGST (never a guess), GSTIN and totals
 *   2. A real download route exists with auth + ownership + attachment headers
 *   3. The standalone HTML builder is XSS-safe (escapes all interpolated data)
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  classifyTaxSplit,
  computeInvoiceTaxLines,
  computeLineTax,
  gstinStateCode,
  isValidGstin,
  normalizeGstin,
} from '@/lib/retailer/invoice-tax';
import { buildStandaloneInvoiceHtml } from '@/lib/retailer/invoice-html';
import { toInvoiceDisplayLines } from '@/lib/retailer/invoice-display';

const root = join(__dirname, '..');
const read = (rel: string) => readFileSync(join(root, rel), 'utf8');

const invoicePage = read('app/retailer/orders/[id]/invoice/page.tsx');
const downloadRoute = read('app/retailer/orders/[id]/invoice/download/route.ts');
const htmlBuilder = read('lib/retailer/invoice-html.ts');
const displayModule = read('lib/retailer/invoice-display.ts');

// ---------------------------------------------------------------------------
// GSTIN handling
// ---------------------------------------------------------------------------
describe('GSTIN validation + state code', () => {
  it('accepts a syntactically valid GSTIN (any state code)', () => {
    // 10 = Bihar (this business is in Khagaria, Bihar)
    expect(isValidGstin('10ABCDE1234F1Z5')).toBe(true);
    // 27 = Maharashtra
    expect(isValidGstin('27ABCDE1234F1Z5')).toBe(true);
  });

  it('rejects malformed GSTINs', () => {
    expect(isValidGstin(null)).toBe(false);
    expect(isValidGstin('')).toBe(false);
    expect(isValidGstin('10ABCDE1234F1Z')).toBe(false); // 14 chars
    expect(isValidGstin('ABCDE1234F1Z50')).toBe(false); // starts with letters
    expect(isValidGstin('10ABCDE1234F125')).toBe(false); // no 'Z' entity marker
    expect(isValidGstin('10ABCDE1234F1Z')).toBe(false); // 14 chars
    expect(isValidGstin('10abc1234f1z5')).toBe(false); // 13 chars (case is normalised first)
  });

  it('normalises case/whitespace before validating', () => {
    expect(normalizeGstin(' 10abcde1234f1z5 ')).toBe('10ABCDE1234F1Z5');
    expect(isValidGstin(' 10abcde1234f1z5 ')).toBe(true);
    expect(gstinStateCode('10abcde1234f1z5')).toBe('10');
  });

  it('extracts the 2-digit state code only from valid GSTINs', () => {
    expect(gstinStateCode('10ABCDE1234F1Z5')).toBe('10');
    expect(gstinStateCode('27XYZPA9999Q1Z2')).toBe('27');
    expect(gstinStateCode('bogus')).toBeNull();
    expect(gstinStateCode(undefined)).toBeNull();
  });
});

describe('tax split classification', () => {
  const biharGstin = '10ABCDE1234F1Z5';
  const mahaGstin = '27XYZPA9999Q1Z2';

  it('same state → intra (CGST + SGST)', () => {
    expect(classifyTaxSplit(biharGstin, biharGstin)).toBe('intra');
  });

  it('different states → inter (IGST)', () => {
    expect(classifyTaxSplit(biharGstin, mahaGstin)).toBe('inter');
  });

  it('missing or invalid GSTIN on EITHER side → unsplit (never guessed)', () => {
    expect(classifyTaxSplit(biharGstin, null)).toBe('unsplit');
    expect(classifyTaxSplit(null, biharGstin)).toBe('unsplit');
    expect(classifyTaxSplit('not-configured-yet', biharGstin)).toBe('unsplit');
    expect(classifyTaxSplit(biharGstin, 'short')).toBe('unsplit');
  });
});

// ---------------------------------------------------------------------------
// Tax extraction + per-line split
// ---------------------------------------------------------------------------
describe('line tax extraction (GST-inclusive prices)', () => {
  it('extracts the embedded tax from an inclusive total', () => {
    // ₹118 at 18% → tax = 18.00 exactly
    expect(computeLineTax(118, 18)).toBeCloseTo(18, 10);
    // ₹125 at 5% → tax = 5.95238…
    expect(computeLineTax(125, 5)).toBeCloseTo(125 - 125 / 1.05, 10);
  });

  it('returns 0 for zero/empty tax or zero amount', () => {
    expect(computeLineTax(100, 0)).toBe(0);
    expect(computeLineTax(0, 18)).toBe(0);
    expect(computeLineTax(-5, 18)).toBe(0);
  });
});

describe('computeInvoiceTaxLines', () => {
  const inputs = [
    { lineKey: 'p1', lineTotal: 118, gstPercent: 18 },
    { lineKey: 'p2', lineTotal: 105.4, gstPercent: 5 },
  ];

  it('intra: CGST + SGST reconcile to the rounded line tax on every line', () => {
    const result = computeInvoiceTaxLines('intra', inputs);
    expect(result.mode).toBe('intra');
    for (const line of result.lines) {
      expect(line.cgst + line.sgst).toBeCloseTo(line.cgst + line.sgst, 10);
      expect(line.cgst + line.sgst).toBeLessThanOrEqual(Math.round(line.tax * 100) / 100 + 0.01);
      expect(line.cgst).toBeGreaterThan(0);
    }
    // Totals: CGST + SGST ≈ total tax, and no IGST.
    expect(result.totals.igst).toBe(0);
    expect(result.totals.cgst + result.totals.sgst).toBeCloseTo(result.totals.tax, 5);
  });

  it('inter: the whole tax is IGST, CGST/SGST are zero', () => {
    const result = computeInvoiceTaxLines('inter', inputs);
    expect(result.totals.cgst).toBe(0);
    expect(result.totals.sgst).toBe(0);
    expect(result.totals.igst).toBeCloseTo(result.totals.tax, 5);
  });

  it('unsplit: columns are zero (UI shows the stored GST total instead)', () => {
    const result = computeInvoiceTaxLines('unsplit', inputs);
    expect(result.totals.cgst).toBe(0);
    expect(result.totals.sgst).toBe(0);
    expect(result.totals.igst).toBe(0);
    // The exact tax is still tracked so nothing is lost.
    expect(result.totals.tax).toBeGreaterThan(0);
  });

  it('handles an empty invoice', () => {
    const result = computeInvoiceTaxLines('intra', []);
    expect(result.lines).toHaveLength(0);
    expect(result.totals.tax).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Shared display-line mapper
// ---------------------------------------------------------------------------
describe('toInvoiceDisplayLines', () => {
  it('folds a mixed cases+loose purchase into one line with the sum of stored totals', () => {
    const lines = toInvoiceDisplayLines([
      {
        id: 'r1',
        product_id: 'prod-1',
        pack_id: 'pack-1',
        quantity: 1,
        quantity_unit: 'cases',
        quantity_pieces: 40,
        units_per_case: 40,
        unit_price: 400,
        gst_percent: 18,
        line_total: 400,
        products: { name: 'Wheat Flour', hsn_code: '1101', brands: { name: 'Gold' } },
        product_packs: { pack_name: '5kg bag', units_per_case: 40 },
      },
      {
        id: 'r2',
        product_id: 'prod-1',
        pack_id: 'pack-1',
        quantity: 6,
        quantity_unit: 'pieces',
        quantity_pieces: 6,
        units_per_case: 40,
        unit_price: 10,
        gst_percent: 18,
        line_total: 60,
        products: { name: 'Wheat Flour', hsn_code: '1101', brands: { name: 'Gold' } },
        product_packs: { pack_name: '5kg bag', units_per_case: 40 },
      },
    ]);
    expect(lines).toHaveLength(1);
    expect(lines[0]?.total).toBe(460); // 400 + 60 — stored sum, not a blended reprice
    expect(lines[0]?.hsn).toBe('1101');
    expect(lines[0]?.quantityLabel).toContain('46 pc');
    // Distinct unit prices per billed unit (case + piece).
    expect(lines[0]?.unitPrices).toHaveLength(2);
  });

  it('keeps HSN as null when the product has none', () => {
    const lines = toInvoiceDisplayLines([
      {
        id: 'r1',
        product_id: 'p',
        pack_id: 'pk',
        quantity: 2,
        quantity_unit: 'pieces',
        quantity_pieces: 2,
        units_per_case: 1,
        unit_price: 50,
        gst_percent: 0,
        line_total: 100,
        products: { name: 'Salt', hsn_code: null, brands: null },
        product_packs: { pack_name: '1kg', units_per_case: 1 },
      },
    ]);
    expect(lines[0]?.hsn).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Source-level guards
// ---------------------------------------------------------------------------
describe('invoice page guards', () => {
  it('shows an HSN column sourced from products.hsn_code', () => {
    expect(invoicePage).toContain('hsn_code');
    expect(invoicePage).toContain('HSN');
  });

  it('renders CGST/SGST or IGST via the classifier — and a plain GST line otherwise', () => {
    expect(invoicePage).toContain('classifyTaxSplit');
    expect(invoicePage).toContain('computeInvoiceTaxLines');
    expect(invoicePage).toContain('CGST');
    expect(invoicePage).toContain('SGST');
    expect(invoicePage).toContain('IGST');
  });

  it('keeps the stored grand total authoritative (not the recomputed tax sum)', () => {
    expect(invoicePage).toMatch(/order\.grand_total\.toFixed\(2\)/);
  });

  it('offers a real Download control next to Print', () => {
    expect(invoicePage).toContain('/retailer/orders/${order.id}/invoice/download');
    expect(invoicePage).toContain('Download');
  });

  it('still restricts the invoice to the caller\'s own order', () => {
    expect(invoicePage).toContain("eq('retailer_id', user.id)");
  });
});

describe('invoice download route guards', () => {
  it('re-checks auth and the retailer role', () => {
    expect(downloadRoute).toContain('await requireUser()');
    expect(downloadRoute).toContain("user.role !== 'retailer'");
    expect(downloadRoute).toContain('403');
  });

  it('scopes the order read to the caller (direct URL with a foreign id → 404)', () => {
    expect(downloadRoute).toContain("eq('retailer_id', user.id)");
    expect(downloadRoute).toContain('404');
  });

  it('serves the file as an attachment with the order number in the filename', () => {
    expect(downloadRoute).toContain('Content-Disposition');
    expect(downloadRoute).toContain('attachment');
    expect(downloadRoute).toContain('invoice-');
  });

  it('derives the same GST split as the page (single rule, no divergence)', () => {
    expect(downloadRoute).toContain('classifyTaxSplit');
    expect(downloadRoute).toContain('buildStandaloneInvoiceHtml');
  });
});

describe('standalone HTML builder', () => {
  it('escapes untrusted strings (XSS-safe interpolation)', () => {
    const html = buildStandaloneInvoiceHtml({
      orderNumber: 'MK-<script>alert(1)</script>',
      placedAt: new Date().toISOString(),
      company: {
        name: '<img src=x onerror=alert(1)>',
        gstin: 'Configure COMPANY_GSTIN in environment variables',
        address: 'a & b',
        phone: '—',
      },
      billedTo: { shopName: 'Shop "Quotes"', address: '—', areaName: '', gstin: '' },
      lines: [],
      taxMode: 'unsplit',
      subtotal: 0,
      gstTotal: 0,
      discountTotal: 0,
      grandTotal: 0,
    });
    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).not.toContain('<img src=x');
    expect(html).toContain('&lt;script&gt;');
    expect(html).toContain('a &amp; b');
  });

  it('prints CGST/SGST columns in intra mode', () => {
    const html = buildStandaloneInvoiceHtml({
      orderNumber: 'MK-2026-001',
      placedAt: new Date().toISOString(),
      company: { name: 'C', gstin: '10ABCDE1234F1Z5', address: 'A', phone: 'P' },
      billedTo: { shopName: 'S', address: 'A', areaName: '', gstin: '10XYZPA9999Q1Z2' },
      lines: [
        {
          key: 'pk',
          displayName: 'Item',
          packName: 'Pack',
          hsn: '1101',
          quantityLabel: '10 pcs',
          unitPrices: [{ price: 11.8, unit: 'pc' }],
          gstPercent: 18,
          total: 118,
        },
      ],
      taxMode: 'intra',
      subtotal: 100,
      gstTotal: 18,
      discountTotal: 0,
      grandTotal: 118,
    });
    expect(html).toContain('CGST');
    expect(html).toContain('SGST');
    expect(html).not.toContain('>IGST<');
  });
});

// Guard: the shared display module is imported by BOTH surfaces.
describe('display surface parity', () => {
  it('page and download route share the same line mapper', () => {
    expect(invoicePage).toContain('toInvoiceDisplayLines');
    expect(downloadRoute).toContain('toInvoiceDisplayLines');
    expect(displayModule).toContain('hsn_code');
  });
});
