import { Users, UserCheck, TrendingUp, PackageSearch, Sparkles, Tag, Tags, Warehouse, Activity } from 'lucide-react';
import { createClient } from '@/lib/supabase/server';
import { Card, CardHeader, CardTitle } from '@/components/ui/card';

async function getCounts() {
  const supabase = createClient();

  const [
    { count: totalRetailers },
    { count: pendingRetailers },
    { count: totalProducts },
    { count: totalBrands },
    { count: totalCategories },
    { count: totalWarehouses },
  ] = await Promise.all([
    supabase.from('retailers').select('id', { count: 'exact', head: true }),
    supabase.from('retailers').select('id', { count: 'exact', head: true }).eq('status', 'pending_approval'),
    supabase.from('products').select('id', { count: 'exact', head: true }),
    supabase.from('brands').select('id', { count: 'exact', head: true }),
    supabase.from('categories').select('id', { count: 'exact', head: true }),
    supabase.from('warehouses').select('id', { count: 'exact', head: true }),
  ]);

  return {
    totalRetailers: totalRetailers ?? 0,
    pendingRetailers: pendingRetailers ?? 0,
    totalProducts: totalProducts ?? 0,
    totalBrands: totalBrands ?? 0,
    totalCategories: totalCategories ?? 0,
    totalWarehouses: totalWarehouses ?? 0,
  };
}

interface ActivityRow {
  id: string;
  table_name: string;
  action: string;
  created_at: string;
  profiles: { full_name: string } | null;
}

const TABLE_LABELS: Record<string, string> = {
  products: 'a product',
  price_lists: 'a price',
  orders: 'an order',
  product_packs: 'a product pack',
  retailer_documents: 'a retailer document',
};

async function getRecentActivity(): Promise<ActivityRow[]> {
  const supabase = createClient();
  const { data } = await supabase
    .from('audit_logs')
    .select('id, table_name, action, created_at, profiles ( full_name )')
    .order('created_at', { ascending: false })
    .limit(10);
  return (data ?? []) as unknown as ActivityRow[];
}

export default async function AdminDashboardPage() {
  const [{ totalRetailers, pendingRetailers, totalProducts, totalBrands, totalCategories, totalWarehouses }, activity] =
    await Promise.all([getCounts(), getRecentActivity()]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-ink-950">Dashboard</h1>
        <p className="mt-1 text-sm text-ink-500">
          Live overview of your distribution network. Numbers reflect real data only.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard icon={Users} label="Total Retailers" value={totalRetailers} />
        <StatCard
          icon={UserCheck}
          label="Pending Approvals"
          value={pendingRetailers}
          accent={pendingRetailers > 0}
        />
        <StatCard icon={PackageSearch} label="Total Products" value={totalProducts} hint={totalProducts === 0 ? 'Add products to get started' : undefined} />
        <StatCard icon={TrendingUp} label="Orders Today" value={0} hint="No orders placed yet" />
        <StatCard icon={Tag} label="Total Brands" value={totalBrands} />
        <StatCard icon={Tags} label="Total Categories" value={totalCategories} />
        <StatCard icon={Warehouse} label="Total Warehouses" value={totalWarehouses} />
      </div>

      <div>
        <div className="mb-3 flex items-center gap-2">
          <Sparkles className="h-4 w-4 text-primary-600" />
          <h2 className="text-sm font-semibold text-ink-800">AI Dashboard</h2>
        </div>
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <InsightCard
            title="Daily Sales Prediction"
            body="Predictions activate automatically once at least 14 days of order history are available."
          />
          <InsightCard
            title="Top Selling Products"
            body="Will populate from real order data as products are sold. No data yet."
          />
          <InsightCard
            title="Low Stock Prediction"
            body="Runs against live warehouse stock and sales velocity — add products and stock to enable."
          />
          <InsightCard
            title="Customer Purchase Analysis"
            body="Retailer purchase patterns (RFM scoring) build up as orders come in."
          />
        </div>
      </div>

      <div>
        <div className="mb-3 flex items-center gap-2">
          <Activity className="h-4 w-4 text-primary-600" />
          <h2 className="text-sm font-semibold text-ink-800">Recent Activity</h2>
        </div>
        {activity.length === 0 ? (
          <Card>
            <p className="text-sm text-ink-500">
              Changes to products, pricing, and orders made by your team will show up here.
            </p>
          </Card>
        ) : (
          <Card className="overflow-hidden p-0">
            <ul className="divide-y divide-ink-100">
              {activity.map((a) => (
                <li key={a.id} className="flex items-center justify-between px-5 py-3 text-sm">
                  <span className="text-ink-700">
                    <span className="font-medium text-ink-900">{a.profiles?.full_name ?? 'Someone'}</span>{' '}
                    {a.action === 'insert' ? 'added' : a.action === 'update' ? 'updated' : 'removed'}{' '}
                    {TABLE_LABELS[a.table_name] ?? a.table_name}
                  </span>
                  <span className="text-xs text-ink-400">{new Date(a.created_at).toLocaleString('en-IN')}</span>
                </li>
              ))}
            </ul>
          </Card>
        )}
      </div>

      {totalRetailers === 0 ? (
        <Card className="border-primary-100 bg-primary-50/40">
          <CardHeader>
            <CardTitle>Get your platform ready</CardTitle>
          </CardHeader>
          <ol className="list-inside list-decimal space-y-1.5 text-sm text-ink-600">
            <li>Set up Areas for Khagaria district (Admin → Catalog).</li>
            <li>Add Brands, Categories, and Products.</li>
            <li>Configure base pricing.</li>
            <li>Approve retailer registrations as they come in.</li>
          </ol>
        </Card>
      ) : null}
    </div>
  );
}

function StatCard({
  icon: Icon,
  label,
  value,
  hint,
  accent,
}: {
  icon: React.ElementType;
  label: string;
  value: number;
  hint?: string;
  accent?: boolean;
}) {
  return (
    <Card>
      <div className="flex items-start justify-between">
        <div>
          <p className="text-sm text-ink-500">{label}</p>
          <p className={`mt-1 text-2xl font-semibold ${accent ? 'text-primary-600' : 'text-ink-950'}`}>
            {value}
          </p>
          {hint ? <p className="mt-1 text-xs text-ink-400">{hint}</p> : null}
        </div>
        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary-50">
          <Icon className="h-5 w-5 text-primary-600" />
        </div>
      </div>
    </Card>
  );
}

function InsightCard({ title, body }: { title: string; body: string }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
      </CardHeader>
      <p className="text-sm text-ink-500">{body}</p>
    </Card>
  );
          }
