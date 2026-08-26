import { describe, expect, it } from 'vitest';
import {
  classifyDirection,
  classifyStockoutRisk,
  confidenceToLabel,
  computeSeasonality,
  exponentialSmoothing,
  forecastProduct,
  holtLinear,
  linearRegression,
  mean,
  simpleMovingAverage,
  stdDev,
  summarizeForecasts,
  weightedMovingAverage,
} from '@/lib/ai/forecast/engine';
import type { DemandTimeSeries, ForecastParams, StockSnapshot } from '@/lib/ai/forecast/types';

const DAY = 86_400_000;
const TODAY = new Date('2025-06-15T00:00:00.000Z');

function iso(daysAgo: number): string {
  return new Date(TODAY.getTime() - daysAgo * DAY).toISOString().slice(0, 10);
}

function makeSeries(daily: number[], productId = 'p1', sku = 'SKU-1', name = 'Cooking Oil 1L'): DemandTimeSeries {
  const points = daily.map((quantity, index) => ({ date: iso(daily.length - 1 - index), quantity }));
  return {
    productId,
    productName: name,
    skuCode: sku,
    unit: 'pack',
    periodStart: iso(daily.length - 1),
    periodEnd: iso(0),
    daily: points,
    daysOfHistory: daily.length,
    activeDays: daily.length,
    totalUnits: daily.reduce((acc, q) => acc + q, 0),
    orderCount: daily.length,
    cancellationUnits: 0,
    returnUnits: 0,
  };
}

const PARAMS: ForecastParams = {
  windowDays: 60,
  minHistoryDays: 14,
  minActiveDays: 7,
  idealHistoryDays: 60,
  overstockCoverDays: 60,
  deadStockDays: 21,
  safetyDays: 7,
};

function stockSnapshot(overrides: Partial<StockSnapshot> = {}): StockSnapshot {
  return {
    productId: 'p1',
    availableQuantity: 180,
    reservedQuantity: 10,
    quantityOnHand: 190,
    reorderLevel: 40,
    maxStock: 300,
    minStock: 20,
    leadTimeDays: 2,
    stockStatus: 'healthy',
    ...overrides,
  };
}

describe('forecast statistical primitives', () => {
  it('computes mean, std dev, moving and weighted averages', () => {
    expect(mean([2, 4, 6])).toBe(4);
    expect(stdDev([2, 4, 6])).toBeCloseTo(1.633, 2);
    expect(simpleMovingAverage([1, 2, 3, 4, 5], 3)).toBe(4);
    expect(weightedMovingAverage([10, 20], [1, 3])).toBe(17.5);
  });

  it('smooths with exponential smoothing and Holt linear (level + trend)', () => {
    expect(exponentialSmoothing([10, 20, 30], 0.5)).toBeCloseTo(22.5, 2);
    const holt = holtLinear([10, 12, 14, 16], 0.5, 0.3);
    expect(holt.level).toBeGreaterThan(10);
    expect(holt.trend).toBeGreaterThan(0);
  });

  it('fits a least-squares slope for an increasing series', () => {
    const { slope, intercept } = linearRegression([5, 10, 15, 20]);
    expect(slope).toBe(5);
    expect(intercept).toBe(5);
  });

  it('detects day-of-week seasonality only with a strong pattern and enough data', () => {
    const base = Array.from({ length: 63 }, (_, i) => 10);
    // 63 days from today: make Sundays (the day 7 back from diff) spike.
    const daily = base.map((q, index) => {
      const date = new Date(TODAY.getTime() - (base.length - 1 - index) * DAY);
      return { date: date.toISOString().slice(0, 10), quantity: date.getUTCDay() === 0 ? 25 : q };
    });
    const result = computeSeasonality(daily);
    expect(result.detected).toBe(true);
    // A flat sub-threshold series should not detect seasonality.
    const flat = makeSeries(Array.from({ length: 20 }, () => 5));
    expect(computeSeasonality(flat.daily).detected).toBe(false);
  });
});

describe('demand direction classification', () => {
  it('classifies rising, stable and falling', () => {
    expect(classifyDirection(18)).toBe('rising');
    expect(classifyDirection(-18)).toBe('falling');
    expect(classifyDirection(2)).toBe('stable');
    expect(classifyDirection(-2)).toBe('stable');
  });

  it('classifies stock-out risk from days of cover', () => {
    expect(classifyStockoutRisk(1, 2)).toBe('critical');
    expect(classifyStockoutRisk(5, 2)).toBe('high');
    expect(classifyStockoutRisk(10, 2)).toBe('medium');
    expect(classifyStockoutRisk(20, 2)).toBe('low');
    expect(classifyStockoutRisk(45, 2)).toBe('none');
    expect(classifyStockoutRisk(null, 2)).toBe('none');
  });
});

describe('forecastProduct behaviour', () => {
  it('reports rising demand with a bounded 7/30-day estimate', () => {
    const series = makeSeries(Array.from({ length: 60 }, (_, index) => 10 + Math.floor(index / 10)));
    const result = forecastProduct({ series, stock: stockSnapshot(), params: PARAMS, today: TODAY });
    expect(result.dataQuality).toBe('real');
    expect(result.demandDirection).toBe('rising');
    expect(result.trendChangePercent).toBeGreaterThan(5);
    expect(result.demand7Day).toBeGreaterThan(70);
    expect(result.demand30Day).toBeGreaterThan(result.demand7Day);
    expect(result.confidence).toBeGreaterThan(0.4);
    expect(result.explanation).toMatch(/increased|estim/);
  });

  it('reports falling demand', () => {
    const series = makeSeries(Array.from({ length: 60 }, (_, index) => 30 - Math.floor(index / 8)));
    const result = forecastProduct({ series, stock: stockSnapshot(), params: PARAMS, today: TODAY });
    expect(result.dataQuality).toBe('real');
    expect(result.demandDirection).toBe('falling');
    expect(result.trendChangePercent).toBeLessThan(-5);
  });

  it('reports stable demand for a flat series', () => {
    const series = makeSeries(Array.from({ length: 60 }, () => 10));
    const result = forecastProduct({ series, stock: stockSnapshot(), params: PARAMS, today: TODAY });
    expect(result.demandDirection).toBe('stable');
    expect(result.demand7Day).toBe(70);
    expect(result.demand30Day).toBe(300);
  });

  it('predicts a stock-out date and a positive reorder quantity when stock is tight', () => {
    const series = makeSeries(Array.from({ length: 60 }, () => 20));
    const result = forecastProduct({ series, stock: stockSnapshot({ availableQuantity: 100 }), params: PARAMS, today: TODAY });
    // 100 units / 20 per day = 5 days of cover -> high risk.
    expect(result.stockOutDays).toBe(5);
    expect(result.stockOutDate).not.toBeNull();
    expect(result.stockOutRisk).toBe('high');
    expect(result.reorderQuantity).toBeGreaterThan(0);
  });

  it('uses a conservative fallback with insufficient history instead of inventing demand', () => {
    const series = makeSeries([5, 8, 6]); // only 3 active days
    const result = forecastProduct({ series, stock: stockSnapshot(), params: PARAMS, today: TODAY });
    expect(result.dataQuality).toBe('estimate');
    expect(result.confidenceLabel).toBe('Low');
    expect(result.demand30Day).toBeGreaterThanOrEqual(0);
    expect(result.explanation).toMatch(/limited data/i);
  });

  it('reports insufficient data and zero demand for a product with no sales history', () => {
    const series = makeSeries([], 'p2', 'SKU-2', 'New Product');
    const result = forecastProduct({ series, stock: stockSnapshot(), params: PARAMS, today: TODAY });
    expect(result.dataQuality).toBe('insufficient');
    expect(result.confidenceLabel).toBe('Insufficient');
    expect(result.demand7Day).toBe(0);
    expect(result.demand30Day).toBe(0);
  });

  it('flags overstocking when cover exceeds the threshold or max stock', () => {
    const series = makeSeries(Array.from({ length: 60 }, () => 2));
    const result = forecastProduct({ series, stock: stockSnapshot({ availableQuantity: 400, maxStock: 300 }), params: PARAMS, today: TODAY });
    expect(result.overstockWarning).toBe(true);
    expect(result.overstockDaysOfCover).toBeGreaterThan(60);
  });

  it('flags dead stock for slow-moving product with no recent sale', () => {
    // Sales only in the earlier part of the window; nothing in the last ~30 days.
    const daily = Array.from({ length: 60 }, (_, index) => {
      const date = iso(59 - index);
      return { date, quantity: date.localeCompare(iso(30)) < 0 ? 10 : 0 };
    });
    const series: DemandTimeSeries = {
      productId: 'p3', productName: 'Old Stock', skuCode: 'SKU-3', unit: 'pack',
      periodStart: iso(59), periodEnd: iso(0), daily, daysOfHistory: 60, activeDays: 29,
      totalUnits: 290, orderCount: 29, cancellationUnits: 0, returnUnits: 0,
    };
    const result = forecastProduct({ series, stock: stockSnapshot({ availableQuantity: 50 }), params: PARAMS, today: TODAY });
    expect(result.deadStockWarning).toBe(true);
    expect(result.demandDirection).toBe('falling');
  });

  it('labels confidence by score and data quality', () => {
    expect(confidenceToLabel(0.9, 'real')).toBe('High');
    expect(confidenceToLabel(0.5, 'real')).toBe('Medium');
    expect(confidenceToLabel(0.2, 'real')).toBe('Low');
    expect(confidenceToLabel(0.2, 'insufficient')).toBe('Insufficient');
  });

  it('summarizes a set of forecasts', () => {
    const series = makeSeries(Array.from({ length: 60 }, () => 10));
    const risingSeries = makeSeries(Array.from({ length: 60 }, (_, index) => 5 + Math.floor(index / 10)), 'p2', 'SKU-B', 'B');
    const forecasts = [
      forecastProduct({ series, stock: stockSnapshot(), params: PARAMS, today: TODAY }),
      forecastProduct({ series: risingSeries, stock: stockSnapshot(), params: PARAMS, today: TODAY }),
    ];
    const summary = summarizeForecasts(forecasts, PARAMS.windowDays);
    expect(summary.productsForecast).toBe(2);
    expect(summary.rising).toBeGreaterThanOrEqual(1);
    expect(summary.averageConfidence).toBeGreaterThan(0);
  });
});

describe('forecast insights generation', () => {
  it('generates traceable reorder and stock-out insights without inventing facts', async () => {
    const { generateForecastInsights, rankForecasts } = await import('@/lib/ai/forecast/insights');
    const series = makeSeries(Array.from({ length: 60 }, () => 20));
    const result = forecastProduct({ series, stock: stockSnapshot({ availableQuantity: 100 }), params: PARAMS, today: TODAY });
    const all = [result, forecastProduct({ series: makeSeries(Array.from({ length: 60 }, () => 2)), stock: stockSnapshot(), params: PARAMS, today: TODAY })];
    const summary = { generatedAt: 'x', windowDays: 60, productsForecast: 2, productsWithInsufficientData: 0, productsWithStockoutRisk: 1, productsNeedingReorder: 1, productsOverstocked: 0, productsDeadStock: 0, rising: 0, falling: 0, stable: 2, averageConfidence: 0.6, totalUnitsOutflow: 1320, forecasts: all };
    const insights = generateForecastInsights(summary);
    expect(insights.some((i) => i.kind === 'stockout_risk')).toBe(true);
    expect(insights.length).toBeGreaterThan(0);
    for (const insight of insights) {
      expect(insight.trace.length).toBeGreaterThan(0);
      expect(insight.title).not.toMatch(/fake|demo/i);
    }
  });
});
