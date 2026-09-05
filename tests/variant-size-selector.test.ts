import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  buildVariantSwitcher,
  variantHref,
  type VariantPackBase,
  type VariantPricingInput,
} from '@/lib/retailer/variants';
import { caseLineBreakdown, piecePriceFromCase, round2 } from '@/lib/retailer/case-pricing';
import { quoteOrderForRetailer } from '@/lib/orders/quote-order';

const root = join(__dirname, '..');
const read = (rel: string) => readFileSync(join(root, rel), 'utf8');

/**
 * Phase 2 — the advanced, DYNAMIC size selector.
 *
 * The sizes below deliberately include 30g, 50g, 100g, 200g, 500g AND the
 * arbitrary future sizes 750g / 2kg. Nothing in the production code may
 * enumerate them: every value comes from the `product_packs` rows an admin
 * created, so a brand-new size must work with zero code changes.
 */
const PRODUCT_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

interface SizeFixture {
  id: string;
  pack_name: string;
  units_per_case: number;
  /** GST-INCLUSIVE case price — the source of truth. */
  case_price: number;
  mrp: number | null;
  is_active: boolean;
  sort_order: number;
}

const SIZES: SizeFixture[] = [
  { id: '11111111-1111-4111-8111-111111111111', pack_name: '30g', units_per_case: 96, case_price: 1152, mrp: 15, is_active: true, sort_order: 0 },
  { id: '22222222-2222-4222-8222-222222222222', pack_name: '50g', units_per_case: 48, case_price: 1200, mrp: 30, is_active: true, sort_order: 1 },
  { id: '33333333-3333-4333-8333-333333333333', pack_name: '100g', units_per_case: 24, case_price: 1440, mrp: 70, is_active: true, sort_order: 2 },
  { id: '44444444-4444-4444-8444-444444444444', pack_name: '200g', units_per_case: 12, case_price: 1320, mrp: 130, is_active: true, sort_order: 3 },
  { id: '55555555-5555-4555-8555-555555555555', pack_name: '500g', units_per_case: 10, case_price: 2500, mrp: 280, is_active: true, sort_order: 4 },
  { id: '66666666-6666-4666-8666-666666666666', pack_name: '750g', units_per_case: 8, case_price: 2880, mrp: 400, is_active: true, sort_order: 5 },
  { id: '77777777-7777-4777-8777-777777777777', pack_name: '2kg', units_per_case: 6, case_price: 5400, mrp: 999, is_active: false, sort_order: 6 },
];

const BASES: VariantPackBase[] = SIZES.map((size) => ({
  id: size.id,
  pack_name: size.pack_name,
  is_active: size.is_active,
  sort_order: size.sort_order,
}));

const PRICING = new Map<string, VariantPricingInput>(
  SIZES.map((size) => [
    size.id,
    { piecePrice: round2(size.case_price / size.units_per_case), mrp: size.mrp, hasOffer: false },
  ])
);

const bySize = (name: string) => SIZES.find((size) => size.pack_name === name)!;

describe('Phase 2 — dynamic variant size selector', () => {
  it('renders every admin-created size, in sort order, with no hard-coded list', () => {
    const model = buildVariantSwitcher(BASES, null, PRICING);
    expect(model.variants.map((variant) => variant.label)).toEqual([
      '30g',
      '50g',
      '100g',
      '200g',
      '500g',
      '750g',
      '2kg',
    ]);
    // A future size added by Super Admin needs no code change.
    const withNewSize = buildVariantSwitcher(
      [...BASES, { id: '88888888-8888-4888-8888-888888888888', pack_name: '5kg', is_active: true, sort_order: 7 }],
      null,
      PRICING
    );
    expect(withNewSize.variants.at(-1)?.label).toBe('5kg');
    // …and it stays navigable even before any price detail is supplied.
    expect(withNewSize.variants.at(-1)?.isAvailable).toBe(true);
    expect(withNewSize.variants.at(-1)?.pricing).toBeNull();
  });

  it('never hard-codes a size anywhere in the variant/selector production code', () => {
    const sources = [
      read('lib/retailer/variants.ts'),
      read('components/retailer/variant-switcher.tsx'),
      read('lib/retailer/case-pricing.ts'),
    ].join('\n');
    // Size tokens may only appear inside explanatory comments, never in logic.
    const codeOnly = sources
      .split('\n')
      .filter((line) => !line.trimStart().startsWith('*') && !line.trimStart().startsWith('//') && !line.trimStart().startsWith('/*'))
      .join('\n');
    expect(codeOnly).not.toMatch(/['"`](?:30|50|100|200|500|750)\s?g['"`]/i);
    expect(codeOnly).not.toMatch(/['"`]\d+\s?kg['"`]/i);
    // Neither may piece counts per case be assumed.
    expect(codeOnly).not.toMatch(/unitsPerCase\s*=\s*12\b/);
  });

  it('each size card carries its OWN per-piece selling price', () => {
    const model = buildVariantSwitcher(BASES, null, PRICING);
    const g750 = model.variants.find((variant) => variant.label === '750g')!;
    expect(g750.pricing).not.toBeNull();
    expect(g750.pricing!.piecePrice).toBe(360); // 2880 / 8 — derived, never stored
    // No cross-contamination between variants.
    const g30 = model.variants.find((variant) => variant.label === '30g')!;
    expect(g30.pricing!.piecePrice).toBe(12); // 1152 / 96
  });

  it('shows a discount only when a real MRP is genuinely higher', () => {
    const model = buildVariantSwitcher(BASES, null, PRICING);
    const g30 = model.variants.find((variant) => variant.label === '30g')!;
    expect(g30.pricing!.mrp).toBe(15);
    expect(g30.pricing!.discountPercent).toBe(20); // 15 -> 12

    const noMrp = buildVariantSwitcher(
      [BASES[0]!],
      null,
      new Map([[BASES[0]!.id, { piecePrice: 12, mrp: null }]])
    );
    expect(noMrp.variants[0]!.pricing!.discountPercent).toBe(0);

    // MRP below the selling price never becomes a negative "saving".
    const badMrp = buildVariantSwitcher(
      [BASES[0]!],
      null,
      new Map([[BASES[0]!.id, { piecePrice: 12, mrp: 5 }]])
    );
    expect(badMrp.variants[0]!.pricing!.discountPercent).toBe(0);
  });

  it('awards BEST VALUE to the cheapest available per-piece size — and never to an unavailable one', () => {
    const model = buildVariantSwitcher(BASES, null, PRICING);
    const best = model.variants.filter((variant) => variant.isBestValue);
    expect(best).toHaveLength(1);
    expect(best[0]!.label).toBe('30g'); // ₹12/pc is the lowest
    expect(model.variants.find((variant) => variant.label === '2kg')!.isBestValue).toBe(false);
  });

  it('awards no BEST VALUE badge when every size costs the same per piece', () => {
    const flat = new Map<string, VariantPricingInput>([
      [BASES[0]!.id, { piecePrice: 10 }],
      [BASES[1]!.id, { piecePrice: 10 }],
    ]);
    const model = buildVariantSwitcher(BASES.slice(0, 2), null, flat);
    expect(model.variants.some((variant) => variant.isBestValue)).toBe(false);
  });

  it('marks exactly the URL-selected variant and links to that variant route', () => {
    const model = buildVariantSwitcher(BASES, bySize('500g').id, PRICING);
    const selected = model.variants.filter((variant) => variant.isSelected);
    expect(selected.map((variant) => variant.label)).toEqual(['500g']);
    expect(selected[0]!.href).toBe(variantHref(bySize('500g').id));
    expect(selected[0]!.href).toContain('/retailer/catalog/');
  });

  it('an inactive size is shown as unavailable, is never linked and gets no price card', () => {
    const model = buildVariantSwitcher(BASES, null, PRICING);
    const kg2 = model.variants.find((variant) => variant.label === '2kg')!;
    expect(kg2.isAvailable).toBe(false);
    const component = read('components/retailer/variant-switcher.tsx');
    // Unavailable variants render a <span>, never a <Link>.
    expect(component).toContain('if (!variant.isAvailable)');
    expect(component).toContain('aria-disabled="true"');
  });

  it('is a Server Component using real Links, with mobile scrolling and a view-all disclosure', () => {
    const component = read('components/retailer/variant-switcher.tsx');
    expect(component).toContain("from 'next/link'");
    expect(component).toContain('href={variant.href}');
    expect(component).not.toContain("'use client'");
    expect(component).not.toContain('useState');
    // Horizontal snap scrolling on mobile, grid from sm up.
    expect(component).toContain('overflow-x-auto');
    expect(component).toContain('snap-x');
    // JS-free "view all sizes" interaction for products with many variants.
    expect(component).toContain('<details');
    expect(component).toContain('View all {model.variants.length} sizes');
  });

  it('never exposes staff-only inventory numbers on a retailer size card', () => {
    const component = read('components/retailer/variant-switcher.tsx');
    const helpers = read('lib/retailer/variants.ts');
    for (const source of [component, helpers]) {
      expect(source).not.toMatch(/inventory_stock|current_quantity|quantity_on_hand|reserved_quantity/);
    }
  });
});

describe('Phase 4 — case/loose quantity and GST-inclusive pricing stay correct for any size', () => {
  it('splits pieces into full cases + loose pieces using the variant’s own units_per_case', () => {
    const g200 = bySize('200g'); // 12 per case
    const twoCasesOneLoose = caseLineBreakdown({
      casePrice: g200.case_price,
      unitsPerCase: g200.units_per_case,
      pieceQuantity: 25,
      gstPercent: 5,
    });
    expect(twoCasesOneLoose.cases).toBe(2);
    expect(twoCasesOneLoose.loosePieces).toBe(1);
    expect(twoCasesOneLoose.total).toBe(round2(2 * 1320 + 110));

    // The same 25 pieces of a 6-per-case size is 4 cases + 1 loose — proof
    // that 12-per-case is never assumed.
    const kg2 = bySize('2kg'); // 6 per case
    const other = caseLineBreakdown({
      casePrice: kg2.case_price,
      unitsPerCase: kg2.units_per_case,
      pieceQuantity: 25,
      gstPercent: 5,
    });
    expect(other.cases).toBe(4);
    expect(other.loosePieces).toBe(1);
  });

  it('extracts GST from the inclusive price and never adds it twice', () => {
    // ₹75 inclusive @ 5% GST -> the customer pays exactly ₹75.
    const line = caseLineBreakdown({ casePrice: 75, unitsPerCase: 1, pieceQuantity: 1, gstPercent: 5 });
    expect(line.total).toBe(75);
    expect(line.gst).toBe(round2((75 * 5) / 105));
    expect(round2(line.subtotal + line.gst)).toBe(75);
  });

  it('derives the piece price for an arbitrary future size without configuration', () => {
    expect(piecePriceFromCase(2880, 8)).toBe(360); // 750g
    expect(piecePriceFromCase(1152, 96)).toBe(12); // 30g
  });
});

// ----------------------------------------------------------------------------
// Server quote: unit_price must reconcile with the persisted line_total, so an
// invoice can never print "12 × ₹99.96 = ₹1,200.00".
// ----------------------------------------------------------------------------
function makeFakeSupabase(packs: Record<string, unknown>[]) {
  const retailer = {
    id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    area_id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
    status: 'active',
    credit_limit: 1000000,
    outstanding_balance: 0,
  };
  const builder = (table: string) => {
    const state: { table: string; ids: string[] } = { table, ids: [] };
    const chain: Record<string, unknown> = {};
    const self = () => chain as never;
    Object.assign(chain, {
      select: () => self(),
      eq: () => self(),
      lte: () => self(),
      in: (_col: string, ids: string[]) => {
        state.ids = ids;
        return self();
      },
      order: () => self(),
      returns: () => chain,
      maybeSingle: async () => ({ data: state.table === 'retailers' ? retailer : null, error: null }),
      then: (resolve: (value: { data: unknown[]; error: null }) => unknown) => {
        if (state.table === 'product_packs') {
          return resolve({ data: packs.filter((pack) => state.ids.includes(pack.id as string)), error: null });
        }
        return resolve({ data: [], error: null });
      },
    });
    return chain;
  };
  return { from: (table: string) => builder(table) };
}

describe('Phase 5 — persisted order lines reconcile (unit_price × quantity = line_total)', () => {
  it('persists an exact piece-billed line even when the case size is odd', async () => {
    // 7 pieces per case × ₹100 — an odd divisor. In the retailer piece model the
    // pack is billed per piece at the derived rate (₹14.29/pc), and the persisted
    // row satisfies unit_price × quantity = line_total exactly to the paisa.
    const pack = {
      id: '99999999-9999-4999-8999-999999999999',
      product_id: PRODUCT_ID,
      pack_name: '350g',
      base_price: 100,
      ptr: null,
      case_price: 100,
      units_per_case: 7,
      moq: 1,
      is_active: true,
      products: { id: PRODUCT_ID, name: 'Test Product', gst_percent: 5, is_active: true },
    };
    const result = await quoteOrderForRetailer({
      retailerId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
      lines: [{ packId: pack.id, quantity: 21 }],
      supabase: makeFakeSupabase([pack]) as never,
    });
    expect('quote' in result).toBe(true);
    if (!('quote' in result)) return;
    const line = result.quote.lines[0]!;

    expect(line.pieces).toBe(21);
    expect(line.cases).toBe(0);
    expect(line.loosePieces).toBe(0);
    // Derived per-piece rate: 100 / 7 = ₹14.29; line total reconciles in paise.
    expect(line.piecePrice).toBe(14.29);
    expect(line.lineTotal).toBe(round2(line.piecePrice * 21));
    expect(line.items).toHaveLength(1);
    expect(line.items[0]).toMatchObject({ quantity: 21, quantityUnit: 'pieces', unitPrice: 14.29 });
    expect(round2(line.items[0]!.unitPrice * line.items[0]!.quantity)).toBe(line.items[0]!.lineTotal);
    // GST is extracted from the inclusive total, never added on top.
    expect(round2(line.subtotal + line.gst)).toBe(line.lineTotal);
  });

  it('prices any piece quantity at the retail tier rate — no case/loose split', async () => {
    const pack = {
      id: '99999999-9999-4999-8999-999999999999',
      product_id: PRODUCT_ID,
      pack_name: '350g',
      base_price: 100,
      ptr: null,
      case_price: 100,
      units_per_case: 7,
      moq: 1,
      is_active: true,
      products: { id: PRODUCT_ID, name: 'Test Product', gst_percent: 5, is_active: true },
    };
    const result = await quoteOrderForRetailer({
      retailerId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
      lines: [{ packId: pack.id, quantity: 10 }],
      supabase: makeFakeSupabase([pack]) as never,
    });
    expect('quote' in result).toBe(true);
    if (!('quote' in result)) return;
    const line = result.quote.lines[0]!;
    expect(line.cases).toBe(0);
    expect(line.loosePieces).toBe(0);
    expect(line.items).toHaveLength(1);
    expect(line.items[0]).toMatchObject({ quantity: 10, quantityUnit: 'pieces', unitPrice: 14.29 });
    expect(round2(line.items[0]!.unitPrice * line.items[0]!.quantity)).toBe(line.items[0]!.lineTotal);
  });

  it('order creation persists the reconciled per-piece unit price', () => {
    const create = read('lib/orders/create-order.ts');
    expect(create).toContain('unit_price: item.unitPrice');
    expect(create).toContain('line_total: item.lineTotal');
    const quote = read('lib/orders/quote-order.ts');
    expect(quote).toContain('unitPrice: pricing.unitPrice');
    expect(quote).toContain("quantityUnit: 'pieces'");
  });
});

describe('Phase 6 — admin can create unlimited variants without typing a code', () => {
  it('generates the internal pack SKU instead of asking the admin for one', () => {
    const actions = read('lib/admin/products-actions.ts');
    expect(actions).toContain('function generatePackSkuCode(productId: string)');
    expect(actions).toContain('parsed.data.packSkuCode || generatePackSkuCode(productId)');
    // The database column (NOT NULL UNIQUE) is still written.
    expect(actions).toContain('pack_sku_code: d.packSkuCode');
  });

  it('no longer renders a SKU field in the pack manager workflow', () => {
    const manager = read('components/admin/product-pack-manager.tsx');
    expect(manager).not.toContain('name="packSkuCode"');
    expect(manager).not.toContain('>Pack SKU<');
    // The variant name stays free text so any size can be created.
    expect(manager).toContain('name="packName"');
    expect(manager).toContain('name="casePrice"');
    expect(manager).toContain('name="unitsPerCase"');
    expect(manager).toContain('setPackImageAction');
  });
});
