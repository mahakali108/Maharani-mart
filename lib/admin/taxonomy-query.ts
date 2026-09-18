/**
 * Admin categories & brands list query parameters — parsing, bounds and link
 * building.
 *
 * The product list owns the same problem for `products`
 * (lib/admin/catalog-query.ts). This module is its taxonomy counterpart for the
 * two master-data lists at /admin/catalog/categories and /admin/catalog/brands:
 * the page only ever sees validated values, and the rules can be unit-tested
 * without rendering anything (tests/admin-taxonomy-query.test.ts).
 *
 * Reuses the product list's generic primitives — `sanitizeAdminSearch`,
 * `ADMIN_STATUS_FILTERS`, `parseAdminPage`, `adminPageRange`,
 * `adminTotalPages` — so the two lists bound `?page=`, strip LIKE wildcards
 * and clamp pages identically. Only what is genuinely different lives here.
 *
 * PURE — no Supabase, no `next/*`, no env, no secrets.
 */

import {
  ADMIN_STATUS_FILTERS,
  type AdminStatusFilter,
  sanitizeAdminSearch,
  parseAdminPage,
} from '@/lib/admin/catalog-query';

/** The two admin taxonomy list routes this module builds links for. */
export type TaxonomyListRoute = '/admin/catalog/categories' | '/admin/catalog/brands';

/**
 * Sorts the taxonomy lists offer. Unlike products, name is the natural
 * default for master data (the old combined catalog page also ordered by
 * name), and there is no stock/sales/margin to rank by — so no derived
 * working-set mode exists here and every sort is a plain SQL `ORDER BY`.
 */
export const TAXONOMY_SORTS = ['name', 'name-desc', 'newest', 'oldest'] as const;
export type TaxonomySort = (typeof TAXONOMY_SORTS)[number];

export const TAXONOMY_SORT_LABELS: Record<TaxonomySort, string> = {
  name: 'Name A–Z',
  'name-desc': 'Name Z–A',
  newest: 'Newest first',
  oldest: 'Oldest first',
};

export interface TaxonomyParams {
  /** Free-text search on the name. Sanitised (wildcards stripped, bounded). */
  q: string;
  /** Lifecycle filter. `categories`/`brands` have only `is_active` (0001). */
  status: AdminStatusFilter;
  sort: TaxonomySort;
  page: number;
}

function oneOf<T extends string>(raw: string | undefined, allowed: readonly T[], fallback: T): T {
  return allowed.includes(raw as T) ? (raw as T) : fallback;
}

/** Turn raw `searchParams` into a fully defaulted, bounds-checked query. */
export function parseTaxonomyParams(
  searchParams: Record<string, string | string[] | undefined>
): TaxonomyParams {
  const first = (value: string | string[] | undefined): string | undefined =>
    Array.isArray(value) ? value[0] : value;

  return {
    q: sanitizeAdminSearch(first(searchParams.q)),
    status: oneOf(first(searchParams.status), ADMIN_STATUS_FILTERS, 'all'),
    sort: oneOf(first(searchParams.sort), TAXONOMY_SORTS, 'name'),
    page: parseAdminPage(first(searchParams.page)),
  };
}

/** True when anything other than the defaults is active. Drives "Clear filters". */
export function hasTaxonomyFilters(params: TaxonomyParams): boolean {
  return Boolean(params.q) || params.status !== 'all';
}

/** How many distinct filters are on, for the "2 filters applied" chip. */
export function countTaxonomyFilters(params: TaxonomyParams): number {
  return [params.q, params.status !== 'all'].filter(Boolean).length;
}

const PARAM_ORDER: (keyof TaxonomyParams)[] = ['q', 'status', 'sort'];

/**
 * Build a link that preserves the current filter/sort state.
 *
 * `page` is intentionally never emitted: changing a filter must land on page 1
 * of the NEW result set, not on page 7 of a set that may not have one.
 * `overrides` may set a key to `undefined` to drop it.
 */
export function taxonomyHref(
  base: TaxonomyListRoute,
  params: TaxonomyParams,
  overrides: Partial<Record<keyof TaxonomyParams, string | undefined>> = {}
): string {
  const merged: Record<string, string | number | null | undefined> = { ...params, ...overrides };
  const query = new URLSearchParams();
  for (const key of PARAM_ORDER) {
    const value = merged[key];
    if (value === undefined || value === null || value === '') continue;
    // Defaults are omitted so a filtered URL stays short and shareable.
    if (key === 'sort' && value === 'name') continue;
    if (key === 'status' && value === 'all') continue;
    query.set(key, String(value));
  }
  const qs = query.toString();
  return `${base}${qs ? `?${qs}` : ''}`;
}

/** Pagination link: current state plus an explicit page. */
export function taxonomyPageHref(base: TaxonomyListRoute, params: TaxonomyParams, page: number): string {
  const href = taxonomyHref(base, params);
  if (page <= 1) return href;
  return `${href}${href.includes('?') ? '&' : '?'}page=${page}`;
}

/**
 * Escape a string so an `ilike` pattern matches it literally.
 *
 * `%`, `_` and `\` are wildcards/escapes in SQL LIKE patterns; escaping them
 * turns the pattern into an exact case-insensitive equality test. Used by the
 * duplicate-name pre-checks in master-data-actions, where the user's typed
 * name must be compared exactly — not as a fuzzy contains search.
 */
export function escapeLikeLiteral(value: string): string {
  return value.replace(/[\\%_]/g, (char) => `\\${char}`);
}

/**
 * Canonical form of a taxonomy name for duplicate comparison: leading and
 * trailing whitespace only. Matches the database's own notion of a duplicate —
 * `categories_name_parent_ci_uq` (0027) compares `lower(trim(name))` — so the
 * pre-check and the constraint can never disagree about what is unique.
 */
export function normalizeTaxonomyName(value: string): string {
  return value.trim();
}
