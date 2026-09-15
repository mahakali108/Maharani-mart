/**
 * Admin Dashboard — result types.
 *
 * Every number is derived from real, RLS-authorized rows. Sections carry a
 * `status` so the UI can render honest empty/unavailable states instead of
 * fabricated figures:
 *
 *   - 'ok'          authorized query succeeded and there is something to show
 *   - 'empty'       query succeeded but there are no rows yet
 *   - 'unavailable' the underlying source failed
 */

export type SectionStatus = 'ok' | 'empty' | 'unavailable';
export type DashboardPreset = 'today' | '7d' | '30d' | 'custom';
export type AlertSeverity = 'urgent' | 'high' | 'medium';

export interface DashboardRange {
  preset: DashboardPreset;
  fromKey: string;
  toKey: string;
  fromIso: string;
  toIso: string;
  label: string;
  previousFromKey: string;
  previousToKey: string;
  previousFromIso: string;
  previousToIso: string;
  spanDays: number;
  /** True when a custom window was clamped to the 90-day cap. */
  truncatedWindow: boolean;
  error: string | null;
}

export interface DashboardOrder {
  id: string;
  order_number: string;
  retailer_id: string;
  status: string;
  subtotal: number;
  gst_total: number;
  grand_total: number;
  placed_at: string;
}

export interface DashboardOrderItem {
  order_id: string;
  product_id: string;
  quantity: number;
  quantity_pieces?: number | null;
  quantity_unit?: 'packs' | 'cases' | 'pieces' | null;
  units_per_case?: number | null;
  line_total: number;
  gst_percent: number;
}

export interface DashboardRetailer {
  id: string;
  shop_name: string;
  status: string;
  credit_limit: number;
  outstanding_balance: number;
  created_at: string;
  approved_at: string | null;
}

export interface DashboardInventoryRow {
  product_id: string;
  product_name: string;
  sku_code: string;
  quantity_on_hand: number;
  reorder_level: number;
  stock_status: 'healthy' | 'low_stock' | 'out_of_stock' | string;
}

export interface DashboardExpiryRow {
  batch_id: string;
  product_id: string;
  product_name: string;
  batch_number: string;
  warehouse_name: string;
  expiry_date: string | null;
  available_quantity: number;
  estimated_value: number;
  days_remaining: number | null;
  expiry_status: 'expired' | 'critical' | 'warning' | 'healthy' | string;
}

export interface DashboardLedgerRow {
  amount_paise: number;
  transaction_type: string;
  is_reversed: boolean;
  created_at: string;
}

export interface DashboardCollectionRow {
  amount_paise: number;
  status: string;
  method: string;
  created_at: string;
}

export interface DashboardTicketRow {
  id: string;
  ticket_number: string;
  subject: string;
  status: string;
  priority: string;
  created_at: string;
}

export interface SalesKpis {
  status: SectionStatus;
  sales: number;
  orderCount: number;
  aov: number | null;
  previousSales: number;
  growthPct: number | null;
  taxable: number;
  gst: number;
}

export interface OrderKpis {
  status: SectionStatus;
  total: number;
  billed: number;
  pending: number;
  confirmed: number;
  processing: number;
  packed: number;
  dispatched: number;
  delivered: number;
  cancelled: number;
  returned: number;
  fulfillmentPct: number | null;
}

export interface RetailerKpis {
  status: SectionStatus;
  total: number;
  active: number;
  pendingApproval: number;
  suspended: number;
  newInRange: number;
}

export interface CatalogSnapshot {
  status: SectionStatus;
  products: number;
  variants: number;
  brands: number;
  categories: number;
  warehouses: number;
}

export interface CreditSummary {
  status: SectionStatus;
  totalOutstanding: number;
  totalConfiguredLimit: number;
  retailersWithLimit: number;
  overLimitCount: number;
  overLimitAmount: number;
  utilizationPct: number | null;
  highRisk: {
    retailerId: string;
    shopName: string;
    outstanding: number;
    limit: number;
    utilizationPct: number | null;
    exceedsLimit: boolean;
  }[];
}

export interface PaymentSummary {
  status: SectionStatus;
  collected: number;
  collectedCount: number;
  pendingVerification: number;
  pendingCount: number;
  rejected: number;
  rejectedCount: number;
  verifiedCollections: number;
  verifiedCollectionCount: number;
  byMethod: { method: string; amount: number; count: number }[];
}

export interface GstRateBucket {
  gstPercent: number;
  lineCount: number;
  taxable: number;
  tax: number;
  inclusive: number;
}

export interface GstSummary {
  status: SectionStatus;
  invoiceCount: number;
  taxable: number;
  gst: number;
  invoiceValue: number;
  /** Line-level extraction; never used to override stored `orders.gst_total`. */
  rateBuckets: GstRateBucket[];
  note: string;
}

export interface RankedRow {
  id: string;
  name: string;
  value: number;
  secondary?: string;
}

export interface TopList {
  status: SectionStatus;
  rows: RankedRow[];
}

export interface RecentOrderRow {
  id: string;
  orderNumber: string;
  status: string;
  grandTotal: number;
  placedAt: string;
  retailerName: string | null;
}

export interface RecentOrders {
  status: SectionStatus;
  rows: RecentOrderRow[];
}

export interface PendingApprovals {
  status: SectionStatus;
  retailers: number;
  returns: number;
  collections: number;
  openTickets: number;
}

export interface InventoryAlerts {
  status: SectionStatus;
  lowStockCount: number;
  outOfStockCount: number;
  onHandProducts: number;
  lowStock: {
    productId: string;
    productName: string;
    skuCode: string;
    quantityOnHand: number;
    reorderLevel: number;
    stockStatus: string;
  }[];
}

export interface ExpiringBatches {
  status: SectionStatus;
  expired: number;
  critical: number;
  warning: number;
  rows: {
    batchId: string;
    productName: string;
    batchNumber: string;
    warehouseName: string;
    expiryDate: string | null;
    daysRemaining: number | null;
    quantity: number;
    value: number;
    expiryStatus: string;
  }[];
}

export interface SupportSummary {
  status: SectionStatus;
  open: number;
  inProgress: number;
  urgentOpen: number;
  resolved: number;
  closed: number;
  recent: {
    id: string;
    ticketNumber: string;
    subject: string;
    status: string;
    priority: string;
    createdAt: string;
  }[];
}

export interface SystemAlert {
  id: string;
  severity: AlertSeverity;
  title: string;
  detail: string;
  href: string;
}

export interface ActivityRow {
  id: string;
  tableName: string;
  action: string;
  createdAt: string;
  changedByName: string | null;
}

export interface RecentActivity {
  status: SectionStatus;
  rows: ActivityRow[];
}

export type DashboardSection =
  | 'sales'
  | 'orders'
  | 'retailers'
  | 'catalog'
  | 'inventory'
  | 'credit'
  | 'payments'
  | 'gst'
  | 'topProducts'
  | 'topRetailers'
  | 'recentOrders'
  | 'pendingApprovals'
  | 'lowStock'
  | 'expiringBatches'
  | 'support'
  | 'systemAlerts'
  | 'activity'
  | 'commandCenter';

export type DashboardVisibility = Record<DashboardSection, boolean>;

export interface DashboardData {
  generatedAt: string;
  range: DashboardRange;
  ordersTruncated: boolean;
  sales: SalesKpis;
  orders: OrderKpis;
  retailers: RetailerKpis;
  catalog: CatalogSnapshot;
  credit: CreditSummary;
  payments: PaymentSummary;
  gst: GstSummary;
  topProducts: TopList;
  topRetailers: TopList;
  recentOrders: RecentOrders;
  pendingApprovals: PendingApprovals;
  inventory: InventoryAlerts;
  expiring: ExpiringBatches;
  support: SupportSummary;
  alerts: SystemAlert[];
  activity: RecentActivity;
}
