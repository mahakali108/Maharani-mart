import 'server-only';

import type { createClient } from '@/lib/supabase/server';
import {
  SUPPLIER_PAGE_SIZE,
  SUPPLIER_SUMMARY_WINDOW,
  aggregateSuppliers,
  grnValue,
  type SupplierGrnItemRow,
  type SupplierGrnRow,
  type SupplierQuery,
  type SupplierSummary,
} from './suppliers-query';

type Supabase = ReturnType<typeof createClient>;

export interface SupplierLedgerRow extends SupplierGrnRow {
  lines: number;
  value: number;
}

export interface SupplierDirectoryData {
  status: 'ok' | 'unavailable';
  ledger: SupplierLedgerRow[];
  total: number;
  counts: { all: number; draft: number; confirmed: number; cancelled: number };
  /** Aggregates over the most recent SUPPLIER_SUMMARY_WINDOW non-cancelled GRNs only. */
  summary: SupplierSummary[];
  summaryWindow: number;
  summaryTruncated: boolean;
}

const UNAVAILABLE: SupplierDirectoryData = {
  status: 'unavailable',
  ledger: [],
  total: 0,
  counts: { all: 0, draft: 0, confirmed: 0, cancelled: 0 },
  summary: [],
  summaryWindow: SUPPLIER_SUMMARY_WINDOW,
  summaryTruncated: false,
};

interface RawGrn extends Omit<SupplierGrnRow, 'warehouse_name'> {
  warehouses: { name: string } | null;
}

function flatten(row: RawGrn): SupplierGrnRow {
  const { warehouses, ...rest } = row;
  return { ...rest, warehouse_name: warehouses?.name ?? null };
}

async function itemsFor(supabase: Supabase, grnIds: string[]): Promise<SupplierGrnItemRow[]> {
  if (grnIds.length === 0) return [];
  const { data, error } = await supabase
    .from('grn_items')
    .select('grn_id, received_quantity, unit_cost')
    .in('grn_id', grnIds);
  if (error) throw new Error(error.message);
  return (data ?? []) as SupplierGrnItemRow[];
}

async function countGrns(supabase: Supabase, status?: string): Promise<number> {
  let query = supabase.from('grns').select('id', { count: 'exact', head: true });
  if (status) query = query.eq('status', status);
  const { count, error } = await query;
  if (error) throw new Error(error.message);
  return count ?? 0;
}

/**
 * Loads the Supplier Directory through the CALLER'S RLS-scoped client.
 * No service-role client is used: `grns`/`grn_items` RLS (0017,
 * is_staff_or_above()) remains the enforcement boundary, and the page-level
 * `suppliers.view` permission is checked before this is ever called.
 * Every query is bounded: ledger = one 25-row page + exact count, summary =
 * the latest SUPPLIER_SUMMARY_WINDOW GRNs and only their line items.
 */
export async function loadSupplierDirectory(
  supabase: Supabase,
  query: SupplierQuery
): Promise<SupplierDirectoryData> {
  try {
    const from = (query.page - 1) * SUPPLIER_PAGE_SIZE;

    let ledgerQuery = supabase
      .from('grns')
      .select(
        'id, grn_number, status, supplier_reference, invoice_reference, created_at, confirmed_at, warehouses ( name )',
        { count: 'exact' }
      )
      .order('created_at', { ascending: false })
      .order('id', { ascending: false })
      .range(from, from + SUPPLIER_PAGE_SIZE - 1);
    if (query.status !== 'all') ledgerQuery = ledgerQuery.eq('status', query.status);
    if (query.supplier) ledgerQuery = ledgerQuery.eq('supplier_reference', query.supplier);
    if (query.q) {
      ledgerQuery = ledgerQuery.or(
        `supplier_reference.ilike.%${query.q}%,grn_number.ilike.%${query.q}%,invoice_reference.ilike.%${query.q}%`
      );
    }

    const [ledgerRes, all, draft, confirmed, cancelled, summaryGrnsRes] = await Promise.all([
      ledgerQuery,
      countGrns(supabase),
      countGrns(supabase, 'draft'),
      countGrns(supabase, 'confirmed'),
      countGrns(supabase, 'cancelled'),
      supabase
        .from('grns')
        .select(
          'id, grn_number, status, supplier_reference, invoice_reference, created_at, confirmed_at, warehouses ( name )'
        )
        .neq('status', 'cancelled')
        .order('created_at', { ascending: false })
        .order('id', { ascending: false })
        .limit(SUPPLIER_SUMMARY_WINDOW),
    ]);
    if (ledgerRes.error) throw new Error(ledgerRes.error.message);
    if (summaryGrnsRes.error) throw new Error(summaryGrnsRes.error.message);

    const ledgerGrns = ((ledgerRes.data ?? []) as unknown as RawGrn[]).map(flatten);
    const summaryGrns = ((summaryGrnsRes.data ?? []) as unknown as RawGrn[]).map(flatten);

    const [ledgerItems, summaryItems] = await Promise.all([
      itemsFor(supabase, ledgerGrns.map((g) => g.id)),
      itemsFor(supabase, summaryGrns.map((g) => g.id)),
    ]);
    const itemsByGrn = new Map<string, SupplierGrnItemRow[]>();
    for (const item of ledgerItems) {
      const list = itemsByGrn.get(item.grn_id) ?? [];
      list.push(item);
      itemsByGrn.set(item.grn_id, list);
    }

    return {
      status: 'ok',
      total: ledgerRes.count ?? ledgerGrns.length,
      counts: { all, draft, confirmed, cancelled },
      ledger: ledgerGrns.map((g) => {
        const items = itemsByGrn.get(g.id) ?? [];
        return { ...g, lines: items.length, value: grnValue(items) };
      }),
      summary: aggregateSuppliers(summaryGrns, summaryItems),
      summaryWindow: SUPPLIER_SUMMARY_WINDOW,
      summaryTruncated: summaryGrns.length >= SUPPLIER_SUMMARY_WINDOW,
    };
  } catch (error) {
    console.error('[suppliers] directory load failed:', error);
    return UNAVAILABLE;
  }
}
