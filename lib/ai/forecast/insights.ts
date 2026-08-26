import 'server-only';

import type { ForecastSummary, ForecastResult } from '@/lib/ai/forecast/types';

/**
 * Data-backed business insights derived from the demand-forecast summary.
 *
 * Every insight carries a `trace` string describing exactly which real data
 * produced it, so nothing is presented as fact without a source. Pure and
 * side-effect free so it can be unit-tested and reused by the copilot and
 * the dashboard.
 */

export interface BusinessInsight {
  kind: 'demand_up' | 'demand_down' | 'stockout_risk' | 'reorder' | 'overstock' | 'dead_stock' | 'confidence' | 'insufficient';
  severity: 'critical' | 'warning' | 'info';
  title: string;
  detail: string;
  /** Traceable data basis. */
  trace: string;
  productId: string | null;
}

/** Rank forecasts by a bounded, data-derived urgency score. */
export function rankForecasts(forecasts: ForecastResult[]): ForecastResult[] {
  const score = (forecast: ForecastResult): number => {
    const risk = forecast.stockOutRisk === 'critical' ? 100 : forecast.stockOutRisk === 'high' ? 70 : forecast.stockOutRisk === 'medium' ? 40 : 0;
    const reorder = (forecast.reorderQuantity ?? 0) > 0 ? 30 : 0;
    const rising = forecast.demandDirection === 'rising' ? 10 : 0;
    const dead = forecast.deadStockWarning ? 20 : 0;
    return risk + reorder + rising + dead;
  };
  return [...forecasts].sort((a, b) => score(b) - score(a));
}

/** Produce human-readable, traceable insights from a forecast summary. */
export function generateForecastInsights(summary: ForecastSummary): BusinessInsight[] {
  const insights: BusinessInsight[] = [];
  const ranked = rankForecasts(summary.forecasts);

  for (const forecast of ranked.filter((f) => f.demandDirection === 'rising' && f.trendChangePercent >= 15).slice(0, 5)) {
    insights.push({
      kind: 'demand_up', severity: 'warning', productId: forecast.productId,
      title: `${forecast.productName} demand is rising`,
      detail: `Demand increased ~${forecast.trendChangePercent}%; ${forecast.demand7Day} unit(s) expected in the next 7 days.`,
      trace: `${forecast.dataBasis}; direction ${forecast.demandDirection}`,
    });
  }

  for (const forecast of ranked.filter((f) => f.demandDirection === 'falling' && f.trendChangePercent <= -15).slice(0, 5)) {
    insights.push({
      kind: 'demand_down', severity: 'info', productId: forecast.productId,
      title: `${forecast.productName} demand is falling`,
      detail: `Demand fell ~${Math.abs(forecast.trendChangePercent)}%; reorder conservatively.`,
      trace: `${forecast.dataBasis}; direction ${forecast.demandDirection}`,
    });
  }

  for (const forecast of ranked.filter((f) => f.stockOutRisk === 'critical' || f.stockOutRisk === 'high').slice(0, 8)) {
    insights.push({
      kind: 'stockout_risk', severity: 'critical', productId: forecast.productId,
      title: `${forecast.productName} may run out in ${forecast.stockOutDays ?? '—'} days`,
      detail: `Stock ${forecast.availableStock ?? '—'} vs ~${forecast.averageDailyRate} unit(s)/day; recommended reorder ${forecast.reorderQuantity ?? '—'}.`,
      trace: `${forecast.dataBasis}; cover ${forecast.stockOutDays ?? '?'} days; risk ${forecast.stockOutRisk}`,
    });
  }

  for (const forecast of ranked.filter((f) => (f.reorderQuantity ?? 0) > 0).slice(0, 8)) {
    insights.push({
      kind: 'reorder', severity: 'warning', productId: forecast.productId,
      title: `Reorder ${forecast.productName}`,
      detail: `Order ~${forecast.reorderQuantity} unit(s) to cover a ${forecast.reorderWindowDays ?? '?'} day window.`,
      trace: `${forecast.dataBasis}; reorder ${forecast.reorderQuantity}; window ${forecast.reorderWindowDays ?? '?'}d`,
    });
  }

  for (const forecast of ranked.filter((f) => f.overstockWarning).slice(0, 5)) {
    insights.push({
      kind: 'overstock', severity: 'info', productId: forecast.productId,
      title: `${forecast.productName} may be overstocked`,
      detail: `Current stock ${forecast.availableStock ?? '—'} exceeds demand-based target; days of cover ≈ ${forecast.overstockDaysOfCover ?? '—'}.`,
      trace: `${forecast.dataBasis}; overstock ${forecast.overstockDaysOfCover ?? '?'} days of cover`,
    });
  }

  for (const forecast of ranked.filter((f) => f.deadStockWarning).slice(0, 5)) {
    insights.push({
      kind: 'dead_stock', severity: 'info', productId: forecast.productId,
      title: `${forecast.productName} may be dead stock`,
      detail: `Stock ${forecast.availableStock ?? '—'} with weak recent demand; review before reordering.`,
      trace: `${forecast.dataBasis}; dead-stock signal`,
    });
  }

  return insights;
}

/** Concise natural-language narrative for the copilot. */
export function summaryNarrative(summary: ForecastSummary): string {
  const insights = generateForecastInsights(summary);
  const parts: string[] = [];
  if (summary.productsWithStockoutRisk > 0) parts.push(`🔴 ${summary.productsWithStockoutRisk} product(s) may run out of stock`);
  if (summary.productsNeedingReorder > 0) parts.push(`📦 ${summary.productsNeedingReorder} product(s) need a reorder`);
  if (summary.rising > 0) parts.push(`📈 ${summary.rising} product(s) show rising demand`);
  if (summary.falling > 0) parts.push(`📉 ${summary.falling} product(s) show falling demand`);
  if (summary.productsOverstocked > 0) parts.push(`💤 ${summary.productsOverstocked} product(s) may be overstocked`);
  if (summary.productsDeadStock > 0) parts.push(`🧟 ${summary.productsDeadStock} product(s) may be dead stock`);
  if (parts.length === 0) parts.push('No urgent inventory signals detected in this window');

  const confidence = Math.round(summary.averageConfidence * 100);
  let text = `Forecast over ${summary.windowDays} day(s): ${summary.productsForecast} product(s) analysed, average confidence ${confidence}%. ${parts.join('. ')}.`;
  if (insights.length > 0) {
    const top = insights.slice(0, 3).map((insight) => `${insight.title} (${insight.detail})`).join(' ');
    text += ` Top signals: ${top}`;
  }
  return text;
}
