/**
 * Regression tests for the retailer UI/UX redesign pass. These tests verify
 * the new helpers (`nextTierHint`, `describeOrderTotals`) and the surface-level
 * "no wholesale admin language" rules without going through the database.
 *
 * The visual styling changes (color tokens, hero sections, card design) are
 * covered by the existing page-level assertion suites — those scan the
 * rendered page text for required strings. This file stays focused on the
 * new pure-function behaviour.
 */
import { describe, expect, it } from 'vitest';
import { nextTierHint } from '@/lib/retailer/catalog';
import { describeOrderTotals } from '@/lib/orders/item-display';

describe('nextTierHint (product card "buy more, save more" hint)', () => {
  it('returns null when there is no current price', () => {
    expect(
      nextTierHint(
        [
          { min_quantity: 1, max_quantity: 6, price_per_piece: 85, rule_type: 'default' },
          { min_quantity: 7, max_quantity: 12, price_per_piece: 80, rule_type: 'bulk' },
        ],
        12,
        null
      )
    ).toBeNull();
  });

  it('returns null when the pack has only one tier', () => {
    expect(
      nextTierHint(
        [{ min_quantity: 1, max_quantity: 6, price_per_piece: 85, rule_type: 'default' }],
        12,
        85
      )
    ).toBeNull();
  });

  it('returns null when no tier beats the current from price', () => {
    expect(
      nextTierHint(
        [
          { min_quantity: 1, max_quantity: 6, price_per_piece: 85, rule_type: 'default' },
          { min_quantity: 7, max_quantity: null, price_per_piece: 90, rule_type: 'bulk' },
        ],
        12,
        80
      )
    ).toBeNull();
  });

  it('returns the next better tier when one exists', () => {
    const hint = nextTierHint(
      [
        { min_quantity: 1, max_quantity: 6, price_per_piece: 85, rule_type: 'default' },
        { min_quantity: 7, max_quantity: 12, price_per_piece: 80, rule_type: 'bulk' },
        { min_quantity: 13, max_quantity: null, price_per_piece: 77, rule_type: 'bulk' },
      ],
      12,
      85
    );
    expect(hint).not.toBeNull();
    expect(hint?.minQuantity).toBe(7);
    expect(hint?.pricePerPiece).toBe(80);
    expect(hint?.label).toBe('7+ pcs se ₹80/pc');
  });

  it('ignores inactive tiers', () => {
    expect(
      nextTierHint(
        [
          { min_quantity: 1, max_quantity: 6, price_per_piece: 85, rule_type: 'default', is_active: true },
          { min_quantity: 7, max_quantity: null, price_per_piece: 70, rule_type: 'bulk', is_active: false },
        ],
        12,
        85
      )
    ).toBeNull();
  });
});

describe('describeOrderTotals (order history card "X lines · Y pieces")', () => {
  it('returns zeros for an empty row set', () => {
    expect(describeOrderTotals([])).toEqual({ lineCount: 0, totalPieces: 0 });
  });

  it('folds cases + loose rows of the same pack into a single billing line', () => {
    const totals = describeOrderTotals([
      { id: 'r1', pack_id: 'pack-A', quantity: 1, quantity_unit: 'cases', quantity_pieces: 40, units_per_case: 40 },
      { id: 'r2', pack_id: 'pack-A', quantity: 6, quantity_unit: 'pieces', quantity_pieces: 6, units_per_case: 40 },
      { id: 'r3', pack_id: 'pack-B', quantity: 12, quantity_unit: 'pieces', quantity_pieces: 12, units_per_case: 24 },
    ]);
    expect(totals.lineCount).toBe(2);
    expect(totals.totalPieces).toBe(58);
  });

  it('counts one line per pack when each pack only has one row', () => {
    const totals = describeOrderTotals([
      { id: 'r1', pack_id: 'pack-A', quantity: 12, quantity_unit: 'pieces', quantity_pieces: 12, units_per_case: 12 },
      { id: 'r2', pack_id: 'pack-B', quantity: 24, quantity_unit: 'pieces', quantity_pieces: 24, units_per_case: 24 },
    ]);
    expect(totals.lineCount).toBe(2);
    expect(totals.totalPieces).toBe(36);
  });

  it('falls back to quantity × units_per_case when quantity_pieces is missing', () => {
    // Legacy rows written before the snapshot column existed.
    const totals = describeOrderTotals([
      { id: 'r1', pack_id: 'pack-A', quantity: 2, quantity_unit: 'cases', quantity_pieces: null, units_per_case: 50 },
    ]);
    expect(totals.totalPieces).toBe(100);
  });
});

describe('retailer-facing pages do not expose internal pricing fields', () => {
  // These guard against accidental re-introduction of wholesale admin language
  // during future redesign passes. They scan the source for known banned
  // strings — the visual design rules live in the actual JSX; this just keeps
  // the marketing-facing copy honest.
  const bannedPhrases = [
    'case subtotal',
    'loose subtotal',
    'case count',
    'supplier cost',
    'internal margin',
  ];
  const pagesToCheck = [
    'app/retailer/home/page.tsx',
    'app/retailer/catalog/page.tsx',
    'app/retailer/catalog/[id]/page.tsx',
    'app/retailer/cart/page.tsx',
    'app/retailer/checkout/page.tsx',
    'app/retailer/account/page.tsx',
    'app/retailer/orders/page.tsx',
    'app/retailer/categories/page.tsx',
    'app/retailer/brands/page.tsx',
    'components/retailer/product-card.tsx',
    'components/retailer/cart-item-row.tsx',
    'components/retailer/cart-order-summary.tsx',
    'components/retailer/checkout-form.tsx',
    'components/retailer/promo-carousel.tsx',
    'components/retailer/promo-banner.tsx',
    'components/retailer/category-card.tsx',
    'components/retailer/brand-card.tsx',
    'components/layout/retailer-shell.tsx',
  ];

  for (const path of pagesToCheck) {
    it(`${path} does not surface internal pricing concepts`, async () => {
      const fs = await import('node:fs/promises');
      const source = await fs.readFile(path, 'utf8');
      const lower = source.toLowerCase();
      for (const phrase of bannedPhrases) {
        expect(lower).not.toContain(phrase);
      }
    });
  }
});
