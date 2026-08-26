import 'server-only';

import type { createClient } from '@/lib/supabase/server';
import {
  DEFAULT_FORECAST_PARAMS,
  forecastProduct,
  summarizeForecasts,
} from '@/lib/ai/forecast/engine';
import { collectForecastInputs } from '@/lib/ai/forecast/data';
import type { ForecastParams, ForecastResult, ForecastSummary } from '@/lib/ai/forecast/types';

export * from '@/lib/ai/forecast/engine';
export * from '@/lib/ai/forecast/types';

export interface ForecastPipelineResult {
  summary: ForecastSummary;
  byProductId: Map<string, ForecastResult>;
}

/**
 * End-to-end, read-only forecast pipeline.
 *
 * 1. Reads authorized order/inventory data through the caller's RLS client.
 * 2. Runs the explainable statistical engine per product.
 * 3. Returns per-product results plus an aggregate summary.
 *
 * It never writes business data. If the AI later wants to persist a snapshot
 * it may do so through an explicit, permission-checked server action.
 */
export async function runForecastPipeline(
  supabase: ReturnType<typeof createClient>,
  options: {
    productIds?: string[];
    days?: number;
    limit?: number;
    params?: Partial<ForecastParams>;
  } = {}
): Promise<ForecastPipelineResult> {
  const params = { ...DEFAULT_FORECAST_PARAMS, ...(options.params ?? {}) };
  const days = options.days ?? params.windowDays;
  const { series, stock } = await collectForecastInputs(supabase, {
    productIds: options.productIds,
    days,
    params,
    limit: options.limit,
  });

  const now = new Date();
  const forecasts = series.map((item) =>
    forecastProduct({
      series: item,
      stock: stock.get(item.productId) ?? null,
      params,
      today: now,
    })
  );

  // Rank: products that need attention (stock-out / reorder) first.
  forecasts.sort((a, b) => {
    const aScore = (a.stockOutRisk === 'critical' ? 100 : a.stockOutRisk === 'high' ? 70 : a.stockOutRisk === 'medium' ? 40 : a.stockOutRisk === 'low' ? 20 : 0) + ((a.reorderQuantity ?? 0) > 0 ? 30 : 0);
    const bScore = (b.stockOutRisk === 'critical' ? 100 : b.stockOutRisk === 'high' ? 70 : b.stockOutRisk === 'medium' ? 40 : b.stockOutRisk === 'low' ? 20 : 0) + ((b.reorderQuantity ?? 0) > 0 ? 30 : 0);
    return bScore - aScore;
  });

  const summary = summarizeForecasts(forecasts, days, now.toISOString());
  const byProductId = new Map(forecasts.map((forecast) => [forecast.productId, forecast]));
  return { summary, byProductId };
}
