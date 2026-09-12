import Link from 'next/link';
import { Truck, PackageCheck, History } from 'lucide-react';
import { requirePermission } from '@/lib/admin/guard';
import { createClient } from '@/lib/supabase/server';
import { listOpenDeliveriesForUser, listRecentDeliveriesForUser } from '@/lib/delivery/queries';
import { DeliveryStatusBadge } from '@/components/delivery/delivery-status-badge';
import { AdminEmptyState } from '@/components/admin/empty-state';
import { Card } from '@/components/ui/card';
import { formatIndiaDateTime } from '@/lib/datetime/india';

export default async function StaffDeliveriesPage() {
  const user = await requirePermission('deliveries.view.assigned');
  const [open, recent] = await Promise.all([
    listOpenDeliveriesForUser(user.id),
    listRecentDeliveriesForUser(user.id),
  ]);

  // Fallback: RLS may also show unassigned tasks inside the caller's scope —
  // surface those so a dispatcher's colleague can pick them up after asking
  // an admin to reassign, and so nothing is silently invisible.
  const supabase = createClient();
  const { data: unassigned } = await supabase
    .from('order_deliveries')
    .select('order_id, delivery_status, orders ( order_number, retailers ( shop_name ) )')
    .is('assigned_staff_id', null)
    .eq('delivery_status', 'assigned')
    .order('dispatched_at', { ascending: true, nullsFirst: false })
    .limit(10);
  const unassignedRows = (unassigned ?? []) as unknown as {
    order_id: string;
    delivery_status: string;
    orders: { order_number: string; retailers: { shop_name: string } | null } | null;
  }[];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-ink-950">My Deliveries</h1>
        <p className="mt-1 text-sm text-ink-500">
          Orders assigned to you for delivery. Complete them with the retailer&apos;s OTP.
        </p>
      </div>

      {open.length === 0 ? (
        <AdminEmptyState
          icon={Truck}
          title="No open deliveries"
          body="When an order is dispatched and assigned to you, it will appear here with its delivery task."
        />
      ) : (
        <div className="space-y-2">
          {open.map((row) => (
            <Link key={row.order_id} href={`/staff/deliveries/${row.order_id}`}>
              <Card className="flex min-w-0 flex-wrap items-center justify-between gap-3 p-4">
                <div className="min-w-0">
                  <p className="font-mono text-sm font-medium text-ink-900">{row.order_number}</p>
                  <p className="truncate text-xs text-ink-500">{row.shop_name ?? '—'}</p>
                  <p className="truncate text-xs text-ink-400">{row.shipping_line ?? 'No address on file'}</p>
                  <p className="text-xs text-ink-400">
                    Dispatched {row.dispatched_at ? formatIndiaDateTime(row.dispatched_at) : '—'}
                  </p>
                </div>
                <div className="flex flex-col items-end gap-1.5">
                  <span className="text-sm font-semibold text-ink-900">₹{row.grand_total.toFixed(2)}</span>
                  <DeliveryStatusBadge status={row.delivery_status} />
                </div>
              </Card>
            </Link>
          ))}
        </div>
      )}

      {unassignedRows.length > 0 ? (
        <div className="space-y-2">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-ink-500">Unassigned tasks in your scope</h2>
          {unassignedRows.map((row) => (
            <Card key={row.order_id} className="flex flex-wrap items-center justify-between gap-3 p-4">
              <div className="min-w-0">
                <p className="font-mono text-sm font-medium text-ink-900">{row.orders?.order_number ?? '—'}</p>
                <p className="truncate text-xs text-ink-500">{row.orders?.retailers?.shop_name ?? '—'}</p>
              </div>
              <span className="text-xs text-ink-400">Ask an admin to assign it to you</span>
            </Card>
          ))}
        </div>
      ) : null}

      {recent.length > 0 ? (
        <div className="space-y-2">
          <h2 className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-ink-500">
            <History className="h-4 w-4" /> Recent completions
          </h2>
          {recent.map((row) => (
            <Link key={row.order_id} href={`/staff/deliveries/${row.order_id}`}>
              <Card className="flex min-w-0 flex-wrap items-center justify-between gap-3 p-4">
                <div className="min-w-0">
                  <p className="font-mono text-sm font-medium text-ink-900">{row.order_number}</p>
                  <p className="truncate text-xs text-ink-500">{row.shop_name ?? '—'}</p>
                </div>
                <div className="flex items-center gap-2">
                  {row.receiver_name ? (
                    <span className="hidden items-center gap-1 text-xs text-ink-400 sm:inline-flex">
                      <PackageCheck className="h-3.5 w-3.5" /> {row.receiver_name}
                    </span>
                  ) : null}
                  <DeliveryStatusBadge status={row.delivery_status} />
                </div>
              </Card>
            </Link>
          ))}
        </div>
      ) : null}
    </div>
  );
}
