import Link from 'next/link';
import { ScrollText, Search, Filter } from 'lucide-react';
import { createClient } from '@/lib/supabase/server';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Button } from '@/components/ui/button';
import { AdminEmptyState } from '@/components/admin/empty-state';

const PAGE_SIZE = 25;

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
  INSERT: 'bg-green-50 text-green-700',
  UPDATE: 'bg-blue-50 text-blue-700',
  DELETE: 'bg-primary-50 text-primary-700',
};

/**
 * Super Admin / Admin Audit Log viewer.
 *
 * Authorization:
 *   1. middleware.ts restricts /admin/* to super_admin/admin.
 *   2. audit_logs RLS (0001_init.sql) allows is_staff_or_above() to read all
 *      rows — the server-side Supabase client inherits the caller's JWT so
 *      the same RLS policy is the final enforcement boundary.
 *   3. We never expose sensitive fields: passwords, tokens, and secrets
 *      never reach this table (the log_audit trigger captures only column
 *      values from business tables, never auth secrets).
 */
export default async function AuditLogsPage({
  searchParams,
}: {
  searchParams: { table?: string; action?: string; q?: string; page?: string };
}) {
  const supabase = createClient();

  const tableFilter = searchParams.table ?? '';
  const actionFilter = searchParams.action ?? '';
  const q = searchParams.q?.trim() ?? '';
  const page = Math.max(1, Number(searchParams.page) || 1);
  const from = (page - 1) * PAGE_SIZE;
  const to = from + PAGE_SIZE - 1;

  let query = supabase
    .from('audit_logs')
    .select('id, table_name, record_id, action, changed_by, old_data, new_data, created_at', {
      count: 'exact',
    })
    .order('created_at', { ascending: false })
    .range(from, to);

  if (tableFilter) query = query.eq('table_name', tableFilter);
  if (actionFilter) query = query.eq('action', actionFilter);
  if (q) query = query.ilike('record_id', `%${q}%`);

  const { data: auditData, count } = await query;
  const rawRows = (auditData ?? []) as Omit<AuditLogRow, 'changed_by_name'>[];

  // Resolve changed_by names separately (same pattern as other pages).
  const changedByIds = [...new Set(rawRows.map((r) => r.changed_by).filter((id): id is string => !!id))];
  const { data: profileData } =
    changedByIds.length > 0
      ? await supabase.from('profiles').select('id, full_name').in('id', changedByIds)
      : { data: [] as unknown[] };

  const nameById = new Map(
    ((profileData ?? []) as { id: string; full_name: string }[]).map((p) => [p.id, p.full_name])
  );

  const logs: AuditLogRow[] = rawRows.map((r) => ({
    ...r,
    changed_by_name: r.changed_by ? nameById.get(r.changed_by) ?? 'Unknown user' : null,
  }));

  const totalPages = Math.max(1, Math.ceil((count ?? 0) / PAGE_SIZE));
  const hasFilters = tableFilter || actionFilter || q;

  const filterParams = new URLSearchParams();
  if (tableFilter) filterParams.set('table', tableFilter);
  if (actionFilter) filterParams.set('action', actionFilter);
  if (q) filterParams.set('q', q);

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
            <Input name="q" defaultValue={q} placeholder="Search record ID…" className="pl-9" />
          </div>
          <Select name="table" defaultValue={tableFilter}>
            <option value="">All tables</option>
            {TABLE_OPTIONS.map((t) => (
              <option key={t} value={t}>
                {t.replace(/_/g, ' ')}
              </option>
            ))}
          </Select>
          <Select name="action" defaultValue={actionFilter}>
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
        <>
          <Card className="overflow-hidden p-0">
            <table className="w-full text-sm">
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
                {logs.map((log) => (
                  <tr key={log.id}>
                    <td className="whitespace-nowrap px-5 py-3 text-xs text-ink-400">
                      {new Date(log.created_at).toLocaleString('en-IN')}
                    </td>
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
                ))}
              </tbody>
            </table>
          </Card>

          {totalPages > 1 ? (
            <div className="flex items-center justify-center gap-2">
              {page > 1 ? (
                <Link href={`/admin/audit-logs?${filterParams.toString()}&page=${page - 1}`}>
                  <Button size="sm" variant="outline">
                    Previous
                  </Button>
                </Link>
              ) : null}
              <span className="text-xs text-ink-400">
                Page {page} of {totalPages}
              </span>
              {page < totalPages ? (
                <Link href={`/admin/audit-logs?${filterParams.toString()}&page=${page + 1}`}>
                  <Button size="sm" variant="outline">
                    Next
                  </Button>
                </Link>
              ) : null}
            </div>
          ) : null}
        </>
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
