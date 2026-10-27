import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  RETAILER_CATEGORIES,
  categoryLabel,
  isRetailerCategory,
  normalizeRetailerCategory,
  resolveCategoryPiecePrice,
  validateCategoryPriceOrdering,
} from '@/lib/pricing/category-pricing';

describe('retailer category ordering', () => {
  it('accepts gold <= silver <= general', () => {
    expect(validateCategoryPriceOrdering({ general: 100, silver: 95, gold: 90 }).ok).toBe(true);
    expect(validateCategoryPriceOrdering({ general: 100, silver: 100, gold: 100 }).ok).toBe(true);
  });

  it('rejects gold above silver', () => {
    const result = validateCategoryPriceOrdering({ general: 100, silver: 90, gold: 91 });
    expect(result.ok).toBe(false);
    expect(result.message).toMatch(/gold price cannot be higher than the silver/i);
  });

  it('rejects silver above general', () => {
    const result = validateCategoryPriceOrdering({ general: 100, silver: 100.01, gold: 90 });
    expect(result.ok).toBe(false);
    expect(result.message).toMatch(/silver price cannot be higher than the general/i);
  });

  it('rejects gold above general even when silver is absent', () => {
    const result = validateCategoryPriceOrdering({ general: 100, gold: 101 });
    expect(result.ok).toBe(false);
  });

  it('compares in integer paise (no floating-point false negatives)', () => {
    expect(validateCategoryPriceOrdering({ general: 99.99, silver: 99.99, gold: 99.99 }).ok).toBe(true);
  });

  it('treats missing/zero/negative prices as "not configured" rather than a violation', () => {
    expect(validateCategoryPriceOrdering({ general: 100, silver: null, gold: undefined }).ok).toBe(true);
    expect(validateCategoryPriceOrdering({}).ok).toBe(true);
  });
});

describe('category price resolution', () => {
  it('returns the own-category price', () => {
    const rows = { general: 100, silver: 95, gold: 90 };
    expect(resolveCategoryPiecePrice('gold', rows)).toBe(90);
    expect(resolveCategoryPiecePrice('silver', rows)).toBe(95);
    expect(resolveCategoryPiecePrice('general', rows)).toBe(100);
  });

  it('falls back to the general price when the own category is unset', () => {
    expect(resolveCategoryPiecePrice('gold', { general: 100 })).toBe(100);
    expect(resolveCategoryPiecePrice('silver', { general: 100, silver: null })).toBe(100);
  });

  it('never looks UP from general to a cheaper category', () => {
    expect(resolveCategoryPiecePrice('general', { silver: 95, gold: 90 })).toBeNull();
  });

  it('returns null when nothing is configured (legacy slab pricing governs)', () => {
    expect(resolveCategoryPiecePrice('silver', {})).toBeNull();
  });

  it('ignores non-positive values', () => {
    expect(resolveCategoryPiecePrice('gold', { gold: 0, general: 100 })).toBe(100);
  });
});

describe('category helpers', () => {
  it('normalises unknown values to general', () => {
    expect(normalizeRetailerCategory('gold')).toBe('gold');
    expect(normalizeRetailerCategory('platinum')).toBe('general');
    expect(normalizeRetailerCategory(null)).toBe('general');
    expect(normalizeRetailerCategory(undefined)).toBe('general');
  });

  it('exposes exactly three categories with Hindi-friendly labels', () => {
    expect(RETAILER_CATEGORIES).toEqual(['general', 'silver', 'gold']);
    expect(categoryLabel('gold', 'hi')).toContain('गोल्ड');
    expect(isRetailerCategory('silver')).toBe(true);
    expect(isRetailerCategory('Silver')).toBe(false);
  });
});

describe('wiring contracts (the price the server charges is the price shown)', () => {
  const read = (path: string) => readFileSync(path, 'utf8');

  it('loadPackTiers injects the category price for the retailer and is called with a retailer id', () => {
    const pricingData = read('lib/retailer/pricing-data.ts');
    expect(pricingData).toContain('loadEffectiveCategoryPrices');
    expect(pricingData).toContain('category-price:');

    for (const path of [
      'lib/orders/quote-order.ts',
      'lib/retailer/catalog.ts',
      'lib/coupons/cart-lines.ts',
      'lib/retailer/cart-validation.ts',
      'app/retailer/cart/page.tsx',
      'app/retailer/checkout/page.tsx',
      'app/retailer/quick-order/page.tsx',
      'app/retailer/orders/[id]/reorder/page.tsx',
      "app/retailer/catalog/[id]/page.tsx",
      'app/salesman/orders/new/page.tsx',
    ]) {
      expect(read(path), `${path} must pass a retailer id to loadPackTiers`).toMatch(
        /loadPackTiers\([\s\S]{0,160}?(user\.id|retailer\.id|retailerId|selectedRetailer\.id)/
      );
    }
  });

  it('both checkout RPCs consult the database category-price helper', () => {
    const sql = read('supabase/migrations/0082_category_tier_pricing.sql');
    expect(sql).toContain('public.pack_category_price_per_piece(v_item.pack_id, p_retailer_id)');
    const occurrences = sql.match(/pack_category_price_per_piece\(v_item\.pack_id, p_retailer_id\)/g) ?? [];
    expect(occurrences).toHaveLength(2); // create_order_atomic + create_order_atomic_v2
    // The category check must only appear in the Maharani own-stock branch: the
    // seller-offer branch is reached with `else`, i.e. seller_offer_id not null.
    expect(sql).toContain('if v_item.seller_offer_id is null then');
  });

  it('the admin pricing surfaces cannot be reached without pricing.manage', () => {
    expect(read('app/admin/pricing/tiers/page.tsx')).toContain("requirePagePermission('pricing.manage')");
    expect(read('app/admin/retailer-applications/page.tsx')).toContain("requirePagePermission('retailers.view')");
    expect(read('lib/admin/tier-pricing-actions.ts')).toContain("requirePermission('pricing.manage')");
    expect(read('lib/admin/retailer-approval-actions.ts')).toContain("requirePermission('retailers.approve')");
  });
});
