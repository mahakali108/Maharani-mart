import 'server-only';

/**
 * Types for the Maharani demand-forecasting engine.
 *
 * The engine itself is pure TypeScript (no Supabase, no I/O): it consumes
 * the real, RLS-authorized time-series data produced by lib/ai/forecast/data.ts
 * and produces an explainable, bounded forecast. Every number is generated
 * from real order lines — never fabricated.
 */

export type DemandDirection = 'rising' | 'stable' | 'falling';
export type ForecastQuality = 'verified' | 'estimate' | 'insufficient' | 'unavailable';
export type ForecastDataQuality = 'real' | 'estimate' | 'insufficient';
export type ConfidenceLabel = 'High' | 'Medium' | 'Low' | 'Insufficient';
export type StockoutRisk = 'none' | 'low' | 'medium' | 'high' | 'critical';

/** One day of actual requested units for a product (from non-cancelled orders). */
export interface DailyDemandPoint {
  /** YYYY-MM-DD in the caller's local/site timezone as stored in the DB. */
  date: string;
  quantity: number;
}

/** The real, per-day demand series for one product within a bounded window. */
export interface DemandTimeSeries {
  productId: string;
  productName: string;
  skuCode: string;
  unit: string | null;
  periodStart: string;
  periodEnd: string;
  /** One row per day the product was actually ordered in the window. */
  daily: DailyDemandPoint[];
  /** Number of distinct dates in the window (may be > daily.length). */
  daysOfHistory: number;
  /** Distinct days that had at least one sale. */
  activeDays: number;
  /** Total units requested in the window. */
  totalUnits: number;
  /** Distinct non-cancelled order headers contributing to the series. */
  orderCount: number;
  /** Units cancelled in the window (informational, not part of demand). */
  cancellationUnits: number;
  /** Units returned in the window (informational, not part of demand). */
  returnUnits: number;
}

/** Authorized current-stock snapshot for a product (staff/admin scope). */
export interface StockSnapshot {
  productId: string;
  availableQuantity: number;
  reservedQuantity: number;
  quantityOnHand: number;
  reorderLevel: number;
  maxStock: number;
  minStock: number;
  leadTimeDays: number;
  stockStatus: string | null;
}

export interface ForecastParams {
  /** Ideal history window (days) pulled from the DB. */
  windowDays: number;
  /** Below this many history days we fall back to a conservative estimate. */
  minHistoryDays: number;
  /** Below this many active sale days we refuse to claim a reliable trend. */
  minActiveDays: number;
  /** Confidence ramp: this many history days = full data coverage. */
  idealHistoryDays: number;
  /** Days of cover above which a product is flagged as overstocked. */
  overstockCoverDays: number;
  /** Days with no sales that flags a product as potentially dead stock. */
  deadStockDays: number;
  /** Safety buffer (days) added to lead time for the reorder window. */
  safetyDays: number;
}

export interface ForecastResult {
  productId: string;
  productName: string;
  skuCode: string;
  unit: string | null;

  /** How trustworthy this result is: real, estimate, or insufficient. */
  dataQuality: ForecastDataQuality;
  /** Bounded source interval (YYYY-MM-DD). */
  periodStart: string;
  periodEnd: string;
  historyDays: number;
  activeDays: number;
  dataPoints: number;
  totalUnits: number;

  /** Average daily demand (units/day) across the window. */
  averageDailyRate: number;
  /** Average weekly demand (units/week) across the window. */
  weeklyRate: number;
  /** Recent (last ~safetyDays) daily rate, more responsive for reordering. */
  recentDailyRate: number;

  demand7Day: number;
  demand30Day: number;
  demandDirection: DemandDirection;
  /** Signed % change between the earlier and recent halves of the window. */
  trendChangePercent: number;

  /** Day-of-week seasonal factors (length 7; ~1 = neutral). */
  seasonalityFactors: number[];
  seasonalityDetected: boolean;

  confidence: number;
  confidenceLabel: ConfidenceLabel;

  availableStock: number | null;
  stockOutDays: number | null;
  stockOutDate: string | null;
  stockOutRisk: StockoutRisk;

  reorderLevel: number | null;
  maxStock: number | null;
  leadTimeDays: number | null;
  reorderQuantity: number | null;
  reorderWindowDays: number | null;

  overstockWarning: boolean;
  overstockDaysOfCover: number | null;
  deadStockWarning: boolean;

  /** Human-readable, data-backed explanation. */
  explanation: string;
  /** Which statistical method produced the numbers. */
  method: string;
  /** Traceability of the source rows. */
  dataBasis: string;
}

/** Summary used by the business copilot narrative. */
export interface ForecastSummary {
  generatedAt: string;
  windowDays: number;
  productsForecast: number;
  productsWithInsufficientData: number;
  productsWithStockoutRisk: number;
  productsNeedingReorder: number;
  productsOverstocked: number;
  productsDeadStock: number;
  rising: number;
  falling: number;
  stable: number;
  averageConfidence: number;
  totalUnitsOutflow: number;
  forecasts: ForecastResult[];
}
