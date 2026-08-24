import Link from 'next/link';
import { BarChart3 } from 'lucide-react';
import { createClient } from '@/lib/supabase/server';
import { requirePermission } from '@/lib/admin/guard';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Button } from '@/components/ui/button';
import { AdminEmptyState } from '@/components/admin/empty-state';
import { InventoryNav } from '@/components/admin/inventory-nav';
import type { ProductTotalsViewRow, ExpiryReportViewRow } from '@/types/inventory.types';

const PAGE_SIZE = 30;

const REPORTS = [
  { key: 'valuation', label: 'Stock valuation' },
  { key: 'batches', label: 'Batch-wise stock' },
  { key: 'warehouses', label: 'Warehouse-wise stock' },
  { key: 'expiry', label: 'Expiry report' },
  { key: 'low-stock', label: 'Low-stock report' },
  { key: 'movements', label: 'Movement report' },
  { key: 'grn', label: 'GRN report' },
];

interface BatchReportRow {
  id: string;
  batch_number: string;
  expiry_date: string | null;
  current_quantity: number;
  reserved_quantity: number;
  unit_cost: number | null;
  products: { name: string; sku_code: string } | null;
  warehouses: { name: string } | null;
}

interface WarehouseReportRow {
  id: string;
  quantity: number;
  reserved_quantity: number;
  products: { name: string; sku_code: string } | null;
  warehouses: { name: string } | null;
}

interface MovementReportRow {
  id: string;
  movement_type: string;
  quantity: number;
  direction: string | null;
  created_at: string;
  products: { name: string } | null;
  warehouses: { name: string } | null;
}

interface GrnReportRow {
  id: string;
  grn_number: string;
  status: string;
  created_at: string;
  confirmed_at: string | null;
  warehouses: { name: string } | null;
  grn_items: { id: string; received_quantity: number; unit_cost: number | null }[];
}

export default async function InventoryReportsPage({
  searchParams,
}: {
  searchParams: { report?: string; warehouse?: string; q?: string; from?: string; to?: string; page?: string };
}) {
  await requirePermission('reports.view.all');
  const supabase = createClient();

  const report = searchParams.report ?? 'valuation';
  const warehouse = searchParams.warehouse ?? '';
  const q = (searchParams.q ?? '').trim();
  const from = searchParams.from ?? '';
  const to = searchParams.to ?? '';
  const page = Math.max(1, Number(searchParams.page) || 1);
  const rangeFrom = (page - 1) * PAGE_SIZE;
  const rangeTo = rangeFrom + PAGE_SIZE - 1;

  const [{ data: warehouseData }, { data: productIdsData }] = await Promise.all([
    supabase.from('warehouses').select('id, name').eq('is_active', true).order('name'),
    q
      ? supabase.from('products').select('id').or(`name.ilike.%${q}%,sku_code.ilike.%${q}%`).limit(500)
      : Promise.resolve({ data: null }),
  ]);
  const warehouses = (warehouseData ?? []) as { id: string; name: string }[];
  let productIds: string[] | null = null;
  if (q) {
    productIds = ((productIdsData ?? []) as { id: string }[]).map((p) => p.id);
    if (productIds.length === 0) productIds = ['00000000-0000-0000-0000-000000000000'];
  }

  const filterBase = `/admin/inventory/reports?report=${report}&warehouse=${warehouse}&q=${encodeURIComponent(q)}&from=${from}&to=${to}`;
  let body: React.ReactNode = null;

  if (report === 'valuation' || report === 'low-stock') {
    let query = supabase.from('inventory_product_totals').select('*', { count: 'exact' });
    if (productIds) query = query.in('product_id', productIds);
    if (report === 'valuation') query = query.gt('quantity_on_hand', 0);
    else query = query.in('stock_status', ['low_stock', 'out_of_stock']).not('warehouse_count', 'is', null);
    const { data, count } = await query.order('product_name').range(rangeFrom, rangeTo);
    const rows = (data ?? []) as unknown as ProductTotalsViewRow[];
    const totalValue = rows.reduce((s, r) => s + Number(r.estimated_value), 0);
    body = (
      <SimpleTable
        count={count ?? 0}
        page={page}
        filterBase={filterBase}
        headers={['Product', 'Status', 'On hand', 'Reserved', 'Available', 'Reorder level', 'Est. value']}
        rows={rows.map((r) => [
          `${r.product_name} (${r.sku_code})`,
          r.stock_status.replace(/_/g, ' '),
          String(r.quantity_on_hand),
          String(r.reserved_quantity),
          String(r.available_quantity),
          r.reorder_level > 0 ? String(r.reorder_level) : '—',
          `₹${Number(r.estimated_value).toLocaleString('en-IN')}`,
        ])}
        footer={report === 'valuation' ? `Page value: ₹${totalValue.toLocaleString('en-IN', { maximumFractionDigits: 0 })}` : undefined}
      />
    );
  } else if (report === 'batches') {
    let query = supabase
      .from('inventory_batches')
      .select('id, batch_number, expiry_date, current_quantity, reserved_quantity, unit_cost, products ( name, sku_code ), warehouses ( name )', { count: 'exact' })
      .gt('current_quantity', 0);
    if (warehouse) query = query.eq('warehouse_id', warehouse);
    if (productIds) query = query.in('product_id', productIds);
    const { data, count } = await query.order('expiry_date', { ascending: true, nullsFirst: false }).range(rangeFrom, rangeTo);
    const rows = (data ?? []) as unknown as BatchReportRow[];
    body = (
      <SimpleTable
        count={count ?? 0}
        page={page}
        filterBase={filterBase}
        headers={['Product', 'Batch', 'Warehouse', 'Expiry', 'On hand', 'Reserved', 'Unit cost', 'Value']}
        rows={rows.map((b) => [
          b.products?.name ?? '—',
          b.batch_number,
          b.warehouses?.name ?? '—',
          b.expiry_date ?? 'No expiry',
          String(b.current_quantity),
          String(b.reserved_quantity),
          b.unit_cost != null ? `₹${b.unit_cost}` : '—',
          b.unit_cost != null ? `₹${(b.current_quantity * b.unit_cost).toLocaleString('en-IN')}` : '—',
        ])}
      />
    );
  } else if (report === 'warehouses') {
    let query = supabase
      .from('inventory_stock')
      .select('id, quantity, reserved_quantity, products ( name, sku_code ), warehouses ( name )', { count: 'exact' });
    if (warehouse) query = query.eq('warehouse_id', warehouse);
    if (productIds) query = query.in('product_id', productIds);
    const { data, count } = await query.order('updated_at', { ascending: false }).range(rangeFrom, rangeTo);
    const rows = (data ?? []) as unknown as WarehouseReportRow[];
    body = (
      <SimpleTable
        count={count ?? 0}
        page={page}
        filterBase={filterBase}
        headers={['Product', 'Warehouse', 'On hand', 'Reserved', 'Available']}
        rows={rows.map((r) => [
          `${r.products?.name ?? '—'} (${r.products?.sku_code ?? '—'})`,
          r.warehouses?.name ?? '—',
          String(r.quantity),
          String(r.reserved_quantity),
          String(r.quantity - r.reserved_quantity),
        ])}
      />
    );
  } else if (report === 'expiry') {
    let query = supabase.from('inventory_expiry_report').select('*', { count: 'exact' });
    if (warehouse) query = query.eq('warehouse_id', warehouse);
    if (productIds) query = query.in('product_id', productIds);
    const { data, count } = await query.order('expiry_date', { ascending: true, nullsFirst: false }).range(rangeFrom, rangeTo);
    const rows = (data ?? []) as unknown as ExpiryReportViewRow[];
    body = (
      <SimpleTable
        count={count ?? 0}
        page={page}
        filterBase={filterBase}
        headers={['Product', 'Batch', 'Warehouse', 'Expiry', 'Days left', 'Qty', 'Status', 'Est. value']}
        rows={rows.map((r) => [
          r.product_name,
          r.batch_number,
          r.warehouse_name,
          r.expiry_date ?? 'No expiry',
          r.days_remaining == null ? '—' : String(r.days_remaining),
          String(r.current_quantity),
          r.expiry_status,
          `₹${Number(r.estimated_value).toLocaleString('en-IN')}`,
        ])}
      />
    );
  } else if (report === 'movements') {
    let query = supabase
      .from('stock_movements')
      .select('id, movement_type, quantity, direction, created_at, products ( name ), warehouses ( name )', { count: 'exact' })
      .order('seq', { ascending: false });
    if (warehouse) query = query.eq('warehouse_id', warehouse);
    if (productIds) query = query.in('product_id', productIds);
    if (from) query = query.gte('created_at', `${from}T00:00:00.000Z`);
    if (to) query = query.lte('created_at', `${to}T23:59:59.999Z`);
    const { data, count } = await query.range(rangeFrom, rangeTo);
    const rows = (data ?? []) as unknown as MovementReportRow[];
    body = (
      <SimpleTable
        count={count ?? 0}
        page={page}
        filterBase={filterBase}
        headers={['When', 'Product', 'Warehouse', 'Type', 'Qty']}
        rows={rows.map((m) => [
          new Date(m.created_at).toLocaleString('en-IN'),
          m.products?.name ?? '—',
          m.warehouses?.name ?? '—',
          m.movement_type.replace(/_/g, ' '),
          `${m.direction === 'out' ? '−' : '+'}${Math.abs(m.quantity)}`,
        ])}
      />
    );
  } else {
    // GRN report
    let query = supabase
      .from('grns')
      .select('id, grn_number, status, created_at, confirmed_at, warehouses ( name ), grn_items ( id, received_quantity, unit_cost )', { count: 'exact' })
      .order('created_at', { ascending: false });
    if (warehouse) query = query.eq('warehouse_id', warehouse);
    if (from) query = query.gte('created_at', `${from}T00:00:00.000Z`);
    if (to) query = query.lte('created_at', `${to}T23:59:59.999Z`);
    const { data, count } = await query.range(rangeFrom, rangeTo);
    const rows = (data ?? []) as unknown as GrnReportRow[];
    body = (
      <SimpleTable
        count={count ?? 0}
        page={page}
        filterBase={filterBase}
        headers={['GRN #', 'Warehouse', 'Status', 'Units', 'Value', 'Created', 'Confirmed']}
        rows={rows.map((g) => {
          const units = g.grn_items.reduce((s, i) => s + i.received_quantity, 0);
          const value = g.grn_items.reduce((s, i) => s + i.received_quantity * (i.unit_cost ?? 0), 0);
          return [
            g.grn_number,
            g.warehouses?.name ?? '—',
            g.status,
            String(units),
            `₹${value.toLocaleString('en-IN')}`,
            new Date(g.created_at).toLocaleString('en-IN'),
            g.confirmed_at ? new Date(g.confirmed_at).toLocaleString('en-IN') : '—',
          ];
        })}
      />
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-ink-950">Inventory Reports</h1>
        <p className="mt-1 text-sm text-ink-500">
          Valuation, batch, warehouse, expiry, low-stock, movement and GRN reports — filtered and paginated
          server-side.
        </p>
      </div>

      <InventoryNav />

      <Card>
        <form method="get" className="flex flex-wrap items-end gap-2">
          <div>
            <label className="mb-1 block text-xs font-medium text-ink-500">Report</label>
            <Select name="report" defaultValue={report} className="w-48">
              {REPORTS.map((r) => (
                <option key={r.key} value={r.key}>{r.label}</option>
              ))}
            </Select>
          </div>
          {report !== 'grn' ? (
            <div>
              <label className="mb-1 block text-xs font-medium text-ink-500">Product search</label>
              <Input name="q" defaultValue={q} placeholder="Name or SKU" className="w-44" />
            </div>
          ) : null}
          <div>
            <label className="mb-1 block text-xs font-medium text-ink-500">Warehouse</label>
            <Select name="warehouse" defaultValue={warehouse} className="w-40">
              <option value="">All</option>
              {warehouses.map((w) => (
                <option key={w.id} value={w.id}>{w.name}</option>
              ))}
            </Select>
          </div>
          {report === 'movements' || report === 'grn' ? (
            <>
              <div>
                <label className="mb-1 block text-xs font-medium text-ink-500">From</label>
                <Input type="date" name="from" defaultValue={from} className="w-40" />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-ink-500">To</label>
                <Input type="date" name="to" defaultValue={to} className="w-40" />
              </div>
            </>
          ) : null}
          <Button type="submit" size="sm" variant="outline">Run report</Button>
        </form>
      </Card>

      {body}
    </div>
  );
}

function SimpleTable({
  headers,
  rows,
  count,
  page,
  filterBase,
  footer,
}: {
  headers: string[];
  rows: string[][];
  count: number;
  page: number;
  filterBase: string;
  footer?: string;
}) {
  const totalPages = Math.max(1, Math.ceil(count / PAGE_SIZE));
  if (rows.length === 0) {
    return (
      <AdminEmptyState icon={BarChart3} title="No data for this report" body="Adjust the filters or record some inventory first." />
    );
  }
  return (
    <>
      <Card className="overflow-x-auto p-0">
        <table className="w-full min-w-[800px] text-sm">
          <thead className="border-b border-ink-100 bg-ink-50 text-left text-xs uppercase tracking-wide text-ink-500">
            <tr>
              {headers.map((h) => (
                <th key={h} className="px-5 py-3 font-medium">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-ink-100">
            {rows.map((row, i) => (
              <tr key={i}>
                {row.map((cell, j) => (
                  <td key={j} className="px-5 py-3 text-ink-700">{cell}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
      <div className="flex items-center justify-center gap-2">
        {page > 1 ? (
          <Link href={`${filterBase}&page=${page - 1}`}>
            <Button size="sm" variant="outline">Previous</Button>
          </Link>
        ) : null}
        <span className="text-xs text-ink-400">
          Page {page} of {totalPages} · {count} rows{footer ? ` · ${footer}` : ''}
        </span>
        {page < totalPages ? (
          <Link href={`${filterBase}&page=${page + 1}`}>
            <Button size="sm" variant="outline">Next</Button>
          </Link>
        ) : null}
      </div>
    </>
  );
}
