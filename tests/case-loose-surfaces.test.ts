import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  formatQuantitySummary,
  formatRowQuantity,
  groupOrderLines,
  rowCases,
  rowLoosePieces,
  rowPieces,
  rowUnit,
  summarizeQuantityRows,
  type GroupableOrderItemRow,
} from '@/lib/orders/item-display';
import { calculateCaseLoosePrice, type PricingTier } from '@/lib/retailer/case-pricing';

const root = join(__dirname, '..');
const read = (rel: string) => readFileSync(join(root, rel), 'utf8');

/**
 * The surfaces that must speak the case + loose-piece language.
 *
 * Two kinds of guard live here:
 *   1. `lib/orders/item-display.ts` is unit-tested directly — it is the single
 *      interpretation of a persisted `order_items` row, shared by the retailer
 *      order page, the invoice, admin, staff, the salesman screen and the AI
 *      tools, so its folding rules are tested once and exhaustively.
 *   2. The UI files are source-scanned (the established style in this repo) to
 *      pin that they call the canonical engine instead of hand-rolling a price,
 *      and that the pricing editor for a pack has exactly one implementation.
 */
describe('reading persisted case / loose rows', () => {
  it('treats a cases row as cases and a pieces row as pieces', () => {
    const casesRow = { quantity: 2, quantity_unit: 'cases' as const, quantity_pieces: 80, units_per_case: 40 };
    const looseRow = { quantity: 6, quantity_unit: 'pieces' as const, quantity_pieces: 6, units_per_case: 40 };
    expect(rowUnit(casesRow)).toBe('cases');
    expect(rowUnit(looseRow)).toBe('pieces');
    expect(rowCases(casesRow)).toBe(2);
    expect(rowCases(looseRow)).toBe(0);
    expect(rowLoosePieces(casesRow)).toBe(0);
    expect(rowLoosePieces(looseRow)).toBe(6);
    expect(rowPieces(casesRow)).toBe(80);
    expect(rowPieces(looseRow)).toBe(6);
  });

  it('keeps historical rows (no unit) on their original pack semantics', () => {
    // Before the split `quantity` meant packs/cases of `units_per_case`.
    const legacy = { quantity: 3, quantity_unit: null, quantity_pieces: null, units_per_case: 12 };
    expect(rowUnit(legacy)).toBe('cases');
    expect(rowPieces(legacy)).toBe(36);
    expect(summarizeQuantityRows([legacy])).toEqual({ pieces: 36, cases: 3, loose: 0, unitsPerCase: 12 });
  });

  it('derives pieces from the order-time snapshot, not from today pack size', () => {
    // The pack was later reconfigured to 24 pcs: the row still says 40.
    const snapshot = { quantity: 1, quantity_unit: 'cases' as const, quantity_pieces: 40, units_per_case: 40 };
    expect(rowPieces({ ...snapshot, units_per_case: 40 })).toBe(40);
    // And when no snapshot exists at all, the embedded (current) pack size is
    // the only available source — matching the pre-upgrade behaviour.
    expect(rowPieces({ quantity: 2, quantity_unit: null, quantity_pieces: null, units_per_case: null })).toBe(2);
  });

  it('folds a mixed line into Cases: 1 / Loose: 6 for 46 pieces', () => {
    const rows = [
      { quantity: 1, quantity_unit: 'cases' as const, quantity_pieces: 40, units_per_case: 40 },
      { quantity: 6, quantity_unit: 'pieces' as const, quantity_pieces: 6, units_per_case: 40 },
    ];
    expect(summarizeQuantityRows(rows)).toEqual({ pieces: 46, cases: 1, loose: 6, unitsPerCase: 40 });
    expect(formatQuantitySummary(summarizeQuantityRows(rows))).toBe('46 pcs (1 Case + 6 loose pcs)');
    expect(formatRowQuantity(rows[0]!)).toBe('1 Case');
    expect(formatRowQuantity(rows[1]!)).toBe('6 loose pcs');
  });

  it('labels pure-case and pure-loose quantities plainly', () => {
    expect(
      formatQuantitySummary(summarizeQuantityRows([{ quantity: 2, quantity_unit: 'cases', quantity_pieces: 80, units_per_case: 40 }]))
    ).toBe('80 pcs (2 Cases)');
    expect(
      formatQuantitySummary(summarizeQuantityRows([{ quantity: 12, quantity_unit: 'pieces', quantity_pieces: 12, units_per_case: 40 }]))
    ).toBe('12 pcs (12 loose pcs)');
    // A line whose split is unknown (historical single case row) still reads well.
    expect(formatQuantitySummary({ pieces: 1, cases: 0, loose: 0, unitsPerCase: 1 })).toBe('1 pc');
  });

  it('groups rows per pack and sums the stored money without repricing', () => {
    const rows: (GroupableOrderItemRow & { id: string; line_total: number })[] = [
      { id: 'a', product_id: 'p1', pack_id: 'k1', quantity: 1, quantity_unit: 'cases', quantity_pieces: 40, units_per_case: 40, line_total: 1000 },
      { id: 'b', product_id: 'p1', pack_id: 'k1', quantity: 6, quantity_unit: 'pieces', quantity_pieces: 6, units_per_case: 40, line_total: 180 },
      { id: 'c', product_id: 'p2', pack_id: 'k2', quantity: 2, quantity_unit: 'cases', quantity_pieces: 48, units_per_case: 24, line_total: 1800 },
    ];
    const lines = groupOrderLines(rows);
    expect(lines).toHaveLength(2);
    expect(lines[0]!.key).toBe('k1');
    expect(lines[0]!.total).toBe(1180);
    expect(lines[0]!.quantity).toMatchObject({ pieces: 46, cases: 1, loose: 6 });
    expect(lines[1]!.total).toBe(1800);
    // Σ of the grouped lines equals Σ of the stored rows — nothing is dropped
    // or double counted when a line is folded.
    const storedTotal = rows.reduce((sum, row) => sum + row.line_total, 0);
    expect(lines.reduce((sum, line) => sum + line.total, 0)).toBeCloseTo(storedTotal, 2);
  });

  it('keeps the folded total exact with fractional paise', () => {
    const rows: (GroupableOrderItemRow & { line_total: number })[] = [
      { pack_id: 'k1', product_id: 'p1', quantity: 1, quantity_unit: 'cases', quantity_pieces: 3, units_per_case: 3, line_total: 100.01 },
      { pack_id: 'k1', product_id: 'p1', quantity: 2, quantity_unit: 'pieces', quantity_pieces: 2, units_per_case: 3, line_total: 33.33 },
    ];
    expect(groupOrderLines(rows)[0]!.total).toBe(133.34);
  });
});

describe('retailer surfaces price through the canonical engine only', () => {
  it('product page shows the case price and the loose tiers of the selected variant', () => {
    const page = read('app/retailer/catalog/[id]/page.tsx');
    expect(page).toContain("from '@/components/retailer/pricing-schedule'");
    expect(page).toContain('<CaseLoosePriceSchedule');
    expect(page).toContain('allow_loose_pieces');
    expect(page).toContain('never compulsory');
    // The cart summary on the same page uses the engine, in pieces.
    expect(page).toContain('calculateCaseLoosePrice({');
    expect(page).toContain('quantity: item.quantity');
  });

  it('pack selector enters pieces, suggests quantities and never forces a case', () => {
    const selector = read('components/retailer/pack-selector.tsx');
    expect(selector).toContain('calculateCaseLoosePrice({');
    expect(selector).toContain('suggestedQuantities({');
    expect(selector).toContain('Quantity (pcs)');
    expect(selector).toContain('<CaseLooseLineBreakdown');
    // Add / update still submit (packId, pieces) — the server prices them.
    expect(selector).toContain('addToCartAction(pack.id, qty)');
    expect(selector).toContain('updateCartQuantityAction(inCart.cartItemId, qty)');
    // Case-only packs are the admin's choice, not a hard-coded restriction.
    expect(selector).toContain('allowLoosePieces: pack.allowLoosePieces !== false');
  });

  it('cart line is editable in pieces and shows the case + loose breakdown', () => {
    const row = read('components/retailer/cart-item-row.tsx');
    expect(row).toContain('calculateCaseLoosePrice({');
    expect(row).toContain('<CaseLooseLineBreakdown');
    expect(row).toContain('min={moq}');
    const page = read('app/retailer/cart/page.tsx');
    expect(page).toContain('calculateCaseLoosePrice({');
    expect(page).toContain('allowLoosePieces: pack?.allow_loose_pieces !== false');
  });

  it('checkout re-quotes with the engine and blocks an unpriced loose remainder', () => {
    const checkout = read('app/retailer/checkout/page.tsx');
    expect(checkout).toContain('calculateCaseLoosePrice({');
    expect(checkout).toContain('Cases: {line.cases} · Loose: {line.loosePieces}');
    expect(checkout).toContain('disabled={lines.some((line) => !line.orderable)}');
    // GST is still extracted, never added on top.
    expect(checkout).not.toMatch(/\*\s*\(1\s*\+\s*gst/);
  });

  it('order detail, invoice and picking list read quantity_pieces', () => {
    for (const file of [
      'app/retailer/orders/[id]/page.tsx',
      'app/retailer/orders/[id]/invoice/page.tsx',
      'app/admin/orders/[id]/page.tsx',
      'app/salesman/orders/[id]/page.tsx',
      'app/staff/orders/[id]/page.tsx',
    ]) {
      const source = read(file);
      expect(source, file).toContain('quantity_pieces');
      expect(source, file).toContain("from '@/lib/orders/item-display'");
      // The old `quantity × units_per_case` guess is gone from every view.
      expect(source, file).not.toMatch(/quantity\s*\*\s*(units|unitsPerCase)/);
    }
    expect(read('app/retailer/orders/[id]/page.tsx')).toContain('groupOrderLines(items)');
    expect(read('app/retailer/orders/[id]/invoice/page.tsx')).toContain('formatQuantitySummary(line.quantity)');
  });

  it('reorder re-orders pieces, not a case count', () => {
    const page = read('app/retailer/orders/[id]/reorder/page.tsx');
    expect(page).toContain('groupOrderLines(items.filter((item) => item.pack_id))');
    expect(page).toContain('previousQuantity: quantity.pieces');
    const form = read('components/retailer/reorder-form.tsx');
    expect(form).toContain('calculateCaseLoosePrice({');
    expect(form).not.toContain('currentUnitPrice * quantity');
  });

  it('AI cart tools speak in pieces and label a quote by its billing parts', () => {
    const cart = read('lib/ai/tools/cart.ts');
    expect(cart).toContain('Quantity in pieces (not cases)');
    expect(cart).toContain('quoteLineLabel');
    expect(cart).toContain('loose pc');
    const history = cart.match(/existing.totalQuantity \+= (.+);/);
    expect(history?.[1]).toBe('row.quantity_pieces ?? row.quantity');
  });

  it('AI order tools fold rows back into pieces for reorder and frequency', () => {
    const orders = read('lib/ai/tools/orders.ts');
    expect(orders).toContain('piecesByPack');
    expect(orders).toContain('rowPieces(item)');
    expect(orders).toContain('piecesByOrderProduct');
    expect(orders).toContain('formatRowQuantity(item)');
  });

  it('salesman order capture submits pieces and previews with the engine', () => {
    const actions = read('lib/salesman/order-creation-actions.ts');
    expect(actions).toContain("describe('Quantity in pieces (not cases)')");
    const builder = read('components/salesman/order-builder.tsx');
    expect(builder).toContain('calculateCaseLoosePrice({');
    expect(builder).toContain('blockedLine');
    expect(builder).not.toContain('effectivePrice * quantity');
  });

  it('quick order grid prices each typed piece count with the engine', () => {
    const row = read('components/retailer/quick-order-row.tsx');
    expect(row).toContain('calculateCaseLoosePrice({');
    expect(row).toContain('disabled={isPending || !pricing.orderable}');
    expect(row).toContain('quantity in pieces');
    // The old shortcut (case price × pieces) must not come back.
    expect(row).not.toContain('landedPrice * quantity');
    const page = read('app/retailer/quick-order/page.tsx');
    expect(page).toContain('loadPackTiers');
    expect(page).toContain('allow_loose_pieces');
  });

  it('catalog cards use the engine for their per-piece reference rate', () => {
    const card = read('components/retailer/product-card.tsx');
    expect(card).toContain('piecePriceFromCase(fromPrice, unitsPerCase)');
    expect(card).not.toMatch(/fromPrice\s*\/\s*unitsPerCase/);
    expect(card).toContain('quantity in pieces');
  });
});

describe('admin configures one case + loose model', () => {
  it('has a single editor for a pack, using the engine for validation and preview', () => {
    expect(existsSync(join(root, 'components/admin/pack-pricing-tiers.tsx'))).toBe(false);
    const editor = read('components/admin/pack-case-pricing.tsx');
    expect(editor).toContain('validateLooseTierSet(');
    expect(editor).toContain('findLooseCoverageGaps(');
    expect(editor).toContain('looseTierDraftToRow(');
    expect(editor).toContain('calculateCaseLoosePrice({');
    expect(editor).toContain('savePackPricingAction({');
    // The preview says so out loud, and there is no local copy of the math.
    expect(editor).toContain('same function as checkout');
    expect(editor).not.toMatch(/casePrice\s*\/\s*unitsPerCase\s*\*\s*quantity/);
  });

  it('server-side save validates, converts and refuses to reprice cases', () => {
    const actions = read('lib/admin/products-actions.ts');
    expect(actions).toContain('export async function savePackPricingAction(');
    expect(actions).toContain('validateLooseTierSet(drafts, unitsPerCase)');
    expect(actions).toContain('findLooseCoverageGaps(rows, unitsPerCase)');
    expect(actions).toContain('looseTierDraftToRow(draft, unitsPerCase)');
    expect(actions).toContain("rule_type: 'loose' as const");
    expect(actions).toContain('allow_loose_pieces: d.allowLoosePieces');
    // Partial coverage has to be acknowledged — never silently repriced.
    expect(actions).toContain('acknowledgeGaps');
    // The legacy per-row tier endpoints are gone: one writer, one rule set.
    expect(actions).not.toContain('export async function addPricingTierAction(');
    expect(actions).not.toContain('export async function updatePricingTierAction(');
  });

  it('never derives a case price from a piece price in the admin path', () => {
    // `case_price` is the source of truth, so the admin form must write it from
    // the input directly; multiplying a piece price up would recreate the bug.
    const actions = read('lib/admin/products-actions.ts');
    for (const match of actions.matchAll(/case_price:\s*([^,\n]+)/g)) {
      expect(match[1], 'case_price assignment').not.toMatch(/\*\s*units/i);
    }
  });

  it('pack manager feeds the editor from database values only', () => {
    const manager = read('components/admin/product-pack-manager.tsx');
    expect(manager).toContain('<PackCasePricing');
    expect(manager).toContain('allowLoosePieces={pack.allow_loose_pieces !== false}');
    expect(manager).toContain('moq={pack.moq}');
    expect(manager).toContain('Min order qty (pieces)');
    const page = read('app/admin/products/[id]/page.tsx');
    expect(page).toContain('moq, allow_loose_pieces');
    expect(page).toContain("rule_type: 'default' | 'case' | 'bulk' | 'loose'");
  });
});

describe('the mandated worked examples still hold end to end', () => {
  const pack = {
    unitsPerCase: 40,
    casePrice: 1000,
    tiers: [
      { min_quantity: 1, max_quantity: 7, price_per_piece: 30, rule_type: 'loose' as const },
      { min_quantity: 7, max_quantity: 13, price_per_piece: 28, rule_type: 'loose' as const },
      { min_quantity: 13, max_quantity: 21, price_per_piece: 27, rule_type: 'loose' as const },
      { min_quantity: 21, max_quantity: 40, price_per_piece: 26, rule_type: 'loose' as const },
    ],
  };

  it('produces the table the business rule defines', () => {
    const expected: [number, number][] = [
      [6, 180],
      [10, 280],
      [12, 336],
      [25, 650],
      [40, 1000],
      [46, 1180],
      [48, 1224],
      [80, 2000],
      [85, 2150],
      [92, 2336],
    ];
    for (const [quantity, total] of expected) {
      const pricing = calculateCaseLoosePrice({ quantity, ...pack, gstPercent: 5 });
      expect(pricing.total, `${quantity} pcs`).toBe(total);
    }
  });

  it('splits a mixed line into rows that reconcile exactly', () => {
    // This is what the invoice renders for 46 pcs, straight from the engine.
    const pricing = calculateCaseLoosePrice({ quantity: 46, ...pack, gstPercent: 5 });
    const caseRow = { quantity: pricing.fullCases, unitPrice: pricing.casePrice, lineTotal: pricing.caseSubtotal };
    const looseRow = {
      quantity: pricing.looseQuantity,
      unitPrice: pricing.looseUnitPrice ?? 0,
      lineTotal: pricing.looseSubtotal,
    };
    for (const row of [caseRow, looseRow]) {
      expect(row.unitPrice * row.quantity).toBeCloseTo(row.lineTotal, 2);
    }
    expect(caseRow.lineTotal + looseRow.lineTotal).toBe(pricing.total);
    expect(
      summarizeQuantityRows([
        { quantity: caseRow.quantity, quantity_unit: 'cases', quantity_pieces: 40, units_per_case: 40 },
        { quantity: looseRow.quantity, quantity_unit: 'pieces', quantity_pieces: 6, units_per_case: 40 },
      ])
    ).toMatchObject({ pieces: 46, cases: 1, loose: 6 });
  });
});

describe('the exact 80-piece configuration from the requirement (admin → page → cart → quote → invoice)', () => {
  //   units/case   80 pcs
  //   case price   ₹1,000 (GST-inclusive)
  //   loose tiers  1–6 → ₹30 · 7–12 → ₹28 · 13–20 → ₹27 · 21–79 → ₹26
  const EIGHTY: PricingTier[] = [
    { min_quantity: 1, max_quantity: 7, price_per_piece: 30, rule_type: 'loose' },
    { min_quantity: 7, max_quantity: 13, price_per_piece: 28, rule_type: 'loose' },
    { min_quantity: 13, max_quantity: 21, price_per_piece: 27, rule_type: 'loose' },
    { min_quantity: 21, max_quantity: 80, price_per_piece: 26, rule_type: 'loose' },
  ];
  const exact = (quantity: number) =>
    calculateCaseLoosePrice({ quantity, unitsPerCase: 80, casePrice: 1000, tiers: EIGHTY, gstPercent: 0 });

  it('prices 6 / 12 / 20 / 80 / 92 / 160 pcs exactly as mandated', () => {
    const expected: [number, number, number, number][] = [
      [6, 180, 0, 6],
      [12, 336, 0, 12],
      [20, 540, 0, 20],
      [80, 1000, 1, 0],
      [92, 1336, 1, 12],
      [160, 2000, 2, 0],
    ];
    for (const [quantity, total, cases, loose] of expected) {
      const pricing = exact(quantity);
      expect(pricing.total, `${quantity} pcs`).toBe(total);
      expect(pricing.fullCases).toBe(cases);
      expect(pricing.looseQuantity).toBe(loose);
      expect(pricing.orderable).toBe(true);
    }
  });

  it('writes and invoices 92 pcs as 1 case × ₹1,000 + 12 loose × ₹28 — never a prorated ₹150', () => {
    const pricing = exact(92);
    expect(pricing.caseSubtotal).toBe(1000);
    expect(pricing.looseSubtotal).toBe(336);
    expect(pricing.total).toBe(1336);
    // The exact rows the server quote persists.
    const rows = [
      { quantity: pricing.fullCases, quantity_unit: 'cases' as const, quantity_pieces: 80, units_per_case: 80 },
      { quantity: pricing.looseQuantity, quantity_unit: 'pieces' as const, quantity_pieces: 12, units_per_case: 80 },
    ];
    expect(pricing.caseSubtotal + pricing.looseSubtotal).toBe(pricing.total);
    expect(formatQuantitySummary(summarizeQuantityRows(rows))).toBe('92 pcs (1 Case + 12 loose pcs)');
    // The forbidden formula 12/80 × ₹1,000 = ₹150 must never appear anywhere.
    expect(pricing.total).not.toBe((12 / 80) * 1000);
  });

  it('product page shows the case + loose schedule and never the old bulk-only table', () => {
    const page = read('app/retailer/catalog/[id]/page.tsx');
    expect(page).toContain('piecePriceFromCase(selectedCasePrice, selectedPack.units_per_case)');
    expect(page).not.toMatch(/selectedCasePrice\s*\/\s*selectedPack\.units_per_case/);
  });

  it('admin editor and pack manager flag the legacy 1 pc = 1 case state from the reported screenshot', () => {
    expect(read('components/admin/pack-case-pricing.tsx')).toContain('1 pc = 1 case');
    expect(read('components/admin/product-pack-manager.tsx')).toContain('1 pc = 1 case');
  });
});
