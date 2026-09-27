import { describe, expect, it } from 'vitest';
import {
  TAXONOMY_SORTS,
  TAXONOMY_SORT_LABELS,
  countTaxonomyFilters,
  escapeLikeLiteral,
  hasTaxonomyFilters,
  normalizeTaxonomyName,
  parseTaxonomyParams,
  taxonomyHref,
} from '@/lib/admin/taxonomy-query';

const CATEGORIES = '/admin/catalog/categories' as const;
const BRANDS = '/admin/catalog/brands' as const;

describe('taxonomy list param parsing', () => {
  it('defaults to an unfiltered, name-sorted list', () => {
    expect(parseTaxonomyParams({})).toEqual({ q: '', status: 'all', sort: 'name' });
  });

  it('sanitises the search term exactly like the product list does', () => {
    // Wildcards are stripped so an ilike cannot be turned into a table scan,
    // and the length is bounded the same way.
    expect(parseTaxonomyParams({ q: '100%_gold' }).q).toBe('100 gold');
    expect(parseTaxonomyParams({ q: 'x'.repeat(500) }).q).toHaveLength(80);
  });

  it('rejects unknown status and sort values instead of trusting the URL', () => {
    expect(parseTaxonomyParams({ status: 'banana' }).status).toBe('all');
    expect(parseTaxonomyParams({ status: 'inactive' }).status).toBe('inactive');
    expect(parseTaxonomyParams({ sort: 'margin-high' }).sort).toBe('name');
    expect(parseTaxonomyParams({ sort: 'newest' }).sort).toBe('newest');
  });

  it('ignores a stale ?page= instead of skipping rows', () => {
    // The list scrolls, so a deep link carrying ?page= must simply start at the
    // top rather than open an empty slice or error.
    expect(parseTaxonomyParams({ page: '0' })).toEqual({ q: '', status: 'all', sort: 'name' });
    expect(parseTaxonomyParams({ page: '999999', q: 'tata' })).toEqual({ q: 'tata', status: 'all', sort: 'name' });
  });

  it('reads the first value when a param is repeated', () => {
    expect(parseTaxonomyParams({ q: ['tata', 'amul'] }).q).toBe('tata');
  });

  it('offers every sort a label', () => {
    expect(TAXONOMY_SORTS).toEqual(['name', 'name-desc', 'newest', 'oldest']);
    for (const sort of TAXONOMY_SORTS) {
      expect(TAXONOMY_SORT_LABELS[sort]).toBeTruthy();
    }
  });
});

describe('taxonomy filter accounting', () => {
  it('reports no filters for the defaults', () => {
    expect(hasTaxonomyFilters(parseTaxonomyParams({}))).toBe(false);
    expect(countTaxonomyFilters(parseTaxonomyParams({}))).toBe(0);
  });

  it('counts search and status separately', () => {
    expect(hasTaxonomyFilters(parseTaxonomyParams({ q: 'tata' }))).toBe(true);
    expect(countTaxonomyFilters(parseTaxonomyParams({ q: 'tata' }))).toBe(1);
    expect(countTaxonomyFilters(parseTaxonomyParams({ q: 'tata', status: 'active' }))).toBe(2);
    // Sort alone is not a filter — it never changes the result set.
    expect(hasTaxonomyFilters(parseTaxonomyParams({ sort: 'newest' }))).toBe(false);
  });
});

describe('taxonomy link building', () => {
  it('emits a bare base href for the defaults', () => {
    expect(taxonomyHref(CATEGORIES, parseTaxonomyParams({}))).toBe(CATEGORIES);
    expect(taxonomyHref(BRANDS, parseTaxonomyParams({}))).toBe(BRANDS);
  });

  it('preserves filters and drops defaults so URLs stay shareable', () => {
    const params = parseTaxonomyParams({ q: 'tata', status: 'inactive', sort: 'name-desc' });
    expect(taxonomyHref(BRANDS, params)).toBe(`${BRANDS}?q=tata&status=inactive&sort=name-desc`);
  });

  it('omits a default sort while keeping the other filters', () => {
    const params = parseTaxonomyParams({ q: 'beverages', sort: 'name' });
    expect(taxonomyHref(CATEGORIES, params)).toBe(`${CATEGORIES}?q=beverages`);
  });

  it('lets an override drop a key (the Clear-filters link)', () => {
    const params = parseTaxonomyParams({ q: 'tata', status: 'inactive' });
    expect(taxonomyHref(BRANDS, params, { q: undefined })).toBe(`${BRANDS}?status=inactive`);
  });

  it('never emits a page — there is no pagination link to build any more', () => {
    const params = parseTaxonomyParams({ q: 'tata', page: '7' });
    expect(taxonomyHref(CATEGORIES, params)).not.toContain('page=');
    expect(taxonomyHref(BRANDS, parseTaxonomyParams({}))).toBe(BRANDS);
  });
});

describe('duplicate-name comparison helpers', () => {
  it('escapes LIKE wildcards so an ilike pattern matches the literal text', () => {
    expect(escapeLikeLiteral('tata')).toBe('tata');
    expect(escapeLikeLiteral('50%_off')).toBe('50\\%\\_off');
    expect(escapeLikeLiteral('back\\slash')).toBe('back\\\\slash');
  });

  it('trims a name to the same canonical form the database compares', () => {
    // categories_name_parent_ci_uq (0027) compares lower(trim(name)); the
    // pre-check must agree with it or it would block names the index allows.
    expect(normalizeTaxonomyName('  Beverages  ')).toBe('Beverages');
    expect(normalizeTaxonomyName('')).toBe('');
  });
});
