import { requireUser } from '@/lib/auth/session';
import { can } from '@/lib/permissions/permissions';
import { requirePermission } from '@/lib/admin/guard';
import { createClient } from '@/lib/supabase/server';
import { csvStamp, toCsv } from '@/lib/admin/csv';
import {
  ADMIN_PRODUCT_SELECT,
  buildSearchClause,
  loadCostMap,
  loadSalesMap,
  loadSearchRelatedIds,
  loadStockMap,
  matchesDerivedFilters,
  searchMatchesNothing,
  productCasePrice,
  productMoq,
  resolveAdminProducts,
  type AdminProductRow,
} from '@/lib/admin/catalog-data';
import {
  ADMIN_DERIVED_LOOKUP_LIMIT,
  needsDerivedLookup,
  needsRelatedIdLookup,
  parseAdminCatalogParams,
} from '@/lib/admin/catalog-query';
import { PRODUCT_EXPORT_HEADER, productExportCells } from '@/lib/admin/product-csv';

/**
 * CSV export of the admin product catalog.
 *
 *   GET  — exports whatever the current filter/sort state matches. The query
 *          string is the same one the list page uses, so "Export this view"
 *          exports exactly what is on screen.
 *   POST — exports an explicit selection. The ids travel in the body because a
 *          200-id selection would not fit comfortably (or safely) in a URL.
 *
 * SECURITY
 * --------
 * * `products.view` is required, and RLS still scopes the read — a caller only
 *   ever exports rows they can already see.
 * * `cost_price` is REVOKED from anon/authenticated by migration 0025, so it is
 *   read through `admin_product_costs()` (0050) and only when the caller holds
 *   `products.view_cost`. A staff session gets every other column and an empty
 *   cost column; the value never reaches the file.
 * * `sku_code` is not exported. Migration 0023 removed it from the workflow: it
 *   is auto-generated, never shown and never edited, so putting it in a file an
 *   operator is meant to re-import would invite them to edit a field the app
 *   ignores.
 */

const MAX_EXPORT_ROWS = 5000;

export async function GET(request: Request) {
  await requirePermission('products.view');
  const url = new URL(request.url);
  const params = parseAdminCatalogParams(Object.fromEntries(url.searchParams.entries()));
  return respond(await loadRows(params, null));
}

export async function POST(request: Request) {
  await requirePermission('products.view');
  let ids: string[] = [];
  try {
    const body = (await request.json()) as { ids?: unknown };
    if (Array.isArray(body.ids)) {
      ids = [...new Set(body.ids.map((id) => String(id).trim()))]
        .filter((id) => /^[0-9a-f-]{36}$/i.test(id))
        .slice(0, 500);
    }
  } catch {
    ids = [];
  }
  // An empty or malformed selection exports nothing rather than the whole
  // catalog — silently widening the scope of an explicit request would be a
  // data-exposure bug, not a convenience.
  return respond(await loadRows(parseAdminCatalogParams({}), ids));
}

async function loadRows(
  params: ReturnType<typeof parseAdminCatalogParams>,
  explicitIds: string[] | null
) {
  const user = await requireUser();
  const includeCost = can(user.role, 'products.view_cost');
  const supabase = createClient();

  const relatedIds = params.q && needsRelatedIdLookup(params.field)
    ? await loadSearchRelatedIds(supabase, params.q, params.field === 'sku' ? 'sku' : 'all')
    : { brandIds: [], categoryIds: [], packProductIds: [] };
  const searchClause = buildSearchClause(params, relatedIds);

  // Mirror the list page exactly: a SKU search that resolves to no variant
  // exports a header-only file, never the whole catalog.
  if (searchMatchesNothing(params, relatedIds)) {
    return { resolved: [], includeCost };
  }

  let query = supabase.from('products').select(ADMIN_PRODUCT_SELECT);
  if (explicitIds) {
    query = query.in('id', explicitIds) as never;
  } else {
    if (searchClause) query = query.or(searchClause) as never;
    if (params.brand) query = query.eq('brand_id', params.brand) as never;
    if (params.category) query = query.eq('category_id', params.category) as never;
    if (params.status === 'active') query = query.eq('is_active', true) as never;
    if (params.status === 'inactive') query = query.eq('is_active', false) as never;
    if (params.gst !== 'all') query = query.eq('gst_percent', Number(params.gst)) as never;
    if (params.minPrice !== null) query = query.gte('base_price', params.minPrice) as never;
    if (params.maxPrice !== null) query = query.lte('base_price', params.maxPrice) as never;
  }

  const limit = explicitIds ? explicitIds.length : Math.min(ADMIN_DERIVED_LOOKUP_LIMIT, MAX_EXPORT_ROWS);
  const { data } = (await query.order('name').limit(limit)) as unknown as { data: AdminProductRow[] | null };
  let rows = data ?? [];

  // Derived filters/sorts have to be resolved in memory for the same reason the
  // list page does it: stock, sales and margin are not columns on `products`.
  const derived = !explicitIds && needsDerivedLookup(params);
  const [stock, sales, costs] = await Promise.all([
    loadStockMap(supabase),
    loadSalesMap(supabase),
    includeCost ? loadCostMap(supabase) : Promise.resolve(new Map<string, number | null>()),
  ]);

  const resolved = resolveAdminProducts(rows, { stock, sales, costs, includeCost });
  rows = (derived ? resolved.filter((row) => matchesDerivedFilters(row, params)) : resolved) as unknown as AdminProductRow[];

  return { resolved, includeCost };
}

function respond({
  resolved,
  includeCost,
}: {
  resolved: ReturnType<typeof resolveAdminProducts>;
  includeCost: boolean;
}) {
  const csv = toCsv(
    PRODUCT_EXPORT_HEADER,
    resolved.map((row) => {
      const active = row.product_packs.filter((pack) => pack.is_active);
      const cheapest = active.length > 0
        ? active.reduce((best, pack) => (pack.case_price < best.case_price ? pack : best), active[0]!)
        : null;
      return productExportCells({
        name: row.name,
        brandName: row.brands?.name ?? null,
        categoryName: row.categories?.name ?? null,
        unit: row.unit,
        unitsPerCase: cheapest?.units_per_case ?? 1,
        mrp: row.base_price,
        casePrice: productCasePrice(row),
        // Never written for a caller without cost permission — an empty cell,
        // not a zero, so a re-import cannot mistake it for "costs nothing".
        costPrice: includeCost ? (row.costPrice ?? null) : null,
        gstPercent: row.gst_percent,
        hsnCode: row.hsn_code,
        barcode: row.barcode,
        leadTimeDays: row.lead_time_days,
        moq: productMoq(row) ?? 1,
        isNewLaunch: row.is_new_launch,
        stockStatus: row.stock?.status ?? null,
        availableStock: row.stock?.available ?? null,
      });
    })
  );

  return new Response(csv, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="maharani-products-${csvStamp(new Date().toISOString())}.csv"`,
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}
