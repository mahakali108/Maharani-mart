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
  adminCatalogHref,
  adminCatalogPageHref,
  adminPageRange,
  adminTotalPages,
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
import { ProductBulkPanel } from '@/components/admin/product-bulk-panel';
import { AdminEmptyState } from '@/components/admin/empty-state';
import { Package } from 'lucide-react';

interface Option {
  id: string;
  name: string;
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

  const derived = needsDerivedLookup(params);
  // The variant-SKU field resolves product ids from product_packs first; `all`
  // resolves brand / category / variant names. Every other field is a direct
  // column on `products`, so no extra lookup is issued for them.
  const relatedIds = params.q && needsRelatedIdLookup(params.field)
    ? await loadSearchRelatedIds(supabase, params.q, params.field === 'sku' ? 'sku' : 'all')
    : { brandIds: [], categoryIds: [], packProductIds: [] };
  const searchClause = buildSearchClause(params, relatedIds);
  const noPossibleResults = searchMatchesNothing(params, relatedIds);

  // Derived lookups are only issued when something actually needs them, so the
  // default browse path stays a single paginated query.
  const needsStock = derived && (params.stock !== 'all' || params.maxStock !== null || params.sort === 'stock-low');
  const needsSales = params.sort === 'sales';
  const needsCost = canViewCost && params.sort === 'margin-high';

  const [{ data: brandOptions }, { data: categoryOptions }] = await Promise.all([
    supabase.from('brands').select('id, name').order('name').returns<Option[]>(),
    supabase.from('categories').select('id, name').order('sort_order').order('name').returns<Option[]>(),
  ]);

  const [stockMap, salesMap, costMap] = await Promise.all([
    needsStock ? loadStockMap(supabase) : Promise.resolve(new Map()),
    needsSales ? loadSalesMap(supabase) : Promise.resolve(new Map()),
    needsCost ? loadCostMap(supabase) : Promise.resolve(new Map()),
  ]);

  /** Build the products query with every SQL-expressible filter applied. */
  const baseQuery = () => {
    let query = supabase.from('products').select(ADMIN_PRODUCT_SELECT, { count: 'exact' });
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

  let rows: AdminProductRow[] = [];
  let total = 0;
  let resultCapped = false;
  let stockMap2 = stockMap;
  let salesMap2 = salesMap;
  let costMap2 = costMap;

  if (noPossibleResults) {
    // Nothing to query: report an empty set rather than an unfiltered one.
    rows = [];
    total = 0;
  } else if (derived) {
    // MODE 2 — bounded working set. Ordered by name so the cap, when it binds,
    // drops a deterministic tail rather than an arbitrary one.
    const { data, count, error } = await baseQuery()
      .order('name', { ascending: true })
      .limit(ADMIN_DERIVED_LOOKUP_LIMIT) as never as {
      data: AdminProductRow[] | null;
      count: number | null;
      error: { message: string } | null;
    };
    if (error) throw new Error(error.message);
    resultCapped = (data ?? []).length >= ADMIN_DERIVED_LOOKUP_LIMIT;
    total = count ?? 0;

    // Stock badges and the stock sort need the map even when no stock filter
    // is active, but only for the rows that survived the SQL filters.
    const resolved0 = resolveAdminProducts(data ?? [], {
      stock: stockMap,
      sales: salesMap,
      costs: costMap,
      includeCost: canViewCost,
    });
    const filtered = resolved0.filter((row) => matchesDerivedFilters(row, params));
    const ordered = sortResolvedProducts(filtered, params.sort);
    const { from, to } = adminPageRange(params.page, ADMIN_PAGE_SIZE);
    const pageRows = ordered.slice(from, to + 1);

    // Mode 2 pages over a working set, so the total is the filtered length,
    // not the SQL count — otherwise "Page 3 of 40" would point at rows that
    // the stock filter already removed.
    total = ordered.length;

    // Lazily load stock/sales/cost for just this page when the map was not
    // needed for filtering or sorting.
    const pageNeeds = pageRows.length > 0;
    const [pageStock, pageSales, pageCosts] = await Promise.all([
      pageNeeds && !needsStock ? loadStockMap(supabase) : Promise.resolve(stockMap),
      pageNeeds && !needsSales ? loadSalesMap(supabase) : Promise.resolve(salesMap),
      pageNeeds && canViewCost && !needsCost ? loadCostMap(supabase) : Promise.resolve(costMap),
    ]);

    rows = pageRows as unknown as AdminProductRow[];
    stockMap2 = pageStock;
    salesMap2 = pageSales;
    costMap2 = pageCosts;
  } else {
    // MODE 1 — DB pagination.
    const { from, to } = adminPageRange(params.page, ADMIN_PAGE_SIZE);
    let query = baseQuery();
    if (params.sort === 'oldest') query = query.order('created_at', { ascending: true }) as never;
    else if (params.sort === 'name') query = query.order('name', { ascending: true }) as never;
    else if (params.sort === 'name-desc') query = query.order('name', { ascending: false }) as never;
    else if (params.sort === 'price-high') query = query.order('base_price', { ascending: false }) as never;
    else if (params.sort === 'price-low') query = query.order('base_price', { ascending: true }) as never;
    else if (params.sort === 'updated') query = query.order('updated_at', { ascending: false }) as never;
    else query = query.order('created_at', { ascending: false }) as never;

    const { data, count, error } = (await query.range(from, to)) as unknown as {
      data: AdminProductRow[] | null;
      count: number | null;
      error: { message: string } | null;
    };
    if (error) throw new Error(error.message);
    rows = data ?? [];
    total = count ?? 0;

    const [pageStock, pageSales, pageCosts] = await Promise.all([
      rows.length > 0 ? loadStockMap(supabase) : Promise.resolve(new Map()),
      Promise.resolve(new Map()),
      rows.length > 0 && canViewCost ? loadCostMap(supabase) : Promise.resolve(new Map()),
    ]);
    stockMap2 = pageStock;
    salesMap2 = pageSales;
    costMap2 = pageCosts;
  }

  const resolved: ResolvedAdminProduct[] = resolveAdminProducts(rows, {
    stock: stockMap2,
    sales: salesMap2,
    costs: costMap2,
    includeCost: canViewCost,
  });

  const brands = brandOptions ?? [];
  const categories = categoryOptions ?? [];
  const activeFilters = hasAdminFilters(params);
  const filterCount = countAdminFilters(params);
  const totalPages = adminTotalPages(total, ADMIN_PAGE_SIZE);
  const exportHref = `/admin/products/export${adminCatalogHref(params).split('?')[1] ? `?${adminCatalogHref(params).split('?')[1]}` : ''}`;

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

      {resultCapped ? (
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
          />

          {totalPages > 1 ? (
            <div className="flex items-center justify-center gap-2">
              {params.page > 1 ? (
                <Link href={adminCatalogPageHref(params, params.page - 1)}>
                  <Button size="sm" variant="outline">
                    Previous
                  </Button>
                </Link>
              ) : null}
              <span className="text-xs text-ink-400">
                Page {params.page} of {totalPages} · {total} product{total === 1 ? '' : 's'}
              </span>
              {params.page < totalPages ? (
                <Link href={adminCatalogPageHref(params, params.page + 1)}>
                  <Button size="sm" variant="outline">
                    Next
                  </Button>
                </Link>
              ) : null}
            </div>
          ) : (
            <p className="text-center text-xs text-ink-400">
              {total} product{total === 1 ? '' : 's'}
            </p>
          )}
        </>
      )}
    </div>
  );
}
