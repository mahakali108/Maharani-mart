/**
 * Admin categories & brands list query parameters — parsing, bounds and link
 * building (Phase 7).
 *
 * The combined /admin/catalog page used to read `?brandQ` / `?categoryQ` and
 * then filter the ENTIRE brands/categories tables in JavaScript. This module
 * gives each dedicated list page the same validated-parameter surface the
 * admin product list has (lib/admin/catalog-query.ts): a bounded page number,
 * a sanitized search term, a status filter and URL builders that survive
 * pagination.
 *
 * It reuses the product list's primitives (page bounds, status filter set,
 * search sanitizer) instead of redefining them, so both lists stay bounded
 * the same way.
 *
 * PURE — no Supabase, no `next/*`, no env, no secrets.
 */

import {
  ADMIN_PAGE_SIZE,
  ADMIN_STATUS_FILTERS,
  parseAdminPage,
  sanitizeAdminSearch,
  type AdminStatusFilter,
} from '@/lib/admin/catalog-query';

/** Route of each dedicated master-data list (kept here so hrefs stay consistent). */
export const CATEGORIES_LIST_PATH = '/admin/catalog/categories';
export const BRANDS_LIST_PATH = '/admin/catalog/brands';

export type MasterListKind = 'categories' | 'brands';

export function masterListPath(kind: MasterListKind): string {
  return kind === 'categories' ? CATEGORIES_LIST_PATH : BRANDS_LIST_PATH;
}

/** Validated state of one master-data list page request. */
export interface MasterListParams {
  q: string;
  status: AdminStatusFilter;
  page: number;
}

export type MasterSearchParams = Record<string, string | string[] | undefined>;

/** First value of a possibly-repeated search param, as a trimmed string. */
function firstParam(raw: unknown): string | undefined {
  if (Array.isArray(raw)) return typeof raw[0] === 'string' ? raw[0].trim() : undefined;
  return typeof raw === 'string' ? raw.trim() : undefined;
}

function parseStatus(raw: unknown): AdminStatusFilter {
  const value = firstParam(raw);
  return ADMIN_STATUS_FILTERS.includes(value as AdminStatusFilter) ? (value as AdminStatusFilter) : 'all';
}

/**
 * Parse one list page's params. Unknown status values fall back to `all`,
 * out-of-range pages are clamped to [1, ADMIN_MAX_PAGE], and the search term
 * is sanitized exactly like the product list's.
 */
export function parseMasterListParams(searchParams: MasterSearchParams): MasterListParams {
  return {
    q: sanitizeAdminSearch(firstParam(searchParams.q)),
    status: parseStatus(searchParams.status),
    page: parseAdminPage(firstParam(searchParams.page)),
  };
}

export function hasMasterListFilters(params: MasterListParams): boolean {
  return params.q !== '' || params.status !== 'all';
}

/**
 * Build a list URL, replacing only the keys given in `overrides`. When a
 * filter (`q` / `status`) changes, `page` resets to 1 unless the caller
 * explicitly provides one — following a filter change the operator should
 * land back on page 1, not on a page that may no longer exist.
 */
export function masterListHref(
  kind: MasterListKind,
  params: MasterListParams,
  overrides: Partial<MasterListParams> = {}
): string {
  const filterChanged = overrides.q !== undefined || overrides.status !== undefined;
  const merged: MasterListParams = {
    q: overrides.q !== undefined ? overrides.q : params.q,
    status: overrides.status !== undefined ? overrides.status : params.status,
    page: overrides.page !== undefined ? overrides.page : filterChanged ? 1 : params.page,
  };

  const search = new URLSearchParams();
  if (merged.q !== '') search.set('q', merged.q);
  if (merged.status !== 'all') search.set('status', merged.status);
  if (merged.page > 1) search.set('page', String(merged.page));

  const qs = search.toString();
  return qs ? `${masterListPath(kind)}?${qs}` : masterListPath(kind);
}

/** Pagination window for a master-data list, bounded by ADMIN_PAGE_SIZE. */
export function masterPageRange(page: number, pageSize: number = ADMIN_PAGE_SIZE) {
  const from = (page - 1) * pageSize;
  return { from, to: from + pageSize - 1 };
}

export function masterTotalPages(count: number, pageSize: number = ADMIN_PAGE_SIZE): number {
  return Math.max(1, Math.ceil(count / pageSize));
}

// ----------------------------------------------------------------------------
// Category form validation (shared by create and edit)
// ----------------------------------------------------------------------------

const CATEGORY_NAME_MIN = 2;
const CATEGORY_NAME_MAX = 80;
const BRAND_NAME_MIN = 2;
const BRAND_NAME_MAX = 80;
const SORT_ORDER_MIN = 0;
const SORT_ORDER_MAX = 9999;

/**
 * Parse and validate the `sortOrder` form field. Returns null for an empty
 * field (meaning "leave at the default 0"), or an error message. Accepts only
 * whole numbers in [0, 9999] — `sort_order` is an int column and the admin
 * list orders by it, so a stray decimal or huge value must never reach SQL.
 */
export function parseSortOrder(raw: FormDataEntryValue | null | undefined): { value: number | null; error?: string } {
  const text = typeof raw === 'string' ? raw.trim() : '';
  if (text === '') return { value: null };
  if (!/^\d+$/.test(text)) return { value: null, error: 'Sort order must be a whole number (0–9999).' };
  const value = Number(text);
  if (value < SORT_ORDER_MIN || value > SORT_ORDER_MAX) {
    return { value: null, error: `Sort order must be between ${SORT_ORDER_MIN} and ${SORT_ORDER_MAX}.` };
  }
  return { value };
}

/** Normalize a master-data name for storage: trimmed, single-spaced, bounded. */
export function normalizeMasterName(raw: FormDataEntryValue | null | undefined): string {
  return typeof raw === 'string' ? raw.trim().replace(/\s+/g, ' ') : '';
}

export function validateCategoryName(name: string): string | null {
  if (name.length < CATEGORY_NAME_MIN) return 'Enter a category name (at least 2 characters).';
  if (name.length > CATEGORY_NAME_MAX) return `Category names must be at most ${CATEGORY_NAME_MAX} characters.`;
  return null;
}

export function validateBrandName(name: string): string | null {
  if (name.length < BRAND_NAME_MIN) return 'Enter a brand name (at least 2 characters).';
  if (name.length > BRAND_NAME_MAX) return `Brand names must be at most ${BRAND_NAME_MAX} characters.`;
  return null;
}

/**
 * Case-insensitive duplicate check for a master-data name.
 *
 * The database already enforces uniqueness — `categories` via the
 * case-insensitive index `categories_name_parent_ci_uq` (0027) and `brands`
 * via the exact `unique(name)` constraint — so this is a friendly pre-flight,
 * not the guarantee. Its value is catching "tata" beside "Tata" for brands
 * (where the DB constraint is case-sensitive) and turning a raw Postgres
 * error into a message an operator can act on.
 */
export function duplicateNameError(exists: boolean, kind: 'brand' | 'category'): string | null {
  if (!exists) return null;
  return kind === 'brand'
    ? 'A brand with this name already exists (names must be unique).'
    : 'This category already exists under the selected parent.';
}
