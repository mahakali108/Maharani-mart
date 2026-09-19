import { describe, expect, it } from 'vitest';
import { loadCategoryDetail } from '@/lib/retailer/category-detail';
import { supabaseFixture } from './helpers/supabase-fixture';

const PARENT = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const CHILD_1 = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const CHILD_2 = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const UNRELATED = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';

function tables() {
  return {
    categories: [
      { id: PARENT, name: 'Dairy', image_url: null, parent_id: null, is_active: true, products: [{ id: 'p1' }, { id: 'p2' }] },
      { id: CHILD_1, name: 'Milk', image_url: null, parent_id: PARENT, is_active: true, products: [{ id: 'c1' }] },
      { id: CHILD_2, name: 'Cheese', image_url: null, parent_id: PARENT, is_active: true, products: [] },
      { id: UNRELATED, name: 'Bakery', image_url: null, parent_id: null, is_active: true, products: [{ id: 'u1' }] },
    ],
  };
}

describe('loadCategoryDetail', () => {
  it('returns the category, its subcategories and the scoped product count', async () => {
    const data = await loadCategoryDetail(supabaseFixture(tables()) as never, PARENT);

    expect(data.category).toEqual({ id: PARENT, name: 'Dairy', image_url: null, parentName: null });
    expect(data.subcategories).toEqual([
      { id: CHILD_1, name: 'Milk', image_url: null, productCount: 1 },
      { id: CHILD_2, name: 'Cheese', image_url: null, productCount: 0 },
    ]);
    // 2 products in the parent + 1 in Milk + 0 in Cheese.
    expect(data.productCount).toBe(3);
    expect(data.errors).toEqual({ category: false });
  });

  it('scopes a subcategory to itself and reports the parent name for breadcrumbs', async () => {
    const data = await loadCategoryDetail(supabaseFixture(tables()) as never, CHILD_1);

    expect(data.category).toEqual({ id: CHILD_1, name: 'Milk', image_url: null, parentName: 'Dairy' });
    expect(data.subcategories).toEqual([]);
    expect(data.productCount).toBe(1);
  });

  it('never loads brand rows for a category (independent catalog dimensions)', async () => {
    const fixture = supabaseFixture({
      ...tables(),
      brands: [{ id: '11111111-1111-4111-8111-111111111111', name: 'Brand A', logo_url: null, is_active: true, products: [] }],
    });

    const data = await loadCategoryDetail(fixture as never, PARENT);

    expect(data.category?.id).toBe(PARENT);
    const brandQueries = fixture.queries.filter((query) => query.table === 'brands');
    expect(brandQueries).toEqual([]);
  });

  it('returns a null category for unknown or inactive ids', async () => {
    const missing = await loadCategoryDetail(supabaseFixture(tables()) as never, 'ffffffff-ffff-4fff-8fff-ffffffffffff');
    expect(missing.category).toBeNull();
    expect(missing.subcategories).toEqual([]);
    expect(missing.errors.category).toBe(false);

    const empty = await loadCategoryDetail(supabaseFixture() as never, PARENT);
    expect(empty.category).toBeNull();
  });

  it('flags category read failures instead of inventing data', async () => {
    const data = await loadCategoryDetail(supabaseFixture(tables(), { categories: 'offline' }) as never, PARENT);
    expect(data.category).toBeNull();
    expect(data.errors.category).toBe(true);
  });
});
