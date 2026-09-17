import { describe, expect, it } from 'vitest';
import {
  BRANDS_LIST_PATH,
  CATEGORIES_LIST_PATH,
  duplicateNameError,
  hasMasterListFilters,
  masterListHref,
  masterListPath,
  masterPageRange,
  masterTotalPages,
  normalizeMasterName,
  parseMasterListParams,
  parseSortOrder,
  validateBrandName,
  validateCategoryName,
} from '@/lib/admin/master-data-query';
import { ADMIN_PAGE_SIZE } from '@/lib/admin/catalog-query';

describe('master-data list param parsing', () => {
  it('defaults to an unfiltered first page', () => {
    expect(parseMasterListParams({})).toEqual({ q: '', status: 'all', page: 1 });
  });

  it('sanitizes the search term exactly like the product list', () => {
    // sanitizeAdminSearch strips LIKE wildcards and quotes, collapses
    // whitespace and caps length — a master-data search must not widen into
    // a wildcard match.
    const params = parseMasterListParams({ q: '  Tata%100_ ' });
    expect(params.q).toBe('Tata 100');
    expect(parseMasterListParams({ q: 'x'.repeat(200) }).q).toHaveLength(80);
  });

  it('accepts only known status filters', () => {
    expect(parseMasterListParams({ status: 'active' }).status).toBe('active');
    expect(parseMasterListParams({ status: 'inactive' }).status).toBe('inactive');
    expect(parseMasterListParams({ status: 'archived' }).status).toBe('all');
    expect(parseMasterListParams({ status: '' }).status).toBe('all');
  });

  it('bounds the page number', () => {
    expect(parseMasterListParams({ page: '0' }).page).toBe(1);
    expect(parseMasterListParams({ page: '-3' }).page).toBe(1);
    expect(parseMasterListParams({ page: 'abc' }).page).toBe(1);
    expect(parseMasterListParams({ page: '3' }).page).toBe(3);
    expect(parseMasterListParams({ page: '99999' }).page).toBe(500);
  });

  it('uses the first value when a param repeats', () => {
    expect(parseMasterListParams({ q: ['Tea', 'Coffee'] }).q).toBe('Tea');
  });

  it('ignores non-string param values instead of throwing', () => {
    expect(parseMasterListParams({ q: undefined, status: undefined, page: undefined })).toEqual({
      q: '',
      status: 'all',
      page: 1,
    });
  });
});

describe('master-data list filters flag', () => {
  it('is false only for the pristine default view', () => {
    expect(hasMasterListFilters({ q: '', status: 'all', page: 1 })).toBe(false);
    expect(hasMasterListFilters({ q: 'tea', status: 'all', page: 1 })).toBe(true);
    expect(hasMasterListFilters({ q: '', status: 'inactive', page: 1 })).toBe(true);
    // A deep page with no filters is still not a "filtered" view.
    expect(hasMasterListFilters({ q: '', status: 'all', page: 4 })).toBe(false);
  });
});

describe('master-data list hrefs', () => {
  const base = parseMasterListParams({ q: 'tea', status: 'active', page: '2' });

  it('round-trips the current state', () => {
    expect(masterListHref('categories', base)).toBe(`${CATEGORIES_LIST_PATH}?q=tea&status=active&page=2`);
    expect(masterListHref('brands', base)).toBe(`${BRANDS_LIST_PATH}?q=tea&status=active&page=2`);
  });

  it('drops default values from the URL', () => {
    const pristine = parseMasterListParams({});
    expect(masterListHref('categories', pristine)).toBe(CATEGORIES_LIST_PATH);
    expect(masterListHref('brands', pristine)).toBe(BRANDS_LIST_PATH);
    expect(masterListHref('brands', parseMasterListParams({ q: 'amul', page: '1' }))).toBe(
      `${BRANDS_LIST_PATH}?q=amul`
    );
  });

  it('resets to page 1 unless a page is explicitly given', () => {
    // Following a filter change the operator must land on page 1, not on a
    // page number that may no longer exist.
    expect(masterListHref('categories', base, { q: 'coffee' })).toBe(
      `${CATEGORIES_LIST_PATH}?q=coffee&status=active`
    );
    expect(masterListHref('categories', base, { page: 3 })).toBe(
      `${CATEGORIES_LIST_PATH}?q=tea&status=active&page=3`
    );
  });

  it('exposes the list paths consistently', () => {
    expect(masterListPath('categories')).toBe(CATEGORIES_LIST_PATH);
    expect(masterListPath('brands')).toBe(BRANDS_LIST_PATH);
  });
});

describe('master-data pagination math', () => {
  it('computes inclusive range windows for a 1-based page', () => {
    expect(masterPageRange(1)).toEqual({ from: 0, to: ADMIN_PAGE_SIZE - 1 });
    expect(masterPageRange(2)).toEqual({ from: ADMIN_PAGE_SIZE, to: ADMIN_PAGE_SIZE * 2 - 1 });
  });

  it('never returns a zero or negative page count', () => {
    expect(masterTotalPages(0)).toBe(1);
    expect(masterTotalPages(-5)).toBe(1);
    expect(masterTotalPages(25)).toBe(1);
    expect(masterTotalPages(26)).toBe(2);
  });
});

describe('master-data form field validation', () => {
  it('parses sort order as a bounded whole number or leaves it unset', () => {
    expect(parseSortOrder('')).toEqual({ value: null });
    expect(parseSortOrder(null)).toEqual({ value: null });
    expect(parseSortOrder(undefined)).toEqual({ value: null });
    expect(parseSortOrder('0')).toEqual({ value: 0 });
    expect(parseSortOrder('42')).toEqual({ value: 42 });
    expect(parseSortOrder('9999')).toEqual({ value: 9999 });
    expect(parseSortOrder(' 7 ')).toEqual({ value: 7 });
  });

  it('rejects non-numeric and out-of-range sort orders', () => {
    expect(parseSortOrder('abc').error).toBeTruthy();
    expect(parseSortOrder('12.5').error).toBeTruthy();
    expect(parseSortOrder('-1').error).toBeTruthy();
    expect(parseSortOrder('10000').error).toBeTruthy();
    expect(parseSortOrder('1e3').error).toBeTruthy();
  });

  it('normalizes names: trimmed, single-spaced', () => {
    expect(normalizeMasterName('  Beverages   &  Snacks ')).toBe('Beverages & Snacks');
    expect(normalizeMasterName(null)).toBe('');
    expect(normalizeMasterName(undefined)).toBe('');
  });

  it('enforces name length bounds', () => {
    expect(validateCategoryName('A')).toBeTruthy();
    expect(validateCategoryName('Beverages')).toBeNull();
    expect(validateCategoryName('x'.repeat(81))).toBeTruthy();
    expect(validateBrandName('A')).toBeTruthy();
    expect(validateBrandName('Tata')).toBeNull();
    expect(validateBrandName('x'.repeat(81))).toBeTruthy();
  });

  it('returns the operator-facing duplicate message per table', () => {
    expect(duplicateNameError(true, 'brand')).toBe('A brand with this name already exists (names must be unique).');
    expect(duplicateNameError(true, 'category')).toBe('This category already exists under the selected parent.');
    expect(duplicateNameError(false, 'brand')).toBeNull();
    expect(duplicateNameError(false, 'category')).toBeNull();
  });
});
