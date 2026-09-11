import { BadgeIndianRupee } from 'lucide-react';
import { requirePermission } from '@/lib/admin/guard';
import { createClient } from '@/lib/supabase/server';
import { RecordCollectionForm } from '@/components/salesman/record-collection-form';
import { AdminEmptyState } from '@/components/admin/empty-state';
import { Card } from '@/components/ui/card';
import { formatIndiaDateTime } from '@/lib/datetime/india';

const PAGE_SIZE = 20;

const STATUS_STYLES: Record<string, string> = {
  pending: 'bg-amber-50 text-amber-700',
  verified: 'bg-green-50 text-green-700',
  rejected: 'bg-primary-50 text-primary-700',
};

const METHOD_LABELS: Record<string, string> = {
  cash: 'Cash',
  bank_transfer: 'Bank transfer',
  upi: 'UPI',
  cheque: 'Cheque',
  other: 'Other',
};

interface CollectionRow {
  id: string;
  amount_paise: number;
  method: string;
  reference_number: string | null;
  status: string;
  notes: string | null;
  created_at: string;
  verified_at: string | null;
  retailers: { shop_name: string } | null;
}

export default async function SalesmanCollectionsPage({
  searchParams,
}: {
  searchParams: { page?: string };
}) {
  const user = await requirePermission('collections.record');
  const supabase = createClient();
  const page = Math.max(1, Number(searchParams.page) || 1);
  const from = (page - 1) * PAGE_SIZE;

  // My assigned retailers for the entry form.
  const { data: retailerRows } = await supabase
    .from('retailers')
    .select('id, shop_name')
    .eq('assigned_salesman_id', user.id)
    .order('shop_name');
  const retailers = (retailerRows ?? []) as { id: string; shop_name: string }[];

  // My collection history (RLS also scopes this, the filter is explicit).
  const { data, count } = await supabase
    .from('payment_collections')
    .select('id, amount_paise, method, reference_number, status, notes, created_at, verified_at, retailers ( shop_name )', {
      count: 'exact',
    })
    .eq('collected_by', user.id)
    .order('created_at', { ascending: false })
    .range(from, from + PAGE_SIZE - 1);
  const rows = (data ?? []) as unknown as CollectionRow[];
  const totalPages = Math.max(1, Math.ceil((count ?? 0) / PAGE_SIZE));

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-ink-950">Collections</h1>
        <p className="mt-1 text-sm text-ink-500">
          Record money you collect in the field. The office verifies it before the retailer&apos;s wallet is credited.
        </p>
      </div>

      {user.role === 'salesman' ? <RecordCollectionForm retailers={retailers.map((r) => ({ id: r.id, shopName: r.shop_name }))} /> : null}

      {rows.length === 0 ? (
        <AdminEmptyState
          icon={BadgeIndianRupee}
          title="No collections recorded yet"
          body="Every collection you submit for verification appears here with its status."
        />
      ) : (
        <div className="space-y-3">
          {rows.map((row) => (
            <Card key={row.id} className="flex flex-wrap items-center justify-between gap-3 p-4">
              <div className="min-w-0">
                <p className="text-sm font-semibold text-ink-950">
                  ₹{(row.amount_paise / 100).toLocaleString('en-IN', { maximumFractionDigits: 2 })}
                  <span className="ml-2 rounded-full bg-ink-100 px-2 py-0.5 text-xs font-medium text-ink-600">
                    {METHOD_LABELS[row.method] ?? row.method}
                  </span>
                </p>
                <p className="truncate text-xs text-ink-500">
                  {row.retailers?.shop_name ?? '—'}
                  {row.reference_number ? ` · ref ${row.reference_number}` : ''}
                </p>
                <p className="text-xs text-ink-400">{formatIndiaDateTime(row.created_at)}</p>
                {row.notes ? <p className="text-xs text-ink-400">{row.notes}</p> : null}
              </div>
              <span
                className={`rounded-full px-2.5 py-1 text-xs font-medium ${STATUS_STYLES[row.status] ?? 'bg-ink-100 text-ink-600'}`}
              >
                {row.status === 'verified' ? 'Verified — wallet credited' : row.status.charAt(0).toUpperCase() + row.status.slice(1)}
              </span>
            </Card>
          ))}
        </div>
      )}

      {totalPages > 1 ? (
        <div className="flex items-center justify-center gap-3 text-xs text-ink-400">
          {page > 1 ? <a href={`/salesman/collections?page=${page - 1}`} className="text-primary-600 hover:underline">Previous</a> : null}
          <span>Page {page} of {totalPages}</span>
          {page < totalPages ? <a href={`/salesman/collections?page=${page + 1}`} className="text-primary-600 hover:underline">Next</a> : null}
        </div>
      ) : null}
    </div>
  );
}
