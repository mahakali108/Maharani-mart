import Link from 'next/link';
import { ClipboardList } from 'lucide-react';
import { createClient } from '@/lib/supabase/server';
import { requireUser } from '@/lib/auth/session';
import { Card } from '@/components/ui/card';
import { AdminEmptyState } from '@/components/admin/empty-state';

const STATUS_STYLES: Record<string, string> = {
  pending: 'bg-amber-50 text-amber-700',
  confirmed: 'bg-blue-50 text-blue-700',
  processing: 'bg-blue-50 text-blue-700',
  packed: 'bg-violet-50 text-violet-700',
  dispatched: 'bg-violet-50 text-violet-700',
  delivered: 'bg-green-50 text-green-700',
  cancelled: 'bg-primary-50 text-primary-700',
};

interface OrderRow {
  id: string;
  order_number: string;
  status: string;
  grand_total: number;
  placed_at: string;
  retailers: { shop_name: string; areas: { name: string } | null } | null;
}

export default async function SalesmanOrdersPage() {
  const user = await requireUser();
  const supabase = createClient();

  // Orders for retailers assigned to this salesman, or ones this
  // salesman personally collected in the field.
  const { data } = await supabase
    .from('orders')
    .select('id, order_number, status, grand_total, placed_at, retailers!inner ( shop_name, assigned_salesman_id, areas ( name ) )')
    .or(`collected_by.eq.${user.id},retailers.assigned_salesman_id.eq.${user.id}`)
    .order('placed_at', { ascending: false });

  const orders = (data ?? []) as unknown as OrderRow[];
  const dispatched = orders.filter((o) => o.status === 'dispatched');
  const others = orders.filter((o) => o.status !== 'dispatched');

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-ink-950">Assigned Orders</h1>
        <p className="mt-1 text-sm text-ink-500">Orders for your retailers, grouped by area.</p>
      </div>

      {orders.length === 0 ? (
        <AdminEmptyState
          icon={ClipboardList}
          title="No assigned orders yet"
          body="Orders from retailers assigned to your route will show up here."
        />
      ) : (
        <>
          {dispatched.length > 0 ? (
            <div>
              <h2 className="mb-2 text-sm font-semibold text-ink-800">Out for delivery</h2>
              <OrderList orders={dispatched} />
            </div>
          ) : null}
          {others.length > 0 ? (
            <div>
              <h2 className="mb-2 mt-4 text-sm font-semibold text-ink-800">Other orders</h2>
              <OrderList orders={others} />
            </div>
          ) : null}
        </>
      )}
    </div>
  );
}

function OrderList({ orders }: { orders: OrderRow[] }) {
  return (
    <div className="space-y-2">
      {orders.map((o) => (
        <Link key={o.id} href={`/salesman/orders/${o.id}`}>
          <Card className="flex items-center justify-between p-4">
            <div>
              <p className="font-mono text-sm font-medium text-ink-900">{o.order_number}</p>
              <p className="text-xs text-ink-500">{o.retailers?.shop_name}</p>
              <p className="text-xs text-ink-400">{o.retailers?.areas?.name}</p>
            </div>
            <div className="text-right">
              <p className="font-semibold text-ink-900">₹{o.grand_total.toFixed(2)}</p>
              <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_STYLES[o.status] ?? 'bg-ink-100 text-ink-600'}`}>
                {o.status.charAt(0).toUpperCase() + o.status.slice(1)}
              </span>
            </div>
          </Card>
        </Link>
      ))}
    </div>
  );
}
