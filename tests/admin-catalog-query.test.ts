import { describe, expect, it } from 'vitest';
import {
  ADMIN_MAX_PAGE,
  ADMIN_PAGE_SIZE,
  adminCatalogHref,
  adminCatalogPageHref,
  adminPageRange,
  adminTotalPages,
  countAdminFilters,
  hasAdminFilters,
  isDbSortableAdminSort,
  needsDerivedLookup,
  parseAdminCatalogParams,
  parseAdminPage,
  parseAdminSort,
  sanitizeAdminSearch,
} from '@/lib/admin/catalog-query';

describe('admin search sanitisation', () => {
  it('strips LIKE wildcards so a search term cannot match the whole table', () => {
    expect(sanitizeAdminSearch('100%')).toBe('100');
    expect(sanitizeAdminSearch('a_b')).toBe('a b');
    expect(sanitizeAdminSearch('*')).toBe('');
  });

  it('collapses whitespace and bounds the length', () => {
    expect(sanitizeAdminSearch('  tata   tea ')).toBe('tata tea');
    expect(sanitizeAdminSearch('x'.repeat(500))).toHaveLength(80);
  });

  it('neutralises quote characters rather than trusting the client', () => {
    // The quotes that would break out of an ilike pattern are removed; what
    // remains is inert text bound as a parameter, never interpolated as SQL.
    expect(sanitizeAdminSearch(`tea' or '1'='1`)).toBe('tea or 1 = 1');
  });

  it('tolerates undefined', () => {
    expect(sanitizeAdminSearch(undefined)).toBe('');
  });
});

describe('sort parsing', () => {
  it('falls back to newest for unknown or missing values', () => {
    expect(parseAdminSort(undefined)).toBe('newest');
    expect(parseAdminSort('banana')).toBe('newest');
    expect(parseAdminSort('sales')).toBe('sales');
  });

  it('knows which sorts the products table can answer alone', () => {
    expect(isDbSortableAdminSort('newest')).toBe(true);
    expect(isDbSortableAdminSort('name')).toBe(true);
    // stock/sales/margin live in 0017/0050 helpers, not on products.
    expect(isDbSortableAdminSort('stock-low')).toBe(false);
    expect(isDbSortableAdminSort('sales')).toBe(false);
    expect(isDbSortableAdminSort('margin-high')).toBe(false);
  });
});

describe('page parsing and bounds', () => {
  it('clamps a hostile deep page instead of requesting a huge range', () => {
    expect(parseAdminPage('999999')).toBe(ADMIN_MAX_PAGE);
    expect(parseAdminPage('0')).toBe(1);
    expect(parseAdminPage('-4')).toBe(1);
    expect(parseAdminPage('abc')).toBe(1);
    expect(parseAdminPage('3')).toBe(3);
  });

  it('computes inclusive range bounds', () => {
    expect(adminPageRange(1)).toEqual({ from: 0, to: ADMIN_PAGE_SIZE - 1 });
    expect(adminPageRange(3, 10)).toEqual({ from: 20, to: 29 });
    expect(adminPageRange(0, 10)).toEqual({ from: 0, to: 9 });
  });

  it('always has at least one page', () => {
    expect(adminTotalPages(0)).toBe(1);
    expect(adminTotalPages(25)).toBe(1);
    expect(adminTotalPages(26)).toBe(2);
    expect(adminTotalPages(101)).toBe(5);
  });
});

describe('parameter parsing', () => {
  it('defaults every value when the query string is empty', () => {
    const params = parseAdminCatalogParams({});
    expect(params).toMatchObject({
      q: '',
      field: 'all',
      brand: '',
      category: '',
      status: 'all',
      stock: 'all',
      gst: 'all',
      minPrice: null,
      maxPrice: null,
      maxStock: null,
      sort: 'newest',
      page: 1,
    });
  });

  it('reads a fully populated query string', () => {
    const params = parseAdminCatalogParams({
      q: 'tea',
      field: 'hsn',
      brand: 'b1',
      category: 'c1',
      status: 'inactive',
      stock: 'low_stock',
      gst: '18',
      minPrice: '100',
      maxPrice: '500',
      maxStock: '20',
      sort: 'margin-high',
      page: '4',
    });
    expect(params.q).toBe('tea');
    expect(params.field).toBe('hsn');
    expect(params.status).toBe('inactive');
    expect(params.stock).toBe('low_stock');
    expect(params.gst).toBe('18');
    expect(params.minPrice).toBe(100);
    expect(params.maxPrice).toBe(500);
    expect(params.maxStock).toBe(20);
    expect(params.sort).toBe('margin-high');
    expect(params.page).toBe(4);
  });

  it('drops an inverted price range rather than returning nothing', () => {
    const params = parseAdminCatalogParams({ minPrice: '500', maxPrice: '100' });
    expect(params.minPrice).toBe(500);
    expect(params.maxPrice).toBeNull();
  });

  it('ignores non-numeric and negative bounds', () => {
    const params = parseAdminCatalogParams({ minPrice: 'abc', maxPrice: '-5', maxStock: 'x' });
    expect(params.minPrice).toBeNull();
    expect(params.maxPrice).toBeNull();
    expect(params.maxStock).toBeNull();
  });

  it('rejects an unknown status/stock/gst value instead of passing it to SQL', () => {
    const params = parseAdminCatalogParams({ status: 'archived', stock: 'maybe', gst: '7' });
    expect(params.status).toBe('all');
    expect(params.stock).toBe('all');
    expect(params.gst).toBe('all');
  });

  it('takes the first value when a param is repeated', () => {
    expect(parseAdminCatalogParams({ brand: ['a', 'b'] }).brand).toBe('a');
  });
});

describe('derived-lookup detection', () => {
  it('is false for a plain products query', () => {
    expect(needsDerivedLookup(parseAdminCatalogParams({ sort: 'name', status: 'active' }))).toBe(false);
  });

  it('is true for a derived sort or a stock constraint', () => {
    expect(needsDerivedLookup(parseAdminCatalogParams({ sort: 'sales' }))).toBe(true);
    expect(needsDerivedLookup(parseAdminCatalogParams({ sort: 'margin-high' }))).toBe(true);
    expect(needsDerivedLookup(parseAdminCatalogParams({ stock: 'low_stock' }))).toBe(true);
    expect(needsDerivedLookup(parseAdminCatalogParams({ maxStock: '5' }))).toBe(true);
  });
});

describe('link building', () => {
  it('omits defaults so a filtered URL stays short', () => {
    const href = adminCatalogHref(parseAdminCatalogParams({ q: 'tea', sort: 'name' }));
    expect(href).toBe('/admin/products?q=tea&sort=name');
  });

  it('drops page when a filter changes, so you land on page 1 of the new set', () => {
    const params = parseAdminCatalogParams({ q: 'tea', page: '7' });
    expect(adminCatalogHref(params)).not.toContain('page');
    expect(adminCatalogHref(params, { q: 'coffee' })).toBe('/admin/products?q=coffee');
  });

  it('keeps every other filter when paging', () => {
    const params = parseAdminCatalogParams({ q: 'tea', brand: 'b1', stock: 'low_stock' });
    expect(adminCatalogPageHref(params, 3)).toBe(
      '/admin/products?q=tea&brand=b1&stock=low_stock&page=3'
    );
    // Page 1 is the same as the unfiltered-state link.
    expect(adminCatalogPageHref(params, 1)).toBe('/admin/products?q=tea&brand=b1&stock=low_stock');
  });

  it('can clear one filter without touching the rest', () => {
    const params = parseAdminCatalogParams({ q: 'tea', brand: 'b1' });
    expect(adminCatalogHref(params, { brand: undefined })).toBe('/admin/products?q=tea');
  });

  it('encodes values that need it', () => {
    expect(adminCatalogHref(parseAdminCatalogParams({ q: 'tea & coffee' }))).toBe(
      '/admin/products?q=tea+%26+coffee'
    );
  });
});

describe('filter summary', () => {
  it('reports nothing active by default', () => {
    expect(hasAdminFilters(parseAdminCatalogParams({}))).toBe(false);
    expect(countAdminFilters(parseAdminCatalogParams({}))).toBe(0);
  });

  it('counts each active filter once, price bounds counting as one', () => {
    const params = parseAdminCatalogParams({
      q: 'tea',
      brand: 'b1',
      minPrice: '10',
      maxPrice: '20',
      gst: '18',
    });
    expect(hasAdminFilters(params)).toBe(true);
    expect(countAdminFilters(params)).toBe(4);
  });
});
