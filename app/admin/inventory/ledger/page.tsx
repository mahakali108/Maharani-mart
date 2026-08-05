import { History } from 'lucide-react';
import { createClient } from '@/lib/supabase/server';
import { Card } from '@/components/ui/card';
import { Select } from '@/components/ui/select';
import { Button } from '@/components/ui/button';
import { AdminEmptyState } from '@/components/admin/empty-state';
import Link from 'next/link';

const PAGE_SIZE = 30;

const MOVEMENT_STYLES: Record<string, string> = {
  inward: 'bg-green-50 text-green-700',
  outward: 'bg-primary-50 text-primary-700',
  damage: 'bg-primary-50 text-primary-700',
  return: 'bg-blue-50 text-blue-700',
  transfer: 'bg-violet-50 text-violet-700',
  adjustment: 'bg-amber-50 text-amber-700',
};

interface Option {
  id: string;
  name: string;
}

interface MovementRow {
  id: string;
  movement_type: string;
  quantity: number;
  reason: string | null;
  created_at: string;
  products: { name: string; sku_code: string } | null;
  warehouses: { name: string } | null;
  profiles: { full_name: string } | null;
}

export default async function InventoryLedgerPage({
  searchParams,
}: {
  searchParams: { warehouse?: string; page?: string };
}) {
  const supabase = createClient();
  const warehouseFilter = searchParams.warehouse ?? '';
  const page = Math.max(1, Number(searchParams.page) || 1);
  const from = (page - 1) * PAGE_SIZE;
  const to = from + PAGE_SIZE - 1;

  let query = supabase
    .from('stock_movements')
    .select(
      'id, movement_type, quantity, reason, created_at, products ( name, sku_code ), warehouses ( name ), profiles ( full_name )',
      { count: 'exact' }
    )
    .order('created_at', { ascending: false })
    .range(from, to);

  if (warehouseFilter) query = query.eq('warehouse_id', warehouseFilter);

  const [{ data, count }, { data: warehouseData }] = await Promise.all([
    query,
    supabase.from('warehouses').select('id, name').order('name'),
  ]);

  const movements = (data ?? []) as unknown as MovementRow[];
  const warehouses = (warehouseData ?? []) as Option[];
  const totalPages = Math.max(1, Math.ceil((count ?? 0) / PAGE_SIZE));

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-ink-950">Stock Movement Ledger</h1>
        <p className="mt-1 text-sm text-ink-500">
          The complete audit trail of every stock change — inward, outward (dispatch), damage, returns, transfers, and
          manual adjustments. Nothing here is editable; it&apos;s a historical record.
        </p>
      </div>

      <Card>
        <form method="get" className="flex gap-2">
          <Select name="warehouse" defaultValue={warehouseFilter}>
            <option value="">All warehouses</option>
            {warehouses.map((w) => (
              <option key={w.id} value={w.id}>
                {w.name}
              </option>
            ))}
          </Select>
          <Button type="submit" size="sm" variant="outline">
            Filter
          </Button>
        </form>
      </Card>

      {movements.length === 0 ? (
        <AdminEmptyState
          icon={History}
          title="No stock movements yet"
          body="Every inward delivery, dispatch, damage report, return, or adjustment will be logged here as it happens."
        />
      ) : (
        <>
          <Card className="overflow-hidden p-0">
            <table className="w-full text-sm">
              <thead className="border-b border-ink-100 bg-ink-50 text-left text-xs uppercase tracking-wide text-ink-500">
                <tr>
                  <th className="px-5 py-3 font-medium">Product</th>
                  <th className="px-5 py-3 font-medium">Warehouse</th>
                  <th className="px-5 py-3 font-medium">Type</th>
                  <th className="px-5 py-3 font-medium">Qty</th>
                  <th className="px-5 py-3 font-medium">By</th>
                  <th className="px-5 py-3 font-medium">Reason</th>
                  <th className="px-5 py-3 font-medium">When</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-ink-100">
                {movements.map((m) => (
                  <tr key={m.id}>
                    <td className="px-5 py-3">
                      <p className="font-medium text-ink-900">{m.products?.name ?? '—'}</p>
                      <p className="font-mono text-xs text-ink-400">{m.products?.sku_code}</p>
                    </td>
                    <td className="px-5 py-3 text-ink-600">{m.warehouses?.name ?? '—'}</td>
                    <td className="px-5 py-3">
                      <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${MOVEMENT_STYLES[m.movement_type] ?? 'bg-ink-100 text-ink-600'}`}>
                        {m.movement_type}
                      </span>
                    </td>
                    <td className="px-5 py-3 font-medium text-ink-900">{m.quantity}</td>
                    <td className="px-5 py-3 text-ink-600">{m.profiles?.full_name ?? '—'}</td>
                    <td className="px-5 py-3 text-ink-500">{m.reason ?? '—'}</td>
                    <td className="px-5 py-3 text-ink-500">{new Date(m.created_at).toLocaleString('en-IN')}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>

          {totalPages > 1 ? (
            <div className="flex items-center justify-center gap-2">
              {page > 1 ? (
                <Link href={`/admin/inventory/ledger?warehouse=${warehouseFilter}&page=${page - 1}`}>
                  <Button size="sm" variant="outline">Previous</Button>
                </Link>
              ) : null}
              <span className="text-xs text-ink-400">Page {page} of {totalPages}</span>
              {page < totalPages ? (
                <Link href={`/admin/inventory/ledger?warehouse=${warehouseFilter}&page=${page + 1}`}>
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
