import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ClipboardList, ShoppingCart } from 'lucide-react';
import { createClient } from '@/lib/supabase/server';
import { throwIfReadFailed } from '@/lib/supabase/read-guard';
import { requireUser } from '@/lib/auth/session';
import { Card, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { formatIndiaDateTime } from '@/lib/datetime/india';
import { getRetailerCoinPosition } from '@/lib/coins/server';

interface RetailerDetail {
  id: string;
  shop_name: string;
  gstin: string | null;
  area_id: string;
  address: string | null;
  status: 'pending_approval' | 'active' | 'suspended';
  created_at: string;
}

interface RecentOrder {
  id: string;
  order_number: string;
  status: string;
  grand_total: number;
  placed_at: string;
  collected_by: string | null;
}

export default async function SalesmanRetailerDetailPage({ params: paramsPromise }: { params: Promise<{ id: string }> }) {
  const params = await paramsPromise;
  const user = await requireUser();
  const supabase = (await createClient());

  // The explicit assignment filter is the application-level boundary;
  // retailers RLS repeats the same condition at the database boundary.
  // Therefore manually entering an unassigned retailer UUID returns 404.
  const { data: retailer, error: retailerError } = await supabase
    .from('retailers')
    .select('id, shop_name, gstin, area_id, address, status, created_at')
    .eq('id', params.id)
    .eq('assigned_salesman_id', user.id)
    .maybeSingle<RetailerDetail>();

  throwIfReadFailed(retailerError, 'Retailer');
  if (!retailer) notFound();

  // Separate profile/area queries preserve the safe retailer-list pattern
  // used by the existing admin screens (no shared-PK embedded profile join).
  const [{ data: profile }, { data: area }, { data: orderData }] = await Promise.all([
    supabase
      .from('profiles')
      .select('full_name, phone')
      .eq('id', retailer.id)
      .maybeSingle<{ full_name: string; phone: string }>(),
    supabase.from('areas').select('name').eq('id', retailer.area_id).maybeSingle<{ name: string }>(),
    supabase
      .from('orders')
      .select('id, order_number, status, grand_total, placed_at, collected_by')
      .eq('retailer_id', retailer.id)
      .order('placed_at', { ascending: false })
      .limit(5)
      .returns<RecentOrder[]>(),
  ]);

  const recentOrders = orderData ?? [];
  // 🪙 Coins are the shop's only balance — read from the same server source the
  // checkout bills with. No credit limit/outstanding is shown to the field team.
  const coinPosition = await getRetailerCoinPosition(supabase, retailer.id);

  return (
    <div className="space-y-5">
      <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-start">
        <div>
          <h1 className="text-xl font-semibold text-ink-950">{retailer.shop_name}</h1>
          <p className="mt-1 text-sm text-ink-500">
            {profile?.full_name ?? 'Owner name unavailable'}{profile?.phone ? ` · ${profile.phone}` : ''}
          </p>
        </div>
        {retailer.status === 'active' ? (
          <Link href={`/salesman/orders/new?retailer=${retailer.id}`}>
            <Button size="sm"><ShoppingCart className="h-4 w-4" /> Create order</Button>
          </Link>
        ) : null}
      </div>

      <Card>
        <CardHeader><CardTitle>Retailer details</CardTitle></CardHeader>
        <dl className="grid grid-cols-1 gap-4 text-sm sm:grid-cols-2">
          <div><dt className="text-ink-400">Area</dt><dd className="font-medium text-ink-900">{area?.name ?? '—'}</dd></div>
          <div><dt className="text-ink-400">Status</dt><dd className="font-medium capitalize text-ink-900">{retailer.status.replace('_', ' ')}</dd></div>
          <div><dt className="text-ink-400">Phone</dt><dd className="font-medium text-ink-900">{profile?.phone ?? '—'}</dd></div>
          <div><dt className="text-ink-400">GSTIN</dt><dd className="font-medium text-ink-900">{retailer.gstin ?? '—'}</dd></div>
          <div className="sm:col-span-2"><dt className="text-ink-400">Address</dt><dd className="font-medium text-ink-900">{retailer.address ?? '—'}</dd></div>
        </dl>
      </Card>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Card className="p-3">
          <p className="text-xs text-amber-700">🪙 Coins available</p>
          <p className="mt-1 text-sm font-semibold text-ink-900">₹{coinPosition.balanceRupees.toFixed(2)}</p>
        </Card>
        <Card className="p-3">
          <p className="text-xs text-ink-400">Coins spent</p>
          <p className="mt-1 text-sm font-semibold text-ink-900">₹{(coinPosition.outstandingPaise / 100).toFixed(2)}</p>
        </Card>
        <Card className="p-3">
          <p className="text-xs text-ink-400">Settlement</p>
          <p className="mt-1 text-sm font-semibold text-ink-900">🪙 Coins + cash on delivery</p>
        </Card>
      </div>

      <Card>
        <CardHeader><CardTitle>Recent orders</CardTitle></CardHeader>
        {recentOrders.length === 0 ? (
          <div className="flex flex-col items-center py-6 text-center">
            <ClipboardList className="h-7 w-7 text-ink-300" />
            <p className="mt-2 text-sm text-ink-500">No orders for this retailer yet.</p>
          </div>
        ) : (
          <div className="divide-y divide-ink-100">
            {recentOrders.map((order) => (
              <Link key={order.id} href={`/salesman/orders/${order.id}`} className="flex min-w-0 items-center justify-between gap-3 py-3">
                <div className="min-w-0">
                  <p className="break-all font-mono text-sm font-medium text-ink-900">{order.order_number}</p>
                  <p className="break-words text-xs text-ink-400">{formatIndiaDateTime(order.placed_at)}{order.collected_by === user.id ? ' · Collected by you' : ''}</p>
                </div>
                <div className="shrink-0 text-right">
                  <p className="text-sm font-semibold text-ink-900">₹{order.grand_total.toFixed(2)}</p>
                  <p className="text-xs capitalize text-ink-400">{order.status}</p>
                </div>
              </Link>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}
