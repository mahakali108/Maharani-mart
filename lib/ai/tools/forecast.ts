import 'server-only';

import { z } from 'zod';
import type { AICard, AIToolContext, AIToolDefinition, AIToolResult } from '@/lib/ai/types';
import { runForecastPipeline } from '@/lib/ai/forecast/index';
import { generateForecastInsights, summaryNarrative } from '@/lib/ai/forecast/insights';
import type { ForecastResult, ForecastSummary } from '@/lib/ai/forecast/types';
import { unavailable, verified } from '@/lib/ai/tools/helpers';

/**
 * Demand-forecasting business tools.
 *
 * These are READ-only and RLS-gated to staff/admin. They run the explainable
 * statistical engine (lib/ai/forecast) against REAL authorized order and
 * inventory data and convert the results into structured cards for the AI
 * copilot. They never write to the database and never expose warehouse/cost
 * details to non-authorized roles (the tool is simply not registered for
 * retailer/salesman surfaces).
 */

const roles = ['staff', 'admin', 'super_admin'] as const;
const surfaces = ['staff', 'admin'] as const;

const forecastSchema = z.object({
  days: z.number().int().min(14).max(365).optional(),
  limit: z.number().int().min(1).max(50).optional(),
  productIds: z.array(z.string().uuid()).max(50).optional(),
});
const forecastJson = {
  type: 'object',
  additionalProperties: false,
  properties: {
    days: { type: 'integer', minimum: 14, maximum: 365 },
    limit: { type: 'integer', minimum: 1, maximum: 50 },
    productIds: { type: 'array', items: { type: 'string', format: 'uuid' }, maxItems: 50 },
  },
};

function riskTone(risk: string): string {
  if (risk === 'critical') return 'bg-red-600 text-white';
  if (risk === 'high') return 'bg-red-100 text-red-700';
  if (risk === 'medium') return 'bg-amber-100 text-amber-700';
  if (risk === 'low') return 'bg-blue-100 text-blue-700';
  return 'bg-emerald-100 text-emerald-700';
}

function confidenceTone(confidence: string): string {
  if (confidence === 'High') return 'bg-emerald-100 text-emerald-700';
  if (confidence === 'Medium') return 'bg-amber-100 text-amber-700';
  if (confidence === 'Low') return 'bg-orange-100 text-orange-700';
  return 'bg-slate-100 text-slate-600';
}

/** Turn one explained forecast into an AI card for the copilot. */
export function forecastCard(forecast: ForecastResult): AICard {
  const metrics = [
    { label: 'Now', value: forecast.availableStock === null ? 'No stock' : `${forecast.availableStock}`, quality: forecast.availableStock === null ? ('unavailable' as const) : ('verified' as const) },
    { label: '7-day demand', value: `${forecast.demand7Day}`, quality: forecast.dataQuality === 'real' ? ('verified' as const) : ('estimate' as const) },
    { label: '30-day demand', value: `${forecast.demand30Day}`, quality: forecast.dataQuality === 'real' ? ('verified' as const) : ('estimate' as const) },
    { label: 'Confidence', value: forecast.confidenceLabel, quality: forecast.confidence >= 0.7 ? ('verified' as const) : ('estimate' as const) },
  ];
  if (forecast.stockOutDays !== null) {
    metrics.push({ label: 'Stock-out', value: `${forecast.stockOutDays} days`, quality: ('estimate' as const) });
  }
  if (forecast.reorderQuantity !== null) {
    metrics.push({ label: 'Reorder', value: `${forecast.reorderQuantity}`, quality: ('estimate' as const) });
  }
  const badges: string[] = [];
  if (forecast.stockOutRisk !== 'none') badges.push(`stock-out: ${forecast.stockOutRisk}`);
  if (forecast.overstockWarning) badges.push('overstock');
  if (forecast.deadStockWarning) badges.push('dead stock');
  if (badges.length === 0) badges.push(`trend: ${forecast.demandDirection}`);

  return {
    type: 'insight',
    id: forecast.productId,
    title: forecast.productName,
    subtitle: forecast.skuCode,
    badge: badges.slice(0, 2).join(' · '),
    quality: forecast.dataQuality === 'real' ? 'verified' : 'estimate',
    source: forecast.dataBasis,
    metrics,
    lines: [
      { label: 'Explanation', value: forecast.method, detail: forecast.explanation },
      { label: 'Direction', value: forecast.demandDirection },
      { label: 'Trend', value: `${forecast.trendChangePercent}%` },
      { label: 'Period', value: `${forecast.periodStart} → ${forecast.periodEnd}` },
      { label: 'Avg daily', value: `${forecast.averageDailyRate}` },
      { label: 'Reorder window', value: forecast.reorderWindowDays === null ? '—' : `${forecast.reorderWindowDays} days` },
    ],
  };
}

/** Produce a concise, explainable text summary from a forecast summary. */
export function forecastNarrative(summary: ForecastSummary): string {
  return summaryNarrative(summary);
}

async function demandForecast(input: z.infer<typeof forecastSchema>, context: AIToolContext): Promise<AIToolResult> {
  try {
    const { summary } = await runForecastPipeline(context.supabase, {
      productIds: input.productIds,
      days: input.days,
      limit: input.limit,
    });
    const insights = generateForecastInsights(summary);
    const insightCards: AICard[] = insights.slice(0, 5).map((insight) => ({
      type: 'insight',
      id: insight.productId ?? undefined,
      title: insight.title,
      subtitle: insight.detail,
      badge: insight.kind.replaceAll('_', ' '),
      quality: 'estimate',
      source: insight.trace,
    }));
    const cards: AICard[] = [
      ...insightCards,
      ...summary.forecasts.slice(0, input.limit ?? 20).map(forecastCard),
    ];
    const data = {
      windowDays: summary.windowDays,
      productsForecast: summary.productsForecast,
      productsWithInsufficientData: summary.productsWithInsufficientData,
      productsWithStockoutRisk: summary.productsWithStockoutRisk,
      productsNeedingReorder: summary.productsNeedingReorder,
      productsOverstocked: summary.productsOverstocked,
      productsDeadStock: summary.productsDeadStock,
      rising: summary.rising,
      falling: summary.falling,
      stable: summary.stable,
      averageConfidence: summary.averageConfidence,
      totalUnitsOutflow: summary.totalUnitsOutflow,
      forecasts: summary.forecasts.slice(0, input.limit ?? 20).map((forecast) => ({
        productId: forecast.productId,
        productName: forecast.productName,
        skuCode: forecast.skuCode,
        dataQuality: forecast.dataQuality,
        averageDailyRate: forecast.averageDailyRate,
        demand7Day: forecast.demand7Day,
        demand30Day: forecast.demand30Day,
        demandDirection: forecast.demandDirection,
        trendChangePercent: forecast.trendChangePercent,
        confidence: forecast.confidence,
        confidenceLabel: forecast.confidenceLabel,
        availableStock: forecast.availableStock,
        stockOutDays: forecast.stockOutDays,
        stockOutDate: forecast.stockOutDate,
        stockOutRisk: forecast.stockOutRisk,
        reorderQuantity: forecast.reorderQuantity,
        reorderWindowDays: forecast.reorderWindowDays,
        overstockWarning: forecast.overstockWarning,
        deadStockWarning: forecast.deadStockWarning,
        explanation: forecast.explanation,
        method: forecast.method,
      })),
    };
    if (cards.length === 0) {
      return unavailable('No eligible products were found. Add authorized products and order history first.');
    }
    return verified(data, cards, `${summary.forecasts.length} product forecast(s) from ${summary.windowDays} day(s) of real order data`);
  } catch {
    return unavailable('The demand forecast could not be computed. Check that the analytics view is applied and there is authorized order data.');
  }
}

async function reorderRecommendations(input: { days?: number; limit?: number }, context: AIToolContext): Promise<AIToolResult> {
  try {
    const { summary } = await runForecastPipeline(context.supabase, { days: input.days, limit: input.limit });
    const reorder = summary.forecasts
      .filter((forecast) => (forecast.reorderQuantity ?? 0) > 0 && forecast.dataQuality !== 'insufficient')
      .slice(0, input.limit ?? 15);
    if (reorder.length === 0) {
      return verified({ recommendations: [], prediction: true }, [{ type: 'notice', title: 'No reorder needed', subtitle: 'No authorized product currently needs a demand-based reorder. Configured stock thresholds remain authoritative for immediate action.', quality: 'verified' }]);
    }
    const cards: AICard[] = reorder.map((forecast) => ({
      type: 'insight',
      id: forecast.productId,
      title: forecast.productName,
      subtitle: forecast.skuCode,
      badge: forecast.stockOutRisk === 'critical' ? 'Reorder now' : forecast.stockOutRisk,
      quality: 'estimate',
      source: forecast.dataBasis,
      metrics: [
        { label: 'Reorder', value: `${forecast.reorderQuantity}`, quality: 'estimate' },
        { label: 'Stock', value: `${forecast.availableStock}`, quality: 'verified' },
        { label: '7-day', value: `${forecast.demand7Day}`, quality: 'estimate' },
        { label: 'Confidence', value: forecast.confidenceLabel, quality: forecast.confidence >= 0.7 ? 'verified' : 'estimate' },
      ],
      lines: [{ label: 'Why', value: forecast.explanation, detail: forecast.method }],
      actions: [{ type: 'link', label: 'Open product', href: `/admin/inventory/products?product=${forecast.productId}` }],
    }));
    return verified({ recommendations: reorder.map((forecast) => ({ productId: forecast.productId, productName: forecast.productName, skuCode: forecast.skuCode, availableStock: forecast.availableStock, demand7Day: forecast.demand7Day, reorderQuantity: forecast.reorderQuantity, stockOutDays: forecast.stockOutDays, confidenceLabel: forecast.confidenceLabel, explanation: forecast.explanation })), prediction: true }, cards, `Demand-based reorder recommendations over ${summary.windowDays} day(s) of real order data`);
  } catch {
    return unavailable('The reorder recommendation could not be computed.');
  }
}

async function inventoryRisk(context: AIToolContext): Promise<AIToolResult> {
  try {
    const { summary } = await runForecastPipeline(context.supabase, { limit: 40 });
    const stockout = summary.forecasts.filter((forecast) => forecast.stockOutRisk === 'critical' || forecast.stockOutRisk === 'high');
    const overstock = summary.forecasts.filter((forecast) => forecast.overstockWarning);
    const dead = summary.forecasts.filter((forecast) => forecast.deadStockWarning);

    // Expiry risk from the authorized FEFO expiry view.
    type ExpiryRiskRow = { product_id: string; product_name: string; available_quantity: number; days_remaining: number | null; expiry_status: string };
    const { data: expiry, error: expiryError } = await context.supabase
      .from('inventory_expiry_report')
      .select('product_id, product_name, available_quantity, days_remaining, expiry_status')
      .in('expiry_status', ['critical', 'expired'])
      .order('days_remaining', { ascending: true })
      .limit(15)
      .returns<ExpiryRiskRow[]>();
    const expiryRisk = expiryError
      ? []
      : (expiry ?? []).map((row) => ({ productId: row.product_id, productName: row.product_name, availableQuantity: row.available_quantity, daysRemaining: row.days_remaining, status: row.expiry_status }));

    const cards: AICard[] = [];
    if (stockout.length > 0) {
      cards.push({ type: 'notice', title: '🔴 Stock-out risk', subtitle: `${stockout.length} product(s) may run out within the forecast horizon.`, quality: 'estimate', source: 'Authorized demand forecast + inventory view' });
      for (const forecast of stockout.slice(0, 6)) {
        cards.push(forecastCard({ ...forecast, stockOutRisk: 'critical' }));
      }
    }
    if (overstock.length > 0) {
      cards.push({ type: 'notice', title: '🟣 Overstock / slow-moving', subtitle: `${overstock.length} product(s) hold excess stock relative to demand.`, quality: 'estimate', source: 'Authorized demand forecast + inventory view' });
      for (const forecast of overstock.slice(0, 4)) {
        cards.push({ ...forecastCard(forecast), badge: 'overstock' });
      }
    }
    if (dead.length > 0) {
      cards.push({ type: 'notice', title: '🧟 Dead-stock risk', subtitle: `${dead.length} product(s) have stock but little or no recent demand.`, quality: 'estimate', source: 'Authorized demand forecast + inventory view' });
      for (const forecast of dead.slice(0, 4)) {
        cards.push({ ...forecastCard(forecast), badge: 'dead stock' });
      }
    }
    if (expiryRisk.length > 0) {
      cards.push({ type: 'notice', title: '⚠️ Expiry risk', subtitle: `${expiryRisk.length} batch(es) are expiring or expired.`, quality: 'verified', source: 'Authorized FEFO batch expiry report' });
      for (const row of expiryRisk.slice(0, 5)) {
        cards.push({ type: 'inventory', title: row.productName, badge: row.status, quality: 'verified', source: 'inventory_expiry_report', metrics: [{ label: 'Available', value: String(row.availableQuantity), quality: 'verified' }, { label: 'Days left', value: row.daysRemaining === null ? '—' : String(row.daysRemaining), quality: 'verified' }] });
      }
    }
    if (cards.length === 0) {
      return verified({ stockoutRisk: [], overstockRisk: [], deadStockRisk: [], expiryRisk: [] }, [{ type: 'notice', title: 'Inventory looks healthy', subtitle: 'No critical stock-out, overstock, dead-stock or expiry signals were detected in the authorized data.', quality: 'verified' }]);
    }
    return verified({ stockoutRisk: stockout.map((forecast) => forecast.productName), overstockRisk: overstock.map((forecast) => forecast.productName), deadStockRisk: dead.map((forecast) => forecast.productName), expiryRisk: expiryRisk.map((row) => row.productName) }, cards, 'Authorized demand forecast + inventory/batch views');
  } catch {
    return unavailable('The inventory risk report could not be computed.');
  }
}

export const forecastTools: AIToolDefinition[] = [
  {
    name: 'get_demand_forecast',
    description: 'Get an explainable demand forecast for authorized products from real order history, with 7/30-day estimates, stock-out risk and reorder quantity. Estimates are labelled.',
    actionClass: 'READ',
    roles: [...roles],
    surfaces: [...surfaces],
    inputSchema: forecastSchema,
    inputJsonSchema: forecastJson,
    execute: demandForecast,
  },
  {
    name: 'get_reorder_recommendation',
    description: 'Get demand-based reorder recommendations for authorized low-stock products. Recommends quantity; never creates a purchase order.',
    actionClass: 'READ',
    roles: [...roles],
    surfaces: [...surfaces],
    inputSchema: z.object({ days: z.number().int().min(14).max(365).optional(), limit: z.number().int().min(1).max(30).optional() }),
    inputJsonSchema: { type: 'object', additionalProperties: false, properties: { days: { type: 'integer', minimum: 14, maximum: 365 }, limit: { type: 'integer', minimum: 1, maximum: 30 } } },
    execute: reorderRecommendations,
  },
  {
    name: 'get_inventory_risk',
    description: 'Get the current authorized inventory risk picture: stock-out, overstock, dead-stock and expiry risk from real data.',
    actionClass: 'READ',
    roles: [...roles],
    surfaces: [...surfaces],
    inputSchema: z.object({}),
    inputJsonSchema: { type: 'object', additionalProperties: false },
    execute: inventoryRisk,
  },
];

export { riskTone, confidenceTone };
