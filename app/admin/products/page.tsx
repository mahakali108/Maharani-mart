import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';
import { requireUser } from '@/lib/auth/session';
import { can } from '@/lib/permissions/permissions';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import {
  ADMIN_DERIVED_LOOKUP_LIMIT,
  ADMIN_GST_FILTERS,
  ADMIN_PAGE_SIZE,
  ADMIN_SEARCH_FIELDS,
  ADMIN_SEARCH_FIELD_LABELS,
  ADMIN_SORT_LABELS,
  ADMIN_STOCK_FILTERS,
  ADMIN_STOCK_LABELS,
  ADMIN_STATUS_FILTERS,
  type AdminCatalogParams,
  type AdminProductSort as AdminProductSortValue,
  adminCatalogHref,
  countAdminFilters,
  hasAdminFilters,
  needsDerivedLookup,
  needsRelatedIdLookup,
  parseAdminCatalogParams,
} from '@/lib/admin/catalog-query';
import {
  ADMIN_PRODUCT_SELECT,
  buildSearchClause,
  loadCostMap,
  loadSalesMap,
  loadSearchRelatedIds,
  loadStockMap,
  matchesDerivedFilters,
  searchMatchesNothing,
  resolveAdminProducts,
  sortResolvedProducts,
  type AdminProductRow,
  type ResolvedAdminProduct,
} from '@/lib/admin/catalog-data';
import {
  ProductBulkPanel,
  toBulkPanelProduct,
  type BulkPanelProduct,
} from '@/components/admin/product-bulk-panel';
import { AdminEmptyState } from '@/components/admin/empty-state';
import { Package } from 'lucide-react';
import {
  applyCursor,
  applyKeysetOrder,
  cursorOffset,
  keysetCursorFor,
  readCursor,
  toListBatch,
  toOffsetBatch,
  type KeysetColumn,
} from '@/lib/infinite-scroll/keyset';
import type { ListCursor } from '@/lib/infinite-scroll/cursor';

interface Option {
  id: string;
  name: string;
}

type SupabaseClient = ReturnType<typeof createClient>;

/**
 * The ORDER BY for each DB-sortable admin sort, and — in the same breath — the
 * shape of the keyset cursor. Every column here is NOT NULL (0001_init.sql) and
 * `id` is always the last term, so "everything after the row I just showed" is
 * an exact, index-served predicate rather than an OFFSET walk.
 */
function adminSortOrder(sort: AdminProductSortValue): KeysetColumn[] {
  if (sort === 'oldest') {
    return [
      { column: 'created_at', ascending: true },
      { column: 'id', ascending: true },
    ];
  }
  if (sort === 'name') {
    return [
      { column: 'name', ascending: true },
      { column: 'id', ascending: true },
    ];
  }
  if (sort === 'name-desc') {
    return [
      { column: 'name', ascending: false },
      { column: 'id', ascending: true },
    ];
  }
  if (sort === 'price-high') {
    return [
      { column: 'base_price', ascending: false },
      { column: 'id', ascending: true },
    ];
  }
  if (sort === 'price-low') {
    return [
      { column: 'base_price', ascending: true },
      { column: 'id', ascending: true },
    ];
  }
  if (sort === 'updated') {
    return [
      { column: 'updated_at', ascending: false },
      { column: 'id', ascending: true },
    ];
  }
  return [
    { column: 'created_at', ascending: false },
    { column: 'id', ascending: false },
  ];
}

/**
 * One batch of resolved admin products.
 *
 * MODE 1 (every filter and the sort are expressible in SQL) pages the database
 * with a keyset cursor. MODE 2 (stock / sales / margin / MOQ, none of which are
 * columns on `products`) still resolves a bounded working set of
 * ADMIN_DERIVED_LOOKUP_LIMIT rows, filters and ranks it in memory, and then
 * batches over it with an offset cursor — the same honest disclosure as before,
 * just without a page number.
 */
async function loadAdminProductBatch(
  supabase: SupabaseClient,
  params: AdminCatalogParams,
  view: { canViewCost: boolean },
  cursor: ListCursor | null
): Promise<{ items: ResolvedAdminProduct[]; nextCursor: string | null; resultCapped: boolean }> {
  const derived = needsDerivedLookup(params);
  const relatedIds =
    params.q && needsRelatedIdLookup(params.field)
      ? await loadSearchRelatedIds(supabase, params.q, params.field === 'sku' ? 'sku' : 'all')
      : { brandIds: [], categoryIds: [], packProductIds: [] };
  const searchClause = buildSearchClause(params, relatedIds);

  if (params.q && searchMatchesNothing(params, relatedIds)) {
    return { items: [], nextCursor: null, resultCapped: false };
  }

  /** Build the products query with every SQL-expressible filter applied. */
  const baseQuery = () => {
    let query = supabase.from('products').select(ADMIN_PRODUCT_SELECT);
    if (searchClause) query = query.or(searchClause) as never;
    if (params.brand) query = query.eq('brand_id', params.brand) as never;
    if (params.category) query = query.eq('category_id', params.category) as never;
    if (params.status === 'active') query = query.eq('is_active', true) as never;
    if (params.status === 'inactive') query = query.eq('is_active', false) as never;
    if (params.gst !== 'all') query = query.eq('gst_percent', Number(params.gst)) as never;
    if (params.minPrice !== null) query = query.gte('base_price', params.minPrice) as never;
    if (params.maxPrice !== null) query = query.lte('base_price', params.maxPrice) as never;
    return query;
  };

  if (!derived) {
    const order = adminSortOrder(params.sort);
    const { data, error } = await applyCursor(
      applyKeysetOrder(baseQuery(), order),
      cursor,
      order,
      ADMIN_PAGE_SIZE
    ) as never as { data: AdminProductRow[] | null; error: { message: string } | null };
    if (error) throw new Error(error.message);

    const batch = toListBatch(data ?? [], ADMIN_PAGE_SIZE, (row) => keysetCursorFor(row, order));
    return {
      items: resolveAdminProducts(batch.items, {
        stock: await loadStockMap(supabase),
        sales: new Map(),
        costs: view.canViewCost ? await loadCostMap(supabase) : new Map(),
        includeCost: view.canViewCost,
      }),
      nextCursor: batch.nextCursor,
      resultCapped: false,
    };
  }

  // MODE 2 — bounded working set, ordered by name so the cap, when it binds,
  // drops a deterministic tail rather than an arbitrary one.
  const offset = cursorOffset(cursor);
  const { data, error } = (await baseQuery()
    .order('name', { ascending: true })
    .order('id', { ascending: true })
    .limit(ADMIN_DERIVED_LOOKUP_LIMIT)) as never as {
    data: AdminProductRow[] | null;
    error: { message: string } | null;
  };
  if (error) throw new Error(error.message);
  const resultCapped = (data ?? []).length >= ADMIN_DERIVED_LOOKUP_LIMIT;

  const needsStock = params.stock !== 'all' || params.maxStock !== null || params.sort === 'stock-low';
  const needsSales = params.sort === 'sales';
  const needsCost = view.canViewCost && params.sort === 'margin-high';
  const resolved0 = resolveAdminProducts(data ?? [], {
    stock: needsStock ? await loadStockMap(supabase) : new Map(),
    sales: needsSales ? await loadSalesMap(supabase) : new Map(),
    costs: needsCost ? await loadCostMap(supabase) : new Map(),
    includeCost: view.canViewCost,
  });
  const filtered = resolved0.filter((row) => matchesDerivedFilters(row, params));
  const ordered = sortResolvedProducts(filtered, params.sort);
  const batch = toOffsetBatch(ordered, ADMIN_PAGE_SIZE, offset);

  return {
    items: resolveAdminProducts(
      batch.items as unknown as AdminProductRow[],
      {
        stock: needsStock ? await loadStockMap(supabase) : new Map(),
        sales: needsSales ? await loadSalesMap(supabase) : new Map(),
        costs: view.canViewCost ? await loadCostMap(supabase) : new Map(),
        includeCost: view.canViewCost,
      }
    ),
    nextCursor: batch.nextCursor,
    resultCapped,
  };
}

/**
 * Admin product catalog.
 *
 * Filters that the `products` table can answer directly are pushed into SQL
 * (Mode 1, DB-paginated). Filters and sorts that need stock, sales, cost or
 * MOQ — none of which are columns on `products` — resolve a bounded working
 * set first (Mode 2). See lib/admin/catalog-data.ts for why, and the notice
 * below for how the cap is disclosed.
 */
export default async function ProductsPage({
  searchParams,
}: {
  searchParams: Record<string, string | string[] | undefined>;
}) {
  const user = await requireUser();
  const params = parseAdminCatalogParams(searchParams);
  const supabase = createClient();

  const canEdit = can(user.role, 'products.edit');
  const canDelete = can(user.role, 'products.delete');
  const canManagePricing = can(user.role, 'pricing.manage');
  const canViewCost = can(user.role, 'products.view_cost');

  const [{ data: brandOptions }, { data: categoryOptions }, firstBatch] = await Promise.all([
    supabase.from('brands').select('id, name').order('name').returns<Option[]>(),
    supabase.from('categories').select('id, name').order('sort_order').order('name').returns<Option[]>(),
    loadAdminProductBatch(supabase, params, { canViewCost }, null),
  ]);
  const resolved = firstBatch.items;

  const brands = brandOptions ?? [];
  const categories = categoryOptions ?? [];
  const activeFilters = hasAdminFilters(params);
  const filterCount = countAdminFilters(params);
  const exportHref = `/admin/products/export${adminCatalogHref(params).split('?')[1] ? `?${adminCatalogHref(params).split('?')[1]}` : ''}`;

  /**
   * Server Action for batches 2..n. The row needs its own resolved pricing and
   * permission-derived cost column, so this returns plain serialisable rows the
   * product table can own (selection state lives client-side) — the same
   * scrolling contract, just carrying data instead of markup.
   */
  async function loadMoreProducts(
    cursor: string | null
  ): Promise<{ items: BulkPanelProduct[]; nextCursor: string | null }> {
    'use server';
    const caller = await requireUser();
    const batch = await loadAdminProductBatch(
      createClient(),
      params,
      { canViewCost: can(caller.role, 'products.view_cost') },
      readCursor(cursor)
    );
    return { items: batch.items.map(toBulkPanelProduct), nextCursor: batch.nextCursor };
  }


  return (
    <div className="space-y-6">
      <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-center">
        <div>
          <h1 className="text-2xl font-semibold text-ink-950">Products</h1>
          <p className="mt-1 text-sm text-ink-500">
            Your full product catalog. Nothing is visible to retailers until it exists here and is active.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link href={exportHref}>
            <Button variant="outline">Export CSV</Button>
          </Link>
          <Link href="/admin/products/import">
            <Button variant="outline">Import CSV</Button>
          </Link>
          <Link href="/admin/products/new">
            <Button>Add product</Button>
          </Link>
        </div>
      </div>

      <Card>
        <form method="get" className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-6">
          <div className="relative sm:col-span-2 lg:col-span-2">
            <Input name="q" defaultValue={params.q} placeholder="Search products…" className="pl-3" />
          </div>
          <Select name="field" defaultValue={params.field}>
            {ADMIN_SEARCH_FIELDS.map((field) => (
              <option key={field} value={field}>
                {ADMIN_SEARCH_FIELD_LABELS[field]}
              </option>
            ))}
          </Select>
          <Select name="brand" defaultValue={params.brand}>
            <option value="">All brands</option>
            {brands.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </Select>
          <Select name="category" defaultValue={params.category}>
            <option value="">All categories</option>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </Select>
          <Select name="status" defaultValue={params.status}>
            {ADMIN_STATUS_FILTERS.map((status) => (
              <option key={status} value={status}>
                {status === 'all' ? 'Any status' : status === 'active' ? 'Active' : 'Inactive'}
              </option>
            ))}
          </Select>

          <Select name="stock" defaultValue={params.stock}>
            {ADMIN_STOCK_FILTERS.map((value) => (
              <option key={value} value={value}>
                {ADMIN_STOCK_LABELS[value]}
              </option>
            ))}
          </Select>
          <Select name="gst" defaultValue={params.gst}>
            {ADMIN_GST_FILTERS.map((value) => (
              <option key={value} value={value}>
                {value === 'all' ? 'Any GST' : `GST ${value}%`}
              </option>
            ))}
          </Select>
          <div className="flex gap-2">
            <Input
              name="minPrice"
              type="number"
              min={0}
              step="0.01"
              defaultValue={params.minPrice ?? ''}
              placeholder="MRP min"
            />
            <Input
              name="maxPrice"
              type="number"
              min={0}
              step="0.01"
              defaultValue={params.maxPrice ?? ''}
              placeholder="MRP max"
            />
          </div>
          <div className="flex gap-2">
            <Input
              name="minMoq"
              type="number"
              min={0}
              step={1}
              defaultValue={params.minMoq ?? ''}
              placeholder="MOQ min"
            />
            <Input
              name="maxMoq"
              type="number"
              min={0}
              step={1}
              defaultValue={params.maxMoq ?? ''}
              placeholder="MOQ max"
            />
          </div>
          <Select name="sort" defaultValue={params.sort}>
            {(Object.keys(ADMIN_SORT_LABELS) as (keyof typeof ADMIN_SORT_LABELS)[]).map((sort) => (
              <option key={sort} value={sort}>
                {ADMIN_SORT_LABELS[sort]}
              </option>
            ))}
          </Select>
          <div className="flex flex-wrap items-center gap-2 sm:col-span-2 lg:col-span-6">
            <Button type="submit" variant="secondary" size="sm">
              Apply
            </Button>
            {activeFilters ? (
              <Link href="/admin/products">
                <Button type="button" variant="ghost" size="sm">
                  Clear {filterCount > 1 ? `${filterCount} filters` : 'filter'}
                </Button>
              </Link>
            ) : null}
          </div>
        </form>
      </Card>

      {firstBatch.resultCapped ? (
        <p className="rounded-xl border border-amber-200 bg-amber-50 px-3.5 py-2.5 text-xs leading-4 text-amber-800">
          This view ranks by a value that is not stored on the product row (stock, sales, margin or MOQ), so it works
          over the first <span className="font-bold">{ADMIN_DERIVED_LOOKUP_LIMIT}</span> products that match the other
          filters. Narrow the search to see further down the catalog.
        </p>
      ) : null}

      {resolved.length === 0 ? (
        <AdminEmptyState
          icon={Package}
          title={activeFilters ? 'No products match your filters' : 'No products yet'}
          body={
            activeFilters
              ? 'Try a different search term, or clear the filters above.'
              : 'Add your first product to start building the catalog. Retailers see nothing until products exist here.'
          }
        />
      ) : (
        <>
          <ProductBulkPanel
            products={resolved}
            brands={brands}
            categories={categories}
            canEdit={canEdit}
            canDelete={canDelete}
            canManagePricing={canManagePricing}
            canViewCost={canViewCost}
            exportHref={exportHref}
            loader={loadMoreProducts}
            initialCursor={firstBatch.nextCursor}
            initialHasMore={Boolean(firstBatch.nextCursor)}
            resetKey={adminCatalogHref(params)}
          />
        </>
      )}
    </div>
  );
}
