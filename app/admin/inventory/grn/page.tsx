import Link from 'next/link';
import { FileCheck2, Plus } from 'lucide-react';
import { createClient } from '@/lib/supabase/server';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Select } from '@/components/ui/select';
import { AdminEmptyState } from '@/components/admin/empty-state';
import { InventoryNav } from '@/components/admin/inventory-nav';
import { StatusBadge } from '@/components/admin/status-badge';
import type { GrnRow } from '@/types/inventory.types';

const PAGE_SIZE = 25;

interface GrnListRow extends GrnRow {
  warehouses: { name: string } | null;
}

export default async function GrnListPage({
  searchParams,
}: {
  searchParams: { status?: string; page?: string };
}) {
  const supabase = createClient();
  const page = Math.max(1, Number(searchParams.page) || 1);
  const status = searchParams.status ?? '';

  let query = supabase
    .from('grns')
    .select('*, warehouses ( name )', { count: 'exact' })
    .order('created_at', { ascending: false });
  if (status) query = query.eq('status', status);

  const from = (page - 1) * PAGE_SIZE;
  const [{ data, count }, { data: itemData }] = await Promise.all([
    query.range(from, from + PAGE_SIZE - 1),
    supabase.from('grn_items').select('grn_id'),
  ]);

  const grns = (data ?? []) as unknown as GrnListRow[];
  const itemCounts = new Map<string, number>();
  for (const item of (itemData ?? []) as { grn_id: string }[]) {
    itemCounts.set(item.grn_id, (itemCounts.get(item.grn_id) ?? 0) + 1);
  }
  const totalPages = Math.max(1, Math.ceil((count ?? 0) / PAGE_SIZE));

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-ink-950">Goods Received Notes</h1>
          <p className="mt-1 text-sm text-ink-500">
            Receiving stock via GRN creates batches, expiry dates and GRN_RECEIPT ledger entries atomically on
            confirmation.
          </p>
        </div>
        <Link href="/admin/inventory/grn/new">
          <Button size="sm">
            <Plus className="h-4 w-4" /> New GRN
          </Button>
        </Link>
      </div>

      <InventoryNav />

      <Card>
        <form method="get" className="flex gap-2">
          <Select name="status" defaultValue={status} className="max-w-[180px]">
            <option value="">All statuses</option>
            <option value="draft">Draft</option>
            <option value="confirmed">Confirmed</option>
            <option value="cancelled">Cancelled</option>
          </Select>
          <Button type="submit" size="sm" variant="outline">Filter</Button>
        </form>
      </Card>

      {grns.length === 0 ? (
        <AdminEmptyState
          icon={FileCheck2}
          title="No GRNs yet"
          body="Create your first Goods Received Note to bring stock into inventory with batch and expiry tracking."
        />
      ) : (
        <>
          <Card className="overflow-x-auto p-0">
            <table className="w-full min-w-[800px] text-sm">
              <thead className="border-b border-ink-100 bg-ink-50 text-left text-xs uppercase tracking-wide text-ink-500">
                <tr>
                  <th className="px-5 py-3 font-medium">GRN #</th>
                  <th className="px-5 py-3 font-medium">Warehouse</th>
                  <th className="px-5 py-3 font-medium">Supplier ref</th>
                  <th className="px-5 py-3 text-right font-medium">Lines</th>
                  <th className="px-5 py-3 font-medium">Status</th>
                  <th className="px-5 py-3 font-medium">Created</th>
                  <th className="px-5 py-3 font-medium">Confirmed</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-ink-100">
                {grns.map((g) => (
                  <tr key={g.id}>
                    <td className="px-5 py-3">
                      <Link href={`/admin/inventory/grn/${g.id}`} className="font-mono font-medium text-ink-900 hover:text-primary-600">
                        {g.grn_number}
                      </Link>
                    </td>
                    <td className="px-5 py-3 text-ink-600">{g.warehouses?.name ?? '—'}</td>
                    <td className="px-5 py-3 text-ink-600">{g.supplier_reference ?? '—'}</td>
                    <td className="px-5 py-3 text-right text-ink-600">{itemCounts.get(g.id) ?? 0}</td>
                    <td className="px-5 py-3"><StatusBadge status={g.status} /></td>
                    <td className="px-5 py-3 text-ink-500">{new Date(g.created_at).toLocaleString('en-IN')}</td>
                    <td className="px-5 py-3 text-ink-500">{g.confirmed_at ? new Date(g.confirmed_at).toLocaleString('en-IN') : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>

          {totalPages > 1 ? (
            <div className="flex items-center justify-center gap-2">
              {page > 1 ? (
                <Link href={`/admin/inventory/grn?status=${status}&page=${page - 1}`}>
                  <Button size="sm" variant="outline">Previous</Button>
                </Link>
              ) : null}
              <span className="text-xs text-ink-400">Page {page} of {totalPages}</span>
              {page < totalPages ? (
                <Link href={`/admin/inventory/grn?status=${status}&page=${page + 1}`}>
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
