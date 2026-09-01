/**
 * Super Admin Command Center — shared result types.
 *
 * Every number in these types is derived from real, RLS-authorized rows
 * (orders, order_items, retailers, profiles, the inventory_product_totals /
 * inventory_expiry_report / ai_product_demand_daily views, grns/grn_items,
 * audit_logs, ai_audit_logs, notification_logs, stock_movements, visits) or
 * from the existing demand-forecast pipeline. Sections carry a `status`
 * so the UI can render honest empty/unavailable states instead of
 * fabricated numbers:
 *
 *   - 'ok'          real data exists and was aggregated
 *   - 'empty'       authorized query succeeded but no rows exist yet
 *   - 'unavailable' the underlying source failed or does not exist
 *
 * Nothing in this module writes business data.
 */

export type SectionStatus = 'ok' | 'empty' | 'unavailable';
export type Severity = 'urgent' | 'high' | 'medium';

export interface TrendPoint {
  /** YYYY-MM-DD (server local date, consistent with the existing Reports page). */
  date: string;
  label: string;
  sales: number;
  orders: number;
}

export interface TopRow {
  id: string;
  name: string;
  value: number;
  secondary?: string;
}

export interface BusinessOverview {
  status: SectionStatus;
  todaySales: number;
  todayOrders: number;
  monthSales: number;
  monthOrders: number;
  previousMonthSales: number;
  /** Signed % vs previous month; null when the previous month has no data. */
  salesMoMChangePct: number | null;
  revenue30d: number;
  outstandingCredit: number;
  /** Total amount by which over-limit retailers exceed their configured limit. */
  overLimitAmount: number;
  inventoryValue: number;
  lowStockCount: number;
  outOfStockCount: number;
  expiredBatches: number;
  expiringCriticalBatches: number;
  expiringWarningBatches: number;
  /** Value of stocked products with zero sales in the last 30 days. */
  deadStockValue: number;
  deadStockCount: number;
  activeRetailers: number;
  totalRetailers: number;
  activeSalesmen: number;
  activeStaff: number;
  /** Distinct supplier references recorded on GRNs (no supplier master table exists). */
  supplierCount: number;
  pendingGrns: number;
  /** ISO timestamp of when the data was gathered. */
  dataAsOf: string;
}

export interface Trends {
  status: SectionStatus;
  /** Last 14 calendar days (includes zero-sale days). */
  daily: TrendPoint[];
  aov30d: number | null;
  newRetailers30d: number;
  /** Retailers that ordered in the last 7 days AND had at least one order before that window. */
  returningRetailers7d: number;
  /** True only when a payment/collection ledger exists in the schema (it does not today). */
  creditCollectionAvailable: boolean;
}

export interface TopPerformers {
  status: SectionStatus;
  windowDays: number;
  products: TopRow[];
  categories: TopRow[];
  brands: TopRow[];
  retailers: TopRow[];
  salesmen: TopRow[];
}

export interface RiskItem {
  id: string;
  title: string;
  detail: string;
  severity: Severity;
  /** Real source: table/view/function name that produced the signal. */
  source: string;
  href?: string;
  value?: string;
}

export interface RiskBucket {
  count: number;
  items: RiskItem[];
  value?: number;
}

export interface RiskCenter {
  status: SectionStatus;
  stockoutRisk: RiskBucket;
  overstock: RiskBucket;
  deadStock: RiskBucket;
  expiry: RiskBucket;
  credit: RiskBucket;
  unusualOrders: RiskBucket;
  systemFailures: RiskBucket;
}

export interface CommandCenterAction {
  id: string;
  severity: Severity;
  category: string;
  /** Real source of the signal (table/view/forecast pipeline). */
  source: string;
  entity: string;
  entityHref?: string;
  reason: string;
  recommendedAction: string;
  /** Which existing human workflow must execute it — AI never mutates. */
  requiredApproval: string;
  metric?: string;
}

export interface CreditOverview {
  status: SectionStatus;
  totalConfiguredLimit: number;
  retailersWithLimit: number;
  totalOutstanding: number;
  overLimitCount: number;
  overLimitAmount: number;
  /** outstanding / total configured limit; null when no limit is configured anywhere. */
  utilizationPct: number | null;
  buckets: { label: string; count: number }[];
  highRisk: {
    retailerId: string;
    shopName: string;
    outstanding: number;
    limit: number;
    utilizationPct: number | null;
    status: string;
  }[];
  /** Payment history does not exist in the schema — collection trend is never estimated. */
  paymentTrendAvailable: boolean;
}

export interface InventoryIntel {
  status: SectionStatus;
  inventoryValue: number;
  onHandProducts: number;
  lowStock: { id: string; name: string; sku: string | null; available: number; reorderLevel: number }[];
  stockout: {
    id: string;
    name: string;
    days: number | null;
    date: string | null;
    risk: string;
    available: number | null;
    dailyRate: number;
  }[];
  reorder: { id: string; name: string; quantity: number | null; windowDays: number | null; method: string }[];
  overstock: { id: string; name: string; coverDays: number | null }[];
  deadStock: { id: string; name: string; available: number; value: number }[];
  expiring: {
    id: string;
    name: string;
    batch: string;
    expiry: string | null;
    days: number | null;
    qty: number;
    status: string;
    value: number;
  }[];
  fastMoving: { id: string; name: string; units30d: number }[];
  slowMoving: { id: string; name: string; units30d: number; available: number }[];
  /** True when the forecast engine lacks enough order history. */
  forecastInsufficient: boolean;
}

export interface SalesIntel {
  status: SectionStatus;
  from: string;
  to: string;
  totalSales: number;
  totalOrders: number;
  aov: number | null;
  previousPeriodSales: number | null;
  growthPct: number | null;
  daily: TrendPoint[];
  weekly: { label: string; sales: number; orders: number }[];
  topProducts: TopRow[];
  topCategories: TopRow[];
  topBrands: TopRow[];
  topRetailers: TopRow[];
  topSalesmen: TopRow[];
  /** 'order' = order.grand_total basis; 'item' = line_total basis (applies a product-level filter). */
  filteredBasis: 'order' | 'item';
}

export interface RetailerRowIntel {
  retailerId: string;
  shopName: string;
  status: string;
  lastOrderAt: string | null;
  orders60d: number;
  frequencyPerMonth: number | null;
  aov60d: number | null;
  sales60d: number;
  /** Signed % change: last 30 days vs the 30 days before it; null when the earlier window has no sales. */
  salesChangePct: number | null;
  creditUtilizationPct: number | null;
  tags: string[];
}

export interface RetailerIntel {
  status: SectionStatus;
  counts: {
    active: number;
    inactive: number;
    new30d: number;
    highValue: number;
    declining: number;
    increasing: number;
    overLimit: number;
  };
  rows: RetailerRowIntel[];
  dataNotes: string[];
}

export interface SalesmanIntel {
  status: SectionStatus;
  rows: {
    profileId: string;
    name: string;
    sales30d: number;
    orders30d: number;
    aov30d: number | null;
    activeRetailers30d: number;
    visits30d: number;
    salesChangePct: number | null;
    status: 'active' | 'inactive' | 'new';
  }[];
  hasVisitData: boolean;
  /** No target/plan data exists in the schema — target achievement is never invented. */
  targetsAvailable: boolean;
  dataNotes: string[];
}

export interface SupplierIntel {
  status: SectionStatus;
  pendingGrns: { id: string; number: string; supplier: string; warehouse: string; createdAt: string; value: number; items: number }[];
  confirmed30dValue: number;
  confirmed30dCount: number;
  suppliers: { name: string; grns90d: number; value90d: number }[];
  costChanges: {
    productId: string;
    productName: string;
    previousCost: number;
    latestCost: number;
    changePct: number;
    latestAt: string;
  }[];
  productsRequiringPurchase: { id: string; name: string; quantity: number | null; reason: string }[];
  hasGrnData: boolean;
}

export interface SecurityEvent {
  id: string;
  table: string;
  action: string;
  changedBy: string | null;
  createdAt: string;
  /** Small, curated summary — raw jsonb payloads are never exposed. */
  summary: string;
}

export interface SecurityIntel {
  status: SectionStatus;
  events: SecurityEvent[];
  ai: {
    requests7d: number;
    failures7d: number;
    failedTools: { tool: string; code: string; count: number }[];
  };
  failedNotifications7d: number;
  recentAdjustments: { id: string; productName: string; qty: number; reason: string | null; by: string | null; at: string }[];
}

export interface CopilotInsight {
  kind: string;
  severity: string;
  title: string;
  detail: string;
  trace: string;
  productId: string | null;
}

export interface AiInsights {
  status: SectionStatus;
  windowDays: number;
  narrative: string;
  insights: CopilotInsight[];
  productsForecast: number;
}

export interface AlertNotification {
  id: string;
  title: string;
  body: string;
  linkUrl: string | null;
  createdAt: string;
}

export interface CommandCenterData {
  generatedAt: string;
  overview: BusinessOverview;
  trends: Trends;
  top: TopPerformers;
  risk: RiskCenter;
  actions: CommandCenterAction[];
  credit: CreditOverview;
  inventory: InventoryIntel;
  retailers: RetailerIntel;
  salesmen: SalesmanIntel;
  suppliers: SupplierIntel;
  security: SecurityIntel;
  ai: AiInsights;
  notifications: AlertNotification[];
  salesIntel: SalesIntel;
}

/** Filter set for the Sales Intelligence tab (all validated server-side). */
export interface SalesIntelFilters {
  from: string;
  to: string;
  categoryId: string | null;
  brandId: string | null;
  productId: string | null;
  retailerId: string | null;
  salesmanId: string | null;
}

export const COMMAND_CENTER_TABS = [
  'overview',
  'sales',
  'inventory',
  'credit',
  'retailers',
  'salesmen',
  'suppliers',
  'security',
  'copilot',
] as const;

export type CommandCenterTab = (typeof COMMAND_CENTER_TABS)[number];

export function isCommandCenterTab(value: string | undefined): value is CommandCenterTab {
  return value !== undefined && (COMMAND_CENTER_TABS as readonly string[]).includes(value);
}
