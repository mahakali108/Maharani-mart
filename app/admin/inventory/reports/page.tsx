import { BarChart3 } from 'lucide-react';
import { createClient } from '@/lib/supabase/server';
import { requirePermission, requirePagePermission } from '@/lib/admin/guard';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Button } from '@/components/ui/button';
import { AdminEmptyState } from '@/components/admin/empty-state';
import { InventoryNav } from '@/components/admin/inventory-nav';
import {
  InfiniteScrollProvider,
  InfiniteScrollRows,
  InfiniteScrollStatus,
  InfiniteScrollTableSkeleton,
  type InfiniteScrollBatch,
} from '@/components/ui/infinite-scroll';
import type { ProductTotalsViewRow, ExpiryReportViewRow } from '@/types/inventory.types';
import { formatIndiaDateTime, indiaDayEndIso, indiaDayStartIso } from '@/lib/datetime/india';
import {
  applyCursor,
  applyKeysetOrder,
  cursorOffset,
  keysetCursorFor,
  readCursor,
  toListBatch,
  toOffsetBatch,
  type KeysetColumn,
} from '@/lib/infinite-scroll/keyset';
import type { ListCursor } from '@/lib/infinite-scroll/cursor';

/** Rows per batch. */
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

interface ReportFilters {
  report: string;
  warehouse: string;
  q: string;
  from: string;
  to: string;
}

type SupabaseClient = ReturnType<typeof createClient>;

/** Column headers + already-formatted cells for one report batch. */
interface ReportBatch {
  headers: string[];
  rows: string[][];
  nextCursor: string | null;
}

const VALUATION_ORDER: KeysetColumn[] = [
  { column: 'product_name', ascending: true },
  { column: 'product_id', ascending: true },
];

/**
 * `seq` (movements) is a monotonic NOT NULL sequence and `created_at` (GRNs) is
 * NOT NULL, so both are keyset-friendly. The remaining reports sort by a
 * nullable date or a non-unique one, so they page by offset with a unique
 * tiebreaker in the ORDER BY.
 */
const MOVEMENT_ORDER: KeysetColumn[] = [{ column: 'seq', ascending: false }];
const GRN_ORDER: KeysetColumn[] = [
  { column: 'created_at', ascending: false },
  { column: 'id', ascending: false },
];

async function resolveProductIds(supabase: SupabaseClient, q: string): Promise<string[] | null> {
  if (!q) return null;
  const { data } = await supabase
    .from('products')
    .select('id')
    .or(`name.ilike.%${q}%,sku_code.ilike.%${q}%`)
    .limit(500);
  const ids = ((data ?? []) as { id: string }[]).map((product) => product.id);
  // An empty match must mean "no results", never "no filter".
  return ids.length > 0 ? ids : ['00000000-0000-0000-0000-000000000000'];
}

/**
 * One batch of whichever report is selected. Every branch keeps the same
 * filters and permissions as the old paged query — only the window changed.
 */
async function loadReportBatch(
  supabase: SupabaseClient,
  filters: ReportFilters,
  cursor: ListCursor | null
): Promise<ReportBatch> {
  const productIds = await resolveProductIds(supabase, filters.q);

  if (filters.report === 'valuation' || filters.report === 'low-stock') {
    let query = supabase.from('inventory_product_totals').select('*');
    if (productIds) query = query.in('product_id', productIds);
    if (filters.report === 'valuation') query = query.gt('quantity_on_hand', 0);
    else query = query.in('stock_status', ['low_stock', 'out_of_stock']).not('warehouse_count', 'is', null);
    const { data } = await applyCursor(
      applyKeysetOrder(query, VALUATION_ORDER),
      cursor,
      VALUATION_ORDER,
      PAGE_SIZE
    );
    const batch = toListBatch((data ?? []) as unknown as ProductTotalsViewRow[], PAGE_SIZE, (row) =>
      keysetCursorFor(row, VALUATION_ORDER)
    );
    return {
      headers: ['Product', 'Status', 'On hand', 'Reserved', 'Available', 'Reorder level', 'Est. value'],
      rows: batch.items.map((r) => [
        `${r.product_name} (${r.sku_code})`,
        r.stock_status.replace(/_/g, ' '),
        String(r.quantity_on_hand),
        String(r.reserved_quantity),
        String(r.available_quantity),
        r.reorder_level > 0 ? String(r.reorder_level) : '—',
        `₹${Number(r.estimated_value).toLocaleString('en-IN')}`,
      ]),
      nextCursor: batch.nextCursor,
    };
  }

  if (filters.report === 'batches') {
    const offset = cursorOffset(cursor);
    let query = supabase
      .from('inventory_batches')
      .select(
        'id, batch_number, expiry_date, current_quantity, reserved_quantity, unit_cost, products ( name, sku_code ), warehouses ( name )'
      )
      .gt('current_quantity', 0);
    if (filters.warehouse) query = query.eq('warehouse_id', filters.warehouse);
    if (productIds) query = query.in('product_id', productIds);
    const { data } = await applyCursor(
      query.order('expiry_date', { ascending: true, nullsFirst: false }).order('id', { ascending: true }),
      cursor,
      [],
      PAGE_SIZE
    );
    const batch = toOffsetBatch((data ?? []) as unknown as BatchReportRow[], PAGE_SIZE, offset);
    return {
      headers: ['Product', 'Batch', 'Warehouse', 'Expiry', 'On hand', 'Reserved', 'Unit cost', 'Value'],
      rows: batch.items.map((b) => [
        b.products?.name ?? '—',
        b.batch_number,
        b.warehouses?.name ?? '—',
        b.expiry_date ?? 'No expiry',
        String(b.current_quantity),
        String(b.reserved_quantity),
        b.unit_cost != null ? `₹${b.unit_cost}` : '—',
        b.unit_cost != null ? `₹${(b.current_quantity * b.unit_cost).toLocaleString('en-IN')}` : '—',
      ]),
      nextCursor: batch.nextCursor,
    };
  }

  if (filters.report === 'warehouses') {
    const offset = cursorOffset(cursor);
    let query = supabase
      .from('inventory_stock')
      .select('id, quantity, reserved_quantity, products ( name, sku_code ), warehouses ( name )');
    if (filters.warehouse) query = query.eq('warehouse_id', filters.warehouse);
    if (productIds) query = query.in('product_id', productIds);
    const { data } = await applyCursor(
      query.order('updated_at', { ascending: false }).order('id', { ascending: true }),
      cursor,
      [],
      PAGE_SIZE
    );
    const batch = toOffsetBatch((data ?? []) as unknown as WarehouseReportRow[], PAGE_SIZE, offset);
    return {
      headers: ['Product', 'Warehouse', 'On hand', 'Reserved', 'Available'],
      rows: batch.items.map((r) => [
        `${r.products?.name ?? '—'} (${r.products?.sku_code ?? '—'})`,
        r.warehouses?.name ?? '—',
        String(r.quantity),
        String(r.reserved_quantity),
        String(r.quantity - r.reserved_quantity),
      ]),
      nextCursor: batch.nextCursor,
    };
  }

  if (filters.report === 'expiry') {
    const offset = cursorOffset(cursor);
    let query = supabase.from('inventory_expiry_report').select('*');
    if (filters.warehouse) query = query.eq('warehouse_id', filters.warehouse);
    if (productIds) query = query.in('product_id', productIds);
    const { data } = await applyCursor(
      query.order('expiry_date', { ascending: true, nullsFirst: false }).order('batch_id', { ascending: true }),
      cursor,
      [],
      PAGE_SIZE
    );
    const batch = toOffsetBatch((data ?? []) as unknown as ExpiryReportViewRow[], PAGE_SIZE, offset);
    return {
      headers: ['Product', 'Batch', 'Warehouse', 'Expiry', 'Days left', 'Qty', 'Status', 'Est. value'],
      rows: batch.items.map((r) => [
        r.product_name,
        r.batch_number,
        r.warehouse_name,
        r.expiry_date ?? 'No expiry',
        r.days_remaining == null ? '—' : String(r.days_remaining),
        String(r.current_quantity),
        r.expiry_status,
        `₹${Number(r.estimated_value).toLocaleString('en-IN')}`,
      ]),
      nextCursor: batch.nextCursor,
    };
  }

  if (filters.report === 'movements') {
    let query = supabase
      .from('stock_movements')
      .select('id, movement_type, quantity, direction, created_at, products ( name ), warehouses ( name )');
    if (filters.warehouse) query = query.eq('warehouse_id', filters.warehouse);
    if (productIds) query = query.in('product_id', productIds);
    if (filters.from) query = query.gte('created_at', indiaDayStartIso(filters.from)!);
    if (filters.to) query = query.lte('created_at', indiaDayEndIso(filters.to)!);
    const { data } = await applyCursor(
      applyKeysetOrder(query, MOVEMENT_ORDER),
      cursor,
      MOVEMENT_ORDER,
      PAGE_SIZE
    );
    const batch = toListBatch((data ?? []) as unknown as MovementReportRow[], PAGE_SIZE, (row) =>
      keysetCursorFor(row, MOVEMENT_ORDER)
    );
    return {
      headers: ['When', 'Product', 'Warehouse', 'Type', 'Qty'],
      rows: batch.items.map((m) => [
        formatIndiaDateTime(m.created_at),
        m.products?.name ?? '—',
        m.warehouses?.name ?? '—',
        m.movement_type.replace(/_/g, ' '),
        `${m.direction === 'out' ? '−' : '+'}${Math.abs(m.quantity)}`,
      ]),
      nextCursor: batch.nextCursor,
    };
  }

  // GRN report
  let query = supabase
    .from('grns')
    .select(
      'id, grn_number, status, created_at, confirmed_at, warehouses ( name ), grn_items ( id, received_quantity, unit_cost )'
    );
  if (filters.warehouse) query = query.eq('warehouse_id', filters.warehouse);
  if (filters.from) query = query.gte('created_at', indiaDayStartIso(filters.from)!);
  if (filters.to) query = query.lte('created_at', indiaDayEndIso(filters.to)!);
  const { data } = await applyCursor(applyKeysetOrder(query, GRN_ORDER), cursor, GRN_ORDER, PAGE_SIZE);
  const batch = toListBatch((data ?? []) as unknown as GrnReportRow[], PAGE_SIZE, (row) =>
    keysetCursorFor(row, GRN_ORDER)
  );
  return {
    headers: ['GRN #', 'Warehouse', 'Status', 'Units', 'Value', 'Created', 'Confirmed'],
    rows: batch.items.map((g) => {
      const units = g.grn_items.reduce((s, i) => s + i.received_quantity, 0);
      const value = g.grn_items.reduce((s, i) => s + i.received_quantity * (i.unit_cost ?? 0), 0);
      return [
        g.grn_number,
        g.warehouses?.name ?? '—',
        g.status,
        String(units),
        `₹${value.toLocaleString('en-IN')}`,
        formatIndiaDateTime(g.created_at),
        g.confirmed_at ? formatIndiaDateTime(g.confirmed_at) : '—',
      ];
    }),
    nextCursor: batch.nextCursor,
  };
}

/**
 * Report rows are plain strings, so the same renderer serves the first
 * (server-rendered) batch and every batch the Server Action returns.
 */
function renderReportRows(rows: string[][]) {
  return rows.map((row, rowIndex) => (
    <tr key={rowIndex}>
      {row.map((cell, cellIndex) => (
        <td key={cellIndex} className="px-5 py-3 text-ink-700">
          {cell}
        </td>
      ))}
    </tr>
  ));
}

export default async function InventoryReportsPage({
  searchParams,
}: {
  searchParams: { report?: string; warehouse?: string; q?: string; from?: string; to?: string };
}) {
  await requirePagePermission('reports.view.all');
  const supabase = createClient();

  const filters: ReportFilters = {
    report: searchParams.report ?? 'valuation',
    warehouse: searchParams.warehouse ?? '',
    q: (searchParams.q ?? '').trim(),
    from: searchParams.from ?? '',
    to: searchParams.to ?? '',
  };

  const [firstBatch, { data: warehouseData }] = await Promise.all([
    loadReportBatch(supabase, filters, null),
    supabase.from('warehouses').select('id, name').eq('is_active', true).order('name'),
  ]);
  const warehouses = (warehouseData ?? []) as { id: string; name: string }[];

  /** Server Action for batches 2..n; the report permission is re-checked. */
  async function loadMoreReport(cursor: string | null): Promise<InfiniteScrollBatch> {
    'use server';
    await requirePermission('reports.view.all');
    const batch = await loadReportBatch(createClient(), filters, readCursor(cursor));
    return { rows: renderReportRows(batch.rows), nextCursor: batch.nextCursor };
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-ink-950">Inventory Reports</h1>
        <p className="mt-1 text-sm text-ink-500">
          Valuation, batch, warehouse, expiry, low-stock, movement and GRN reports — filtered and streamed
          server-side.
        </p>
      </div>

      <InventoryNav />

      <Card>
        <p className="mb-3 text-sm font-medium text-ink-800">Download CSV</p>
        <div className="flex flex-wrap gap-2">
          {[
            { kind: 'stock', label: 'Stock by warehouse' },
            { kind: 'movements', label: 'Stock movements' },
            { kind: 'expiry', label: 'Expiry report' },
            { kind: 'batches', label: 'Batches' },
          ].map((item) => (
            <a
              key={item.kind}
              href={`/admin/inventory/reports/export?kind=${item.kind}`}
              className="rounded-xl bg-ink-50 px-3 py-1.5 text-sm font-medium text-ink-700 transition-colors hover:bg-primary-50 hover:text-primary-700"
            >
              {item.label}
            </a>
          ))}
        </div>
      </Card>

      <Card>
        <form method="get" className="flex flex-wrap items-end gap-2">
          <div>
            <label className="mb-1 block text-xs font-medium text-ink-500">Report</label>
            <Select name="report" defaultValue={filters.report} className="w-48">
              {REPORTS.map((r) => (
                <option key={r.key} value={r.key}>
                  {r.label}
                </option>
              ))}
            </Select>
          </div>
          {filters.report !== 'grn' ? (
            <div>
              <label className="mb-1 block text-xs font-medium text-ink-500">Product search</label>
              <Input name="q" defaultValue={filters.q} placeholder="Name or SKU" className="w-44" />
            </div>
          ) : null}
          <div>
            <label className="mb-1 block text-xs font-medium text-ink-500">Warehouse</label>
            <Select name="warehouse" defaultValue={filters.warehouse} className="w-40">
              <option value="">All</option>
              {warehouses.map((w) => (
                <option key={w.id} value={w.id}>
                  {w.name}
                </option>
              ))}
            </Select>
          </div>
          {filters.report === 'movements' || filters.report === 'grn' ? (
            <>
              <div>
                <label className="mb-1 block text-xs font-medium text-ink-500">From</label>
                <Input type="date" name="from" defaultValue={filters.from} className="w-40" />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-ink-500">To</label>
                <Input type="date" name="to" defaultValue={filters.to} className="w-40" />
              </div>
            </>
          ) : null}
          <Button type="submit" size="sm" variant="outline">
            Run report
          </Button>
        </form>
      </Card>

      {firstBatch.rows.length === 0 ? (
        <AdminEmptyState
          icon={BarChart3}
          title="No data for this report"
          body="Adjust the filters or record some inventory first."
        />
      ) : (
        <InfiniteScrollProvider
          loader={loadMoreReport}
          initialCursor={firstBatch.nextCursor}
          initialHasMore={Boolean(firstBatch.nextCursor)}
          resetKey={`${filters.report}|${filters.warehouse}|${filters.q}|${filters.from}|${filters.to}`}
        >
          <Card className="overflow-x-auto p-0">
            <table className="w-full min-w-[800px] text-sm">
              <thead className="border-b border-ink-100 bg-ink-50 text-left text-xs uppercase tracking-wide text-ink-500">
                <tr>
                  {firstBatch.headers.map((header) => (
                    <th key={header} className="px-5 py-3 font-medium">
                      {header}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-ink-100">
                <InfiniteScrollRows
                  skeleton={<InfiniteScrollTableSkeleton columns={firstBatch.headers.length} />}
                >
                  {renderReportRows(firstBatch.rows)}
                </InfiniteScrollRows>
              </tbody>
            </table>
          </Card>

          <InfiniteScrollStatus endLabel="No more rows" loadingLabel="Loading more…" />
        </InfiniteScrollProvider>
      )}
    </div>
  );
}
