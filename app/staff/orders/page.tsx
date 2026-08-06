import Link from 'next/link';
import { Truck } from 'lucide-react';
import { createClient } from '@/lib/supabase/server';
import { Card } from '@/components/ui/card';
import { AdminEmptyState } from '@/components/admin/empty-state';

interface OrderRow {
  id: string;
  order_number: string;
  status: string;
  grand_total: number;
  placed_at: string;
  retailers: { shop_name: string } | null;
  warehouses: { name: string } | null;
}

const STATUS_STYLES: Record<string, string> = {
  confirmed: 'bg-blue-50 text-blue-700',
  processing: 'bg-blue-50 text-blue-700',
  packed: 'bg-violet-50 text-violet-700',
};

export default async function StaffOrdersPage() {
  const supabase = createClient();

  const { data } = await supabase
    .from('orders')
    .select('id, order_number, status, grand_total, placed_at, retailers ( shop_name ), warehouses ( name )')
    .in('status', ['confirmed', 'processing', 'packed'])
    .order('placed_at', { ascending: true });

  const orders = (data ?? []) as unknown as OrderRow[];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-ink-950">Dispatch Queue</h1>
        <p className="mt-1 text-sm text-ink-500">Approved orders waiting to be packed and dispatched.</p>
      </div>

      {orders.length === 0 ? (
        <AdminEmptyState
          icon={Truck}
          title="Nothing to dispatch"
          body="Orders approved by an admin will appear here, ready for you to pack and dispatch."
        />
      ) : (
        <div className="space-y-2">
          {orders.map((o) => (
            <Link key={o.id} href={`/staff/orders/${o.id}`}>
              <Card className="flex items-center justify-between p-4">
                <div>
                  <p className="font-mono text-sm font-medium text-ink-900">{o.order_number}</p>
                  <p className="text-xs text-ink-500">{o.retailers?.shop_name}</p>
                  <p className="text-xs text-ink-400">{o.warehouses?.name ?? 'No warehouse assigned'}</p>
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
      )}
    </div>
  );
}
