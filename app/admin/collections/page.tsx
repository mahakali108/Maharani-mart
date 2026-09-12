import Link from 'next/link';
import { BadgeIndianRupee, Search } from 'lucide-react';
import { requirePermission } from '@/lib/admin/guard';
import { createClient } from '@/lib/supabase/server';
import { CollectionReviewButtons } from '@/components/admin/collection-review';
import { AdminEmptyState } from '@/components/admin/empty-state';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Button } from '@/components/ui/button';
import { formatIndiaDateTime } from '@/lib/datetime/india';

const PAGE_SIZE = 20;

const STATUS_STYLES: Record<string, string> = {
  pending: 'bg-amber-50 text-amber-700',
  verified: 'bg-green-50 text-green-700',
  rejected: 'bg-primary-50 text-primary-700',
};

interface CollectionRow {
  id: string;
  retailer_id: string;
  order_id: string | null;
  amount_paise: number;
  method: string;
  reference_number: string | null;
  proof_url: string | null;
  notes: string | null;
  status: string;
  verified_at: string | null;
  ledger_entry_id: string | null;
  created_at: string;
  collected_by_name: { full_name: string } | null;
  retailers: { shop_name: string } | null;
}

const METHOD_LABELS: Record<string, string> = {
  cash: 'Cash',
  bank_transfer: 'Bank transfer',
  upi: 'UPI',
  cheque: 'Cheque',
  other: 'Other',
};

export default async function AdminCollectionsPage({
  searchParams,
}: {
  searchParams: { status?: string; q?: string; page?: string };
}) {
  await requirePermission('collections.verify');
  const supabase = createClient();

  const status = searchParams.status ?? 'pending';
  const q = searchParams.q?.trim() ?? '';
  const page = Math.max(1, Number(searchParams.page) || 1);
  const from = (page - 1) * PAGE_SIZE;

  // Header stats for the queue.
  const { count: pendingCount } = await supabase
    .from('payment_collections')
    .select('id', { count: 'exact', head: true })
    .eq('status', 'pending');
  const { data: pendingTotals } = await supabase
    .from('payment_collections')
    .select('amount_paise')
    .eq('status', 'pending');
  const pendingPaise = ((pendingTotals ?? []) as { amount_paise: number }[]).reduce(
    (sum, row) => sum + (row.amount_paise ?? 0),
    0
  );

  let query = supabase
    .from('payment_collections')
    .select(
      `id, retailer_id, order_id, amount_paise, method, reference_number, proof_url, notes,
       status, verified_at, ledger_entry_id, created_at,
       collected_by_name:profiles!payment_collections_collected_by_fkey ( full_name ),
       retailers ( shop_name )`,
      { count: 'exact' }
    )
    .order('created_at', { ascending: status === 'pending' })
    .range(from, from + PAGE_SIZE - 1);

  if (status) query = query.eq('status', status);
  if (q) query = query.ilike('retailers.shop_name', `%${q}%`);

  const { data, count } = await query;
  const rows = (data ?? []) as unknown as CollectionRow[];
  const totalPages = Math.max(1, Math.ceil((count ?? 0) / PAGE_SIZE));

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-ink-950">Payment Collections</h1>
          <p className="mt-1 text-sm text-ink-500">
            Field collections recorded by sales executives. The wallet is credited only when you verify.
          </p>
        </div>
        <Card className="px-4 py-3">
          <p className="text-xs text-ink-500">Awaiting verification</p>
          <p className="text-lg font-semibold text-ink-950">
            ₹{(pendingPaise / 100).toLocaleString('en-IN', { maximumFractionDigits: 2 })}{' '}
            <span className="text-xs font-normal text-ink-400">across {pendingCount ?? 0} collections</span>
          </p>
        </Card>
      </div>

      <Card>
        <form method="get" className="grid grid-cols-1 gap-3 sm:grid-cols-4">
          <div className="relative sm:col-span-2">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-400" />
            <Input name="q" defaultValue={q} placeholder="Search retailer…" className="pl-9" />
          </div>
          <Select name="status" defaultValue={status}>
            <option value="">All statuses</option>
            <option value="pending">Pending</option>
            <option value="verified">Verified</option>
            <option value="rejected">Rejected</option>
          </Select>
          <Button type="submit" variant="secondary" size="sm">
            Apply
          </Button>
        </form>
      </Card>

      {rows.length === 0 ? (
        <AdminEmptyState
          icon={BadgeIndianRupee}
          title={status === 'pending' ? 'Nothing waiting for verification' : 'No collections match your filters'}
          body={
            status === 'pending'
              ? 'When a sales executive records money collected in the field, it lands here for a finance check before the wallet is credited.'
              : 'Try a different search or status.'
          }
        />
      ) : (
        <div className="space-y-3">
          {rows.map((row) => (
            <Card key={row.id} className="space-y-3 p-5">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-ink-950">
                    ₹{(row.amount_paise / 100).toLocaleString('en-IN', { maximumFractionDigits: 2 })}
                    <span className="ml-2 rounded-full bg-ink-100 px-2 py-0.5 text-xs font-medium text-ink-600">
                      {METHOD_LABELS[row.method] ?? row.method}
                    </span>
                    <span
                      className={`ml-2 rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_STYLES[row.status] ?? 'bg-ink-100 text-ink-600'}`}
                    >
                      {row.status.charAt(0).toUpperCase() + row.status.slice(1)}
                    </span>
                  </p>
                  <p className="mt-0.5 text-sm text-ink-600">
                    {row.retailers?.shop_name ?? 'Unknown retailer'}
                    {row.reference_number ? <span className="text-ink-400"> · ref {row.reference_number}</span> : null}
                  </p>
                  <p className="text-xs text-ink-400">
                    Collected by {row.collected_by_name?.full_name ?? '—'} on {formatIndiaDateTime(row.created_at)}
                    {row.proof_url ? ' · photo proof attached' : ' · no proof'}
                    {row.order_id ? (
                      <>
                        {' · '}
                        <Link href={`/admin/orders/${row.order_id}`} className="text-primary-600 hover:underline">
                          linked order
                        </Link>
                      </>
                    ) : null}
                  </p>
                  {row.notes ? <p className="mt-1 text-xs text-ink-500">{row.notes}</p> : null}
                </div>
                {row.status === 'pending' ? (
                  <CollectionReviewButtons collectionId={row.id} />
                ) : (
                  <p className="text-xs text-ink-400">
                    {row.status === 'verified'
                      ? `Verified ${row.verified_at ? formatIndiaDateTime(row.verified_at) : '—'}${row.ledger_entry_id ? ' · wallet credited' : ''}`
                      : `Rejected ${row.verified_at ? formatIndiaDateTime(row.verified_at) : '—'} · nothing credited`}
                  </p>
                )}
              </div>
            </Card>
          ))}
        </div>
      )}

      {totalPages > 1 ? (
        <div className="flex items-center justify-center gap-2">
          {page > 1 ? (
            <Link href={`/admin/collections?status=${status}&q=${q}&page=${page - 1}`}>
              <Button size="sm" variant="outline">Previous</Button>
            </Link>
          ) : null}
          <span className="text-xs text-ink-400">Page {page} of {totalPages}</span>
          {page < totalPages ? (
            <Link href={`/admin/collections?status=${status}&q=${q}&page=${page + 1}`}>
              <Button size="sm" variant="outline">Next</Button>
            </Link>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
