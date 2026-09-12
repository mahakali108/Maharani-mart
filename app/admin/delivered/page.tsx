import Link from 'next/link';
import { Download, PackageCheck, Search, ShieldAlert } from 'lucide-react';
import { requirePermission } from '@/lib/admin/guard';
import { createClient } from '@/lib/supabase/server';
import { DeliveryStatusBadge } from '@/components/delivery/delivery-status-badge';
import { AdminEmptyState } from '@/components/admin/empty-state';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Button } from '@/components/ui/button';
import { formatIndiaDateTime } from '@/lib/datetime/india';

const PAGE_SIZE = 20;

const COMPLETED_STATUSES = ['delivered', 'partially_delivered', 'returned_to_warehouse'];

interface DeliveredRow {
  order_id: string;
  delivery_status: string;
  delivered_at: string | null;
  receiver_name: string | null;
  otp_verified_at: string | null;
  signature_url: string | null;
  photo_url: string | null;
  assigned_name: { full_name: string } | null;
  orders: {
    order_number: string;
    grand_total: number;
    retailers: { shop_name: string } | null;
  } | null;
}

export default async function AdminDeliveredPage({
  searchParams,
}: {
  searchParams: { q?: string; outcome?: string; staff?: string; from?: string; to?: string; page?: string };
}) {
  await requirePermission('orders.view.all');
  const supabase = createClient();

  const q = searchParams.q?.trim() ?? '';
  const outcome = searchParams.outcome ?? '';
  const staff = searchParams.staff ?? '';
  const from = searchParams.from ?? '';
  const to = searchParams.to ?? '';
  const page = Math.max(1, Number(searchParams.page) || 1);
  const fromRow = (page - 1) * PAGE_SIZE;

  // Delivery people for the filter dropdown.
  const { data: staffProfiles } = await supabase
    .from('profiles')
    .select('id, full_name, role')
    .in('role', ['staff', 'salesman'])
    .eq('is_active', true)
    .order('full_name');
  const staffOptions = (staffProfiles ?? []) as { id: string; full_name: string; role: string }[];

  let query = supabase
    .from('order_deliveries')
    .select(
      `order_id, delivery_status, delivered_at, receiver_name, otp_verified_at, signature_url, photo_url,
       assigned_name:profiles!order_deliveries_assigned_staff_id_fkey ( full_name ),
       orders!inner ( order_number, grand_total, retailers ( shop_name ) )`,
      { count: 'exact' }
    )
    .in('delivery_status', COMPLETED_STATUSES)
    .order('delivered_at', { ascending: false, nullsFirst: false })
    .range(fromRow, fromRow + PAGE_SIZE - 1);

  if (outcome) query = query.eq('delivery_status', outcome);
  if (staff) query = query.eq('assigned_staff_id', staff);
  if (from) query = query.gte('delivered_at', `${from}T00:00:00`);
  if (to) query = query.lte('delivered_at', `${to}T23:59:59`);
  if (q) query = query.ilike('orders.order_number', `%${q}%`);

  const { data, count } = await query;
  const rows = (data ?? []) as unknown as DeliveredRow[];
  const totalPages = Math.max(1, Math.ceil((count ?? 0) / PAGE_SIZE));
  const hasFilters = q || outcome || staff || from || to;

  const exportHref = `/admin/delivered/export?${new URLSearchParams({
    ...(q ? { q } : {}),
    ...(outcome ? { outcome } : {}),
    ...(staff ? { staff } : {}),
    ...(from ? { from } : {}),
    ...(to ? { to } : {}),
  }).toString()}`;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-ink-950">Delivered Orders</h1>
          <p className="mt-1 text-sm text-ink-500">
            Every completed delivery with proof status, receiver, OTP verification and return window.
          </p>
        </div>
        <Link href={exportHref}>
          <Button variant="outline" size="sm">
            <Download className="h-4 w-4" /> Export CSV
          </Button>
        </Link>
      </div>

      <Card>
        <form method="get" className="grid grid-cols-1 gap-3 sm:grid-cols-3 lg:grid-cols-6">
          <div className="relative sm:col-span-2">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-400" />
            <Input name="q" defaultValue={q} placeholder="Search order number…" className="pl-9" />
          </div>
          <Select name="outcome" defaultValue={outcome}>
            <option value="">All outcomes</option>
            <option value="delivered">Fully delivered</option>
            <option value="partially_delivered">Partially delivered</option>
            <option value="returned_to_warehouse">Returned to warehouse</option>
          </Select>
          <Select name="staff" defaultValue={staff}>
            <option value="">Any delivery person</option>
            {staffOptions.map((s) => (
              <option key={s.id} value={s.id}>
                {s.full_name} ({s.role === 'salesman' ? 'sales' : 'staff'})
              </option>
            ))}
          </Select>
          <Input name="from" type="date" defaultValue={from} aria-label="Delivered from" />
          <div className="flex gap-2">
            <Input name="to" type="date" defaultValue={to} aria-label="Delivered to" />
            <Button type="submit" variant="secondary" size="sm">
              Apply
            </Button>
          </div>
        </form>
        {hasFilters ? (
          <div className="mt-2">
            <Link href="/admin/delivered">
              <Button type="button" variant="ghost" size="sm">
                Clear filters
              </Button>
            </Link>
          </div>
        ) : null}
      </Card>

      {rows.length === 0 ? (
        <AdminEmptyState
          icon={PackageCheck}
          title={hasFilters ? 'No deliveries match your filters' : 'No completed deliveries yet'}
          body={
            hasFilters
              ? 'Try a different search or clear the filters above.'
              : 'When dispatched orders are completed with the retailer\u2019s OTP, they appear here.'
          }
        />
      ) : (
        <Card className="table-scroll p-0">
          <table className="w-full min-w-[900px] text-sm">
            <thead className="border-b border-ink-100 bg-ink-50 text-left text-xs uppercase tracking-wide text-ink-500">
              <tr>
                <th className="px-5 py-3 font-medium">Order #</th>
                <th className="px-5 py-3 font-medium">Retailer</th>
                <th className="px-5 py-3 font-medium">Delivered at</th>
                <th className="px-5 py-3 font-medium">Receiver</th>
                <th className="px-5 py-3 font-medium">By</th>
                <th className="px-5 py-3 font-medium">OTP</th>
                <th className="px-5 py-3 font-medium">Proof</th>
                <th className="px-5 py-3 font-medium">Outcome</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-ink-100">
              {rows.map((row) => {
                const proofsMissing = !row.signature_url && !row.photo_url;
                return (
                  <tr key={row.order_id} className="hover:bg-ink-50/50">
                    <td className="px-5 py-3">
                      <Link
                        href={`/admin/delivered/${row.order_id}`}
                        className="font-mono text-xs font-medium text-ink-900 hover:text-primary-600"
                      >
                        {row.orders?.order_number ?? '—'}
                      </Link>
                    </td>
                    <td className="px-5 py-3 text-ink-600">{row.orders?.retailers?.shop_name ?? '—'}</td>
                    <td className="px-5 py-3 text-ink-500">
                      {row.delivered_at ? formatIndiaDateTime(row.delivered_at) : '—'}
                    </td>
                    <td className="px-5 py-3 text-ink-600">{row.receiver_name ?? '—'}</td>
                    <td className="px-5 py-3 text-ink-600">{row.assigned_name?.full_name ?? '—'}</td>
                    <td className="px-5 py-3">
                      {row.otp_verified_at ? (
                        <span className="rounded-full bg-green-50 px-2 py-0.5 text-xs font-medium text-green-700">Verified</span>
                      ) : (
                        <span className="rounded-full bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-700">Not verified</span>
                      )}
                    </td>
                    <td className="px-5 py-3">
                      {proofsMissing ? (
                        <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-700">
                          <ShieldAlert className="h-3 w-3" /> None
                        </span>
                      ) : (
                        <span className="rounded-full bg-green-50 px-2 py-0.5 text-xs font-medium text-green-700">
                          Attached
                        </span>
                      )}
                    </td>
                    <td className="px-5 py-3">
                      <DeliveryStatusBadge status={row.delivery_status} />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </Card>
      )}

      {totalPages > 1 ? (
        <div className="flex items-center justify-center gap-2">
          {page > 1 ? (
            <Link href={`/admin/delivered?q=${q}&outcome=${outcome}&staff=${staff}&from=${from}&to=${to}&page=${page - 1}`}>
              <Button size="sm" variant="outline">Previous</Button>
            </Link>
          ) : null}
          <span className="text-xs text-ink-400">Page {page} of {totalPages}</span>
          {page < totalPages ? (
            <Link href={`/admin/delivered?q=${q}&outcome=${outcome}&staff=${staff}&from=${from}&to=${to}&page=${page + 1}`}>
              <Button size="sm" variant="outline">Next</Button>
            </Link>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
