import { describe, expect, it } from 'vitest';
import {
  buildActions,
  buildDailySeries,
  computeBusinessOverview,
  computeCreditOverview,
  computeRetailerIntel,
  computeRiskCenter,
  computeSalesIntel,
  computeSalesmanIntel,
  computeSupplierIntel,
  computeTrends,
  computeTopPerformers,
  summarizeAuditEvent,
  toDateKey,
  type RawExpiryRow,
  type RawGrn,
  type RawGrnItem,
  type RawOrder,
  type RawOrderItem,
  type RawProfile,
  type RawRetailer,
} from '@/lib/admin/command-center/compute';
import { parseSalesIntelFilters } from '@/lib/admin/command-center/data';
import { can } from '@/lib/permissions/permissions';
import type { ForecastResult } from '@/lib/ai/forecast/types';

// ---------------------------------------------------------------------------
// Fixtures — synthetic rows that mimic REAL table shapes (never used as demo
// data in the app; test-only).
// ---------------------------------------------------------------------------

const NOW = new Date('2026-08-26T12:00:00');
const TODAY = '2026-08-26';

function order(overrides: Partial<RawOrder> & { id: string }): RawOrder {
  return {
    order_number: `ORD-${overrides.id}`,
    retailer_id: 'r-1',
    collected_by: null,
    status: 'confirmed',
    grand_total: 1000,
    placed_at: `${TODAY}T10:00:00.000Z`,
    ...overrides,
  };
}

function retailer(overrides: Partial<RawRetailer> & { id: string }): RawRetailer {
  return {
    shop_name: `Shop ${overrides.id}`,
    status: 'active',
    credit_limit: 0,
    outstanding_balance: 0,
    created_at: '2025-01-01T00:00:00.000Z',
    approved_at: '2025-01-02T00:00:00.000Z',
    ...overrides,
  };
}

function profile(overrides: Partial<RawProfile> & { id: string }): RawProfile {
  return {
    full_name: `P ${overrides.id}`,
    role: 'salesman',
    is_active: true,
    ...overrides,
  };
}

const EMPTY_FORECASTS: ForecastResult[] = [];

function emptyForecastResult(): ForecastResult {
  // Never returned by the engine with data — only shape.
  throw new Error('use real forecast rows');
}
void emptyForecastResult;

// ---------------------------------------------------------------------------
// Dates & daily series
// ---------------------------------------------------------------------------

describe('daily series and date helpers', () => {
  it('zero-fills missing days and excludes cancelled orders', () => {
    const orders = [
      order({ id: 'a', placed_at: `${TODAY}T09:00:00.000Z`, grand_total: 500 }),
      order({ id: 'b', placed_at: '2026-08-24T09:00:00.000Z', grand_total: 300 }),
      order({ id: 'c', placed_at: `${TODAY}T09:30:00.000Z`, grand_total: 999, status: 'cancelled' }),
    ];
    const series = buildDailySeries(orders, 3, NOW);
    expect(series).toHaveLength(3);
    expect(series.map((p) => p.date)).toEqual(['2026-08-24', '2026-08-25', '2026-08-26']);
    expect(series[0]?.sales).toBe(300);
    expect(series[1]?.sales).toBe(0);
    expect(series[2]?.sales).toBe(500); // cancelled order excluded
    expect(series[2]?.orders).toBe(1);
  });

  it('toDateKey uses server-local calendar days', () => {
    const d = new Date(2026, 7, 26, 1, 2, 3);
    expect(toDateKey(d)).toBe('2026-08-26');
  });
});

// ---------------------------------------------------------------------------
// Business overview
// ---------------------------------------------------------------------------

describe('business overview calculations', () => {
  const base = {
    now: NOW,
    retailers: [retailer({ id: 'r-1', credit_limit: 5000, outstanding_balance: 6000 })],
    profiles: [profile({ id: 's-1' }), profile({ id: 'st-1', role: 'staff' as const })],
    inventoryTotals: [
      { product_id: 'p-1', product_name: 'A', sku_code: 'A', quantity_on_hand: 10, reserved_quantity: 2, available_quantity: 8, estimated_value: 800, reorder_level: 5, stock_status: 'healthy' as const },
      { product_id: 'p-2', product_name: 'B', sku_code: 'B', quantity_on_hand: 0, reserved_quantity: 0, available_quantity: 0, estimated_value: 0, reorder_level: 0, stock_status: 'out_of_stock' as const },
    ],
    expiryRows: [
      { batch_id: 'b-1', product_id: 'p-1', product_name: 'A', batch_number: 'X1', warehouse_name: 'WH', expiry_date: '2026-08-20', available_quantity: 3, current_quantity: 3, estimated_value: 250, days_remaining: -6, expiry_status: 'expired' as const },
    ] as RawExpiryRow[],
    items30d: [{ order_id: 'm-1', product_id: 'p-1', quantity: 4, line_total: 400, products: { name: 'A', sku_code: 'A', brand_id: 'br-1', category_id: 'c-1' } }] as RawOrderItem[],
    pendingGrns: 1,
    supplierNames: ['ACME', 'ACME '],
  };

  it('computes sales/orders/revenue from real rows and MoM change', () => {
    const result = computeBusinessOverview({
      ...base,
      ordersToday: [order({ id: 't-1' })],
      ordersMonth: [order({ id: 'm-1', placed_at: '2026-08-10T09:00:00.000Z', grand_total: 100 }), order({ id: 't-1' })],
      ordersPreviousMonth: [order({ id: 'pm-1', placed_at: '2026-07-10T09:00:00.000Z', grand_total: 400 })],
      orders30d: [order({ id: 'm-1', placed_at: '2026-08-10T09:00:00.000Z', grand_total: 100 }), order({ id: 't-1' })],
    });
    expect(result.todaySales).toBe(1000);
    expect(result.todayOrders).toBe(1);
    expect(result.monthSales).toBe(1100);
    expect(result.monthOrders).toBe(2);
    expect(result.previousMonthSales).toBe(400);
    expect(result.salesMoMChangePct).toBe(175); // (1100-400)/400
    expect(result.revenue30d).toBe(1100);
    expect(result.overLimitAmount).toBe(1000); // 6000 - 5000
    expect(result.outstandingCredit).toBe(6000);
    expect(result.inventoryValue).toBe(800);
    expect(result.outOfStockCount).toBe(1);
    expect(result.expiredBatches).toBe(1);
    expect(result.supplierCount).toBe(1); // deduped, case/whitespace-insensitive
    expect(result.status).toBe('ok');
  });

  it('reports MoM change as null (not a fake 0%) when the previous month has no data', () => {
    const result = computeBusinessOverview({
      ...base,
      ordersToday: [],
      ordersMonth: [],
      ordersPreviousMonth: [],
      orders30d: [],
    });
    expect(result.salesMoMChangePct).toBeNull();
    expect(result.todaySales).toBe(0);
    expect(result.status).toBe('ok'); // empty data is real, not an error
  });

  it('dead stock = stocked products with zero sales in the window', () => {
    const result = computeBusinessOverview({
      ...base,
      ordersToday: [],
      ordersMonth: [],
      ordersPreviousMonth: [],
      orders30d: [],
      items30d: [] as RawOrderItem[],
    });
    // p-1 (8 available) and p-2 (0 available — excluded) → only p-1 counts
    expect(result.deadStockCount).toBe(1);
    expect(result.deadStockValue).toBe(800);
  });
});

// ---------------------------------------------------------------------------
// Credit (shared calculator reuse)
// ---------------------------------------------------------------------------

describe('credit overview', () => {
  it('reuses the authoritative calculator for over-limit detection and buckets', () => {
    const overview = computeCreditOverview([
      retailer({ id: 'r-1', credit_limit: 10000, outstanding_balance: 9500 }), // 95%
      retailer({ id: 'r-2', credit_limit: 10000, outstanding_balance: 12000 }), // over
      retailer({ id: 'r-3', credit_limit: 0, outstanding_balance: 3000 }), // no limit configured
      retailer({ id: 'r-4', credit_limit: 8000, outstanding_balance: 1000 }), // 12.5%
    ]);
    expect(overview.overLimitCount).toBe(1);
    expect(overview.overLimitAmount).toBe(2000);
    expect(overview.totalConfiguredLimit).toBe(28000);
    expect(overview.totalOutstanding).toBe(25500);
    expect(overview.utilizationPct).toBe(Math.round((25500 / 28000) * 1000) / 10);
    const buckets = Object.fromEntries(overview.buckets.map((b) => [b.label, b.count]));
    expect(buckets['No limit set']).toBe(1);
    expect(buckets['0–25%']).toBe(1);
    expect(buckets['80–100%']).toBe(1);
    expect(buckets['Over limit']).toBe(1);
    expect(overview.highRisk[0]?.shopName).toBe('Shop r-2');
    expect(overview.paymentTrendAvailable).toBe(false); // no payment ledger exists
  });

  it('reports an empty section for a platform with no retailers', () => {
    const overview = computeCreditOverview([]);
    expect(overview.status).toBe('empty');
    expect(overview.utilizationPct).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Trends
// ---------------------------------------------------------------------------

describe('trends', () => {
  it('counts returning retailers (ordered in 7d AND before the window)', () => {
    const orders30d = [
      order({ id: 'a', retailer_id: 'r-1', placed_at: '2026-08-25T09:00:00.000Z' }),
      order({ id: 'b', retailer_id: 'r-1', placed_at: '2026-08-01T09:00:00.000Z' }),
      order({ id: 'c', retailer_id: 'r-2', placed_at: '2026-08-25T09:00:00.000Z' }), // new this week only
    ];
    const trends = computeTrends({ now: NOW, orders30d, retailers: [retailer({ id: 'r-1' }), retailer({ id: 'r-2' })] });
    expect(trends.returningRetailers7d).toBe(1);
    expect(trends.aov30d).toBe(1000);
    expect(trends.daily).toHaveLength(14);
    expect(trends.creditCollectionAvailable).toBe(false);
  });

  it('counts new retailers by approval (or creation) date', () => {
    const trends = computeTrends({
      now: NOW,
      orders30d: [],
      retailers: [
        retailer({ id: 'r-1', approved_at: '2026-08-10T00:00:00.000Z' }),
        retailer({ id: 'r-2', approved_at: '2026-05-01T00:00:00.000Z', created_at: '2026-08-20T00:00:00.000Z' }), // approved long ago
      ],
    });
    expect(trends.newRetailers30d).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Top performers
// ---------------------------------------------------------------------------

describe('top performers', () => {
  it('ranks products, brands, categories, retailers and salesmen from real lines', () => {
    const orders = [
      order({ id: 'o-1', retailer_id: 'r-1', collected_by: 's-1', grand_total: 300 }),
      order({ id: 'o-2', retailer_id: 'r-2', grand_total: 500 }),
    ];
    const items = [
      { order_id: 'o-1', product_id: 'p-1', quantity: 2, line_total: 200, products: { name: 'A', sku_code: 'A', brand_id: 'br-1', category_id: 'c-1' } },
      { order_id: 'o-1', product_id: 'p-2', quantity: 1, line_total: 100, products: { name: 'B', sku_code: 'B', brand_id: 'br-1', category_id: 'c-2' } },
      { order_id: 'o-2', product_id: 'p-1', quantity: 5, line_total: 500, products: { name: 'A', sku_code: 'A', brand_id: 'br-2', category_id: 'c-1' } },
    ] as RawOrderItem[];
    const top = computeTopPerformers({
      windowDays: 30,
      orders,
      items,
      retailers: [retailer({ id: 'r-1' }), retailer({ id: 'r-2' })],
      profiles: [profile({ id: 's-1' })],
    });
    expect(top.status).toBe('ok');
    expect(top.products[0]?.id).toBe('p-1');
    expect(top.products[0]?.value).toBe(700);
    expect(top.brands.map((b) => b.name)).toEqual(['Unbranded', 'Unbranded']); // no brand names passed — labelled honestly
    expect(top.retailers[0]?.id).toBe('r-2');
    expect(top.salesmen[0]?.id).toBe('s-1');
  });

  it('is an honest empty state with no order data', () => {
    const top = computeTopPerformers({ windowDays: 30, orders: [], items: [], retailers: [], profiles: [] });
    expect(top.status).toBe('empty');
    expect(top.products).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Risk center & actions
// ---------------------------------------------------------------------------

function forecastRow(overrides: Partial<ForecastResult> & { productId: string; productName: string }): ForecastResult {
  return {
    skuCode: 'SKU',
    unit: 'pcs',
    dataQuality: 'real',
    periodStart: '2026-07-27',
    periodEnd: '2026-08-26',
    historyDays: 30,
    activeDays: 20,
    dataPoints: 20,
    totalUnits: 100,
    averageDailyRate: 3,
    weeklyRate: 21,
    recentDailyRate: 3,
    demand7Day: 21,
    demand30Day: 90,
    demandDirection: 'stable',
    trendChangePercent: 0,
    seasonalityFactors: [1, 1, 1, 1, 1, 1, 1],
    seasonalityDetected: false,
    confidence: 0.8,
    confidenceLabel: 'Medium',
    availableStock: 5,
    stockOutDays: 2,
    stockOutDate: '2026-08-28',
    stockOutRisk: 'critical',
    reorderLevel: 10,
    maxStock: 100,
    leadTimeDays: 3,
    reorderQuantity: 25,
    reorderWindowDays: 5,
    overstockWarning: false,
    overstockDaysOfCover: null,
    deadStockWarning: false,
    explanation: 'Stock 5 vs ~3 unit(s)/day.',
    method: 'test',
    dataBasis: '18 order lines',
    ...overrides,
  };
}

describe('risk center', () => {
  const base = {
    now: NOW,
    retailers: [retailer({ id: 'r-1', credit_limit: 10000, outstanding_balance: 11000 })],
    inventoryTotals: [
      { product_id: 'p-1', product_name: 'A', sku_code: 'A', quantity_on_hand: 10, reserved_quantity: 0, available_quantity: 10, estimated_value: 900, reorder_level: 0, stock_status: 'healthy' as const },
    ],
    expiryRows: [
      { batch_id: 'b-1', product_id: 'p-1', product_name: 'A', batch_number: 'X1', warehouse_name: 'WH', expiry_date: '2026-08-25', available_quantity: 4, current_quantity: 4, estimated_value: 350, days_remaining: -1, expiry_status: 'expired' as const },
    ] as RawExpiryRow[],
    orders30d: [
      order({ id: 'h-1', retailer_id: 'r-2', grand_total: 400, placed_at: '2026-08-10T09:00:00.000Z' }),
      order({ id: 'h-2', retailer_id: 'r-2', grand_total: 400, placed_at: '2026-08-12T09:00:00.000Z' }),
    ],
    orders7d: [order({ id: 'u-1', order_number: 'ORD-U1', retailer_id: 'r-2', grand_total: 5000, placed_at: `${TODAY}T09:00:00.000Z` })],
    items30d: [] as RawOrderItem[],
    forecasts: [forecastRow({ productId: 'p-1', productName: 'A' })],
    aiAuditLogs: [{ id: 'ai-1', tool_name: 'get_demand_forecast', request_type: 'tool', success: false, error_code: 'provider_failure', provider: 'openai-compatible', created_at: `${TODAY}T08:00:00.000Z` }],
    failedNotifications7d: 2,
  };

  it('classifies each risk bucket from its real source', () => {
    const risk = computeRiskCenter(base);
    expect(risk.stockoutRisk.count).toBe(1);
    expect(risk.stockoutRisk.items[0]?.severity).toBe('urgent');
    expect(risk.expiry.count).toBe(1);
    expect(risk.expiry.value).toBe(350);
    expect(risk.credit.count).toBe(1);
    expect(risk.credit.items[0]?.severity).toBe('urgent');
    expect(risk.unusualOrders.count).toBe(1); // 5000 vs AOV 400 → 12.5×
    expect(risk.systemFailures.count).toBe(2); // 1 AI failure + notification failures
  });

  it('does not flag unusual orders without a history baseline (avoids false positives)', () => {
    const risk = computeRiskCenter({ ...base, orders30d: [], retailers: [retailer({ id: 'r-2', credit_limit: 0 })] });
    expect(risk.unusualOrders.count).toBe(0);
  });

  it('dead-stock risk comes from the 30-day demand absence, not a heuristic guess', () => {
    const risk = computeRiskCenter({ ...base, orders7d: [], aiAuditLogs: [], failedNotifications7d: 0, forecasts: [] });
    expect(risk.deadStock.count).toBe(1); // p-1 stocked, no sales in items30d
    expect(risk.deadStock.value).toBe(900);
  });
});

describe('executive action center', () => {
  const base = {
    now: NOW,
    retailers: [
      retailer({ id: 'r-1', credit_limit: 10000, outstanding_balance: 12000 }),
      retailer({ id: 'r-2', status: 'active' as const }),
    ],
    inventoryTotals: [
      { product_id: 'p-1', product_name: 'A', sku_code: 'A', quantity_on_hand: 4, reserved_quantity: 0, available_quantity: 4, estimated_value: 360, reorder_level: 10, stock_status: 'low_stock' as const },
    ],
    expiryRows: [
      { batch_id: 'b-1', product_id: 'p-1', product_name: 'A', batch_number: 'X1', warehouse_name: 'WH', expiry_date: '2026-08-28', available_quantity: 4, current_quantity: 4, estimated_value: 350, days_remaining: 2, expiry_status: 'critical' as const },
    ] as RawExpiryRow[],
    orders30d: [],
    orders7d: [],
    items30d: [] as RawOrderItem[],
    forecasts: [forecastRow({ productId: 'p-1', productName: 'A', reorderQuantity: 20, stockOutRisk: 'critical' as const })],
    aiAuditLogs: [],
    failedNotifications7d: 0,
  };

  it('produces urgent-first actions with source, reason and required approval', () => {
    const actions = buildActions({
      ...base,
      retailersIntel: computeRetailerIntel({ now: NOW, retailers: base.retailers, ordersRecent: [], ordersPrevious: [] }),
    });
    expect(actions.length).toBeGreaterThan(0);
    expect(actions[0]?.severity).toBe('urgent');
    for (const action of actions) {
      expect(action.source).toBeTruthy();
      expect(action.reason).toBeTruthy();
      expect(action.recommendedAction).toBeTruthy();
      expect(action.requiredApproval).toBeTruthy();
    }
    const severities = actions.map((a) => a.severity);
    const firstHigh = severities.indexOf('high');
    const lastUrgent = Math.max(...severities.map((s, i) => (s === 'urgent' ? i : -1)));
    expect(firstHigh === -1 || firstHigh > lastUrgent).toBe(true); // urgent before high
  });

  it('produces NO actions when there are no real signals (no fake work)', () => {
    const actions = buildActions({
      ...base,
      retailers: [retailer({ id: 'r-2' })],
      inventoryTotals: [
        { product_id: 'p-9', product_name: 'Z', sku_code: 'Z', quantity_on_hand: 50, reserved_quantity: 0, available_quantity: 50, estimated_value: 500, reorder_level: 0, stock_status: 'healthy' as const },
      ],
      expiryRows: [],
      forecasts: [],
      // p-9 HAS 30-day sales here, so no dead-stock signal fires.
      items30d: [{ order_id: 'y', product_id: 'p-9', quantity: 2, line_total: 200, products: { name: 'Z', sku_code: 'Z', brand_id: null, category_id: null } } as RawOrderItem],
      retailersIntel: computeRetailerIntel({ now: NOW, retailers: [retailer({ id: 'r-2' })], ordersRecent: [order({ id: 'x', retailer_id: 'r-2' })], ordersPrevious: [] }),
    });
    expect(actions).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Sales intelligence
// ---------------------------------------------------------------------------

describe('sales intelligence', () => {
  const retailers = [retailer({ id: 'r-1' }), retailer({ id: 'r-2' })];
  const profiles = [profile({ id: 's-1' })];

  const orders = [
    order({ id: 'o-1', retailer_id: 'r-1', collected_by: 's-1', grand_total: 300, placed_at: '2026-08-20T09:00:00.000Z' }),
    order({ id: 'o-2', retailer_id: 'r-2', grand_total: 500, placed_at: '2026-08-22T09:00:00.000Z' }),
  ];
  const items = [
    { order_id: 'o-1', product_id: 'p-1', quantity: 2, line_total: 200, products: { name: 'A', sku_code: 'A', brand_id: 'br-1', category_id: 'c-1' } },
    { order_id: 'o-1', product_id: 'p-2', quantity: 1, line_total: 100, products: { name: 'B', sku_code: 'B', brand_id: 'br-1', category_id: 'c-1' } },
    { order_id: 'o-2', product_id: 'p-1', quantity: 5, line_total: 500, products: { name: 'A', sku_code: 'A', brand_id: 'br-2', category_id: 'c-2' } },
  ] as RawOrderItem[];
  const previousOrders = [order({ id: 'o-p', retailer_id: 'r-1', grand_total: 1000, placed_at: '2026-07-20T09:00:00.000Z' })];

  it('uses order basis by default and item basis under a product filter', () => {
    const noFilter = computeSalesIntel({
      filters: { from: '2026-08-01', to: '2026-08-26', categoryId: null, brandId: null, productId: null, retailerId: null, salesmanId: null },
      orders,
      items,
      previousOrders,
      retailers,
      profiles,
      brands: [],
      categories: [],
    });
    expect(noFilter.filteredBasis).toBe('order');
    expect(noFilter.totalSales).toBe(800);
    expect(noFilter.totalOrders).toBe(2);
    expect(noFilter.growthPct).toBe(-20); // 800 vs 1000

    const filtered = computeSalesIntel({
      filters: { from: '2026-08-01', to: '2026-08-26', categoryId: null, brandId: null, productId: 'p-1', retailerId: null, salesmanId: null },
      orders,
      items,
      previousOrders,
      retailers,
      profiles,
      brands: [],
      categories: [],
    });
    expect(filtered.filteredBasis).toBe('item');
    expect(filtered.totalSales).toBe(700); // 200 + 500 (p-1 lines only)
    expect(filtered.topProducts[0]?.id).toBe('p-1');
  });

  it('applies retailer and salesman filters on the order header', () => {
    const bySalesman = computeSalesIntel({
      filters: { from: '2026-08-01', to: '2026-08-26', categoryId: null, brandId: null, productId: null, retailerId: null, salesmanId: 's-1' },
      orders,
      items,
      previousOrders,
      retailers,
      profiles,
      brands: [],
      categories: [],
    });
    expect(bySalesman.totalOrders).toBe(1);
    expect(bySalesman.topRetailers[0]?.id).toBe('r-1');
  });

  it('reports an honest empty state when nothing matches', () => {
    const empty = computeSalesIntel({
      filters: { from: '2026-08-01', to: '2026-08-26', categoryId: null, brandId: null, productId: 'nope', retailerId: null, salesmanId: null },
      orders,
      items,
      previousOrders,
      retailers,
      profiles,
      brands: [],
      categories: [],
    });
    expect(empty.status).toBe('empty');
    expect(empty.totalSales).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Retailer intelligence
// ---------------------------------------------------------------------------

describe('retailer intelligence', () => {
  const retailers = [
    retailer({ id: 'r-1' }),
    retailer({ id: 'r-2', status: 'active' as const }),
    retailer({ id: 'r-3', approved_at: '2026-08-15T00:00:00.000Z', created_at: '2026-08-15T00:00:00.000Z' }),
  ];

  it('classifies inactive/declining/increasing/new from real windows', () => {
    const intel = computeRetailerIntel({
      now: NOW,
      retailers,
      ordersRecent: [
        order({ id: 'a', retailer_id: 'r-1', grand_total: 1000, placed_at: '2026-08-20T09:00:00.000Z' }),
        order({ id: 'b', retailer_id: 'r-2', grand_total: 300, placed_at: '2026-08-20T09:00:00.000Z' }),
      ],
      ordersPrevious: [
        order({ id: 'c', retailer_id: 'r-1', grand_total: 600, placed_at: '2026-07-20T09:00:00.000Z' }),
        order({ id: 'd', retailer_id: 'r-2', grand_total: 1000, placed_at: '2026-07-20T09:00:00.000Z' }),
      ],
    });
    expect(intel.counts.inactive).toBe(1); // r-3 never ordered
    expect(intel.counts.declining).toBe(1); // r-2: 300 < 80% of 1000
    expect(intel.counts.increasing).toBe(1); // r-1: 1000 > 120% of 400
    expect(intel.counts.new30d).toBe(1); // r-3 approved in August
    const r1 = intel.rows.find((r) => r.retailerId === 'r-1');
    expect(r1?.tags).toContain('Increasing');
    expect(r1?.salesChangePct).toBe(66.7);
  });

  it('requires materiality before calling a trend (noise protection)', () => {
    const intel = computeRetailerIntel({
      now: NOW,
      retailers: [retailer({ id: 'r-1' })],
      ordersRecent: [order({ id: 'a', retailer_id: 'r-1', grand_total: 900, placed_at: '2026-08-20T09:00:00.000Z' })],
      ordersPrevious: [order({ id: 'b', retailer_id: 'r-1', grand_total: 100, placed_at: '2026-07-20T09:00:00.000Z' })],
    });
    // 100 → 900 is a real increase but the earlier window is below ₹500 materiality
    expect(intel.counts.increasing).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Salesman intelligence
// ---------------------------------------------------------------------------

describe('salesman intelligence', () => {
  it('aggregates collected orders, active retailers and visits', () => {
    const intel = computeSalesmanIntel({
      now: NOW,
      profiles: [profile({ id: 's-1' }), profile({ id: 's-2' })],
      ordersRecent: [
        order({ id: 'a', retailer_id: 'r-1', collected_by: 's-1', grand_total: 600, placed_at: '2026-08-20T09:00:00.000Z' }),
        order({ id: 'b', retailer_id: 'r-2', collected_by: 's-1', grand_total: 400, placed_at: '2026-08-21T09:00:00.000Z' }),
      ],
      ordersPrevious: [order({ id: 'c', retailer_id: 'r-1', collected_by: 's-1', grand_total: 500, placed_at: '2026-07-20T09:00:00.000Z' })],
      visits30d: [
        { id: 'v-1', salesman_id: 's-1', status: 'checked_out', created_at: '2026-08-20T09:00:00.000Z' },
        { id: 'v-2', salesman_id: 's-1', status: 'planned', created_at: '2026-08-20T09:00:00.000Z' },
      ],
    });
    expect(intel.rows[0]?.profileId).toBe('s-1');
    expect(intel.rows[0]?.sales30d).toBe(1000);
    expect(intel.rows[0]?.activeRetailers30d).toBe(2);
    expect(intel.rows[0]?.visits30d).toBe(1); // planned visits excluded
    expect(intel.rows[0]?.salesChangePct).toBe(100); // 1000 vs 500
    expect(intel.targetsAvailable).toBe(false); // no target data exists
  });

  it('is an honest empty state without salesmen', () => {
    const intel = computeSalesmanIntel({ now: NOW, profiles: [], ordersRecent: [], ordersPrevious: [], visits30d: [] });
    expect(intel.status).toBe('empty');
  });
});

// ---------------------------------------------------------------------------
// Supplier intelligence
// ---------------------------------------------------------------------------

describe('supplier intelligence', () => {
  const grns: RawGrn[] = [
    { id: 'g-1', grn_number: 'GRN-1', status: 'draft', supplier_reference: 'ACME', warehouse_name: 'WH', created_at: '2026-08-20T09:00:00.000Z', confirmed_at: null },
    { id: 'g-2', grn_number: 'GRN-2', status: 'confirmed', supplier_reference: 'ACME', warehouse_name: 'WH', created_at: '2026-08-01T09:00:00.000Z', confirmed_at: '2026-08-02T09:00:00.000Z' },
    { id: 'g-3', grn_number: 'GRN-3', status: 'confirmed', supplier_reference: 'ACME', warehouse_name: 'WH', created_at: '2026-08-20T09:00:00.000Z', confirmed_at: '2026-08-21T09:00:00.000Z' },
  ];
  const grnItems: RawGrnItem[] = [
    { grn_id: 'g-1', product_id: 'p-1', received_quantity: 10, unit_cost: 100, created_at: '2026-08-20T09:00:00.000Z', products: { name: 'A' } },
    { grn_id: 'g-2', product_id: 'p-1', received_quantity: 10, unit_cost: 100, created_at: '2026-08-01T09:00:00.000Z', products: { name: 'A' } },
    { grn_id: 'g-3', product_id: 'p-1', received_quantity: 10, unit_cost: 110, created_at: '2026-08-20T09:00:00.000Z', products: { name: 'A' } },
  ];

  it('detects supplier cost changes between successive confirmed receipts', () => {
    const intel = computeSupplierIntel({ now: NOW, grns90d: grns, grnItems, reorderForecasts: [] });
    expect(intel.pendingGrns).toHaveLength(1);
    expect(intel.pendingGrns[0]?.value).toBe(1000);
    expect(intel.confirmed30dCount).toBe(2);
    expect(intel.costChanges).toHaveLength(1);
    expect(intel.costChanges[0]?.changePct).toBe(10);
    expect(intel.suppliers[0]?.name).toBe('ACME');
    expect(intel.hasGrnData).toBe(true);
  });

  it('is an honest empty state without GRNs', () => {
    const intel = computeSupplierIntel({ now: NOW, grns90d: [], grnItems: [], reorderForecasts: [] });
    expect(intel.status).toBe('empty');
    expect(intel.hasGrnData).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Audit summaries & permissions
// ---------------------------------------------------------------------------

describe('audit event summarization', () => {
  it('produces curated summaries and never raw payloads', () => {
    const priceEvent = {
      id: 'a-1',
      table_name: 'price_lists',
      action: 'update',
      changed_by: 'u-1',
      created_at: `${TODAY}T09:00:00.000Z`,
      profiles: { full_name: 'Admin A' },
      old_data: { price: 100, phone: '9999999999' },
      new_data: { price: 120, phone: '9999999999' },
    };
    const summary = summarizeAuditEvent(priceEvent);
    expect(summary).toBe('price 100 → 120');
    expect(summary).not.toContain('9999999999'); // sensitive fields never surfaced

    const orderEvent = { ...priceEvent, table_name: 'orders', old_data: { status: 'pending' }, new_data: { status: 'confirmed' } };
    expect(summarizeAuditEvent(orderEvent)).toBe('status pending → confirmed');
  });

  it('truncates long values to keep cards bounded', () => {
    const long = summarizeAuditEvent({
      id: 'a-2',
      table_name: 'price_lists',
      action: 'update',
      changed_by: 'u-1',
      created_at: `${TODAY}T09:00:00.000Z`,
      profiles: null,
      old_data: null,
      new_data: { price: 'x'.repeat(200) },
    });
    expect(long.length).toBeLessThan(80);
  });
});

describe('command center permissions', () => {
  it('grants command_center.view to super_admin only', () => {
    expect(can('super_admin', 'command_center.view')).toBe(true);
    expect(can('admin', 'command_center.view')).toBe(false);
    expect(can('staff', 'command_center.view')).toBe(false);
    expect(can('salesman', 'command_center.view')).toBe(false);
    expect(can('retailer', 'command_center.view')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Sales filter validation (server-side input safety)
// ---------------------------------------------------------------------------

describe('sales filter validation', () => {
  it('rejects malformed dates, clamps past "to" and bounds the window to 90 days', () => {
    const now = new Date('2026-08-26T12:00:00');
    const bad = parseSalesIntelFilters({ from: 'not-a-date', to: '2026-01-01' }, now);
    expect(bad.error).toBeNull();
    // "to" in the past snaps to today; the 90-day cap then re-anchors "from".
    expect(bad.filters.to).toBe('2026-08-26');
    const days = (new Date(bad.filters.to + 'T00:00:00').getTime() - new Date(bad.filters.from + 'T00:00:00').getTime()) / 86_400_000;
    expect(days).toBeLessThanOrEqual(89);
    expect(days).toBeGreaterThanOrEqual(1);

    const clean = parseSalesIntelFilters({ from: '2026-08-01', to: '2026-08-26' }, now);
    expect(clean.filters.from).toBe('2026-08-01');
    expect(clean.filters.to).toBe('2026-08-26');
  });

  it('accepts only well-formed UUIDs for entity filters', () => {
    const now = new Date('2026-08-26T12:00:00');
    const parsed = parseSalesIntelFilters({ retailer: '123; DROP TABLE orders', salesman: '00000000-0000-4000-8000-000000000001' }, now);
    expect(parsed.filters.retailerId).toBeNull();
    expect(parsed.filters.salesmanId).toBe('00000000-0000-4000-8000-000000000001');
  });
});
