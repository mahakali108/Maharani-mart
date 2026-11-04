import Link from 'next/link';
import { ScrollText, Search, Filter } from 'lucide-react';
import { createClient } from '@/lib/supabase/server';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Button } from '@/components/ui/button';
import { AdminEmptyState } from '@/components/admin/empty-state';
import {
  InfiniteScrollProvider,
  InfiniteScrollRows,
  InfiniteScrollStatus,
  InfiniteScrollTableSkeleton,
  type InfiniteScrollBatch,
} from '@/components/ui/infinite-scroll';
import { formatIndiaDateTime } from '@/lib/datetime/india';
import {
  applyCursor,
  applyKeysetOrder,
  keysetCursorFor,
  readCursor,
  toListBatch,
  type KeysetColumn,
} from '@/lib/infinite-scroll/keyset';
import type { ListCursor } from '@/lib/infinite-scroll/cursor';

/** Rows per batch. */
const PAGE_SIZE = 25;

/** Newest first, `id` breaking ties so a batch never repeats or skips a row. */
const ORDER: KeysetColumn[] = [
  { column: 'created_at', ascending: false },
  { column: 'id', ascending: false },
];

const TABLE_OPTIONS = [
  'products',
  'product_packs',
  'product_pricing_tiers',
  'price_lists',
  'orders',
  'retailers',
  'inventory_stock',
  'stock_movements',
  'banners',
  'schemes',
  'product_images',
  'retailer_documents',
  'warehouses',
  'areas',
  'profiles',
  'staff_assignments',
];

const ACTION_OPTIONS = ['INSERT', 'UPDATE', 'DELETE'];

interface AuditLogRow {
  id: string;
  table_name: string;
  record_id: string;
  action: string;
  changed_by: string | null;
  old_data: Record<string, unknown> | null;
  new_data: Record<string, unknown> | null;
  created_at: string;
  changed_by_name: string | null;
}

const ACTION_STYLES: Record<string, string> = {
  INSERT: 'bg-mint-50 text-mint-700',
  UPDATE: 'bg-sky-50 text-sky-700',
  DELETE: 'bg-primary-50 text-primary-700',
};

interface AuditFilters {
  table: string;
  action: string;
  q: string;
}

type SupabaseClient = Awaited<ReturnType<typeof createClient>>;

/**
 * One batch of audit rows, with the editor names for THAT batch resolved in a
 * single bounded query.
 *
 * Authorization is untouched:
 *   1. middleware.ts restricts /admin/* to super_admin/admin.
 *   2. audit_logs RLS (0001_init.sql) allows is_staff_or_above() to read all
 *      rows — the server-side Supabase client inherits the caller's JWT so the
 *      same RLS policy is the final enforcement boundary.
 *   3. We never expose sensitive fields: passwords, tokens, and secrets never
 *      reach this table (the log_audit trigger captures only column values
 *      from business tables, never auth secrets).
 */
async function loadAuditBatch(
  supabase: SupabaseClient,
  filters: AuditFilters,
  cursor: ListCursor | null
) {
  let query = supabase
    .from('audit_logs')
    .select('id, table_name, record_id, action, changed_by, old_data, new_data, created_at');

  if (filters.table) query = query.eq('table_name', filters.table);
  if (filters.action) query = query.eq('action', filters.action);
  if (filters.q) query = query.ilike('record_id', `%${filters.q}%`);

  const { data } = await applyCursor(applyKeysetOrder(query, ORDER), cursor, ORDER, PAGE_SIZE);
  const rawRows = (data ?? []) as Omit<AuditLogRow, 'changed_by_name'>[];

  const changedByIds = [...new Set(rawRows.map((r) => r.changed_by).filter((id): id is string => !!id))];
  const { data: profileData } =
    changedByIds.length > 0
      ? await supabase.from('profiles').select('id, full_name').in('id', changedByIds)
      : { data: [] as unknown[] };

  const nameById = new Map(
    ((profileData ?? []) as { id: string; full_name: string }[]).map((p) => [p.id, p.full_name])
  );

  const batch = toListBatch(rawRows, PAGE_SIZE, (row) => keysetCursorFor(row, ORDER));
  return {
    items: batch.items.map((row) => ({
      ...row,
      changed_by_name: row.changed_by ? nameById.get(row.changed_by) ?? 'Unknown user' : null,
    })),
    nextCursor: batch.nextCursor,
  };
}

function renderAuditRows(rows: AuditLogRow[]) {
  return rows.map((log) => (
    <tr key={log.id}>
      <td className="whitespace-nowrap px-5 py-3 text-xs text-ink-400">{formatIndiaDateTime(log.created_at)}</td>
      <td className="px-5 py-3 text-ink-700">{log.changed_by_name ?? 'System'}</td>
      <td className="px-5 py-3">
        <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${ACTION_STYLES[log.action] ?? 'bg-ink-100 text-ink-600'}`}>
          {log.action}
        </span>
      </td>
      <td className="px-5 py-3 font-mono text-xs text-ink-600">{log.table_name}</td>
      <td className="px-5 py-3 font-mono text-xs text-ink-400">{log.record_id.slice(0, 8)}…</td>
      <td className="px-5 py-3">
        <ChangeDetails oldData={log.old_data} newData={log.new_data} action={log.action} />
      </td>
    </tr>
  ));
}

/**
 * Super Admin / Admin Audit Log viewer — the list now scrolls instead of
 * paging, so a long audit trail is read top-to-bottom without ever touching a
 * "Next" button.
 */
export default async function AuditLogsPage({
  searchParams: searchParamsPromise,
}: {
  searchParams: Promise<{ table?: string; action?: string; q?: string }>;
}) {
  const searchParams = await searchParamsPromise;
  const supabase = (await createClient());

  const filters: AuditFilters = {
    table: searchParams.table ?? '',
    action: searchParams.action ?? '',
    q: searchParams.q?.trim() ?? '',
  };

  const firstBatch = await loadAuditBatch(supabase, filters, null);
  const logs = firstBatch.items;
  const hasFilters = Boolean(filters.table || filters.action || filters.q);

  async function loadMoreAudit(cursor: string | null): Promise<InfiniteScrollBatch> {
    'use server';
    const batch = await loadAuditBatch((await createClient()), filters, readCursor(cursor));
    return { rows: renderAuditRows(batch.items), nextCursor: batch.nextCursor };
  }

  return (
    <div className="space-y-6">
      <div>
        <div className="flex items-center gap-2.5">
          <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-ink-950">
            <ScrollText className="h-5 w-5 text-white" />
          </span>
          <div>
            <h1 className="text-xl font-semibold text-ink-950 sm:text-2xl">Audit Log</h1>
            <p className="text-xs text-ink-500">
              Complete history of changes to products, pricing, orders, retailers, and more.
            </p>
          </div>
        </div>
      </div>

      <Card>
        <form method="get" className="grid grid-cols-1 gap-3 sm:grid-cols-4">
          <div className="relative sm:col-span-2">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-400" />
            <Input name="q" defaultValue={filters.q} placeholder="Search record ID…" className="pl-9" />
          </div>
          <Select name="table" defaultValue={filters.table}>
            <option value="">All tables</option>
            {TABLE_OPTIONS.map((t) => (
              <option key={t} value={t}>
                {t.replace(/_/g, ' ')}
              </option>
            ))}
          </Select>
          <Select name="action" defaultValue={filters.action}>
            <option value="">All actions</option>
            {ACTION_OPTIONS.map((a) => (
              <option key={a} value={a}>
                {a}
              </option>
            ))}
          </Select>
          <div className="flex gap-2 sm:col-span-4">
            <Button type="submit" variant="secondary" size="sm">
              <Filter className="h-3.5 w-3.5" />
              Apply filters
            </Button>
            {hasFilters ? (
              <Link href="/admin/audit-logs">
                <Button type="button" variant="ghost" size="sm">
                  Clear
                </Button>
              </Link>
            ) : null}
          </div>
        </form>
      </Card>

      {logs.length === 0 ? (
        <AdminEmptyState
          icon={ScrollText}
          title={hasFilters ? 'No audit entries match your filters' : 'No audit entries yet'}
          body={
            hasFilters
              ? 'Try a different table, action, or clear the filters above.'
              : 'Changes to products, pricing, orders, and other business data are automatically recorded here.'
          }
        />
      ) : (
        <InfiniteScrollProvider
          loader={loadMoreAudit}
          initialCursor={firstBatch.nextCursor}
          initialHasMore={Boolean(firstBatch.nextCursor)}
          resetKey={`${filters.table}|${filters.action}|${filters.q}`}
        >
          <Card className="table-scroll p-0">
            <table className="w-full min-w-[760px] text-sm">
              <thead className="border-b border-ink-100 bg-ink-50 text-left text-xs uppercase tracking-wide text-ink-500">
                <tr>
                  <th className="px-5 py-3 font-medium">When</th>
                  <th className="px-5 py-3 font-medium">Who</th>
                  <th className="px-5 py-3 font-medium">Action</th>
                  <th className="px-5 py-3 font-medium">Table</th>
                  <th className="px-5 py-3 font-medium">Record</th>
                  <th className="px-5 py-3 font-medium">Details</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-ink-100">
                <InfiniteScrollRows skeleton={<InfiniteScrollTableSkeleton columns={6} />}>
                  {renderAuditRows(logs)}
                </InfiniteScrollRows>
              </tbody>
            </table>
          </Card>

          <InfiniteScrollStatus endLabel="No more audit entries" loadingLabel="Loading more…" />
        </InfiniteScrollProvider>
      )}
    </div>
  );
}

/**
 * Renders a compact summary of what changed. For INSERT, shows the new data
 * keys; for UPDATE, shows changed fields; for DELETE, shows removed record.
 * Never exposes sensitive fields (passwords, tokens, secrets are never in
 * the audit_logs table due to trigger design).
 */
function ChangeDetails({
  oldData,
  newData,
  action,
}: {
  oldData: Record<string, unknown> | null;
  newData: Record<string, unknown> | null;
  action: string;
}) {
  // Sensitive keys to filter out
  const sensitiveKeys = ['password', 'token', 'secret', 'service_role', 'api_key'];

  if (action === 'INSERT' && newData) {
    const keys = Object.keys(newData).filter((k) => !sensitiveKeys.some((s) => k.toLowerCase().includes(s)));
    const summary = keys.slice(0, 3).map((k) => `${k}: ${formatValue(newData[k])}`).join(', ');
    return <span className="text-xs text-ink-500">{summary}{keys.length > 3 ? '…' : ''}</span>;
  }

  if (action === 'UPDATE' && oldData && newData) {
    const changed: string[] = [];
    for (const key of Object.keys(newData)) {
      if (sensitiveKeys.some((s) => key.toLowerCase().includes(s))) continue;
      if (JSON.stringify(oldData[key]) !== JSON.stringify(newData[key])) {
        changed.push(`${key}: ${formatValue(oldData[key])} → ${formatValue(newData[key])}`);
      }
    }
    if (changed.length === 0) return <span className="text-xs text-ink-400">No visible changes</span>;
    const summary = changed.slice(0, 2).join(', ');
    return <span className="text-xs text-ink-500">{summary}{changed.length > 2 ? ` (+${changed.length - 2} more)` : ''}</span>;
  }

  if (action === 'DELETE' && oldData) {
    const keys = Object.keys(oldData).filter((k) => !sensitiveKeys.some((s) => k.toLowerCase().includes(s)));
    const summary = keys.slice(0, 2).map((k) => `${k}: ${formatValue(oldData[k])}`).join(', ');
    return <span className="text-xs text-ink-500">{summary}</span>;
  }

  return <span className="text-xs text-ink-400">—</span>;
}

function formatValue(value: unknown): string {
  if (value === null || value === undefined) return '—';
  if (typeof value === 'number') return value.toFixed(2);
  if (typeof value === 'string') return value.length > 30 ? value.slice(0, 30) + '…' : value;
  if (typeof value === 'boolean') return value ? 'yes' : 'no';
  return String(value).slice(0, 30);
}
