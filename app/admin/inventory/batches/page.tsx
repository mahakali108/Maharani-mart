import Link from 'next/link';
import { Layers } from 'lucide-react';
import { createClient } from '@/lib/supabase/server';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { AdminEmptyState } from '@/components/admin/empty-state';
import { InventoryNav } from '@/components/admin/inventory-nav';
import { BatchLossForm } from '@/components/admin/batch-loss-form';

const PAGE_SIZE = 25;

interface BatchRow {
  id: string;
  batch_number: string;
  manufacturing_date: string | null;
  expiry_date: string | null;
  received_quantity: number;
  current_quantity: number;
  reserved_quantity: number;
  damaged_quantity: number;
  expired_quantity: number;
  unit_cost: number | null;
  products: { id: string; name: string; sku_code: string | null } | null;
  warehouses: { id: string; name: string } | null;
}

function expiryBadge(expiry: string | null): { label: string; cls: string } {
  if (!expiry) return { label: 'No expiry', cls: 'bg-ink-100 text-ink-500' };
  const days = Math.ceil((new Date(expiry).getTime() - Date.now()) / 86400000);
  if (days < 0) return { label: `Expired ${-days}d ago`, cls: 'bg-primary-50 text-primary-700' };
  if (days <= 7) return { label: `${days}d left`, cls: 'bg-orange-50 text-orange-700' };
  if (days <= 30) return { label: `${days}d left`, cls: 'bg-amber-50 text-amber-700' };
  return { label: expiry, cls: 'bg-green-50 text-green-700' };
}

export default async function InventoryBatchesPage({
  searchParams,
}: {
  searchParams: { q?: string; warehouse?: string; expiry?: string; page?: string };
}) {
  const supabase = createClient();
  const page = Math.max(1, Number(searchParams.page) || 1);
  const q = (searchParams.q ?? '').trim();
  const warehouse = searchParams.warehouse ?? '';
  const expiryFilter = searchParams.expiry ?? '';

  const today = new Date().toISOString().slice(0, 10);
  const in7 = new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10);
  const in30 = new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10);

  let query = supabase
    .from('inventory_batches')
    .select(
      'id, batch_number, manufacturing_date, expiry_date, received_quantity, current_quantity, reserved_quantity, damaged_quantity, expired_quantity, unit_cost, products ( id, name, sku_code ), warehouses ( id, name )',
      { count: 'exact' }
    )
    .gt('current_quantity', 0);

  if (warehouse) query = query.eq('warehouse_id', warehouse);
  if (expiryFilter === 'expired') query = query.lt('expiry_date', today);
  else if (expiryFilter === 'critical') query = query.gte('expiry_date', today).lte('expiry_date', in7);
  else if (expiryFilter === 'warning') query = query.gt('expiry_date', in7).lte('expiry_date', in30);

  const from = (page - 1) * PAGE_SIZE;
  const [{ data, count }, { data: warehouseData }] = await Promise.all([
    query.order('expiry_date', { ascending: true, nullsFirst: false }).range(from, from + PAGE_SIZE - 1),
    supabase.from('warehouses').select('id, name').eq('is_active', true).order('name'),
  ]);

  const batches = (data ?? []) as unknown as BatchRow[];
  const filtered = q
    ? batches.filter(
        (b) =>
          b.products?.name.toLowerCase().includes(q.toLowerCase()) ||
          (b.products?.sku_code ?? '').toLowerCase().includes(q.toLowerCase()) ||
          b.batch_number.toLowerCase().includes(q.toLowerCase())
      )
    : batches;
  const totalPages = Math.max(1, Math.ceil((count ?? 0) / PAGE_SIZE));

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-ink-950">Batches</h1>
        <p className="mt-1 text-sm text-ink-500">
          Every live batch with expiry and FEFO order. Reserved units are committed to approved orders and cannot be
          written off until those orders are cancelled.
        </p>
      </div>

      <InventoryNav />

      <Card>
        <form method="get" className="flex flex-wrap gap-2">
          <Input name="q" defaultValue={q} placeholder="Search product / SKU / batch…" className="max-w-xs" />
          <Select name="warehouse" defaultValue={warehouse} className="max-w-[180px]">
            <option value="">All warehouses</option>
            {(warehouseData ?? []).map((w: { id: string; name: string }) => (
              <option key={w.id} value={w.id}>{w.name}</option>
            ))}
          </Select>
          <Select name="expiry" defaultValue={expiryFilter} className="max-w-[180px]">
            <option value="">All expiry</option>
            <option value="expired">Expired</option>
            <option value="critical">≤ 7 days</option>
            <option value="warning">8–30 days</option>
          </Select>
          <Button type="submit" size="sm" variant="outline">Filter</Button>
        </form>
      </Card>

      {filtered.length === 0 ? (
        <AdminEmptyState icon={Layers} title="No batches found" body="Confirm a GRN to create batches with expiry tracking." />
      ) : (
        <>
          <Card className="overflow-x-auto p-0">
            <table className="w-full min-w-[1000px] text-sm">
              <thead className="border-b border-ink-100 bg-ink-50 text-left text-xs uppercase tracking-wide text-ink-500">
                <tr>
                  <th className="px-5 py-3 font-medium">Product / Batch</th>
                  <th className="px-5 py-3 font-medium">Warehouse</th>
                  <th className="px-5 py-3 font-medium">Expiry</th>
                  <th className="px-5 py-3 text-right font-medium">On Hand</th>
                  <th className="px-5 py-3 text-right font-medium">Reserved</th>
                  <th className="px-5 py-3 text-right font-medium">Available</th>
                  <th className="px-5 py-3 text-right font-medium">Damaged</th>
                  <th className="px-5 py-3 font-medium">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-ink-100">
                {filtered.map((b) => {
                  const badge = expiryBadge(b.expiry_date);
                  const available = b.current_quantity - b.reserved_quantity;
                  return (
                    <tr key={b.id}>
                      <td className="px-5 py-3">
                        <Link href={`/admin/products/${b.products?.id}`} className="font-medium text-ink-900 hover:text-primary-600">
                          {b.products?.name ?? '—'}
                        </Link>
                        <p className="font-mono text-xs text-ink-400">{b.batch_number}</p>
                      </td>
                      <td className="px-5 py-3 text-ink-600">{b.warehouses?.name ?? '—'}</td>
                      <td className="px-5 py-3">
                        <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${badge.cls}`}>{badge.label}</span>
                      </td>
                      <td className="px-5 py-3 text-right font-medium text-ink-900">{b.current_quantity}</td>
                      <td className="px-5 py-3 text-right text-ink-600">{b.reserved_quantity}</td>
                      <td className="px-5 py-3 text-right font-semibold text-ink-900">{available}</td>
                      <td className="px-5 py-3 text-right text-ink-500">{b.damaged_quantity + b.expired_quantity}</td>
                      <td className="px-5 py-3">
                        {available > 0 ? (
                          <div className="flex gap-2">
                            <BatchLossForm batchId={b.id} lossType="damage" maxQuantity={available} />
                            <BatchLossForm batchId={b.id} lossType="expiry" maxQuantity={available} />
                          </div>
                        ) : (
                          <span className="text-xs text-ink-400">Fully reserved</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </Card>

          {totalPages > 1 ? (
            <div className="flex items-center justify-center gap-2">
              {page > 1 ? (
                <Link href={`/admin/inventory/batches?q=${encodeURIComponent(q)}&warehouse=${warehouse}&expiry=${expiryFilter}&page=${page - 1}`}>
                  <Button size="sm" variant="outline">Previous</Button>
                </Link>
              ) : null}
              <span className="text-xs text-ink-400">Page {page} of {totalPages}</span>
              {page < totalPages ? (
                <Link href={`/admin/inventory/batches?q=${encodeURIComponent(q)}&warehouse=${warehouse}&expiry=${expiryFilter}&page=${page + 1}`}>
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
