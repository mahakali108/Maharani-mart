import { RotateCcw } from 'lucide-react';
import { createClient } from '@/lib/supabase/server';
import { Card } from '@/components/ui/card';
import { AdminEmptyState } from '@/components/admin/empty-state';
import { ReturnRowActions } from '@/components/admin/return-row-actions';

interface ReturnRequestRow {
  id: string;
  reason: string;
  status: 'requested' | 'approved' | 'rejected' | 'completed';
  requested_at: string;
  resolution_note: string | null;
  orders: { order_number: string } | null;
  retailers: { shop_name: string } | null;
}

const STATUS_STYLES: Record<ReturnRequestRow['status'], string> = {
  requested: 'bg-amber-50 text-amber-700',
  approved: 'bg-green-50 text-green-700',
  rejected: 'bg-primary-50 text-primary-700',
  completed: 'bg-ink-100 text-ink-600',
};

export default async function ReturnsPage() {
  const supabase = createClient();

  const { data } = await supabase
    .from('return_requests')
    .select('id, reason, status, requested_at, resolution_note, orders ( order_number ), retailers ( shop_name )')
    .order('requested_at', { ascending: false });

  const returns = (data ?? []) as unknown as ReturnRequestRow[];
  const pending = returns.filter((r) => r.status === 'requested');
  const resolved = returns.filter((r) => r.status !== 'requested');

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-ink-950">Returns</h1>
        <p className="mt-1 text-sm text-ink-500">Return requests submitted by retailers on delivered orders.</p>
      </div>

      {returns.length === 0 ? (
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
              <ReturnsTable returns={pending} />
            </div>
          ) : null}

          {resolved.length > 0 ? (
            <div>
              <h2 className="mb-3 mt-8 text-sm font-semibold text-ink-800">Resolved</h2>
              <ReturnsTable returns={resolved} />
            </div>
          ) : null}
        </>
      )}
    </div>
  );
}

function ReturnsTable({ returns }: { returns: ReturnRequestRow[] }) {
  return (
    <Card className="overflow-hidden p-0">
      <table className="w-full text-sm">
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
              <td className="px-5 py-3 text-ink-600">{r.reason}</td>
              <td className="px-5 py-3 text-ink-500">{new Date(r.requested_at).toLocaleDateString('en-IN')}</td>
              <td className="px-5 py-3">
                <span className={`rounded-full px-2.5 py-1 text-xs font-medium ${STATUS_STYLES[r.status]}`}>
                  {r.status.charAt(0).toUpperCase() + r.status.slice(1)}
                </span>
                {r.resolution_note ? <p className="mt-1 text-xs text-ink-400">{r.resolution_note}</p> : null}
              </td>
              <td className="px-5 py-3 text-right">
                {r.status === 'requested' ? <ReturnRowActions returnId={r.id} /> : null}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </Card>
  );
              }
