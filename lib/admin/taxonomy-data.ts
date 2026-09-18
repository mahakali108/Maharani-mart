import 'server-only';

import type { createClient } from '@/lib/supabase/server';
import {
  ADMIN_PAGE_SIZE,
  adminPageRange,
  adminTotalPages,
} from '@/lib/admin/catalog-query';
import {
  escapeLikeLiteral,
  normalizeTaxonomyName,
  type TaxonomyParams,
} from '@/lib/admin/taxonomy-query';

/**
 * Server-side data loading for the admin categories & brands lists.
 *
 * Both lists are single-table and every offered filter/sort is a plain column,
 * so — unlike the product list (lib/admin/catalog-data.ts, Mode 2) — there is
 * no derived working-set mode here: search, status filter, sort, `.range()`
 * pagination and `count: 'exact'` all go to Postgres in one query per page.
 *
 * Nothing here invents a number. `products(count)` is the real link count from
 * the database (PostgREST nested aggregate over `products.brand_id` /
 * `products.category_id`), which is what an operator needs before deciding
 * whether a row is safe to deactivate or delete.
 */

type SupabaseClient = ReturnType<typeof createClient>;

export interface AdminCategoryRow {
  id: string;
  name: string;
  parent_id: string | null;
  image_url: string | null;
  sort_order: number;
  is_active: boolean;
  created_at: string;
  products: { count: number }[] | null;
}

export interface AdminBrandRow {
  id: string;
  name: string;
  logo_url: string | null;
  is_active: boolean;
  created_at: string;
  products: { count: number }[] | null;
}

export interface TaxonomyPageResult<Row> {
  rows: Row[];
  /** Real total matching the filters — drives "Page 1 of N". */
  total: number;
  totalPages: number;
}

/** Ceiling on the parent-chain walk in `categoryParentChainHits`. */
const MAX_PARENT_CHAIN = 100;

function applyTaxonomyFilters<T extends { ilike: (c: string, v: string) => T; eq: (c: string, v: boolean) => T }>(
  query: T,
  params: TaxonomyParams
): T {
  let next = query;
  // `params.q` was sanitised by parseTaxonomyParams, so wrapping it in `%` is
  // safe: it cannot smuggle a LIKE wildcard through.
  if (params.q) next = next.ilike('name', `%${params.q}%`);
  if (params.status === 'active') next = next.eq('is_active', true);
  if (params.status === 'inactive') next = next.eq('is_active', false);
  return next;
}

function applyTaxonomySort<
  T extends {
    order: (column: string, options?: { ascending?: boolean }) => T;
  }
>(query: T, sort: TaxonomyParams['sort']): T {
  // Secondary order on created_at keeps pages deterministic when two rows
  // share a name (legal for categories under different parents).
  if (sort === 'name-desc') return query.order('name', { ascending: false }).order('created_at', { ascending: true });
  if (sort === 'newest') return query.order('created_at', { ascending: false }).order('name', { ascending: true });
  if (sort === 'oldest') return query.order('created_at', { ascending: true }).order('name', { ascending: true });
  return query.order('name', { ascending: true }).order('created_at', { ascending: true });
}

/**
 * One page of categories, DB-paginated, with the parent names and the linked
 * product count resolved for the rows on that page only.
 */
export async function loadAdminCategoriesPage(
  supabase: SupabaseClient,
  params: TaxonomyParams
): Promise<TaxonomyPageResult<AdminCategoryRow & { parentName: string | null }>> {
  const { from, to } = adminPageRange(params.page, ADMIN_PAGE_SIZE);

  const { data, count, error } = (await applyTaxonomySort(
    applyTaxonomyFilters(
      supabase.from('categories').select(
        'id, name, parent_id, image_url, sort_order, is_active, created_at, products(count)',
        { count: 'exact' }
      ),
      params
    ),
    params.sort
  ).range(from, to)) as unknown as {
    data: AdminCategoryRow[] | null;
    count: number | null;
    error: { message: string } | null;
  };
  if (error) throw new Error(error.message);

  const rows = data ?? [];

  // Resolve parent names for just this page — one bounded query, not one per row.
  const parentIds = [...new Set(rows.map((row) => row.parent_id).filter((id): id is string => id !== null))];
  const parentNames = new Map<string, string>();
  if (parentIds.length > 0) {
    const { data: parents, error: parentError } = await supabase
      .from('categories')
      .select('id, name')
      .in('id', parentIds)
      .returns<{ id: string; name: string }[]>();
    if (parentError) throw new Error(parentError.message);
    for (const parent of parents ?? []) {
      parentNames.set(parent.id, parent.name);
    }
  }

  return {
    rows: rows.map((row) => ({ ...row, parentName: row.parent_id ? parentNames.get(row.parent_id) ?? null : null })),
    total: count ?? 0,
    totalPages: adminTotalPages(count ?? 0, ADMIN_PAGE_SIZE),
  };
}

/** One page of brands, DB-paginated, with the linked product count. */
export async function loadAdminBrandsPage(
  supabase: SupabaseClient,
  params: TaxonomyParams
): Promise<TaxonomyPageResult<AdminBrandRow>> {
  const { from, to } = adminPageRange(params.page, ADMIN_PAGE_SIZE);

  const { data, count, error } = (await applyTaxonomySort(
    applyTaxonomyFilters(
      supabase.from('brands').select('id, name, logo_url, is_active, created_at, products(count)', {
        count: 'exact',
      }),
      params
    ),
    params.sort
  ).range(from, to)) as unknown as {
    data: AdminBrandRow[] | null;
    count: number | null;
    error: { message: string } | null;
  };
  if (error) throw new Error(error.message);

  return {
    rows: data ?? [],
    total: count ?? 0,
    totalPages: adminTotalPages(count ?? 0, ADMIN_PAGE_SIZE),
  };
}

/** Counts for the /admin/catalog hub cards — real rows, never estimates. */
export interface TaxonomyCounts {
  total: number;
  active: number;
}

async function loadCounts(supabase: SupabaseClient, table: 'categories' | 'brands'): Promise<TaxonomyCounts> {
  const [all, activeOnly] = await Promise.all([
    supabase.from(table).select('id', { count: 'exact', head: true }),
    supabase.from(table).select('id', { count: 'exact', head: true }).eq('is_active', true),
  ]);
  if (all.error) throw new Error(all.error.message);
  if (activeOnly.error) throw new Error(activeOnly.error.message);
  return { total: all.count ?? 0, active: activeOnly.count ?? 0 };
}

export function loadCategoryCounts(supabase: SupabaseClient): Promise<TaxonomyCounts> {
  return loadCounts(supabase, 'categories');
}

export function loadBrandCounts(supabase: SupabaseClient): Promise<TaxonomyCounts> {
  return loadCounts(supabase, 'brands');
}

/**
 * Exact case-insensitive duplicate check for a brand name.
 *
 * `brands.name` has only a case-SENSITIVE unique constraint (0001), so without
 * this check "Tata" and "tata" could coexist. The escaped `ilike` is an exact
 * CI equality test, and the DB constraint stays as the race-condition backstop.
 * `excludeId` lets the edit form ignore the row's own current name.
 */
export async function findBrandNameDuplicate(
  supabase: SupabaseClient,
  name: string,
  excludeId?: string
): Promise<{ id: string; name: string } | null> {
  let query = supabase
    .from('brands')
    .select('id, name')
    .ilike('name', escapeLikeLiteral(normalizeTaxonomyName(name)));
  if (excludeId) query = query.neq('id', excludeId);
  const { data, error } = await query.maybeSingle<{ id: string; name: string }>();
  if (error) throw new Error(error.message);
  return data ?? null;
}

/**
 * Exact case-insensitive duplicate check for a category within its parent.
 * Mirrors `categories_name_parent_ci_uq` (0027): `lower(trim(name))` scoped to
 * the same parent (NULL parent = top level, matched with `.is()`).
 */
export async function findCategoryNameDuplicate(
  supabase: SupabaseClient,
  name: string,
  parentId: string | null,
  excludeId?: string
): Promise<{ id: string; name: string } | null> {
  let query = supabase
    .from('categories')
    .select('id, name')
    .ilike('name', escapeLikeLiteral(normalizeTaxonomyName(name)));
  query = parentId ? query.eq('parent_id', parentId) : query.is('parent_id', null);
  if (excludeId) query = query.neq('id', excludeId);
  const { data, error } = await query.maybeSingle<{ id: string; name: string }>();
  if (error) throw new Error(error.message);
  return data ?? null;
}

/**
 * Would setting `categoryId.parent_id = newParentId` create a cycle?
 *
 * The self-reference (`parentId === categoryId`) is rejected by the caller;
 * this walks the ancestor chain of the candidate parent looking for the
 * category itself (A → B → A). The chain is bounded by MAX_PARENT_CHAIN and a
 * visited set, so a pre-existing bad cycle in the data cannot loop forever.
 */
export async function categoryParentChainHits(
  supabase: SupabaseClient,
  categoryId: string,
  newParentId: string | null
): Promise<boolean> {
  let current = newParentId;
  const visited = new Set<string>();
  while (current !== null) {
    if (current === categoryId) return true;
    if (visited.has(current) || visited.size >= MAX_PARENT_CHAIN) return false;
    visited.add(current);
    const { data, error } = await supabase
      .from('categories')
      .select('parent_id')
      .eq('id', current)
      .maybeSingle<{ parent_id: string | null }>();
    if (error) throw new Error(error.message);
    if (!data) return false;
    current = data.parent_id;
  }
  return false;
}
