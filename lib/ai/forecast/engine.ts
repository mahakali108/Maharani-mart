import 'server-only';

import type {
  ConfidenceLabel,
  DailyDemandPoint,
  DemandDirection,
  DemandTimeSeries,
  ForecastParams,
  ForecastResult,
  ForecastSummary,
  StockSnapshot,
  StockoutRisk,
} from '@/lib/ai/forecast/types';

/**
 * Pure, explainable demand-forecasting engine.
 *
 * This module has NO side effects and NO database access. It is the single
 * place where the statistical methodology lives, so it can be unit-tested in
 * isolation and later swapped for an ML layer behind the same interface
 * (see ForecastPipeline in index.ts).
 *
 * Methodology (documented in docs/ai-intelligence.md):
 *   - recent-demand weighting (weighted moving average / Holt's linear
 *     exponential smoothing) for the daily rate;
 *   - simple linear trend via least-squares to classify direction;
 *   - day-of-week seasonality factors when the sample supports them;
 *   - a bounded confidence score derived from coverage, activity and
 *     stability;
 *   - a conservative fallback when history is insufficient, never a
 *     fabricated prediction.
 */

const DAY_MS = 86_400_000;
const DOW_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/** Convert a YYYY-MM-DD string to a UTC Date (keeps day arithmetic deterministic). */
function parseDate(value: string): Date {
  const [y, m, d] = value.split('-').map(Number);
  return new Date(Date.UTC(y ?? 1970, (m ?? 1) - 1, d ?? 1));
}

function toIso(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * DAY_MS);
}

/** Average of an array (empty -> 0). */
export function mean(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

export function sum(values: number[]): number {
  return values.reduce((acc, value) => acc + value, 0);
}

/** Population standard deviation (empty -> 0). */
export function stdDev(values: number[]): number {
  if (values.length < 2) return 0;
  const avg = mean(values);
  const variance = values.reduce((acc, value) => acc + (value - avg) ** 2, 0) / values.length;
  return Math.sqrt(variance);
}

/** Simple moving average of the last `window` values. */
export function simpleMovingAverage(values: number[], window: number): number {
  if (values.length === 0) return 0;
  const slice = values.slice(Math.max(0, values.length - window));
  return mean(slice);
}

/**
 * Weighted moving average. Later weights are larger; weights must have the
 * same length as `values`. If weights are shorter, they are applied to the
 * most recent weight.length values.
 */
export function weightedMovingAverage(values: number[], rawWeights: number[]): number {
  if (values.length === 0) return 0;
  const weights = rawWeights.slice(0, values.length);
  if (weights.length === 0) return simpleMovingAverage(values, values.length);
  const start = values.length - weights.length;
  let weightedSum = 0;
  let weightTotal = 0;
  for (let index = 0; index < weights.length; index += 1) {
    const value = values[start + index] ?? 0;
    const weight = Math.max(0, weights[index] ?? 0);
    weightedSum += value * weight;
    weightTotal += weight;
  }
  return weightTotal > 0 ? weightedSum / weightTotal : simpleMovingAverage(values, values.length);
}

/** Simple exponential smoothing. Returns the last smoothed level. */
export function exponentialSmoothing(values: number[], alpha: number): number {
  if (values.length === 0) return 0;
  let level = values[0] ?? 0;
  for (let index = 1; index < values.length; index += 1) {
    level = alpha * (values[index] ?? 0) + (1 - alpha) * level;
  }
  return level;
}

export interface HoltResult {
  level: number;
  trend: number;
}

/**
 * Holt's linear (double) exponential smoothing. Produces a smoothed level and
 * a per-step trend so short-horizon projections blend level and direction.
 */
export function holtLinear(values: number[], alpha = 0.4, beta = 0.3): HoltResult {
  if (values.length === 0) return { level: 0, trend: 0 };
  let level = values[0] ?? 0;
  let trend = (values[1] ?? values[0] ?? 0) - (values[0] ?? 0);
  for (let index = 1; index < values.length; index += 1) {
    const previousLevel = level;
    const value = values[index] ?? 0;
    level = alpha * value + (1 - alpha) * (previousLevel + trend);
    trend = beta * (level - previousLevel) + (1 - beta) * trend;
  }
  return { level, trend };
}

/** Linear least-squares slope (per unit x) and intercept. */
export function linearRegression(values: number[]): { slope: number; intercept: number } {
  if (values.length < 2) return { slope: 0, intercept: values[0] ?? 0 };
  const n = values.length;
  const xs = values.map((_, index) => index);
  const meanX = mean(xs);
  const meanY = mean(values);
  let numerator = 0;
  let denominator = 0;
  for (let index = 0; index < n; index += 1) {
    const dx = xs[index]! - meanX;
    const dy = (values[index] ?? 0) - meanY;
    numerator += dx * dy;
    denominator += dx * dx;
  }
  const slope = denominator === 0 ? 0 : numerator / denominator;
  return { slope, intercept: meanY - slope * meanX };
}

/** Co-efficient of variation for stability scoring. */
export function coefficientOfVariation(values: number[]): number {
  const avg = mean(values);
  if (avg <= 0) return 1;
  return stdDev(values) / avg;
}

export interface SeasonalityResult {
  factors: number[];
  detected: boolean;
}

/**
 * Day-of-week seasonality. For each weekday, factor = (avg sales on that day)
 * / (avg sales overall). Factors hover around 1; strong deviations (>= 1.35
 * or <= 0.65) with a minimum count on each weekday indicate a real pattern.
 */
export function computeSeasonality(daily: DailyDemandPoint[], minPerWeekday = 3): SeasonalityResult {
  const factors = Array.from({ length: 7 }, () => 1);
  if (daily.length < 7 * minPerWeekday) return { factors, detected: false };

  const totals: number[] = Array.from({ length: 7 }, () => 0);
  const counts: number[] = Array.from({ length: 7 }, () => 0);
  const overallTotal: Record<string, number> = {};

  for (const point of daily) {
    const day = parseDate(point.date);
    const dow = day.getUTCDay();
    totals[dow] = (totals[dow] ?? 0) + point.quantity;
    counts[dow] = (counts[dow] ?? 0) + 1;
    overallTotal[point.date] = point.quantity;
  }

  const totalUnits = sum(Object.values(overallTotal));
  const activeDays = Object.keys(overallTotal).length;
  const overallAvg = activeDays > 0 ? totalUnits / activeDays : 0;
  if (overallAvg <= 0) return { factors, detected: false };

  let largestDeviation = 1;
  for (let dow = 0; dow < 7; dow += 1) {
    const count = counts[dow] ?? 0;
    if (count < minPerWeekday) continue;
    const avg = (totals[dow] ?? 0) / count;
    const factor = Math.max(0, avg / overallAvg);
    factors[dow] = factor;
    largestDeviation = Math.max(largestDeviation, factor, 1 / Math.max(factor, 0.0001));
  }

  const detected = largestDeviation >= 1.35;
  return { factors, detected };
}

/** Round up to fewer significant decimals only for display-critical numbers. */
function round(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.round(value);
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

/** Confidence label from a 0..1 score. */
export function confidenceToLabel(score: number, dataQuality: ForecastResult['dataQuality']): ConfidenceLabel {
  if (dataQuality === 'insufficient') return 'Insufficient';
  if (score >= 0.7) return 'High';
  if (score >= 0.45) return 'Medium';
  return 'Low';
}

/**
 * Confidence score (0..1) — bounded, reproducible, from data quantity and
 * stability only. It is intentionally NOT derived from the model that
 * generated the forecast, so it stays an honest data-quality signal.
 */
export function confidenceScore(params: { historyDays: number; activeDays: number; daysOfHistory: number; totalUnits: number; daily: number[]; minHistoryDays: number; idealHistoryDays: number }): number {
  const coverage = params.daysOfHistory > 0 ? clamp(params.historyDays / params.idealHistoryDays, 0, 1) : 0;
  const activity = params.daysOfHistory > 0 ? clamp(params.activeDays / params.daysOfHistory, 0, 1) : 0;
  const cv = coefficientOfVariation(params.daily);
  const stability = 1 / (1 + cv);

  if (params.historyDays < params.minHistoryDays || params.daysOfHistory <= 0) {
    return clamp(0.15 * coverage, 0, 0.3);
  }

  const score = 0.45 * coverage + 0.25 * activity + 0.3 * stability;
  // A product with zero sales has a meaningless "high" confidence: cap it.
  if (params.totalUnits <= 0) return clamp(score * 0.4, 0, 0.5);
  return clamp(score, 0, 1);
}

/** Classify demand direction from a signed per-period percent change. */
export function classifyDirection(changePercent: number): DemandDirection {
  if (changePercent > 5) return 'rising';
  if (changePercent < -5) return 'falling';
  return 'stable';
}

/** Classify stock-out risk from estimated days of cover (null = no cover info). */
export function classifyStockoutRisk(daysOfCover: number | null, leadTimeDays: number | null): StockoutRisk {
  if (daysOfCover === null) return 'none';
  const lead = leadTimeDays ?? 2;
  if (daysOfCover <= 0 || daysOfCover <= lead) return 'critical';
  if (daysOfCover <= 7) return 'high';
  if (daysOfCover <= 14) return 'medium';
  if (daysOfCover <= 30) return 'low';
  return 'none';
}

/**
 * Build a full daily series and derive a per-day rate and recent rate. The
 * daily quantity array is dense (zero-padded across the window) so moving
 * averages and trend detection see a true time axis.
 */
export interface DenseSeries {
  daily: number[];
  startDate: Date;
  endDate: Date;
}

export function buildDenseSeries(current: Date, points: DailyDemandPoint[], windowDays: number): DenseSeries {
  const start = addDays(current, -(windowDays - 1));
  const byDate = new Map<string, number>();
  for (const point of points) byDate.set(point.date, point.quantity);
  const daily: number[] = [];
  for (let index = 0; index < windowDays; index += 1) {
    const day = addDays(start, index);
    daily.push(byDate.get(toIso(day)) ?? 0);
  }
  return { daily, startDate: start, endDate: current };
}

function futureSeasonalityFactorSum(current: Date, factors: number[], horizonDays: number): number {
  let total = 0;
  for (let index = 1; index <= horizonDays; index += 1) {
    const dow = addDays(current, index).getUTCDay();
    total += factors[dow] ?? 1;
  }
  return total;
}

export interface ForecastInput {
  series: DemandTimeSeries;
  stock: StockSnapshot | null;
  params: ForecastParams;
  today?: Date;
}

/**
 * Forecast one product. Always returns a complete, explainable object;
 * when data is insufficient it uses a conservative fallback and marks
 * dataQuality = 'estimate' or 'insufficient' rather than inventing a number.
 */
export function forecastProduct(input: ForecastInput): ForecastResult {
  const { series, stock, params } = input;
  const today = input.today ?? new Date();
  const periodStart = series.daily.length > 0 ? series.daily[0]!.date : series.periodStart;
  const periodEnd = series.daily.length > 0 ? series.daily[series.daily.length - 1]!.date : series.periodEnd;

  const dense = buildDenseSeries(today, series.daily, Math.max(1, params.windowDays));
  const quantities = dense.daily;
  const activeDays = series.activeDays;
  const historyDays = Math.min(series.daysOfHistory, params.windowDays);
  const totalUnits = series.totalUnits;

  const insufficient = historyDays < params.minHistoryDays || activeDays < params.minActiveDays || totalUnits <= 0;
  const dataQuality = insufficient ? (historyDays <= 0 || totalUnits <= 0 ? 'insufficient' : 'estimate') : 'real';

  // Rates.
  const averageDailyRate = historyDays > 0 ? totalUnits / historyDays : 0;
  const weeklyRate = averageDailyRate * 7;
  const recentWindow = Math.max(1, Math.min(params.safetyDays || 7, quantities.length));
  const recentDailyRate = historyDays > 0 ? mean(quantities.slice(-recentWindow)) : 0;

  // Trend via linear regression over dense daily quantities.
  const { slope: dailySlope } = linearRegression(quantities);
  const trendPerDay = dailySlope;

  // Recent vs earlier comparison for a stable, explainable direction.
  const half = Math.max(1, Math.floor(Math.max(1, historyDays) / 2));
  const recent = quantities.slice(-half);
  const earlier = quantities.slice(0, half);
  const earlierAvg = mean(earlier);
  const recentAvg = mean(recent);
  const trendChangePercent = earlierAvg > 0 ? ((recentAvg - earlierAvg) / earlierAvg) * 100 : (recentAvg > 0 ? 100 : 0);
  const demandDirection = classifyDirection(trendChangePercent);

  // Seasonality.
  const seasonality = computeSeasonality(series.daily);

  // Base projected rate: blend the recent rate with the Holt level, then add
  // the linear trend across the horizon (clamped to >= 0).
  let baseRate: number;
  if (quantities.length >= 6 && historyDays >= params.minHistoryDays) {
    const holt = holtLinear(quantities);
    baseRate = Math.max(0, 0.6 * holt.level + 0.4 * recentDailyRate);
  } else {
    baseRate = Math.max(0, averageDailyRate);
  }

  const confidence = confidenceScore({
    historyDays,
    activeDays,
    daysOfHistory: series.daysOfHistory,
    totalUnits,
    daily: quantities,
    minHistoryDays: params.minHistoryDays,
    idealHistoryDays: params.idealHistoryDays,
  });
  const confidenceLabel = confidenceToLabel(confidence, dataQuality);

  // Demand projection with seasonality adjustment for the actual future days.
  const demand7 = round(Math.max(0, baseRate + trendPerDay * 3.5) * futureSeasonalityFactorSum(today, seasonality.factors, 7));
  const demand30 = round(Math.max(0, baseRate + trendPerDay * 15) * futureSeasonalityFactorSum(today, seasonality.factors, 30));

  // Stock-out projection.
  const availableStock = stock?.availableQuantity ?? null;
  const rateForStockout = baseRate > 0 ? baseRate : recentDailyRate;
  const stockOutDays = stock !== null && rateForStockout > 0 ? Math.floor(availableStock! / rateForStockout) : null;
  const stockOutDate = stockOutDays !== null && stockOutDays >= 0 ? toIso(addDays(today, stockOutDays)) : null;
  const stockOutRisk = classifyStockoutRisk(stockOutDays, stock?.leadTimeDays ?? null);

  // Reorder recommendation.
  const leadTimeDays = stock?.leadTimeDays ?? null;
  const reorderWindowDays = leadTimeDays !== null ? leadTimeDays + params.safetyDays : params.safetyDays;
  const safetyStock = baseRate * params.safetyDays;
  const targetStock = stock && stock.maxStock && stock.maxStock > 0 ? stock.maxStock : Math.max(0, Math.ceil(baseRate * reorderWindowDays + safetyStock));
  const reorderQuantity = stock !== null ? Math.max(0, Math.ceil(targetStock) - availableStock!) : null;

  // Overstock.
  const daysOfCover = rateForStockout > 0 && availableStock !== null ? availableStock / rateForStockout : null;
  const overstockWarning = stock !== null
    ? (stock.maxStock > 0 && availableStock! > stock.maxStock) || (daysOfCover !== null && daysOfCover > params.overstockCoverDays)
    : false;

  // Dead stock: present stock but no meaningful recent demand. Use the most
  // recent day that actually recorded units, not the last calendar day.
  const lastNonZeroPoint = [...series.daily].reverse().find((point) => point.quantity > 0);
  const lastSaleDaysAgo = lastNonZeroPoint
    ? Math.round((today.getTime() - parseDate(lastNonZeroPoint.date).getTime()) / DAY_MS)
    : null;
  const deadStockWarning = stock !== null
    ? availableStock! > 0 && lastSaleDaysAgo !== null && lastSaleDaysAgo > params.deadStockDays && (averageDailyRate === 0 || trendChangePercent < -50)
    : false;

  // Explainability.
  const method = insufficient
    ? series.totalUnits === 0 || historyDays <= 0
      ? 'Conservative fallback (no sale history)'
      : `Conservative average over ${historyDays} day(s) (limited history)`
    : seasonality.detected
      ? 'Weighted recent rate + linear trend + day-of-week seasonality'
      : 'Weighted recent rate + linear trend';

  let explanation: string;
  if (insufficient && series.totalUnits === 0) {
    explanation = 'No historical sales data found for a reliable forecast.';
  } else if (insufficient) {
    explanation = `Limited data: about ${historyDays} day(s) of history with ${activeDays} active sale day(s). A conservative average was used with low confidence.`;
  } else {
    const directionText = demandDirection === 'rising' ? 'Demand increased' : demandDirection === 'falling' ? 'Demand decreased' : 'Demand held steady';
    explanation = `${directionText} roughly ${Math.abs(trendChangePercent).toFixed(0)}% over the observed window; estimated daily rate is ${averageDailyRate.toFixed(1)} unit(s).`;
    if (stockOutDays !== null && stockOutDays >= 0) {
      explanation += ` Current stock covers approximately ${stockOutDays} day(s).`;
    }
  }

  const dataBasis = `${periodStart} to ${periodEnd} · ${series.daily.length} active day(s) · ${series.orderCount} order(s) · ${totalUnits} unit(s)`;

  const result: ForecastResult = {
    productId: series.productId,
    productName: series.productName,
    skuCode: series.skuCode,
    unit: series.unit,
    dataQuality,
    periodStart,
    periodEnd,
    historyDays,
    activeDays,
    dataPoints: series.daily.length,
    totalUnits,
    averageDailyRate: Number(averageDailyRate.toFixed(2)),
    weeklyRate: Number(weeklyRate.toFixed(2)),
    recentDailyRate: Number(recentDailyRate.toFixed(2)),
    demand7Day: demand7,
    demand30Day: demand30,
    demandDirection,
    trendChangePercent: Number(trendChangePercent.toFixed(1)),
    seasonalityFactors: seasonality.factors.map((factor) => Number(factor.toFixed(3))),
    seasonalityDetected: seasonality.detected,
    confidence: Number(confidence.toFixed(3)),
    confidenceLabel,
    availableStock,
    stockOutDays,
    stockOutDate,
    stockOutRisk,
    reorderLevel: stock?.reorderLevel ?? null,
    maxStock: stock?.maxStock ?? null,
    leadTimeDays,
    reorderQuantity,
    reorderWindowDays,
    overstockWarning,
    overstockDaysOfCover: daysOfCover !== null ? Number(daysOfCover.toFixed(1)) : null,
    deadStockWarning,
    explanation,
    method,
    dataBasis,
  };

  return result;
}

/** Aggregate many product forecasts into a summary for the copilot. */
export function summarizeForecasts(forecasts: ForecastResult[], windowDays: number, generatedAt = new Date().toISOString()): ForecastSummary {
  const meaningful = forecasts.filter((forecast) => forecast.dataQuality !== 'insufficient' || forecast.totalUnits > 0);
  const withConfidence = forecasts.filter((forecast) => forecast.confidence > 0);
  const averageConfidence = withConfidence.length > 0
    ? withConfidence.reduce((acc, forecast) => acc + forecast.confidence, 0) / withConfidence.length
    : 0;
  return {
    generatedAt,
    windowDays,
    productsForecast: forecasts.length,
    productsWithInsufficientData: forecasts.filter((forecast) => forecast.dataQuality === 'insufficient').length,
    productsWithStockoutRisk: forecasts.filter((forecast) => forecast.stockOutRisk === 'critical' || forecast.stockOutRisk === 'high').length,
    productsNeedingReorder: forecasts.filter((forecast) => (forecast.reorderQuantity ?? 0) > 0).length,
    productsOverstocked: forecasts.filter((forecast) => forecast.overstockWarning).length,
    productsDeadStock: forecasts.filter((forecast) => forecast.deadStockWarning).length,
    rising: meaningful.filter((forecast) => forecast.demandDirection === 'rising').length,
    falling: meaningful.filter((forecast) => forecast.demandDirection === 'falling').length,
    stable: meaningful.filter((forecast) => forecast.demandDirection === 'stable').length,
    averageConfidence: Number(averageConfidence.toFixed(3)),
    totalUnitsOutflow: meaningful.reduce((acc, forecast) => acc + forecast.totalUnits, 0),
    forecasts,
  };
}

/** Default tuning used across tools and the dashboard. */
export const DEFAULT_FORECAST_PARAMS: ForecastParams = {
  windowDays: 60,
  minHistoryDays: 14,
  minActiveDays: 7,
  idealHistoryDays: 60,
  overstockCoverDays: 60,
  deadStockDays: 21,
  safetyDays: 7,
};

export { DOW_LABELS };
