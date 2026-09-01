import 'server-only';

import type { createClient } from '@/lib/supabase/server';
import type { DailyDemandPoint, DemandTimeSeries, ForecastParams, StockSnapshot } from '@/lib/ai/forecast/types';

/**
 * Secure analytics data layer for demand forecasting.
 *
 * IMPORTANT: this module only ever reads through the caller's RLS-scoped
 * Supabase client. It aggregates in Postgres (via the RLS-guarded
 * ai_product_demand_daily view) rather than dragging raw rows into Node —
 * so role boundaries, RLS and the "no unrestricted DB access" rule all hold.
 * It performs no writes and exposes no secrets/costs.
 */

export interface ProductMasterRow {
  id: string;
  name: string;
  sku_code: string | null;
  unit: string | null;
  lead_time_days: number;
  min_stock: number;
  reorder_level: number;
  max_stock: number;
}

interface DemandViewRow {
  product_id: string;
  demand_date: string;
  quantity: number;
  order_count: number;
  cancelled_units: number;
  return_units: number;
}

interface StockViewRow {
  product_id: string;
  available_quantity: number;
  quantity_on_hand: number;
  reserved_quantity: number;
  reorder_level: number;
  max_stock: number;
  min_stock: number;
  stock_status: string | null;
}

const PAGE_SIZE = 1000;
const MAX_PRODUCTS = 500;

interface CollectOptions {
  productIds?: string[];
  days: number;
  params: ForecastParams;
  /** Cap on how many products are processed when no explicit ids are given. */
  limit?: number;
}

/** Fetch the active product master + the current authorized stock snapshot. */
async function fetchProductsAndStock(
  supabase: ReturnType<typeof createClient>,
  explicitIds: string[] | undefined,
  limit: number
): Promise<{ products: ProductMasterRow[]; stock: Map<string, StockSnapshot> }> {
  const products: ProductMasterRow[] = [];
  let stockQuery = supabase.from('inventory_product_totals').select('product_id, available_quantity, quantity_on_hand, reserved_quantity, reorder_level, max_stock, min_stock, stock_status');

  let productQuery = supabase.from('products').select('id, name, sku_code, unit, lead_time_days, min_stock, reorder_level, max_stock').eq('is_active', true);
  if (explicitIds && explicitIds.length > 0) productQuery = productQuery.in('id', explicitIds);
  productQuery = productQuery.order('created_at', { ascending: false }).limit(limit);

  const { data: productData, error: productError } = await productQuery.returns<ProductMasterRow[]>();
  if (productError) throw new Error('Could not read the product catalog.');
  products.push(...(productData ?? []));

  if (products.length === 0) {
    return { products, stock: new Map<string, StockSnapshot>() };
  }

  const productIds = products.map((product) => product.id);
  if (explicitIds && explicitIds.length > 0) stockQuery = stockQuery.in('product_id', productIds);
  const { data: stockData, error: stockError } = await stockQuery.returns<StockViewRow[]>();
  if (stockError) throw new Error('Could not read the authorized inventory stock view.');

  const stock = new Map<string, StockSnapshot>();
  for (const row of stockData ?? []) {
    const product = products.find((candidate) => candidate.id === row.product_id);
    stock.set(row.product_id, {
      productId: row.product_id,
      availableQuantity: row.available_quantity,
      reservedQuantity: row.reserved_quantity,
      quantityOnHand: row.quantity_on_hand,
      reorderLevel: row.reorder_level,
      maxStock: row.max_stock,
      minStock: row.min_stock,
      leadTimeDays: product?.lead_time_days ?? 2,
      stockStatus: row.stock_status,
    });
  }
  return { products, stock };
}

/** Fetch per-day demand (RLS-guarded view) for the given products, paginated. */
async function fetchDailyDemand(
  supabase: ReturnType<typeof createClient>,
  productIds: string[],
  from: string,
  to: string
): Promise<DemandViewRow[]> {
  const rows: DemandViewRow[] = [];
  for (let offset = 0; offset < 50_000; offset += PAGE_SIZE) {
    const query = supabase
      .from('ai_product_demand_daily')
      .select('product_id, demand_date, quantity, order_count, cancelled_units, return_units')
      .in('product_id', productIds)
      .gte('demand_date', from)
      .lte('demand_date', to)
      .order('demand_date', { ascending: true })
      .range(offset, offset + PAGE_SIZE - 1);
    const { data, error } = await query.returns<DemandViewRow[]>();
    if (error) throw new Error('Could not read the authorized demand view.');
    rows.push(...(data ?? []));
    if ((data?.length ?? 0) < PAGE_SIZE) break;
  }
  return rows;
}

/**
 * Build the inputs for the engine: one DemandTimeSeries + StockSnapshot per
 * product that has either an inventory row or at least one sale in the window.
 */
export async function collectForecastInputs(
  supabase: ReturnType<typeof createClient>,
  options: CollectOptions
): Promise<{ series: DemandTimeSeries[]; stock: Map<string, StockSnapshot> }> {
  const limit = options.limit ?? 20;
  const { products, stock } = await fetchProductsAndStock(supabase, options.productIds, options.limit ? Math.max(limit, 50) : 200);

  let activeProducts = products;
  if (options.productIds && options.productIds.length > 0) {
    const wanted = new Set(options.productIds);
    activeProducts = products.filter((product) => wanted.has(product.id));
    if (activeProducts.length < wanted.size) {
      // Some requested ids are inactive or missing — proceed with what exists.
    }
  }

  const to = new Date();
  const toIso = to.toISOString().slice(0, 10);
  const from = new Date(to.getTime() - options.days * 86_400_000).toISOString().slice(0, 10);

  const productIds = activeProducts.map((product) => product.id);
  const demandRows = productIds.length > 0 ? await fetchDailyDemand(supabase, productIds, from, toIso) : [];

  const byProduct = new Map<string, { points: DailyDemandPoint[]; orderCount: number; cancellationUnits: number; returnUnits: number }>();
  for (const row of demandRows) {
    const entry = byProduct.get(row.product_id) ?? { points: [], orderCount: 0, cancellationUnits: 0, returnUnits: 0 };
    entry.points.push({ date: row.demand_date, quantity: row.quantity });
    entry.orderCount += row.order_count;
    entry.cancellationUnits += row.cancelled_units;
    entry.returnUnits += row.return_units;
    byProduct.set(row.product_id, entry);
  }

  // A product is eligible if it has an inventory record, or any activity, or
  // is explicitly requested. The engine reports "insufficient" honestly.
  const series: DemandTimeSeries[] = activeProducts
    .filter((product) => {
      const entry = byProduct.get(product.id);
      return stock.has(product.id) || (entry?.points.length ?? 0) > 0 || (options.productIds?.includes(product.id) ?? false);
    })
    .map((product) => {
      const entry = byProduct.get(product.id);
      const points = (entry?.points ?? []).slice().sort((a, b) => a.date.localeCompare(b.date));
      const daysOfHistory = options.days;
      const activeDays = points.length;
      const totalUnits = points.reduce((acc, point) => acc + point.quantity, 0);
      return {
        productId: product.id,
        productName: product.name,
        skuCode: product.sku_code,
        unit: product.unit,
        periodStart: from,
        periodEnd: toIso,
        daily: points,
        daysOfHistory,
        activeDays,
        totalUnits,
        orderCount: entry?.orderCount ?? 0,
        cancellationUnits: entry?.cancellationUnits ?? 0,
        returnUnits: entry?.returnUnits ?? 0,
      };
    });

  return { series, stock };
}

export { MAX_PRODUCTS };
