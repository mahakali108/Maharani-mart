import 'server-only';

import type { createClient } from '@/lib/supabase/server';
import { ADMIN_PAGE_SIZE } from '@/lib/admin/catalog-query';
import {
  applyCursor,
  applyKeysetOrder,
  keysetCursorFor,
  toListBatch,
  type KeysetColumn,
} from '@/lib/infinite-scroll/keyset';
import type { ListCursor } from '@/lib/infinite-scroll/cursor';
import {
  escapeLikeLiteral,
  normalizeTaxonomyName,
  type TaxonomyParams,
  type TaxonomySort,
} from '@/lib/admin/taxonomy-query';

/**
 * Server-side data loading for the admin categories & brands lists.
 *
 * Both lists are single-table and every offered filter/sort is a plain column,
 * so — unlike the product list (lib/admin/catalog-data.ts, Mode 2) — there is
 * no derived working-set mode here: search, status filter and sort all go to
 * Postgres in one query per batch.
 *
 * Batches are fetched by KEYSET cursor, not by `?page=`: the sort columns are
 * non-null and end in the unique `id` tiebreaker, so "everything after the row
 * I just showed" is an exact, index-served predicate. Scrolling stays cheap no
 * matter how far down the list the operator is, and a row created while they
 * scroll cannot shift or repeat what is on screen.
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

/** One batch of taxonomy rows plus the cursor that continues the list. */
export interface TaxonomyBatch<Row> {
  items: Row[];
  /** `null` means the list is complete. */
  nextCursor: string | null;
}

/** Ceiling on the parent-chain walk in `categoryParentChainHits`. */
const MAX_PARENT_CHAIN = 100;

/** Search + lifecycle filter, shared by both taxonomy lists. */
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

/**
 * The ORDER BY for a taxonomy sort — and, in the same breath, the shape of the
 * keyset cursor. `id` is always the last term: category names may repeat under
 * different parents, so a cursor has to be able to point at exactly one row.
 */
export function taxonomyOrder(sort: TaxonomySort): KeysetColumn[] {
  if (sort === 'name-desc') {
    return [
      { column: 'name', ascending: false },
      { column: 'created_at', ascending: true },
      { column: 'id', ascending: true },
    ];
  }
  if (sort === 'newest') {
    return [
      { column: 'created_at', ascending: false },
      { column: 'name', ascending: true },
      { column: 'id', ascending: true },
    ];
  }
  if (sort === 'oldest') {
    return [
      { column: 'created_at', ascending: true },
      { column: 'name', ascending: true },
      { column: 'id', ascending: true },
    ];
  }
  return [
    { column: 'name', ascending: true },
    { column: 'created_at', ascending: true },
    { column: 'id', ascending: true },
  ];
}

/**
 * One batch of rows from `categories` or `brands`. Both tables have the same
 * filters, the same sorts and the same `products(count)` aggregate, so the two
 * list pages share this single query instead of two near-copies.
 */
async function loadTaxonomyBatch<Row extends object>(
  supabase: SupabaseClient,
  table: 'categories' | 'brands',
  params: TaxonomyParams,
  cursor: ListCursor | null
): Promise<TaxonomyBatch<Row>> {
  const order = taxonomyOrder(params.sort);
  // PostgREST rejects a column the table does not have, so each table selects
  // its own columns; everything else about the two queries is shared.
  const columns =
    table === 'categories'
      ? 'id, name, parent_id, image_url, sort_order, is_active, created_at, products(count)'
      : 'id, name, logo_url, is_active, created_at, products(count)';
  const query = applyTaxonomyFilters(supabase.from(table).select(columns), params);
  const { data, error } = await applyCursor(applyKeysetOrder(query, order), cursor, order, ADMIN_PAGE_SIZE);
  if (error) throw new Error(error.message);
  const rows = (data ?? []) as unknown as Row[];
  return toListBatch(rows, ADMIN_PAGE_SIZE, (row) => keysetCursorFor(row, order));
}

/**
 * One batch of categories, with the parent names for THAT batch resolved in a
 * single bounded query (never one query per row, and never for rows that are
 * not being rendered).
 */
export async function loadAdminCategoryBatch(
  supabase: SupabaseClient,
  params: TaxonomyParams,
  cursor: ListCursor | null
): Promise<TaxonomyBatch<AdminCategoryRow & { parentName: string | null }>> {
  const batch = await loadTaxonomyBatch<AdminCategoryRow>(supabase, 'categories', params, cursor);
  const rows = batch.items;

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
    items: rows.map((row) => ({ ...row, parentName: row.parent_id ? parentNames.get(row.parent_id) ?? null : null })),
    nextCursor: batch.nextCursor,
  };
}

/** One batch of brands, with the linked product count. */
export async function loadAdminBrandBatch(
  supabase: SupabaseClient,
  params: TaxonomyParams,
  cursor: ListCursor | null
): Promise<TaxonomyBatch<AdminBrandRow>> {
  return loadTaxonomyBatch<AdminBrandRow>(supabase, 'brands', params, cursor);
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
