/**
 * Supplier Directory & Purchase Ledger — pure query parsing and aggregation.
 *
 * CONTEXT (verified 2026-10-17 against migrations 0001–0058):
 * there is NO supplier master table, no supplier role, and no purchase-order /
 * supplier-invoice / supplier-payment schema. Suppliers exist only as the
 * free-text `grns.supplier_reference` (0017: "no supplier master table exists
 * yet") and `inventory_batches.supplier_reference`. This module therefore
 * describes GRN-derived supplier activity ONLY. It must never be used to
 * invent a legal identity, GSTIN, payable balance or settlement figure.
 *
 * PURE — no Supabase, no `next/*`, no env, no secrets.
 */

export const SUPPLIER_PAGE_SIZE = 25;
/** Hard ceiling so a crafted ?page= cannot turn into an unbounded OFFSET scan. */
export const SUPPLIER_MAX_PAGE = 200;
/** Bounded recent window used for the (clearly labelled) supplier summary. */
export const SUPPLIER_SUMMARY_WINDOW = 300;

export const SUPPLIER_STATUSES = ['all', 'draft', 'confirmed', 'cancelled'] as const;
export type SupplierStatusFilter = (typeof SUPPLIER_STATUSES)[number];

export interface SupplierQuery {
  /** Free-text search over GRN number, supplier reference and supplier invoice reference. */
  q: string;
  status: SupplierStatusFilter;
  /** Exact supplier reference filter (from clicking a supplier summary row). */
  supplier: string;
  page: number;
}

/** Strip LIKE/PostgREST metacharacters so user input can never widen a search. */
export function sanitizeSupplierSearch(raw: string | undefined): string {
  return (raw ?? '')
    .replace(/[%_*\\"',()]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80);
}

export function parseSupplierQuery(
  searchParams: Record<string, string | string[] | undefined>
): SupplierQuery {
  const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
  const rawPage = Number(first(searchParams.page));
  const page = Number.isFinite(rawPage) ? Math.min(Math.max(Math.trunc(rawPage), 1), SUPPLIER_MAX_PAGE) : 1;
  const statusRaw = first(searchParams.status);
  return {
    q: sanitizeSupplierSearch(first(searchParams.q)),
    status: (SUPPLIER_STATUSES as readonly string[]).includes(statusRaw ?? '')
      ? (statusRaw as SupplierStatusFilter)
      : 'all',
    supplier: sanitizeSupplierSearch(first(searchParams.supplier)),
    page,
  };
}

export function supplierHref(
  query: SupplierQuery,
  overrides: Partial<SupplierQuery> = {}
): string {
  const merged = { ...query, ...overrides };
  const params = new URLSearchParams();
  if (merged.q) params.set('q', merged.q);
  if (merged.status !== 'all') params.set('status', merged.status);
  if (merged.supplier) params.set('supplier', merged.supplier);
  if (merged.page > 1) params.set('page', String(merged.page));
  const qs = params.toString();
  return qs ? `/admin/suppliers?${qs}` : '/admin/suppliers';
}

export function totalPages(total: number, pageSize = SUPPLIER_PAGE_SIZE): number {
  if (!Number.isFinite(total) || total <= 0) return 1;
  return Math.min(Math.ceil(total / pageSize), SUPPLIER_MAX_PAGE);
}

// ---------------------------------------------------------------------------
// Aggregation (operates only on rows the caller was authorized to read)
// ---------------------------------------------------------------------------

export interface SupplierGrnRow {
  id: string;
  grn_number: string;
  status: string;
  supplier_reference: string | null;
  invoice_reference: string | null;
  created_at: string;
  confirmed_at: string | null;
  warehouse_name: string | null;
}

export interface SupplierGrnItemRow {
  grn_id: string;
  received_quantity: number;
  unit_cost: number | null;
}

export interface SupplierSummary {
  /** Display name; blank references group under an explicit label, never invented. */
  name: string;
  /** Exact reference to filter by; null for the unspecified group. */
  reference: string | null;
  grns: number;
  draft: number;
  confirmed: number;
  lines: number;
  /** Σ received_quantity × unit_cost over non-cancelled GRNs in the window. */
  value: number;
  lastActivityAt: string | null;
}

export const UNSPECIFIED_SUPPLIER = 'Unspecified supplier';

function roundMoney(n: number): number {
  return Math.round(n * 100) / 100;
}

export function grnValue(items: SupplierGrnItemRow[]): number {
  return roundMoney(items.reduce((s, i) => s + i.received_quantity * (i.unit_cost ?? 0), 0));
}

export function aggregateSuppliers(
  grns: SupplierGrnRow[],
  items: SupplierGrnItemRow[]
): SupplierSummary[] {
  const itemsByGrn = new Map<string, SupplierGrnItemRow[]>();
  for (const item of items) {
    const list = itemsByGrn.get(item.grn_id) ?? [];
    list.push(item);
    itemsByGrn.set(item.grn_id, list);
  }
  const bySupplier = new Map<string, SupplierSummary>();
  for (const grn of grns) {
    if (grn.status === 'cancelled') continue;
    const reference = (grn.supplier_reference ?? '').trim() || null;
    const key = reference ?? UNSPECIFIED_SUPPLIER;
    const row =
      bySupplier.get(key) ??
      ({
        name: key,
        reference,
        grns: 0,
        draft: 0,
        confirmed: 0,
        lines: 0,
        value: 0,
        lastActivityAt: null,
      } satisfies SupplierSummary);
    const grnItems = itemsByGrn.get(grn.id) ?? [];
    row.grns += 1;
    if (grn.status === 'draft') row.draft += 1;
    if (grn.status === 'confirmed') row.confirmed += 1;
    row.lines += grnItems.length;
    row.value = roundMoney(row.value + grnValue(grnItems));
    const activity = grn.confirmed_at ?? grn.created_at;
    if (!row.lastActivityAt || activity > row.lastActivityAt) row.lastActivityAt = activity;
    bySupplier.set(key, row);
  }
  return [...bySupplier.values()].sort(
    (a, b) => b.value - a.value || b.grns - a.grns || a.name.localeCompare(b.name)
  );
}
