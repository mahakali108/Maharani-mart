import Link from 'next/link';
import { notFound } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { requirePermission } from '@/lib/admin/guard';
import { Card, CardHeader, CardTitle } from '@/components/ui/card';
import { InventoryNav } from '@/components/admin/inventory-nav';
import { GrnActionButtons } from '@/components/admin/grn-action-buttons';
import { StatusBadge } from '@/components/admin/status-badge';
import type { GrnRow, GrnItemRow } from '@/types/inventory.types';

interface GrnDetailRow extends GrnRow {
  warehouses: { name: string } | null;
}

interface GrnItemDetail extends GrnItemRow {
  products: { name: string; sku_code: string } | null;
}

interface ReceiptMovement {
  id: string;
  quantity: number;
  created_at: string;
  products: { name: string } | null;
  inventory_batches: { batch_number: string } | null;
}

export default async function GrnDetailPage({ params }: { params: { id: string } }) {
  await requirePermission('inventory.view');
  const supabase = createClient();

  const [{ data: grnData }, { data: itemData }, { data: movementData }] = await Promise.all([
    supabase.from('grns').select('*, warehouses ( name )').eq('id', params.id).maybeSingle(),
    supabase
      .from('grn_items')
      .select('*, products ( name, sku_code )')
      .eq('grn_id', params.id)
      .order('created_at'),
    supabase
      .from('stock_movements')
      .select('id, quantity, created_at, products ( name ), inventory_batches ( batch_number )')
      .eq('reference_type', 'grn')
      .eq('reference_id', params.id)
      .order('seq'),
  ]);

  const grn = grnData as unknown as GrnDetailRow | null;
  if (!grn) notFound();

  const items = (itemData ?? []) as unknown as GrnItemDetail[];
  const movements = (movementData ?? []) as unknown as ReceiptMovement[];
  const totalUnits = items.reduce((sum, i) => sum + i.received_quantity, 0);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-sm text-ink-400">
            <Link href="/admin/inventory/grn" className="hover:text-primary-600">GRNs</Link> /{' '}
          </p>
          <h1 className="font-mono text-2xl font-semibold text-ink-950">{grn!.grn_number}</h1>
        </div>
        <StatusBadge status={grn!.status} />
      </div>

      <InventoryNav />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-4">
        <InfoCard label="Warehouse" value={grn!.warehouses?.name ?? '—'} />
        <InfoCard label="Supplier ref" value={grn!.supplier_reference || '—'} />
        <InfoCard label="Invoice ref" value={grn!.invoice_reference || '—'} />
        <InfoCard label="Total units" value={String(totalUnits)} />
      </div>

      {grn!.status === 'draft' ? (
        <Card>
          <CardHeader>
            <CardTitle>Confirm receipt</CardTitle>
          </CardHeader>
          <GrnActionButtons grnId={grn!.id} />
        </Card>
      ) : null}

      {grn!.status === 'cancelled' ? (
        <Card className="border-primary-100 bg-primary-50/40">
          <p className="text-sm text-primary-700">
            This GRN was cancelled{grn!.cancellation_reason ? ` — ${grn!.cancellation_reason}` : ''}. No stock was
            received against it.
          </p>
        </Card>
      ) : null}

      <Card className="overflow-x-auto p-0">
        <CardHeader>
          <CardTitle>Lines ({items.length})</CardTitle>
        </CardHeader>
        <table className="w-full min-w-[800px] text-sm">
          <thead className="border-b border-ink-100 bg-ink-50 text-left text-xs uppercase tracking-wide text-ink-500">
            <tr>
              <th className="px-5 py-3 font-medium">Product</th>
              <th className="px-5 py-3 font-medium">Batch</th>
              <th className="px-5 py-3 font-medium">Mfg. date</th>
              <th className="px-5 py-3 font-medium">Expiry</th>
              <th className="px-5 py-3 text-right font-medium">Qty</th>
              <th className="px-5 py-3 text-right font-medium">Unit cost</th>
              <th className="px-5 py-3 text-right font-medium">Line value</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-ink-100">
            {items.map((item) => (
              <tr key={item.id}>
                <td className="px-5 py-3">
                  <p className="font-medium text-ink-900">{item.products?.name ?? '—'}</p>
                  <p className="font-mono text-xs text-ink-400">{item.products?.sku_code}</p>
                </td>
                <td className="px-5 py-3 font-mono text-xs text-ink-600">{item.batch_number.toUpperCase()}</td>
                <td className="px-5 py-3 text-ink-600">{item.manufacturing_date ?? '—'}</td>
                <td className="px-5 py-3 text-ink-600">{item.expiry_date ?? 'No expiry'}</td>
                <td className="px-5 py-3 text-right font-medium text-ink-900">{item.received_quantity}</td>
                <td className="px-5 py-3 text-right text-ink-600">{item.unit_cost != null ? `₹${item.unit_cost}` : '—'}</td>
                <td className="px-5 py-3 text-right text-ink-600">
                  {item.unit_cost != null ? `₹${(item.unit_cost * item.received_quantity).toLocaleString('en-IN')}` : '—'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>

      {grn!.status === 'confirmed' && movements.length > 0 ? (
        <Card className="p-0 overflow-hidden">
          <CardHeader>
            <CardTitle>Stock movements from this GRN</CardTitle>
          </CardHeader>
          <ul className="divide-y divide-ink-100">
            {movements.map((m) => (
              <li key={m.id} className="flex items-center justify-between px-5 py-2.5 text-sm">
                <span className="font-medium text-ink-900">
                  {m.products?.name ?? '—'}{' '}
                  <span className="font-mono text-xs text-ink-400">{m.inventory_batches?.batch_number}</span>
                </span>
                <span className="font-semibold text-green-600">+{m.quantity}</span>
              </li>
            ))}
          </ul>
        </Card>
      ) : null}
    </div>
  );
}

function InfoCard({ label, value }: { label: string; value: string }) {
  return (
    <Card>
      <p className="text-sm text-ink-500">{label}</p>
      <p className="mt-1 font-medium text-ink-950">{value}</p>
    </Card>
  );
}
