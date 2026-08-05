import Link from 'next/link';
import { Search, ShoppingCart } from 'lucide-react';
import { createClient } from '@/lib/supabase/server';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Button } from '@/components/ui/button';
import { AdminEmptyState } from '@/components/admin/empty-state';

const PAGE_SIZE = 20;

const STATUS_OPTIONS = ['pending', 'confirmed', 'processing', 'packed', 'dispatched', 'delivered', 'cancelled', 'returned'];

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

interface OrderRow {
  id: string;
  order_number: string;
  status: string;
  grand_total: number;
  placed_at: string;
  retailers: { shop_name: string } | null;
}

export default async function AdminOrdersPage({
  searchParams,
}: {
  searchParams: { q?: string; status?: string; page?: string };
}) {
  const supabase = createClient();

  const q = searchParams.q?.trim() ?? '';
  const status = searchParams.status ?? '';
  const page = Math.max(1, Number(searchParams.page) || 1);
  const from = (page - 1) * PAGE_SIZE;
  const to = from + PAGE_SIZE - 1;

  let query = supabase
    .from('orders')
    .select('id, order_number, status, grand_total, placed_at, retailers ( shop_name )', { count: 'exact' })
    .order('placed_at', { ascending: false })
    .range(from, to);

  if (q) query = query.ilike('order_number', `%${q}%`);
  if (status) query = query.eq('status', status);

  const { data, count } = await query;
  const orders = (data ?? []) as unknown as OrderRow[];
  const totalPages = Math.max(1, Math.ceil((count ?? 0) / PAGE_SIZE));
  const hasFilters = q || status;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-ink-950">Orders</h1>
        <p className="mt-1 text-sm text-ink-500">All retailer orders across the network.</p>
      </div>

      <Card>
        <form method="get" className="grid grid-cols-1 gap-3 sm:grid-cols-4">
          <div className="relative sm:col-span-2">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-400" />
            <Input name="q" defaultValue={q} placeholder="Search order number…" className="pl-9" />
          </div>
          <Select name="status" defaultValue={status}>
            <option value="">All statuses</option>
            {STATUS_OPTIONS.map((s) => (
              <option key={s} value={s}>
                {s.charAt(0).toUpperCase() + s.slice(1)}
              </option>
            ))}
          </Select>
          <div className="flex gap-2">
            <Button type="submit" variant="secondary" size="sm">
              Apply
            </Button>
            {hasFilters ? (
              <Link href="/admin/orders">
                <Button type="button" variant="ghost" size="sm">
                  Clear
                </Button>
              </Link>
            ) : null}
          </div>
        </form>
      </Card>

      {orders.length === 0 ? (
        <AdminEmptyState
          icon={ShoppingCart}
          title={hasFilters ? 'No orders match your filters' : 'No orders yet'}
          body={hasFilters ? 'Try a different search or clear the filters above.' : 'Orders placed by retailers will appear here.'}
        />
      ) : (
        <>
          <Card className="overflow-hidden p-0">
            <table className="w-full text-sm">
              <thead className="border-b border-ink-100 bg-ink-50 text-left text-xs uppercase tracking-wide text-ink-500">
                <tr>
                  <th className="px-5 py-3 font-medium">Order #</th>
                  <th className="px-5 py-3 font-medium">Retailer</th>
                  <th className="px-5 py-3 font-medium">Total</th>
                  <th className="px-5 py-3 font-medium">Status</th>
                  <th className="px-5 py-3 font-medium">Placed</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-ink-100">
                {orders.map((o) => (
                  <tr key={o.id}>
                    <td className="px-5 py-3">
                      <Link href={`/admin/orders/${o.id}`} className="font-mono text-xs font-medium text-ink-900 hover:text-primary-600">
                        {o.order_number}
                      </Link>
                    </td>
                    <td className="px-5 py-3 text-ink-600">{o.retailers?.shop_name ?? '—'}</td>
                    <td className="px-5 py-3 font-medium text-ink-900">₹{o.grand_total.toFixed(2)}</td>
                    <td className="px-5 py-3">
                      <span className={`rounded-full px-2.5 py-1 text-xs font-medium ${STATUS_STYLES[o.status]}`}>
                        {o.status.charAt(0).toUpperCase() + o.status.slice(1)}
                      </span>
                    </td>
                    <td className="px-5 py-3 text-ink-500">{new Date(o.placed_at).toLocaleDateString('en-IN')}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>

          {totalPages > 1 ? (
            <div className="flex items-center justify-center gap-2">
              {page > 1 ? (
                <Link href={`/admin/orders?q=${q}&status=${status}&page=${page - 1}`}>
                  <Button size="sm" variant="outline">Previous</Button>
                </Link>
              ) : null}
              <span className="text-xs text-ink-400">Page {page} of {totalPages}</span>
              {page < totalPages ? (
                <Link href={`/admin/orders?q=${q}&status=${status}&page=${page + 1}`}>
                  <Button size="sm" variant="outline">Next</Button>
                </Link>
              ) : null}
            </div>
          ) : null}
        </>
      )}
    </div>
  );
}
