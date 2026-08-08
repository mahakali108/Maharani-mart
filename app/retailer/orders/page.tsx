import Link from 'next/link';
import { ClipboardList } from 'lucide-react';
import { createClient } from '@/lib/supabase/server';
import { requireUser } from '@/lib/auth/session';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';

const PAGE_SIZE = 15;

type OrderStatus = 'pending' | 'confirmed' | 'processing' | 'packed' | 'dispatched' | 'delivered' | 'cancelled' | 'returned';

const STATUS_TABS: { value: OrderStatus | ''; label: string }[] = [
  { value: '', label: 'All' },
  { value: 'pending', label: 'Pending' },
  { value: 'confirmed', label: 'Confirmed' },
  { value: 'packed', label: 'Packed' },
  { value: 'dispatched', label: 'Dispatched' },
  { value: 'delivered', label: 'Delivered' },
  { value: 'cancelled', label: 'Cancelled' },
];

const STATUS_STYLES: Record<OrderStatus, string> = {
  pending: 'bg-amber-50 text-amber-700',
  confirmed: 'bg-blue-50 text-blue-700',
  processing: 'bg-blue-50 text-blue-700',
  packed: 'bg-violet-50 text-violet-700',
  dispatched: 'bg-violet-50 text-violet-700',
  delivered: 'bg-green-50 text-green-700',
  cancelled: 'bg-primary-50 text-primary-700',
  returned: 'bg-primary-50 text-primary-700',
};

interface OrderRow {
  id: string;
  order_number: string;
  status: OrderStatus;
  grand_total: number;
  placed_at: string;
}

export default async function OrdersPage({
  searchParams,
}: {
  searchParams: { status?: string; page?: string };
}) {
  const user = await requireUser();
  const supabase = createClient();

  const status = searchParams.status ?? '';
  const page = Math.max(1, Number(searchParams.page) || 1);
  const from = (page - 1) * PAGE_SIZE;
  const to = from + PAGE_SIZE - 1;

  let query = supabase
    .from('orders')
    .select('id, order_number, status, grand_total, placed_at', { count: 'exact' })
    .eq('retailer_id', user.id)
    .order('placed_at', { ascending: false })
    .range(from, to);

  if (status) query = query.eq('status', status);

  const { data, count } = await query;
  const orders = (data ?? []) as OrderRow[];
  const totalPages = Math.max(1, Math.ceil((count ?? 0) / PAGE_SIZE));

  return (
    <div className="space-y-5">
      <h1 className="text-xl font-semibold text-ink-950">My Orders</h1>

      <div className="flex gap-2 overflow-x-auto pb-1">
        {STATUS_TABS.map((tab) => (
          <Link key={tab.value} href={tab.value ? `/retailer/orders?status=${tab.value}` : '/retailer/orders'}>
            <span
              className={`inline-block whitespace-nowrap rounded-full px-3.5 py-1.5 text-sm font-medium ${
                status === tab.value ? 'bg-primary-600 text-white' : 'bg-ink-100 text-ink-600'
              }`}
            >
              {tab.label}
            </span>
          </Link>
        ))}
      </div>

      {orders.length === 0 ? (
        <Card className="flex flex-col items-center gap-2 py-12 text-center">
          <ClipboardList className="h-8 w-8 text-ink-300" />
          <p className="font-medium text-ink-700">
            {status ? `No ${status} orders` : 'No orders yet'}
          </p>
          <p className="text-sm text-ink-400">Orders you place will show up here.</p>
          {!status ? (
            <Link href="/retailer/catalog">
              <Button className="mt-2">Browse catalog</Button>
            </Link>
          ) : null}
        </Card>
      ) : (
        <>
          <div className="space-y-2">
            {orders.map((order) => (
              <Link key={order.id} href={`/retailer/orders/${order.id}`}>
                <Card className="flex items-center justify-between p-4">
                  <div>
                    <p className="font-mono text-sm font-medium text-ink-900">{order.order_number}</p>
                    <p className="text-xs text-ink-400">
                      {new Date(order.placed_at).toLocaleDateString('en-IN', {
                        day: 'numeric',
                        month: 'short',
                        year: 'numeric',
                      })}
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="font-semibold text-ink-900">₹{order.grand_total.toFixed(2)}</p>
                    <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_STYLES[order.status]}`}>
                      {order.status.charAt(0).toUpperCase() + order.status.slice(1)}
                    </span>
                  </div>
                </Card>
              </Link>
            ))}
          </div>

          {totalPages > 1 ? (
            <div className="flex items-center justify-center gap-2 pt-2">
              {page > 1 ? (
                <Link href={`/retailer/orders?status=${status}&page=${page - 1}`}>
                  <Button size="sm" variant="outline">
                    Previous
                  </Button>
                </Link>
              ) : null}
              <span className="text-xs text-ink-400">
                Page {page} of {totalPages}
              </span>
              {page < totalPages ? (
                <Link href={`/retailer/orders?status=${status}&page=${page + 1}`}>
                  <Button size="sm" variant="outline">
                    Next
                  </Button>
                </Link>
              ) : null}
            </div>
          ) : null}
        </>
      )}
    </div>
  );
}
