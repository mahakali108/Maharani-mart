import Link from 'next/link';
import {
  Users,
  UserCheck,
  PackageSearch,
  ShoppingCart,
  Clock,
  Truck,
  CheckCircle2,
  Tag,
  Tags,
  Warehouse,
  Activity,
  ArrowRight,
  AlertTriangle,
  IndianRupee,
  BarChart3,
} from 'lucide-react';
import { createClient } from '@/lib/supabase/server';
import { Card, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type DateRange = 'today' | '7d' | '30d' | 'custom';

interface DashboardCounts {
  totalRetailers: number;
  pendingRetailers: number;
  activeProducts: number;
  activeVariants: number;
  totalBrands: number;
  totalCategories: number;
  totalWarehouses: number;
}

interface OrderStats {
  totalOrders: number;
  totalSales: number;
  pendingOrders: number;
  confirmedOrders: number;
  dispatchedOrders: number;
  deliveredOrders: number;
}

interface RecentOrder {
  id: string;
  order_number: string;
  status: string;
  grand_total: number;
  placed_at: string;
  retailer_name: string | null;
}

interface TopProduct {
  product_id: string;
  product_name: string;
  total_qty: number;
  total_revenue: number;
}

interface LowStockProduct {
  product_id: string;
  product_name: string;
  sku_code: string;
  quantity_on_hand: number;
  reorder_level: number;
  stock_status: string;
}

interface ActivityRow {
  id: string;
  table_name: string;
  action: string;
  created_at: string;
  changed_by_name: string | null;
}

// ---------------------------------------------------------------------------
// Data fetching
// ---------------------------------------------------------------------------

function getDateRange(range: DateRange, customFrom?: string, customTo?: string): { from: Date; to: Date } {
  const now = new Date();
  const endOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);

  if (range === 'custom' && customFrom && customTo) {
    return {
      from: new Date(customFrom + 'T00:00:00'),
      to: new Date(customTo + 'T23:59:59'),
    };
  }

  switch (range) {
    case '7d': {
      const from = new Date(now);
      from.setDate(from.getDate() - 6);
      from.setHours(0, 0, 0, 0);
      return { from, to: endOfDay };
    }
    case '30d': {
      const from = new Date(now);
      from.setDate(from.getDate() - 29);
      from.setHours(0, 0, 0, 0);
      return { from, to: endOfDay };
    }
    case 'today':
    default: {
      const from = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0);
      return { from, to: endOfDay };
    }
  }
}

const TABLE_LABELS: Record<string, string> = {
  products: 'a product',
  price_lists: 'a price',
  orders: 'an order',
  product_packs: 'a product pack',
  product_pricing_tiers: 'a pricing tier',
  retailer_documents: 'a retailer document',
  retailers: 'a retailer',
  banners: 'a banner',
  inventory_stock: 'stock levels',
  stock_movements: 'a stock movement',
  schemes: 'a scheme',
  product_images: 'a product image',
};

async function getCounts(supabase: ReturnType<typeof createClient>): Promise<DashboardCounts> {
  const [
    { count: totalRetailers },
    { count: pendingRetailers },
    { count: activeProducts },
    { count: activeVariants },
    { count: totalBrands },
    { count: totalCategories },
    { count: totalWarehouses },
  ] = await Promise.all([
    supabase.from('retailers').select('id', { count: 'exact', head: true }),
    supabase.from('retailers').select('id', { count: 'exact', head: true }).eq('status', 'pending_approval'),
    supabase.from('products').select('id', { count: 'exact', head: true }).eq('is_active', true),
    supabase.from('product_packs').select('id', { count: 'exact', head: true }).eq('is_active', true),
    supabase.from('brands').select('id', { count: 'exact', head: true }),
    supabase.from('categories').select('id', { count: 'exact', head: true }),
    supabase.from('warehouses').select('id', { count: 'exact', head: true }),
  ]);

  return {
    totalRetailers: totalRetailers ?? 0,
    pendingRetailers: pendingRetailers ?? 0,
    activeProducts: activeProducts ?? 0,
    activeVariants: activeVariants ?? 0,
    totalBrands: totalBrands ?? 0,
    totalCategories: totalCategories ?? 0,
    totalWarehouses: totalWarehouses ?? 0,
  };
}

async function getOrderStats(
  supabase: ReturnType<typeof createClient>,
  from: Date,
  to: Date
): Promise<OrderStats> {
  const { data } = await supabase
    .from('orders')
    .select('status, grand_total')
    .neq('status', 'cancelled')
    .gte('placed_at', from.toISOString())
    .lte('placed_at', to.toISOString());

  const orders = (data ?? []) as { status: string; grand_total: number }[];

  return {
    totalOrders: orders.length,
    totalSales: orders.reduce((sum, o) => sum + o.grand_total, 0),
    pendingOrders: orders.filter((o) => o.status === 'pending').length,
    confirmedOrders: orders.filter((o) => o.status === 'confirmed' || o.status === 'processing').length,
    dispatchedOrders: orders.filter((o) => o.status === 'dispatched' || o.status === 'packed').length,
    deliveredOrders: orders.filter((o) => o.status === 'delivered').length,
  };
}

async function getRecentOrders(supabase: ReturnType<typeof createClient>): Promise<RecentOrder[]> {
  // Fetch orders and profiles separately to avoid the embed-row-drop issue
  // documented in app/admin/retailers/page.tsx.
  const { data: orderData } = await supabase
    .from('orders')
    .select('id, order_number, status, grand_total, placed_at, retailer_id')
    .order('placed_at', { ascending: false })
    .limit(8);

  const orders = (orderData ?? []) as {
    id: string;
    order_number: string;
    status: string;
    grand_total: number;
    placed_at: string;
    retailer_id: string;
  }[];

  if (orders.length === 0) return [];

  const retailerIds = [...new Set(orders.map((o) => o.retailer_id))];
  const { data: profileData } = await supabase
    .from('profiles')
    .select('id, full_name')
    .in('id', retailerIds);

  const nameById = new Map(
    ((profileData ?? []) as { id: string; full_name: string }[]).map((p) => [p.id, p.full_name])
  );

  return orders.map((o) => ({
    id: o.id,
    order_number: o.order_number,
    status: o.status,
    grand_total: o.grand_total,
    placed_at: o.placed_at,
    retailer_name: nameById.get(o.retailer_id) ?? null,
  }));
}

async function getTopProducts(
  supabase: ReturnType<typeof createClient>,
  from: Date,
  to: Date
): Promise<TopProduct[]> {
  // Get order IDs in the range first
  const { data: orderData } = await supabase
    .from('orders')
    .select('id')
    .neq('status', 'cancelled')
    .gte('placed_at', from.toISOString())
    .lte('placed_at', to.toISOString());

  const orderIds = ((orderData ?? []) as { id: string }[]).map((o) => o.id);
  if (orderIds.length === 0) return [];

  // Get order items for those orders
  const { data: itemData } = await supabase
    .from('order_items')
    .select('product_id, quantity, line_total')
    .in('order_id', orderIds);

  const items = (itemData ?? []) as { product_id: string; quantity: number; line_total: number }[];

  // Aggregate by product
  const byProduct = new Map<string, { qty: number; revenue: number }>();
  for (const item of items) {
    const existing = byProduct.get(item.product_id) ?? { qty: 0, revenue: 0 };
    existing.qty += item.quantity;
    existing.revenue += item.line_total;
    byProduct.set(item.product_id, existing);
  }

  if (byProduct.size === 0) return [];

  // Get product names
  const productIds = [...byProduct.keys()];
  const { data: productData } = await supabase
    .from('products')
    .select('id, name')
    .in('id', productIds);

  const nameById = new Map(
    ((productData ?? []) as { id: string; name: string }[]).map((p) => [p.id, p.name])
  );

  return [...byProduct.entries()]
    .map(([productId, { qty, revenue }]) => ({
      product_id: productId,
      product_name: nameById.get(productId) ?? 'Unknown',
      total_qty: qty,
      total_revenue: revenue,
    }))
    .sort((a, b) => b.total_revenue - a.total_revenue)
    .slice(0, 5);
}

async function getLowStock(supabase: ReturnType<typeof createClient>): Promise<LowStockProduct[]> {
  const { data } = await supabase
    .from('inventory_product_totals')
    .select('product_id, product_name, sku_code, quantity_on_hand, reorder_level, stock_status')
    .in('stock_status', ['low_stock', 'out_of_stock'])
    .order('quantity_on_hand', { ascending: true })
    .limit(10);

  return (data ?? []) as unknown as LowStockProduct[];
}

async function getRecentActivity(supabase: ReturnType<typeof createClient>): Promise<ActivityRow[]> {
  const { data: auditData } = await supabase
    .from('audit_logs')
    .select('id, table_name, action, created_at, changed_by')
    .order('created_at', { ascending: false })
    .limit(10);

  const rows = (auditData ?? []) as { id: string; table_name: string; action: string; created_at: string; changed_by: string | null }[];
  if (rows.length === 0) return [];

  const changedByIds = [...new Set(rows.map((r) => r.changed_by).filter((id): id is string => !!id))];
  const { data: profileData } =
    changedByIds.length > 0
      ? await supabase.from('profiles').select('id, full_name').in('id', changedByIds)
      : { data: [] as unknown[] };

  const nameById = new Map(
    ((profileData ?? []) as { id: string; full_name: string }[]).map((p) => [p.id, p.full_name])
  );

  return rows.map((r) => ({
    id: r.id,
    table_name: r.table_name,
    action: r.action,
    created_at: r.created_at,
    changed_by_name: r.changed_by ? nameById.get(r.changed_by) ?? 'Unknown' : null,
  }));
}

async function getOutstandingTotal(supabase: ReturnType<typeof createClient>): Promise<number> {
  const { data } = await supabase
    .from('retailers')
    .select('outstanding_balance')
    .eq('status', 'active');

  return ((data ?? []) as { outstanding_balance: number }[]).reduce(
    (sum, r) => sum + r.outstanding_balance,
    0
  );
}

// ---------------------------------------------------------------------------
// Page component
// ---------------------------------------------------------------------------

export default async function AdminDashboardPage({
  searchParams,
}: {
  searchParams: { range?: string; from?: string; to?: string };
}) {
  const supabase = createClient();

  const range = (searchParams.range as DateRange) || 'today';
  const { from, to } = getDateRange(range, searchParams.from, searchParams.to);

  const [counts, orderStats, recentOrders, topProducts, lowStock, activity, outstandingTotal] =
    await Promise.all([
      getCounts(supabase),
      getOrderStats(supabase, from, to),
      getRecentOrders(supabase),
      getTopProducts(supabase, from, to),
      getLowStock(supabase),
      getRecentActivity(supabase),
      getOutstandingTotal(supabase),
    ]);

  const rangeLabel =
    range === 'today'
      ? 'Today'
      : range === '7d'
        ? 'Last 7 days'
        : range === '30d'
          ? 'Last 30 days'
          : `${searchParams.from} — ${searchParams.to}`;

  return (
    <div className="space-y-6">
      <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-center">
        <div>
          <h1 className="text-2xl font-semibold text-ink-950">Dashboard</h1>
          <p className="mt-1 text-sm text-ink-500">
            Live overview of your distribution network. All numbers reflect real database data.
          </p>
        </div>
        <Link href="/admin/command-center">
          <Button variant="secondary" size="sm">
            <BarChart3 className="h-4 w-4" />
            Command Center
            <ArrowRight className="h-3.5 w-3.5" />
          </Button>
        </Link>
      </div>

      {/* Date range filter */}
      <div className="flex flex-wrap items-center gap-2">
        <DateFilterButton range="today" current={range} label="Today" />
        <DateFilterButton range="7d" current={range} label="7 Days" />
        <DateFilterButton range="30d" current={range} label="30 Days" />
        {range === 'custom' ? (
          <span className="rounded-full bg-primary-50 px-3 py-1.5 text-xs font-medium text-primary-700">
            {rangeLabel}
          </span>
        ) : null}
      </div>

      {/* Primary order stats */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <StatCard icon={IndianRupee} label="Sales" value={`₹${formatCompact(orderStats.totalSales)}`} hint={rangeLabel} accent />
        <StatCard icon={ShoppingCart} label="Orders" value={orderStats.totalOrders} hint={rangeLabel} />
        <StatCard icon={Clock} label="Pending" value={orderStats.pendingOrders} warn={orderStats.pendingOrders > 0} />
        <StatCard icon={CheckCircle2} label="Confirmed" value={orderStats.confirmedOrders} />
        <StatCard icon={Truck} label="Dispatched" value={orderStats.dispatchedOrders} />
        <StatCard icon={CheckCircle2} label="Delivered" value={orderStats.deliveredOrders} />
      </div>

      {/* Business overview */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatCard icon={Users} label="Total Retailers" value={counts.totalRetailers} />
        <StatCard
          icon={UserCheck}
          label="Pending Approvals"
          value={counts.pendingRetailers}
          warn={counts.pendingRetailers > 0}
          href={counts.pendingRetailers > 0 ? '/admin/retailers' : undefined}
        />
        <StatCard icon={PackageSearch} label="Active Products" value={counts.activeProducts} />
        <StatCard icon={Tag} label="Active Variants" value={counts.activeVariants} />
      </div>

      {/* Outstanding amount */}
      {outstandingTotal > 0 ? (
        <Card className="border-amber-200 bg-amber-50/40">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-amber-800">Total Outstanding Amount</p>
              <p className="mt-1 text-2xl font-semibold text-amber-900">₹{outstandingTotal.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</p>
            </div>
            <AlertTriangle className="h-8 w-8 text-amber-400" />
          </div>
        </Card>
      ) : null}

      {/* Two-column layout: Recent Orders + Top Products */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {/* Recent Orders */}
        <Card>
          <div className="flex items-center justify-between">
            <CardHeader>
              <CardTitle>Recent Orders</CardTitle>
            </CardHeader>
            <Link href="/admin/orders" className="text-xs font-medium text-primary-600 hover:text-primary-700">
              View all →
            </Link>
          </div>
          {recentOrders.length === 0 ? (
            <p className="px-5 pb-4 text-sm text-ink-400">No orders placed yet.</p>
          ) : (
            <ul className="divide-y divide-ink-100">
              {recentOrders.map((o) => (
                <li key={o.id} className="flex items-center justify-between px-5 py-3 text-sm">
                  <div>
                    <Link
                      href={`/admin/orders/${o.id}`}
                      className="font-mono text-xs font-medium text-ink-900 hover:text-primary-600"
                    >
                      {o.order_number}
                    </Link>
                    <p className="text-xs text-ink-400">
                      {o.retailer_name ?? 'Unknown'} · {new Date(o.placed_at).toLocaleDateString('en-IN')}
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="font-medium text-ink-900">₹{o.grand_total.toFixed(2)}</p>
                    <StatusBadge status={o.status} />
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>

        {/* Top Selling Products */}
        <Card>
          <CardHeader>
            <CardTitle>Top Selling Products ({rangeLabel})</CardTitle>
          </CardHeader>
          {topProducts.length === 0 ? (
            <p className="px-5 pb-4 text-sm text-ink-400">
              No sales data yet. Top products will appear as orders come in.
            </p>
          ) : (
            <ul className="divide-y divide-ink-100">
              {topProducts.map((p, idx) => (
                <li key={p.product_id} className="flex items-center justify-between px-5 py-3 text-sm">
                  <div className="flex items-center gap-3">
                    <span className="flex h-7 w-7 items-center justify-center rounded-full bg-ink-100 text-xs font-semibold text-ink-600">
                      {idx + 1}
                    </span>
                    <div>
                      <p className="font-medium text-ink-900">{p.product_name}</p>
                      <p className="text-xs text-ink-400">{p.total_qty} cases sold</p>
                    </div>
                  </div>
                  <p className="font-semibold text-ink-900">₹{p.total_revenue.toFixed(2)}</p>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      {/* Low stock alerts */}
      {lowStock.length > 0 ? (
        <Card className="border-primary-100">
          <div className="flex items-center justify-between">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <AlertTriangle className="h-4 w-4 text-primary-600" />
                Low Stock Alerts
              </CardTitle>
            </CardHeader>
            <Link href="/admin/inventory/low-stock" className="text-xs font-medium text-primary-600 hover:text-primary-700">
              Manage →
            </Link>
          </div>
          <ul className="divide-y divide-ink-100">
            {lowStock.slice(0, 5).map((p) => (
              <li key={p.product_id} className="flex items-center justify-between px-5 py-2.5 text-sm">
                <span className="text-ink-700">{p.product_name}</span>
                <span className="flex items-center gap-2">
                  <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${p.stock_status === 'out_of_stock' ? 'bg-primary-50 text-primary-700' : 'bg-amber-50 text-amber-700'}`}>
                    {p.stock_status === 'out_of_stock' ? 'Out of stock' : 'Low stock'}
                  </span>
                  <span className="text-xs text-ink-400">{p.quantity_on_hand} left</span>
                </span>
              </li>
            ))}
          </ul>
        </Card>
      ) : null}

      {/* Recent Activity */}
      <Card>
        <div className="flex items-center justify-between">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Activity className="h-4 w-4 text-primary-600" />
              Recent Activity
            </CardTitle>
          </CardHeader>
          <Link href="/admin/audit-logs" className="text-xs font-medium text-primary-600 hover:text-primary-700">
            Audit log →
          </Link>
        </div>
        {activity.length === 0 ? (
          <p className="px-5 pb-4 text-sm text-ink-400">
            Changes to products, pricing, orders, and more will appear here.
          </p>
        ) : (
          <ul className="divide-y divide-ink-100">
            {activity.map((a) => (
              <li key={a.id} className="flex items-center justify-between px-5 py-3 text-sm">
                <span className="text-ink-700">
                  <span className="font-medium text-ink-900">{a.changed_by_name ?? 'System'}</span>{' '}
                  {a.action === 'INSERT' || a.action === 'insert'
                    ? 'added'
                    : a.action === 'UPDATE' || a.action === 'update'
                      ? 'updated'
                      : 'removed'}{' '}
                  {TABLE_LABELS[a.table_name] ?? a.table_name}
                </span>
                <span className="text-xs text-ink-400">{new Date(a.created_at).toLocaleString('en-IN')}</span>
              </li>
            ))}
          </ul>
        )}
      </Card>

      {/* Quick catalog stats */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatCard icon={Tag} label="Brands" value={counts.totalBrands} />
        <StatCard icon={Tags} label="Categories" value={counts.totalCategories} />
        <StatCard icon={Warehouse} label="Warehouses" value={counts.totalWarehouses} />
        <StatCard icon={IndianRupee} label="Outstanding" value={`₹${formatCompact(outstandingTotal)}`} />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// UI Components
// ---------------------------------------------------------------------------

function DateFilterButton({ range, current, label }: { range: DateRange; current: DateRange; label: string }) {
  const isActive = current === range;
  return (
    <Link
      href={`/admin/dashboard?range=${range}`}
      className={`rounded-full px-3 py-1.5 text-xs font-medium transition-colors ${
        isActive ? 'bg-ink-950 text-white' : 'bg-ink-100 text-ink-600 hover:bg-ink-200'
      }`}
    >
      {label}
    </Link>
  );
}

function StatCard({
  icon: Icon,
  label,
  value,
  hint,
  accent,
  warn,
  href,
}: {
  icon: React.ElementType;
  label: string;
  value: number | string;
  hint?: string;
  accent?: boolean;
  warn?: boolean;
  href?: string;
}) {
  const content = (
    <div className="flex items-start justify-between">
      <div>
        <p className="text-xs text-ink-500">{label}</p>
        <p className={`mt-1 text-xl font-semibold ${warn ? 'text-primary-600' : accent ? 'text-ink-950' : 'text-ink-950'}`}>
          {value}
        </p>
        {hint ? <p className="mt-0.5 text-[11px] text-ink-400">{hint}</p> : null}
      </div>
      <div className={`flex h-9 w-9 items-center justify-center rounded-xl ${warn ? 'bg-primary-50' : 'bg-ink-50'}`}>
        <Icon className={`h-4.5 w-4.5 ${warn ? 'text-primary-600' : 'text-ink-400'}`} />
      </div>
    </div>
  );

  if (href) {
    return (
      <Link href={href}>
        <Card className="transition-colors hover:border-primary-200">{content}</Card>
      </Link>
    );
  }

  return <Card>{content}</Card>;
}

const STATUS_STYLES: Record<string, string> = {
  pending: 'bg-amber-50 text-amber-700',
  confirmed: 'bg-blue-50 text-blue-700',
  processing: 'bg-blue-50 text-blue-700',
  packed: 'bg-violet-50 text-violet-700',
  dispatched: 'bg-violet-50 text-violet-700',
  delivered: 'bg-green-50 text-green-700',
  cancelled: 'bg-primary-50 text-primary-700',
  returned: 'bg-primary-50 text-primary-700',
};

function StatusBadge({ status }: { status: string }) {
  return (
    <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${STATUS_STYLES[status] ?? 'bg-ink-100 text-ink-600'}`}>
      {status.charAt(0).toUpperCase() + status.slice(1)}
    </span>
  );
}

function formatCompact(value: number): string {
  if (value >= 1_00_00_000) return `₹${(value / 1_00_00_000).toFixed(1)}Cr`.replace('₹', '');
  if (value >= 1_00_000) return `${(value / 1_00_000).toFixed(1)}L`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}k`;
  return value.toFixed(0);
}
