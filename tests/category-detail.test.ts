import { describe, expect, it } from 'vitest';
import { loadCategoryDetail } from '@/lib/retailer/category-detail';
import { supabaseFixture } from './helpers/supabase-fixture';

const PARENT = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const CHILD_1 = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const CHILD_2 = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const UNRELATED = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const BRAND_A = '11111111-1111-4111-8111-111111111111';
const BRAND_B = '22222222-2222-4222-8222-222222222222';
const BRAND_C = '33333333-3333-4333-8333-333333333333';

/**
 * One coherent dataset. The taxonomy rows carry PLAIN COLUMNS, and every count
 * is derived from the `products` rows below — the loader must never need the
 * `products(count)` aggregate embed or an embedded-resource filter (both of
 * which fail, or hide rows, on a project where PostgREST aggregates are off).
 */
function tables() {
  return {
    categories: [
      { id: PARENT, name: 'Dairy', image_url: null, parent_id: null, is_active: true },
      { id: CHILD_1, name: 'Milk', image_url: null, parent_id: PARENT, is_active: true },
      { id: CHILD_2, name: 'Cheese', image_url: null, parent_id: PARENT, is_active: true },
      { id: UNRELATED, name: 'Bakery', image_url: null, parent_id: null, is_active: true },
    ],
    brands: [
      { id: BRAND_A, name: 'Brand A', logo_url: null, is_active: true },
      { id: BRAND_B, name: 'Brand B', logo_url: null, is_active: true },
      { id: BRAND_C, name: 'Brand C', logo_url: null, is_active: true },
    ],
    products: [
      { id: 'p1', brand_id: BRAND_A, category_id: PARENT, is_active: true },
      { id: 'p2', brand_id: BRAND_B, category_id: PARENT, is_active: true },
      { id: 'c1', brand_id: BRAND_A, category_id: CHILD_1, is_active: true },
      { id: 'c2', brand_id: BRAND_B, category_id: CHILD_2, is_active: true },
      { id: 'u1', brand_id: BRAND_A, category_id: UNRELATED, is_active: true },
      { id: 'u2', brand_id: BRAND_C, category_id: UNRELATED, is_active: true },
    ],
  };
}

describe('loadCategoryDetail', () => {
  it('returns the category, its subcategories, scoped product count and brands with real counts', async () => {
    const data = await loadCategoryDetail(supabaseFixture(tables()) as never, PARENT);

    expect(data.category).toEqual({ id: PARENT, name: 'Dairy', image_url: null, parentName: null });
    expect(data.subcategories).toEqual([
      { id: CHILD_1, name: 'Milk', image_url: null, productCount: 1 },
      { id: CHILD_2, name: 'Cheese', image_url: null, productCount: 1 },
    ]);
    // 2 products in the parent + 1 in Milk + 1 in Cheese.
    expect(data.productCount).toBe(4);
    // Brand A carries products in the parent and in Milk; its Bakery product is
    // outside the scope and must not be counted. Brand C has nothing in this
    // scope, so it is not offered as a filter for it.
    expect(data.brands).toEqual([
      { id: BRAND_A, name: 'Brand A', logo_url: null, productCount: 2 },
      { id: BRAND_B, name: 'Brand B', logo_url: null, productCount: 2 },
    ]);
    expect(data.errors).toEqual({ category: false, brands: false });
  });

  it('scopes a subcategory to itself and reports the parent name for breadcrumbs', async () => {
    const data = await loadCategoryDetail(supabaseFixture(tables()) as never, CHILD_1);

    expect(data.category).toEqual({ id: CHILD_1, name: 'Milk', image_url: null, parentName: 'Dairy' });
    expect(data.subcategories).toEqual([]);
    expect(data.productCount).toBe(1);
    expect(data.brands).toEqual([{ id: BRAND_A, name: 'Brand A', logo_url: null, productCount: 1 }]);
  });

  it('reads the taxonomy without an aggregate embed or an embedded filter', async () => {
    // Regression guard for the "admin created a category/brand but the catalog
    // cannot see it" outage: `products(count)` is an opt-in PostgREST aggregate
    // and an embedded `products.is_active` filter narrows the PARENT rows.
    const client = supabaseFixture(tables());
    await loadCategoryDetail(client as never, PARENT);

    for (const table of ['categories', 'brands']) {
      const query = client.queries.find((candidate) => candidate.table === table);
      expect(query, `${table} was never read`).toBeTruthy();
      expect(query!.select).not.toContain('count');
      expect(query!.filters.every((filter) => !filter.column.includes('.'))).toBe(true);
    }
    // Counts come from the products rows, filtered to the category scope.
    const scopeScan = client.queries.find(
      (candidate) => candidate.table === 'products' && candidate.select === 'id, category_id, brand_id'
    );
    expect(scopeScan, 'the scoped count scan never ran').toBeTruthy();
    expect(scopeScan!.filters).toContainEqual({ op: 'eq', column: 'is_active', value: true });
    expect(scopeScan!.filters).toContainEqual({ op: 'in', column: 'category_id', value: [PARENT, CHILD_1, CHILD_2] });
  });

  it('reports unknown counts (never zero) when the count scan fails', async () => {
    const data = await loadCategoryDetail(supabaseFixture(tables(), { products: 'offline' }) as never, PARENT);
    expect(data.category?.id).toBe(PARENT);
    expect(data.subcategories.map((sub) => sub.productCount)).toEqual([undefined, undefined]);
    expect(data.productCount).toBeUndefined();
    expect(data.brands).toEqual([]);
  });

  it('returns a null category for unknown or inactive ids', async () => {
    const missing = await loadCategoryDetail(supabaseFixture(tables()) as never, 'ffffffff-ffff-4fff-8fff-ffffffffffff');
    expect(missing.category).toBeNull();
    expect(missing.subcategories).toEqual([]);
    expect(missing.brands).toEqual([]);
    expect(missing.errors.category).toBe(false);

    const empty = await loadCategoryDetail(supabaseFixture() as never, PARENT);
    expect(empty.category).toBeNull();
  });

  it('flags category read failures instead of inventing data', async () => {
    const data = await loadCategoryDetail(supabaseFixture(tables(), { categories: 'offline' }) as never, PARENT);
    expect(data.category).toBeNull();
    expect(data.errors.category).toBe(true);
  });

  it('keeps the brand list honest when the brand read fails', async () => {
    const data = await loadCategoryDetail(supabaseFixture(tables(), { brands: 'offline' }) as never, PARENT);
    expect(data.category?.id).toBe(PARENT);
    expect(data.brands).toEqual([]);
    expect(data.errors.brands).toBe(true);
  });
});
