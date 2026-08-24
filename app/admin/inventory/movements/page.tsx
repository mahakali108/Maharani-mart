import Link from 'next/link';
import { History } from 'lucide-react';
import { createClient } from '@/lib/supabase/server';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Button } from '@/components/ui/button';
import { AdminEmptyState } from '@/components/admin/empty-state';
import { InventoryNav } from '@/components/admin/inventory-nav';

const PAGE_SIZE = 30;

const MOVEMENT_STYLES: Record<string, string> = {
  inward: 'bg-green-50 text-green-700',
  outward: 'bg-primary-50 text-primary-700',
  damage: 'bg-primary-50 text-primary-700',
  return: 'bg-blue-50 text-blue-700',
  transfer: 'bg-violet-50 text-violet-700',
  transfer_out: 'bg-violet-50 text-violet-700',
  transfer_in: 'bg-violet-50 text-violet-700',
  adjustment: 'bg-amber-50 text-amber-700',
  stock_adjustment: 'bg-amber-50 text-amber-700',
  manual_correction: 'bg-amber-50 text-amber-700',
  opening_stock: 'bg-teal-50 text-teal-700',
  grn_receipt: 'bg-green-50 text-green-700',
  sale: 'bg-primary-50 text-primary-700',
  sale_reservation: 'bg-sky-50 text-sky-700',
  sale_release: 'bg-sky-50 text-sky-700',
  expiry: 'bg-orange-50 text-orange-700',
};

const MOVEMENT_OPTIONS = [
  'opening_stock', 'grn_receipt', 'sale', 'sale_reservation', 'sale_release', 'return', 'damage', 'expiry',
  'stock_adjustment', 'transfer_out', 'transfer_in', 'manual_correction', 'inward', 'outward', 'transfer', 'adjustment',
];

interface MovementRow {
  id: string;
  movement_type: string;
  quantity: number;
  direction: string | null;
  reason: string | null;
  reference_type: string | null;
  previous_quantity: number | null;
  new_quantity: number | null;
  created_at: string;
  seq: number;
  products: { name: string; sku_code: string } | null;
  warehouses: { name: string } | null;
  inventory_batches: { batch_number: string } | null;
  profiles: { full_name: string } | null;
}

export default async function InventoryMovementsPage({
  searchParams,
}: {
  searchParams: { warehouse?: string; type?: string; q?: string; from?: string; to?: string; page?: string };
}) {
  const supabase = createClient();
  const warehouseFilter = searchParams.warehouse ?? '';
  const typeFilter = searchParams.type ?? '';
  const q = (searchParams.q ?? '').trim();
  const from = searchParams.from ?? '';
  const to = searchParams.to ?? '';
  const page = Math.max(1, Number(searchParams.page) || 1);
  const rangeFrom = (page - 1) * PAGE_SIZE;
  const rangeTo = rangeFrom + PAGE_SIZE - 1;

  let query = supabase
    .from('stock_movements')
    .select(
      'id, movement_type, quantity, direction, reason, reference_type, previous_quantity, new_quantity, created_at, seq, products ( name, sku_code ), warehouses ( name ), inventory_batches ( batch_number ), profiles ( full_name )',
      { count: 'exact' }
    )
    .order('seq', { ascending: false });

  if (warehouseFilter) query = query.eq('warehouse_id', warehouseFilter);
  if (typeFilter) query = query.eq('movement_type', typeFilter);
  if (from) query = query.gte('created_at', `${from}T00:00:00.000Z`);
  if (to) query = query.lte('created_at', `${to}T23:59:59.999Z`);

  // Product name search needs a two-step (PostgREST cannot filter embedded
  // relations from the parent query); bounded to keep it cheap.
  let productIds: string[] | null = null;
  if (q) {
    const { data: matches } = await supabase
      .from('products')
      .select('id')
      .or(`name.ilike.%${q}%,sku_code.ilike.%${q}%`)
      .limit(500);
    productIds = ((matches ?? []) as { id: string }[]).map((p) => p.id);
    if (productIds.length === 0) productIds = ['00000000-0000-0000-0000-000000000000'];
  }
  if (productIds) query = query.in('product_id', productIds);

  const [{ data, count }, { data: warehouseData }] = await Promise.all([
    query.range(rangeFrom, rangeTo),
    supabase.from('warehouses').select('id, name').order('name'),
  ]);

  const movements = (data ?? []) as unknown as MovementRow[];
  const totalPages = Math.max(1, Math.ceil((count ?? 0) / PAGE_SIZE));
  const filterBase = `/admin/inventory/movements?warehouse=${warehouseFilter}&type=${typeFilter}&q=${encodeURIComponent(q)}&from=${from}&to=${to}`;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-ink-950">Stock Movement Ledger</h1>
        <p className="mt-1 text-sm text-ink-500">
          Append-only audit trail of every stock change — receipts, FEFO reservations, sales, write-offs, transfers
          and corrections. Historical rows cannot be edited or deleted.
        </p>
      </div>

      <InventoryNav />

      <Card>
        <form method="get" className="flex flex-wrap items-end gap-2">
          <div>
            <label className="mb-1 block text-xs font-medium text-ink-500">Search product</label>
            <Input name="q" defaultValue={q} placeholder="Name or SKU" className="w-44" />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-ink-500">Warehouse</label>
            <Select name="warehouse" defaultValue={warehouseFilter} className="w-40">
              <option value="">All</option>
              {(warehouseData ?? []).map((w: { id: string; name: string }) => (
                <option key={w.id} value={w.id}>{w.name}</option>
              ))}
            </Select>
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-ink-500">Type</label>
            <Select name="type" defaultValue={typeFilter} className="w-44">
              <option value="">All types</option>
              {MOVEMENT_OPTIONS.map((t) => (
                <option key={t} value={t}>{t.replace(/_/g, ' ')}</option>
              ))}
            </Select>
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-ink-500">From</label>
            <Input type="date" name="from" defaultValue={from} className="w-40" />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-ink-500">To</label>
            <Input type="date" name="to" defaultValue={to} className="w-40" />
          </div>
          <Button type="submit" size="sm" variant="outline">Filter</Button>
          <Link href="/admin/inventory/movements" className="text-xs text-ink-400 hover:text-ink-600">Reset</Link>
        </form>
      </Card>

      {movements.length === 0 ? (
        <AdminEmptyState
          icon={History}
          title="No movements match"
          body="Every receipt, reservation, dispatch, write-off and transfer is recorded here as it happens."
        />
      ) : (
        <>
          <Card className="overflow-x-auto p-0">
            <table className="w-full min-w-[1000px] text-sm">
              <thead className="border-b border-ink-100 bg-ink-50 text-left text-xs uppercase tracking-wide text-ink-500">
                <tr>
                  <th className="px-5 py-3 font-medium">When</th>
                  <th className="px-5 py-3 font-medium">Product</th>
                  <th className="px-5 py-3 font-medium">Batch</th>
                  <th className="px-5 py-3 font-medium">Warehouse</th>
                  <th className="px-5 py-3 font-medium">Type</th>
                  <th className="px-5 py-3 text-right font-medium">Qty</th>
                  <th className="px-5 py-3 text-right font-medium">Prev → New</th>
                  <th className="px-5 py-3 font-medium">By</th>
                  <th className="px-5 py-3 font-medium">Reason</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-ink-100">
                {movements.map((m) => (
                  <tr key={m.id}>
                    <td className="whitespace-nowrap px-5 py-3 text-ink-500">{new Date(m.created_at).toLocaleString('en-IN')}</td>
                    <td className="px-5 py-3">
                      <p className="font-medium text-ink-900">{m.products?.name ?? '—'}</p>
                      <p className="font-mono text-xs text-ink-400">{m.products?.sku_code}</p>
                    </td>
                    <td className="px-5 py-3 font-mono text-xs text-ink-500">{m.inventory_batches?.batch_number ?? '—'}</td>
                    <td className="px-5 py-3 text-ink-600">{m.warehouses?.name ?? '—'}</td>
                    <td className="px-5 py-3">
                      <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${MOVEMENT_STYLES[m.movement_type] ?? 'bg-ink-100 text-ink-600'}`}>
                        {m.movement_type.replace(/_/g, ' ')}
                      </span>
                    </td>
                    <td className={`px-5 py-3 text-right font-semibold ${m.direction === 'out' ? 'text-primary-600' : 'text-green-600'}`}>
                      {m.direction === 'out' ? '−' : '+'}{Math.abs(m.quantity)}
                    </td>
                    <td className="whitespace-nowrap px-5 py-3 text-right text-xs text-ink-400">
                      {m.previous_quantity != null && m.new_quantity != null ? `${m.previous_quantity} → ${m.new_quantity}` : '—'}
                    </td>
                    <td className="px-5 py-3 text-ink-600">{m.profiles?.full_name ?? '—'}</td>
                    <td className="max-w-[220px] truncate px-5 py-3 text-ink-500" title={m.reason ?? undefined}>
                      {m.reason ?? '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>

          {totalPages > 1 ? (
            <div className="flex items-center justify-center gap-2">
              {page > 1 ? (
                <Link href={`${filterBase}&page=${page - 1}`}>
                  <Button size="sm" variant="outline">Previous</Button>
                </Link>
              ) : null}
              <span className="text-xs text-ink-400">Page {page} of {totalPages} · {count} movements</span>
              {page < totalPages ? (
                <Link href={`${filterBase}&page=${page + 1}`}>
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
