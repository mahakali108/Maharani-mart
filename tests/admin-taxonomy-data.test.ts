/**
 * Admin categories & brands list loading (`lib/admin/taxonomy-data.ts`).
 *
 * The regression these tests exist for: both lists read their linked-product
 * count with the `products(count)` PostgREST aggregate embed. Aggregates are
 * opt-in (`db-aggregates-enabled`, off by default, error `PGRST123`) and where
 * they are unavailable the request fails AS A WHOLE — so
 * `/admin/catalog/categories` and `/admin/catalog/brands` rendered the section
 * error boundary instead of the list AND its "add" form. An admin could not
 * create a category or a brand at all.
 *
 * What is asserted here:
 *   1. no taxonomy query carries an aggregate or an embedded-resource filter;
 *   2. the linked-product count comes from real `products` rows;
 *   3. a count that cannot be read is `null` (unknown), never 0;
 *   4. keyset pagination and parent-name resolution still work.
 */
import { describe, expect, it } from 'vitest';
import { ADMIN_PAGE_SIZE } from '@/lib/admin/catalog-query';
import { TAXONOMY_SORTS, parseTaxonomyParams } from '@/lib/admin/taxonomy-query';
import { loadAdminBrandBatch, loadAdminCategoryBatch } from '@/lib/admin/taxonomy-data';
import { decodeCursor, encodeCursor } from '@/lib/infinite-scroll/cursor';
import { supabaseFixture } from './helpers/supabase-fixture';

const PARENT = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const CHILD = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const OTHER = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const BRAND_A = '11111111-1111-4111-8111-111111111111';
const BRAND_B = '22222222-2222-4222-8222-222222222222';

function tables() {
  return {
    categories: [
      { id: PARENT, name: 'Dairy', parent_id: null, image_url: null, sort_order: 0, is_active: true, created_at: '2026-01-01T00:00:00Z' },
      { id: CHILD, name: 'Milk', parent_id: PARENT, image_url: null, sort_order: 1, is_active: true, created_at: '2026-01-02T00:00:00Z' },
      { id: OTHER, name: 'Bakery', parent_id: null, image_url: null, sort_order: 2, is_active: false, created_at: '2026-01-03T00:00:00Z' },
    ],
    brands: [
      { id: BRAND_A, name: 'Maharani', logo_url: null, is_active: true, created_at: '2026-01-01T00:00:00Z' },
      { id: BRAND_B, name: 'Fortune', logo_url: null, is_active: true, created_at: '2026-01-02T00:00:00Z' },
    ],
    products: [
      { id: 'p1', category_id: PARENT, brand_id: BRAND_A, is_active: true },
      { id: 'p2', category_id: CHILD, brand_id: BRAND_A, is_active: true },
      { id: 'p3', category_id: OTHER, brand_id: null, is_active: false },
      { id: 'p4', category_id: null, brand_id: BRAND_B, is_active: true },
    ],
  };
}

const defaults = parseTaxonomyParams({});

describe('admin category batch', () => {
  it('never asks for the aggregate embed, and counts real product rows', async () => {
    const client = supabaseFixture(tables());
    const batch = await loadAdminCategoryBatch(client as never, defaults, null);

    const taxonomyRead = client.queries.find((query) => query.table === 'categories');
    expect(taxonomyRead?.select).not.toContain('count');
    expect(taxonomyRead?.filters.every((filter) => !filter.column.includes('.'))).toBe(true);

    // Admin scope counts EVERY linked product (active or not): that is the
    // number an operator needs before deactivating a category.
    expect(batch.items.map((row) => [row.name, row.productCount])).toEqual([
      ['Bakery', 1],
      ['Dairy', 1],
      ['Milk', 1],
    ]);
    // Parent names are resolved for the batch in one extra bounded read.
    expect(batch.items.find((row) => row.id === CHILD)?.parentName).toBe('Dairy');
    expect(batch.items.find((row) => row.id === PARENT)?.parentName).toBeNull();
  });

  it('reports an unreadable count as unknown instead of zero', async () => {
    const client = supabaseFixture(tables(), { products: 'statement timeout' });
    const batch = await loadAdminCategoryBatch(client as never, defaults, null);
    expect(batch.items.length).toBeGreaterThan(0);
    expect(batch.items.every((row) => row.productCount === null)).toBe(true);
    // The list itself still renders — a count outage must not hide the rows.
    expect(batch.items.map((row) => row.name)).toContain('Dairy');
  });

  it('paginates by keyset and never repeats a row across batches', async () => {
    const many = Array.from({ length: ADMIN_PAGE_SIZE + 3 }, (_, index) => ({
      id: `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`,
      name: `Category ${String(index).padStart(2, '0')}`,
      parent_id: null,
      image_url: null,
      sort_order: index,
      is_active: true,
      created_at: `2026-01-01T00:00:${String(index).padStart(2, '0')}Z`,
    }));
    const client = supabaseFixture({ ...tables(), categories: many });

    const first = await loadAdminCategoryBatch(client as never, defaults, null);
    expect(first.items).toHaveLength(ADMIN_PAGE_SIZE);
    expect(first.nextCursor).toBeTruthy();
    expect(decodeCursor(first.nextCursor)).not.toBeNull();

    const second = await loadAdminCategoryBatch(
      client as never,
      defaults,
      decodeCursor(first.nextCursor!) ?? null
    );
    const firstIds = new Set(first.items.map((row) => row.id));
    expect(second.items.length).toBeGreaterThan(0);
    expect(second.items.every((row) => !firstIds.has(row.id))).toBe(true);
  });

  it('honours search, status and sort while keeping counts', async () => {
    const client = supabaseFixture(tables());
    const params = parseTaxonomyParams({ q: 'dai', status: 'active', sort: 'name-desc' });
    const batch = await loadAdminCategoryBatch(client as never, params, null);
    expect(batch.items.map((row) => row.name)).toEqual(['Dairy']);
    expect(batch.items[0]?.productCount).toBe(1);
    expect(TAXONOMY_SORTS).toContain(params.sort);
  });
});

describe('admin brand batch', () => {
  it('counts real products and keeps zero-product brands listed', async () => {
    const client = supabaseFixture(tables());
    const batch = await loadAdminBrandBatch(client as never, defaults, null);

    const taxonomyRead = client.queries.find((query) => query.table === 'brands');
    expect(taxonomyRead?.select).not.toContain('count');
    expect(taxonomyRead?.filters.every((filter) => !filter.column.includes('.'))).toBe(true);

    expect(batch.items.map((row) => [row.name, row.productCount])).toEqual([
      ['Fortune', 1],
      ['Maharani', 2],
    ]);
  });

  it('reports an unreadable count as unknown instead of zero', async () => {
    const client = supabaseFixture(tables(), { products: 'offline' });
    const batch = await loadAdminBrandBatch(client as never, defaults, null);
    expect(batch.items.map((row) => row.productCount)).toEqual([null, null]);
  });

  it('carries a keyset cursor that resumes the same ordering', async () => {
    const client = supabaseFixture(tables());
    const batch = await loadAdminBrandBatch(client as never, defaults, decodeCursor(encodeCursor({ k: 'offset', o: 0 })) ?? null);
    expect(batch.items.length).toBeGreaterThan(0);
    expect(client.queries.find((query) => query.table === 'brands')?.filters.length).toBe(0);
  });
});
