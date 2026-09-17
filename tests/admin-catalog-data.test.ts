import { describe, expect, it } from 'vitest';
import {
  ADMIN_SEARCH_FIELDS,
  ADMIN_SEARCH_FIELD_LABELS,
  needsRelatedIdLookup,
  parseAdminCatalogParams,
} from '@/lib/admin/catalog-query';
import {
  buildSearchClause,
  marginPercent,
  matchesDerivedFilters,
  productCasePrice,
  productMoq,
  searchMatchesNothing,
  sortResolvedProducts,
  type ResolvedAdminProduct,
} from '@/lib/admin/catalog-data';
import { MAX_BULK_IDS, isIdShape, normalizeBulkIds } from '@/lib/admin/products-bulk-shared';

const UUID_A = '11111111-1111-1111-1111-111111111111';
const UUID_B = '22222222-2222-2222-2222-222222222222';

const noRelated = { brandIds: [], categoryIds: [], packProductIds: [] };

describe('search field coverage', () => {
  it('offers name, SKU, barcode and HSN as narrowing options', () => {
    expect(ADMIN_SEARCH_FIELDS).toEqual(['all', 'name', 'sku', 'barcode', 'hsn']);
    for (const field of ADMIN_SEARCH_FIELDS) {
      expect(ADMIN_SEARCH_FIELD_LABELS[field]).toBeTruthy();
    }
  });

  it('accepts the sku field and rejects an unknown one', () => {
    expect(parseAdminCatalogParams({ field: 'sku' }).field).toBe('sku');
    expect(parseAdminCatalogParams({ field: 'cost_price' }).field).toBe('all');
  });

  it('only issues the related-id lookup for fields that need another table', () => {
    // `sku` lives on product_packs, `all` resolves brand/category/variant names.
    expect(needsRelatedIdLookup('sku')).toBe(true);
    expect(needsRelatedIdLookup('all')).toBe(true);
    // These are direct columns on `products` — an extra query would be waste.
    expect(needsRelatedIdLookup('name')).toBe(false);
    expect(needsRelatedIdLookup('barcode')).toBe(false);
    expect(needsRelatedIdLookup('hsn')).toBe(false);
  });
});

describe('search clause building', () => {
  it('targets a single column when the field is narrowed', () => {
    const params = parseAdminCatalogParams({ q: 'tea', field: 'name' });
    expect(buildSearchClause(params, noRelated)).toBe('name.ilike."%tea%"');
    expect(buildSearchClause(parseAdminCatalogParams({ q: '890', field: 'barcode' }), noRelated)).toBe(
      'barcode.ilike."%890%"'
    );
    expect(buildSearchClause(parseAdminCatalogParams({ q: '0902', field: 'hsn' }), noRelated)).toBe(
      'hsn_code.ilike."%0902%"'
    );
  });

  it('expresses a SKU search as the resolved product id set', () => {
    const params = parseAdminCatalogParams({ q: 'PKV', field: 'sku' });
    expect(buildSearchClause(params, { ...noRelated, packProductIds: [UUID_A, UUID_B] })).toBe(
      `id.in.(${UUID_A},${UUID_B})`
    );
  });

  it('returns no clause for a SKU search with no match, so the caller can short-circuit', () => {
    const params = parseAdminCatalogParams({ q: 'PKV', field: 'sku' });
    expect(buildSearchClause(params, noRelated)).toBeNull();
  });

  it('folds brand, category and variant matches into the "everything" search', () => {
    const params = parseAdminCatalogParams({ q: 'tata', field: 'all' });
    const clause = buildSearchClause(params, {
      brandIds: [UUID_A],
      categoryIds: [UUID_B],
      packProductIds: [UUID_A],
    });
    expect(clause).toContain('name.ilike."%tata%"');
    expect(clause).toContain(`brand_id.in.(${UUID_A})`);
    expect(clause).toContain(`category_id.in.(${UUID_B})`);
    expect(clause).toContain(`id.in.(${UUID_A})`);
  });

  it('returns no clause at all when there is no search term', () => {
    expect(buildSearchClause(parseAdminCatalogParams({}), { ...noRelated, packProductIds: [UUID_A] })).toBeNull();
  });
});

describe('empty SKU search must not widen to the whole catalog', () => {
  it('flags a SKU search that resolved to nothing', () => {
    expect(searchMatchesNothing(parseAdminCatalogParams({ q: 'PKV-NOPE', field: 'sku' }), noRelated)).toBe(true);
  });

  it('does not flag a SKU search that did resolve', () => {
    expect(
      searchMatchesNothing(parseAdminCatalogParams({ q: 'PKV', field: 'sku' }), {
        ...noRelated,
        packProductIds: [UUID_A],
      })
    ).toBe(false);
  });

  it('does not flag other fields — a name search with no match is just an empty WHERE', () => {
    expect(searchMatchesNothing(parseAdminCatalogParams({ q: 'zzz', field: 'name' }), noRelated)).toBe(false);
    expect(searchMatchesNothing(parseAdminCatalogParams({ q: '', field: 'sku' }), noRelated)).toBe(false);
  });
});

function product(overrides: Partial<ResolvedAdminProduct>): ResolvedAdminProduct {
  return {
    id: UUID_A,
    name: 'Tea',
    unit: 'box',
    lead_time_days: 2,
    base_price: 620,
    gst_percent: 5,
    hsn_code: null,
    barcode: null,
    is_active: true,
    is_new_launch: false,
    created_at: '2025-01-01T00:00:00.000Z',
    updated_at: '2025-01-01T00:00:00.000Z',
    brand_id: null,
    category_id: null,
    brands: null,
    categories: null,
    product_images: [],
    product_packs: [],
    moq: null,
    casePrice: null,
    stock: null,
    sales: null,
    costPrice: null,
    margin: null,
    ...overrides,
  } as ResolvedAdminProduct;
}

describe('derived value helpers', () => {
  it('takes the lowest active pack MOQ and case price, ignoring inactive packs', () => {
    const row = product({
      product_packs: [
        { id: 'p1', moq: 24, case_price: 6600, units_per_case: 12, is_active: true },
        { id: 'p2', moq: 6, case_price: 1800, units_per_case: 12, is_active: true },
        { id: 'p3', moq: 1, case_price: 100, units_per_case: 12, is_active: false },
      ],
    });
    expect(productMoq(row)).toBe(6);
    expect(productCasePrice(row)).toBe(1800);
  });

  it('returns null when a product has no active pack, rather than inventing a price', () => {
    const row = product({ product_packs: [{ id: 'p1', moq: 1, case_price: 100, units_per_case: 1, is_active: false }] });
    expect(productMoq(row)).toBeNull();
    expect(productCasePrice(row)).toBeNull();
  });

  it('computes margin on the GST-inclusive derived piece price', () => {
    // 6600/case over 12 pieces = 550/pc against a 440 cost → 20%.
    expect(marginPercent(6600, 12, 440)).toBe(20);
  });

  it('refuses to report a margin against a missing or zero cost', () => {
    // A margin over a zero cost is infinite, not 100% — showing either is a lie.
    expect(marginPercent(6600, 12, 0)).toBeNull();
    expect(marginPercent(6600, 12, null)).toBeNull();
    expect(marginPercent(null, 12, 440)).toBeNull();
    expect(marginPercent(6600, 0, 440)).toBeNull();
  });

  it('reports a negative margin instead of hiding it', () => {
    expect(marginPercent(1200, 12, 440)).toBeLessThan(0);
  });
});

describe('derived filters and sorts', () => {
  const inStock = product({ stock: { status: 'healthy', available: 100 } });
  const low = product({ stock: { status: 'low_stock', available: 3 } });
  const out = product({ stock: { status: 'out_of_stock', available: 0 } });
  const unknown = product({ stock: null });

  it('matches the requested stock status', () => {
    expect(matchesDerivedFilters(inStock, parseAdminCatalogParams({ stock: 'healthy' }))).toBe(true);
    expect(matchesDerivedFilters(low, parseAdminCatalogParams({ stock: 'low_stock' }))).toBe(true);
    expect(matchesDerivedFilters(out, parseAdminCatalogParams({ stock: 'out_of_stock' }))).toBe(true);
    expect(matchesDerivedFilters(inStock, parseAdminCatalogParams({ stock: 'out_of_stock' }))).toBe(false);
  });

  it('excludes products with unreadable stock from a stock filter', () => {
    // An unknown number must never masquerade as "in stock".
    expect(matchesDerivedFilters(unknown, parseAdminCatalogParams({ stock: 'healthy' }))).toBe(false);
    expect(matchesDerivedFilters(unknown, parseAdminCatalogParams({}))).toBe(true);
  });

  it('applies the MOQ bounds', () => {
    const row = product({ moq: 12 });
    expect(matchesDerivedFilters(row, parseAdminCatalogParams({ maxMoq: '12' }))).toBe(true);
    expect(matchesDerivedFilters(row, parseAdminCatalogParams({ maxMoq: '6' }))).toBe(false);
    expect(matchesDerivedFilters(row, parseAdminCatalogParams({ minMoq: '12' }))).toBe(true);
    expect(matchesDerivedFilters(row, parseAdminCatalogParams({ minMoq: '24' }))).toBe(false);
  });

  it('excludes products with no MOQ from a MOQ filter', () => {
    expect(matchesDerivedFilters(product({ moq: null }), parseAdminCatalogParams({ maxMoq: '99' }))).toBe(false);
  });

  it('sorts by lowest stock with unknown last', () => {
    const rows = [unknown, inStock, out, low];
    const sorted = sortResolvedProducts(rows, 'stock-low');
    expect(sorted.map((row) => row.stock?.available ?? null)).toEqual([0, 3, 100, null]);
  });

  it('sorts by best selling with never-sold last', () => {
    const a = product({ id: UUID_A, sales: { units30d: 5, orders30d: 1, revenue30d: 100 } });
    const b = product({ id: UUID_B, sales: { units30d: 50, orders30d: 4, revenue30d: 900 } });
    const sorted = sortResolvedProducts([a, product({}), b], 'sales');
    expect(sorted.map((row) => row.sales?.units30d ?? null)).toEqual([50, 5, null]);
  });

  it('sorts by highest margin with unknown last', () => {
    const a = product({ margin: 12 });
    const b = product({ margin: 34 });
    const sorted = sortResolvedProducts([product({}), a, b], 'margin-high');
    expect(sorted.map((row) => row.margin ?? null)).toEqual([34, 12, null]);
  });

  it('breaks ties by name so the order is deterministic', () => {
    const a = product({ id: UUID_A, name: 'Zebra' });
    const b = product({ id: UUID_B, name: 'Apple' });
    const sorted = sortResolvedProducts([a, b], 'sales');
    expect(sorted.map((row) => row.name)).toEqual(['Apple', 'Zebra']);
  });
});

describe('bulk id normalisation', () => {
  it('de-duplicates and accepts a clean selection', () => {
    const result = normalizeBulkIds([UUID_A, UUID_A, UUID_B]);
    expect('ids' in result && result.ids).toEqual([UUID_A, UUID_B]);
  });

  it('rejects an empty selection with a message an operator can act on', () => {
    expect(normalizeBulkIds([])).toEqual({ error: 'Select at least one product first.' });
    expect(normalizeBulkIds(['  ', ''])).toEqual({ error: 'Select at least one product first.' });
  });

  it('refuses a malformed id instead of silently dropping it', () => {
    const result = normalizeBulkIds([UUID_A, 'not-a-uuid']);
    expect('error' in result && result.error).toMatch(/invalid product reference/);
  });

  it('bounds the batch size', () => {
    const many = Array.from({ length: MAX_BULK_IDS + 1 }, (_, index) =>
      `${index}`.padStart(8, '0') + '-1111-1111-1111-111111111111'
    );
    const result = normalizeBulkIds(many);
    expect('error' in result && result.error).toMatch(/at most 200/);
  });

  it('validates the UUID shape', () => {
    expect(isIdShape(UUID_A)).toBe(true);
    expect(isIdShape('nope')).toBe(false);
  });
});
