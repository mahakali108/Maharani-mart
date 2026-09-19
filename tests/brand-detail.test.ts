import { describe, expect, it } from 'vitest';
import { loadBrandDirectory, loadBrandProducts } from '@/lib/retailer/brand-detail';
import { supabaseFixture } from './helpers/supabase-fixture';

const PARENT = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const CHILD_1 = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const UNRELATED = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const BRAND_A = '11111111-1111-4111-8111-111111111111';
const BRAND_B = '22222222-2222-4222-8222-222222222222';
const BRAND_C = '33333333-3333-4333-8333-333333333333';
const RETAILER = '99999999-9999-4999-8999-999999999999';

function directoryTables() {
  return {
    categories: [
      { id: PARENT, name: 'Dairy', parent_id: null, is_active: true },
      { id: CHILD_1, name: 'Milk', parent_id: PARENT, is_active: true },
      { id: UNRELATED, name: 'Bakery', parent_id: null, is_active: true },
    ],
    // Active products powering the scoped brand counts (real relationship rows).
    products: [
      { id: 'p1', brand_id: BRAND_A, category_id: PARENT, is_active: true },
      { id: 'p2', brand_id: BRAND_A, category_id: CHILD_1, is_active: true },
      { id: 'u1', brand_id: BRAND_A, category_id: UNRELATED, is_active: true },
      { id: 'c1', brand_id: BRAND_B, category_id: CHILD_1, is_active: true },
      { id: 'u2', brand_id: BRAND_C, category_id: UNRELATED, is_active: true },
    ],
    brands: [
      {
        id: BRAND_A, name: 'Brand A', logo_url: null, is_active: true,
        products: [
          { id: 'p1', category_id: PARENT },
          { id: 'p2', category_id: CHILD_1 },
          { id: 'u1', category_id: UNRELATED },
        ],
      },
      { id: BRAND_B, name: 'Brand B', logo_url: null, is_active: true, products: [{ id: 'c1', category_id: CHILD_1 }] },
      { id: BRAND_C, name: 'Brand C', logo_url: null, is_active: true, products: [{ id: 'u2', category_id: UNRELATED }] },
    ],
  };
}

describe('loadBrandDirectory', () => {
  it('lists active brands with real active-product counts, sorted by name', async () => {
    const data = await loadBrandDirectory(supabaseFixture(directoryTables()) as never);

    expect(data.error).toBe(false);
    expect(data.brands).toEqual([
      { id: BRAND_A, name: 'Brand A', logo_url: null, productCount: 3 },
      { id: BRAND_B, name: 'Brand B', logo_url: null, productCount: 1 },
      { id: BRAND_C, name: 'Brand C', logo_url: null, productCount: 1 },
    ]);
    expect(data.categories.map((category) => category.id)).toEqual([PARENT, CHILD_1, UNRELATED]);
  });

  it('scopes brands and counts to the category plus its active children', async () => {
    const data = await loadBrandDirectory(supabaseFixture(directoryTables()) as never, PARENT);

    // Brand C only has Bakery products — outside the Dairy scope.
    expect(data.brands).toEqual([
      { id: BRAND_A, name: 'Brand A', logo_url: null, productCount: 2 },
      { id: BRAND_B, name: 'Brand B', logo_url: null, productCount: 1 },
    ]);
  });

  it('supports filtering directly by a subcategory', async () => {
    const data = await loadBrandDirectory(supabaseFixture(directoryTables()) as never, CHILD_1);
    expect(data.brands).toEqual([
      { id: BRAND_A, name: 'Brand A', logo_url: null, productCount: 1 },
      { id: BRAND_B, name: 'Brand B', logo_url: null, productCount: 1 },
    ]);
  });

  it('returns an empty list for unknown category filters', async () => {
    const data = await loadBrandDirectory(
      supabaseFixture(directoryTables()) as never,
      'ffffffff-ffff-4fff-8fff-ffffffffffff'
    );
    expect(data.brands).toEqual([]);
    expect(data.error).toBe(false);
  });

  it('flags read failures instead of hiding them', async () => {
    const data = await loadBrandDirectory(supabaseFixture(directoryTables(), { brands: 'offline' }) as never);
    expect(data.error).toBe(true);
    expect(data.brands).toEqual([]);
  });
});

function productRow(index: number, brandId = BRAND_A) {
  return {
    id: `product-${index}`,
    name: `Product ${index}`,
    category_id: PARENT,
    brand_id: brandId,
    gst_percent: 5,
    is_new_launch: false,
    created_at: '2026-01-01T00:00:00Z',
    is_active: true,
    brands: { id: brandId, name: 'Brand A' },
    product_images: [],
    product_packs: [
      {
        id: `pack-${index}`,
        pack_name: '100 g',
        ptr: null,
        base_price: 1000,
        case_price: 1000,
        units_per_case: 80,
        mrp: 40,
        moq: 6,
        image_url: null,
        is_active: true,
        sort_order: 0,
      },
    ],
  };
}

describe('loadBrandProducts', () => {
  it('paginates the brand products and reports the true count', async () => {
    const rows = Array.from({ length: 25 }, (_, index) => productRow(index + 1));
    const fixtures = () => ({
      brands: [{ id: BRAND_A, name: 'Brand A', logo_url: null, is_active: true }],
      products: rows,
      retailer_favorites: [],
    });

    const firstPage = await loadBrandProducts(supabaseFixture(fixtures()) as never, RETAILER, null, BRAND_A, 1);
    expect(firstPage.brand).toEqual({ id: BRAND_A, name: 'Brand A', logo_url: null });
    expect(firstPage.productCount).toBe(25);
    expect(firstPage.products).toHaveLength(24);
    expect(firstPage.totalPages).toBe(2);
    expect(firstPage.page).toBe(1);

    const secondPage = await loadBrandProducts(supabaseFixture(fixtures()) as never, RETAILER, null, BRAND_A, 2);
    expect(secondPage.products).toHaveLength(1);
    expect(secondPage.page).toBe(2);
  });

  it('prices products through the canonical engine (derived per-piece fallback)', async () => {
    const data = await loadBrandProducts(
      supabaseFixture({
        brands: [{ id: BRAND_A, name: 'Brand A', logo_url: null, is_active: true }],
        products: [productRow(1)],
        retailer_favorites: [],
      }) as never,
      RETAILER,
      null,
      BRAND_A,
      1
    );
    // No selling tiers configured: the derived rate is case_price / units_per_case.
    expect(data.pricingUnavailable).toBe(false);
    expect(data.products[0]?.fromPrice).toBe(12.5);
  });

  it('keeps products listed when pricing cannot be resolved, without prices', async () => {
    const data = await loadBrandProducts(
      supabaseFixture({
        brands: [{ id: BRAND_A, name: 'Brand A', logo_url: null, is_active: true }],
        products: [productRow(1)],
        retailer_favorites: [],
      }) as never,
      RETAILER,
      null,
      BRAND_A,
      1,
      false
    );
    expect(data.pricingUnavailable).toBe(true);
    expect(data.errors.pricing).toBe(true);
    expect(data.products).toHaveLength(1);
    expect(data.products[0]?.fromPrice).toBeNull();
  });

  it('returns a null brand for unknown or inactive brands', async () => {
    const data = await loadBrandProducts(
      supabaseFixture({ brands: [], products: [] }) as never,
      RETAILER,
      null,
      'ffffffff-ffff-4fff-8fff-ffffffffffff',
      1
    );
    expect(data.brand).toBeNull();
    expect(data.products).toEqual([]);
  });

  it('flags a failed product read', async () => {
    const data = await loadBrandProducts(
      supabaseFixture(
        { brands: [{ id: BRAND_A, name: 'Brand A', logo_url: null, is_active: true }], products: [] },
        { products: 'offline' }
      ) as never,
      RETAILER,
      null,
      BRAND_A,
      1
    );
    expect(data.brand).not.toBeNull();
    expect(data.errors.catalog).toBe(true);
    expect(data.products).toEqual([]);
  });
});
