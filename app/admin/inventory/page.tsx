import Link from 'next/link';
import { Warehouse, AlertTriangle, Boxes, CalendarClock, PackageX, History } from 'lucide-react';
import { createClient } from '@/lib/supabase/server';
import { Card, CardHeader, CardTitle } from '@/components/ui/card';
import { AdminEmptyState } from '@/components/admin/empty-state';
import { StockAdjustmentForm } from '@/components/admin/stock-adjustment-form';
import { StatusBadge } from '@/components/admin/status-badge';
import { InventoryNav } from '@/components/admin/inventory-nav';
import type { ProductTotalsViewRow, ExpiryReportViewRow } from '@/types/inventory.types';

interface RecentMovement {
  id: string;
  movement_type: string;
  quantity: number;
  direction: string | null;
  created_at: string;
  products: { name: string } | null;
  warehouses: { name: string } | null;
}

interface RecentGrn {
  id: string;
  grn_number: string;
  status: string;
  created_at: string;
  warehouses: { name: string } | null;
}

interface Option {
  id: string;
  name: string;
}

const MOVEMENT_LABEL: Record<string, string> = {
  inward: 'Inward', outward: 'Outward', damage: 'Damage', return: 'Return',
  transfer: 'Transfer', adjustment: 'Adjustment', opening_stock: 'Opening stock',
  grn_receipt: 'GRN receipt', sale: 'Sale', sale_reservation: 'Reservation',
  sale_release: 'Reservation release', expiry: 'Expiry write-off',
  stock_adjustment: 'Adjustment', transfer_out: 'Transfer out', transfer_in: 'Transfer in',
  manual_correction: 'Correction',
};

export default async function InventoryPage() {
  const supabase = createClient();

  const [
    { data: totalsData },
    { data: expiryData },
    { data: movementData },
    { data: grnData },
    { data: productData },
    { data: warehouseData },
    { data: warehouseCountData },
  ] = await Promise.all([
    supabase.from('inventory_product_totals').select('*'),
    supabase.from('inventory_expiry_report').select('*'),
    supabase
      .from('stock_movements')
      .select('id, movement_type, quantity, direction, created_at, products ( name ), warehouses ( name )')
      .order('seq', { ascending: false })
      .limit(10),
    supabase
      .from('grns')
      .select('id, grn_number, status, created_at, warehouses ( name )')
      .order('created_at', { ascending: false })
      .limit(5),
    supabase.from('products').select('id, name').eq('is_active', true).order('name'),
    supabase.from('warehouses').select('id, name').eq('is_active', true).order('name'),
    supabase.from('inventory_stock').select('warehouse_id'),
  ]);

  const totals = (totalsData ?? []) as unknown as ProductTotalsViewRow[];
  const expiry = (expiryData ?? []) as unknown as ExpiryReportViewRow[];
  const movements = (movementData ?? []) as unknown as RecentMovement[];
  const grns = (grnData ?? []) as unknown as RecentGrn[];
  const products = (productData ?? []) as Option[];
  const warehouses = (warehouseData ?? []) as Option[];

  const totalUnits = totals.reduce((sum, t) => sum + t.quantity_on_hand, 0);
  const totalValue = totals.reduce((sum, t) => sum + Number(t.estimated_value ?? 0), 0);
  const skusWithStock = totals.filter((t) => t.quantity_on_hand > 0).length;
  const lowStock = totals.filter((t) => t.stock_status === 'low_stock').length;
  // Only products that actually have stock records can be "out of stock";
  // never-stocked catalog items are simply not part of inventory yet.
  const outOfStock = totals.filter((t) => t.stock_status === 'out_of_stock' && t.warehouse_count !== null).length;
  const expiredBatches = expiry.filter((e) => e.expiry_status === 'expired');
  const criticalBatches = expiry.filter((e) => e.expiry_status === 'critical');
  const warehousesWithStock = new Set(((warehouseCountData ?? []) as { warehouse_id: string }[]).map((w) => w.warehouse_id)).size;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-ink-950">Inventory</h1>
        <p className="mt-1 text-sm text-ink-500">
          Batch-level stock with expiry tracking and FEFO allocation. Quantities always come from the immutable
          movement ledger — never edited directly.
        </p>
      </div>

      <InventoryNav />

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard icon={Boxes} label="SKUs with stock" value={String(skusWithStock)} sub={`${warehousesWithStock} warehouse(s)`} href="/admin/inventory/products" />
        <StatCard icon={Warehouse} label="Total units" value={totalUnits.toLocaleString('en-IN')} sub={`₹${totalValue.toLocaleString('en-IN', { maximumFractionDigits: 0 })} valuation`} href="/admin/inventory/reports" />
        <StatCard icon={AlertTriangle} label="Low stock" value={String(lowStock)} sub={`${outOfStock} out of stock`} accent={lowStock + outOfStock > 0} href="/admin/inventory/low-stock" />
        <StatCard icon={CalendarClock} label="Expiry alerts" value={String(criticalBatches.length + expiredBatches.length)} sub={`${expiredBatches.length} expired · ${criticalBatches.length} critical`} accent={expiredBatches.length > 0} href="/admin/inventory/expiry" />
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Card className="p-0 overflow-hidden">
          <CardHeader>
            <CardTitle>Recent stock movements</CardTitle>
            <Link href="/admin/inventory/movements" className="text-xs font-medium text-primary-600 hover:text-primary-700">
              View all →
            </Link>
          </CardHeader>
          {movements.length === 0 ? (
            <p className="px-5 pb-5 text-sm text-ink-500">No movements yet. Confirm a GRN to receive stock.</p>
          ) : (
            <ul className="divide-y divide-ink-100">
              {movements.map((m) => (
                <li key={m.id} className="flex items-center justify-between px-5 py-2.5 text-sm">
                  <div className="min-w-0">
                    <p className="truncate font-medium text-ink-900">{m.products?.name ?? 'Unknown product'}</p>
                    <p className="text-xs text-ink-400">
                      {MOVEMENT_LABEL[m.movement_type] ?? m.movement_type} · {m.warehouses?.name ?? '—'}
                    </p>
                  </div>
                  <div className="text-right">
                    <p className={`font-semibold ${m.direction === 'out' ? 'text-primary-600' : 'text-green-600'}`}>
                      {m.direction === 'out' ? '−' : '+'}{Math.abs(m.quantity)}
                    </p>
                    <p className="text-xs text-ink-400">{new Date(m.created_at).toLocaleString('en-IN')}</p>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card className="p-0 overflow-hidden">
          <CardHeader>
            <CardTitle>Recent GRNs</CardTitle>
            <Link href="/admin/inventory/grn/new" className="text-xs font-medium text-primary-600 hover:text-primary-700">
              New GRN →
            </Link>
          </CardHeader>
          {grns.length === 0 ? (
            <p className="px-5 pb-5 text-sm text-ink-500">No goods received notes yet.</p>
          ) : (
            <ul className="divide-y divide-ink-100">
              {grns.map((g) => (
                <li key={g.id} className="flex items-center justify-between px-5 py-2.5 text-sm">
                  <div>
                    <Link href={`/admin/inventory/grn/${g.id}`} className="font-mono font-medium text-ink-900 hover:text-primary-600">
                      {g.grn_number}
                    </Link>
                    <p className="text-xs text-ink-400">{g.warehouses?.name ?? '—'} · {new Date(g.created_at).toLocaleString('en-IN')}</p>
                  </div>
                  <StatusBadge status={g.status} />
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      {expiredBatches.length > 0 ? (
        <Card className="border-primary-200 bg-primary-50/40">
          <CardHeader>
            <CardTitle>
              <PackageX className="mr-2 inline h-4 w-4 text-primary-600" />
              {expiredBatches.length} expired batch(es) still holding stock
            </CardTitle>
            <Link href="/admin/inventory/expiry" className="text-xs font-medium text-primary-600 hover:text-primary-700">
              Review & write off →
            </Link>
          </CardHeader>
          <ul className="divide-y divide-primary-100">
            {expiredBatches.slice(0, 5).map((b) => (
              <li key={b.batch_id} className="flex items-center justify-between py-2 text-sm">
                <span className="font-medium text-ink-900">
                  {b.product_name} <span className="font-mono text-xs text-ink-400">{b.batch_number}</span>
                </span>
                <span className="text-ink-600">{b.warehouse_name} · {b.current_quantity} units expired</span>
              </li>
            ))}
          </ul>
        </Card>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>Record a manual stock adjustment</CardTitle>
        </CardHeader>
        <p className="mb-3 text-xs text-ink-400">
          Prefer GRNs for receipts and damage/expiry write-offs for losses — this form is for counted corrections and
          is recorded in the ledger as MANUAL_CORRECTION.
        </p>
        <StockAdjustmentForm products={products} warehouses={warehouses} />
      </Card>

      {totals.length === 0 ? (
        <AdminEmptyState
          icon={History}
          title="No inventory recorded yet"
          body="Create a GRN to receive your first stock — batches, expiry dates and the movement ledger are all captured automatically."
        />
      ) : null}
    </div>
  );
}

function StatCard({
  icon: Icon,
  label,
  value,
  sub,
  accent,
  href,
}: {
  icon: React.ElementType;
  label: string;
  value: string;
  sub?: string;
  accent?: boolean;
  href?: string;
}) {
  const inner = (
    <Card className="h-full">
      <div className="flex items-start justify-between">
        <div className="min-w-0">
          <p className="text-sm text-ink-500">{label}</p>
          <p className={`mt-1 text-2xl font-semibold ${accent ? 'text-primary-600' : 'text-ink-950'}`}>{value}</p>
          {sub ? <p className="mt-0.5 text-xs text-ink-400">{sub}</p> : null}
        </div>
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary-50">
          <Icon className="h-5 w-5 text-primary-600" />
        </div>
      </div>
    </Card>
  );
  return href ? <Link href={href}>{inner}</Link> : inner;
}
