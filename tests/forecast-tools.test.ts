import { describe, expect, it } from 'vitest';
import { allBusinessTools, executeBusinessTool, toolsForContext } from '@/lib/ai/tools';
import { forecastCard, forecastNarrative } from '@/lib/ai/tools/forecast';
import type { AIToolContext } from '@/lib/ai/types';
import type { ForecastResult, ForecastSummary } from '@/lib/ai/forecast/types';

const adminActor = { id: '00000000-0000-4000-8000-000000000001', role: 'admin' as const, fullName: 'Admin', surface: 'admin' as const };
const retailerActor = { id: '00000000-0000-4000-8000-000000000002', role: 'retailer' as const, fullName: 'R', surface: 'retailer' as const };
const salesmanActor = { id: '00000000-0000-4000-8000-000000000003', role: 'salesman' as const, fullName: 'S', surface: 'salesman' as const };
const staffActor = { id: '00000000-0000-4000-8000-000000000004', role: 'staff' as const, fullName: 'Staff', surface: 'staff' as const };

const today = '2025-06-15';
const windowDays = 60;

/** Build a mock supabase client that serves the forecast data layer for tests. */
function forecastSupabase({ productRows, stockRows, demandRows, expiryRows = [] }: { productRows: unknown[]; stockRows: unknown[]; demandRows: unknown[]; expiryRows?: unknown[] }) {
  const tables: Record<string, unknown[]> = {
    products: productRows,
    inventory_product_totals: stockRows,
    ai_product_demand_daily: demandRows,
    inventory_expiry_report: expiryRows,
  };
  // Each from() returns a fresh chainable builder (real Supabase does this),
  // so per-table fixtures are not clobbered by reusing a single object.
  return {
    from: (table: string) => {
      const query: Record<string, unknown> = {};
      for (const m of ['select', 'eq', 'order', 'limit', 'in', 'gte', 'lte', 'range']) query[m] = () => query;
      query.maybeSingle = async () => ({ data: null, error: null });
      query.returns = async () => ({ data: tables[table] ?? [], error: null });
      return query;
    },
  } as never;
}

function contextFor(actor: AIToolContext['actor'], supabase: unknown): AIToolContext {
  return { actor, supabase: supabase as AIToolContext['supabase'], requestId: '00000000-0000-4000-8000-000000000011', confirmed: false };
}

describe('forecast tool authorization and isolation', () => {
  it('registers forecast tools for staff/admin but never for retailer/salesman', () => {
    const names = new Set(allBusinessTools.map((tool) => tool.name));
    for (const name of ['get_demand_forecast', 'get_reorder_recommendation', 'get_inventory_risk']) {
      expect(names.has(name), name).toBe(true);
    }
    const adminNames = new Set(toolsForContext(contextFor(adminActor, forecastSupabase({ productRows: [], stockRows: [], demandRows: [] }))).map((tool) => tool.name));
    expect(adminNames.has('get_demand_forecast')).toBe(true);
    const staffNames = new Set(toolsForContext(contextFor(staffActor, forecastSupabase({ productRows: [], stockRows: [], demandRows: [] }))).map((tool) => tool.name));
    expect(staffNames.has('get_inventory_risk')).toBe(true);
    const retailerNames = new Set(toolsForContext(contextFor(retailerActor, forecastSupabase({ productRows: [], stockRows: [], demandRows: [] }))).map((tool) => tool.name));
    expect(retailerNames.has('get_demand_forecast')).toBe(false);
    expect(retailerNames.has('get_inventory_risk')).toBe(false);
    const salesmanNames = new Set(toolsForContext(contextFor(salesmanActor, forecastSupabase({ productRows: [], stockRows: [], demandRows: [] }))).map((tool) => tool.name));
    expect(salesmanNames.has('get_demand_forecast')).toBe(false);
  });

  it('rejects forecast arguments with an invalid window', async () => {
    const execution = await executeBusinessTool('get_demand_forecast', { days: 7 }, contextFor(adminActor, forecastSupabase({ productRows: [], stockRows: [], demandRows: [] })));
    expect(execution.result.ok).toBe(false);
    expect(execution.result.message).toBe('Invalid tool arguments.');
  });

  it('reports no eligible products without inventing forecasts when the catalog has no data', async () => {
    const execution = await executeBusinessTool('get_demand_forecast', { days: 30, limit: 5 }, contextFor(adminActor, forecastSupabase({ productRows: [], stockRows: [], demandRows: [] })));
    expect(execution.result.ok).toBe(false);
    expect(execution.result.message).toMatch(/no eligible products|unavailable/i);
  });

  it('marks an active product with no sales history as insufficient data, not a fake forecast', async () => {
    const productRows = [{ id: 'p1', name: 'New Product', sku_code: 'NEW-1', unit: 'pack', lead_time_days: 2, min_stock: 0, reorder_level: 0, max_stock: 0 }];
    const stockRows = [{ product_id: 'p1', available_quantity: 0, quantity_on_hand: 0, reserved_quantity: 0, reorder_level: 0, max_stock: 0, min_stock: 0, stock_status: 'out_of_stock' }];
    const execution = await executeBusinessTool('get_demand_forecast', { days: 30, limit: 5 }, contextFor(adminActor, forecastSupabase({ productRows, stockRows, demandRows: [] })));
    expect(execution.result.ok).toBe(true);
    const card = execution.result.cards?.[0];
    expect(card).toBeTruthy();
    expect(card!.quality).toBe('estimate');
    const demand = execution.result.data as { forecasts: Array<{ dataQuality: string; demand7Day: number; demand30Day: number }> };
    expect(demand.forecasts[0]!.dataQuality).toBe('insufficient');
    expect(demand.forecasts[0]!.demand7Day).toBe(0);
    expect(demand.forecasts[0]!.demand30Day).toBe(0);
  });

  it('produces a demand forecast card from real fixture data', async () => {
    const productRows = [
      { id: 'p1', name: 'Cooking Oil 1L', sku_code: 'OIL-1', unit: 'pack', lead_time_days: 2, min_stock: 0, reorder_level: 40, max_stock: 300 },
    ];
    const stockRows = [
      { product_id: 'p1', available_quantity: 180, quantity_on_hand: 190, reserved_quantity: 10, reorder_level: 40, max_stock: 300, min_stock: 20, stock_status: 'healthy' },
    ];
    const demandRows = Array.from({ length: 60 }, (_, index) => ({
      product_id: 'p1',
      demand_date: new Date(Date.now() - (59 - index) * 86_400_000).toISOString().slice(0, 10),
      quantity: 20,
      order_count: 1,
      cancelled_units: 0,
      return_units: 0,
    }));
    const execution = await executeBusinessTool('get_demand_forecast', { days: 60, limit: 5 }, contextFor(adminActor, forecastSupabase({ productRows, stockRows, demandRows })));
    expect(execution.result.ok).toBe(true);
    expect(execution.result.cards?.length).toBeGreaterThan(0);
    const card = execution.result.cards!.find((c) => c.title === 'Cooking Oil 1L');
    expect(card).toBeTruthy();
    expect(card!.quality).toBe('verified');
    // Insight cards (traceable, labelled as estimates) are present too.
    const first = execution.result.cards![0]!;
    expect(first.type).toBe('insight');
    expect(first.quality).toBe('estimate');
    expect(first.title).toContain('Cooking Oil 1L');
  });
});

describe('forecast card and narrative formatting', () => {
  const forecast: ForecastResult = {
    productId: 'p1', productName: 'Cooking Oil 1L', skuCode: 'OIL-1', unit: 'pack',
    dataQuality: 'estimate', periodStart: '2025-04-17', periodEnd: '2025-06-15',
    historyDays: 60, activeDays: 60, dataPoints: 60, totalUnits: 1200,
    averageDailyRate: 20, weeklyRate: 140, recentDailyRate: 20,
    demand7Day: 140, demand30Day: 600, demandDirection: 'stable', trendChangePercent: 2,
    seasonalityFactors: [1, 1, 1, 1, 1, 1, 1], seasonalityDetected: false,
    confidence: 0.72, confidenceLabel: 'High',
    availableStock: 180, stockOutDays: 9, stockOutDate: '2025-06-24', stockOutRisk: 'medium',
    reorderLevel: 40, maxStock: 300, leadTimeDays: 2, reorderQuantity: 120, reorderWindowDays: 9,
    overstockWarning: false, overstockDaysOfCover: null, deadStockWarning: false,
    explanation: 'Demand held steady; current stock covers approximately 9 days.', method: 'Weighted recent rate + linear trend', dataBasis: 'period source',
  };
  const summary: ForecastSummary = {
    generatedAt: today, windowDays, productsForecast: 3, productsWithInsufficientData: 1,
    productsWithStockoutRisk: 1, productsNeedingReorder: 1, productsOverstocked: 1,
    productsDeadStock: 0, rising: 1, falling: 0, stable: 2, averageConfidence: 0.7,
    totalUnitsOutflow: 1200, forecasts: [forecast],
  };

  it('renders an explainable card with estimates clearly labelled', () => {
    const card = forecastCard(forecast);
    expect(card.title).toBe('Cooking Oil 1L');
    expect(card.quality).toBe('estimate');
    const demandMetric = card.metrics?.find((m) => m.label === '7-day demand');
    expect(demandMetric?.quality).toBe('estimate');
    const stockMetric = card.metrics?.find((m) => m.label === 'Now');
    expect(stockMetric?.value).toBe('180');
  });

  it('writes a data-backed narrative', () => {
    const narrative = forecastNarrative(summary);
    expect(narrative).toContain('60');
    expect(narrative).toContain('3 product(s)');
    expect(narrative).toContain('stock');
    expect(narrative).not.toContain('fake');
  });
});
