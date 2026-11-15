import { RotateCcw } from 'lucide-react';
import { createClient } from '@/lib/supabase/server';
import { Card } from '@/components/ui/card';
import { AdminEmptyState } from '@/components/admin/empty-state';
import { ReadFailureNotice } from '@/components/ui/read-failure-notice';
import { ReturnRowActions } from '@/components/admin/return-row-actions';
import { formatIndiaDateTime } from '@/lib/datetime/india';
import { requirePagePermission } from '@/lib/admin/guard';
import { formatPaise } from '@/lib/retailer/wallet';

interface ReturnRequestRow {
  id: string;
  reason: string;
  status: 'requested' | 'approved' | 'rejected' | 'completed';
  requested_at: string;
  resolution_note: string | null;
  order_id: string;
  order_item_id: string | null;
  orders: { order_number: string } | null;
  retailers: { shop_name: string } | null;
}

/** A Coins credit already issued at delivery for short or damaged goods on the same order. */
interface ShortfallCredit {
  amountPaise: number;
  issuedAt: string;
}

const STATUS_STYLES: Record<ReturnRequestRow['status'], string> = {
  requested: 'bg-amber-50 text-amber-700',
  approved: 'bg-mint-50 text-mint-700',
  rejected: 'bg-primary-50 text-primary-700',
  completed: 'bg-ink-100 text-ink-600',
};

export default async function ReturnsPage() {
  const user = await requirePagePermission('orders.return.manage');
  // Resolving a request is Admin / Super Admin only; the database enforces the
  // same rule (migration 0101). Staff can read the queue.
  const canResolve = user?.role === 'admin' || user?.role === 'super_admin';
  const supabase = (await createClient());

  const { data, error } = await supabase
    .from('return_requests')
    .select('id, reason, status, requested_at, resolution_note, order_id, order_item_id, orders ( order_number ), retailers ( shop_name )')
    .order('requested_at', { ascending: false });

  const returns = (data ?? []) as unknown as ReturnRequestRow[];
  const readFailed = Boolean(error);
  const pending = returns.filter((r) => r.status === 'requested');
  const resolved = returns.filter((r) => r.status !== 'requested');

  // Read-only context for the reviewer: was a shortfall already settled in
  // Coins for this order's delivery? Such a return is refused by the database
  // (RETURN_APPROVE:RECONCILE) and needs manual reconciliation. If this read
  // fails the page says so rather than implying there is no credit.
  const shortfalls = new Map<string, ShortfallCredit>();
  let shortfallReadFailed = false;
  const pendingOrderIds = Array.from(new Set(pending.map((r) => r.order_id).filter(Boolean)));
  if (pendingOrderIds.length > 0) {
    const deliveries = await supabase.from('order_deliveries').select('id, order_id').in('order_id', pendingOrderIds);
    const deliveryRows = (deliveries.data ?? []) as unknown as { id: string; order_id: string }[];
    if (deliveries.error) shortfallReadFailed = true;
    if (deliveryRows.length > 0) {
      const credits = await supabase
        .from('retailer_wallet_ledger')
        .select('reference_id, amount_paise, created_at')
        .eq('transaction_type', 'REFUND_CREDIT')
        .eq('reference_type', 'delivery')
        .in('reference_id', deliveryRows.map((d) => d.id));
      if (credits.error) shortfallReadFailed = true;
      const orderByDelivery = new Map(deliveryRows.map((d) => [d.id, d.order_id]));
      for (const row of (credits.data ?? []) as unknown as { reference_id: string; amount_paise: number | string; created_at: string }[]) {
        const orderId = orderByDelivery.get(row.reference_id);
        if (orderId) shortfalls.set(orderId, { amountPaise: Number(row.amount_paise), issuedAt: row.created_at });
      }
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-ink-950">Returns</h1>
        <p className="mt-1 text-sm text-ink-500">Return requests submitted by retailers on delivered orders.</p>
        <p className="mt-1 text-xs text-ink-500">
          Approving puts the goods back into stock. It does not refund Coins or change loyalty points.
          {canResolve ? '' : ' Only an Admin or Super Admin can approve or reject.'}
        </p>
        {shortfallReadFailed ? (
          <p className="mt-1 text-xs text-primary-700">
            Shortfall credit information could not be loaded, so it is not shown below. The database still checks it on approval.
          </p>
        ) : null}
      </div>

      {readFailed ? (
        <ReadFailureNotice what="Return requests" detail={error?.message} />
      ) : returns.length === 0 ? (
        <AdminEmptyState
          icon={RotateCcw}
          title="No return requests yet"
          body="Return requests retailers submit on delivered orders will appear here."
        />
      ) : (
        <>
          {pending.length > 0 ? (
            <div>
              <h2 className="mb-3 text-sm font-semibold text-ink-800">
                Awaiting review <span className="text-primary-600">({pending.length})</span>
              </h2>
              <ReturnsTable returns={pending} shortfalls={shortfalls} canResolve={canResolve} />
            </div>
          ) : null}

          {resolved.length > 0 ? (
            <div>
              <h2 className="mb-3 mt-8 text-sm font-semibold text-ink-800">Resolved</h2>
              <ReturnsTable returns={resolved} shortfalls={shortfalls} canResolve={canResolve} />
            </div>
          ) : null}
        </>
      )}
    </div>
  );
}

function ReturnsTable({
  returns,
  shortfalls,
  canResolve,
}: {
  returns: ReturnRequestRow[];
  shortfalls: Map<string, ShortfallCredit>;
  canResolve: boolean;
}) {
  return (
    <Card className="table-scroll p-0">
      <table className="w-full min-w-[760px] text-sm">
        <thead className="border-b border-ink-100 bg-ink-50 text-left text-xs uppercase tracking-wide text-ink-500">
          <tr>
            <th className="px-5 py-3 font-medium">Order</th>
            <th className="px-5 py-3 font-medium">Retailer</th>
            <th className="px-5 py-3 font-medium">Reason</th>
            <th className="px-5 py-3 font-medium">Requested</th>
            <th className="px-5 py-3 font-medium">Status</th>
            <th className="px-5 py-3 font-medium" />
          </tr>
        </thead>
        <tbody className="divide-y divide-ink-100">
          {returns.map((r) => (
            <tr key={r.id}>
              <td className="px-5 py-3 font-mono text-xs text-ink-500">{r.orders?.order_number ?? '—'}</td>
              <td className="px-5 py-3 text-ink-600">{r.retailers?.shop_name ?? '—'}</td>
              <td className="px-5 py-3 text-ink-600">
                {r.reason}
                <p className="mt-1 text-xs text-ink-400">{r.order_item_id ? 'One item of the order' : 'Whole order'}</p>
                {r.status === 'requested' && shortfalls.has(r.order_id) ? (
                  <p className="mt-1 max-w-xs text-xs text-amber-700">
                    Shortfall credit of {formatPaise(shortfalls.get(r.order_id)!.amountPaise)} was already issued in Coins for
                    this delivery on {formatIndiaDateTime(shortfalls.get(r.order_id)!.issuedAt)} (short or damaged goods).
                    A return that covers those goods cannot be approved here and needs manual reconciliation.
                  </p>
                ) : null}
              </td>
              <td className="px-5 py-3 text-ink-500">{formatIndiaDateTime(r.requested_at)}</td>
              <td className="px-5 py-3">
                <span className={`rounded-full px-2.5 py-1 text-xs font-medium ${STATUS_STYLES[r.status]}`}>
                  {r.status.charAt(0).toUpperCase() + r.status.slice(1)}
                </span>
                {r.resolution_note ? <p className="mt-1 text-xs text-ink-400">{r.resolution_note}</p> : null}
              </td>
              <td className="px-5 py-3 text-right">
                {r.status === 'requested' && canResolve ? <ReturnRowActions returnId={r.id} /> : null}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </Card>
  );
              }
