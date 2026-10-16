import { Bell } from 'lucide-react';
import { createClient } from '@/lib/supabase/server';
import { Card, CardHeader, CardTitle } from '@/components/ui/card';
import { Select } from '@/components/ui/select';
import { Button } from '@/components/ui/button';
import { AdminEmptyState } from '@/components/admin/empty-state';
import { NotificationComposer } from '@/components/admin/notification-composer';
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

interface LogRow {
  id: string;
  recipient_id: string | null;
  channel: 'whatsapp' | 'sms' | 'push' | 'in_app';
  status: 'queued' | 'sent' | 'delivered' | 'failed';
  provider_message_id: string | null;
  payload: unknown;
  error: string | null;
  created_at: string;
}

const STATUS_STYLES: Record<LogRow['status'], string> = {
  queued: 'bg-ink-100 text-ink-600',
  sent: 'bg-amber-50 text-amber-700',
  delivered: 'bg-mint-50 text-mint-700',
  failed: 'bg-primary-50 text-primary-700',
};

/** Rows per batch. */
const PAGE_SIZE = 25;

/** Newest first, `id` breaking ties so batches never overlap. */
const ORDER: KeysetColumn[] = [
  { column: 'created_at', ascending: false },
  { column: 'id', ascending: false },
];

interface LogFilters {
  channel: string;
  status: string;
}

type SupabaseClient = ReturnType<typeof createClient>;

/**
 * One batch of notification log rows, with the recipient names for THAT batch
 * resolved in a single bounded query (never one query per row, and never for
 * rows that are not being rendered).
 */
async function loadLogBatch(supabase: SupabaseClient, filters: LogFilters, cursor: ListCursor | null) {
  let query = supabase
    .from('notification_logs')
    .select('id, recipient_id, channel, status, provider_message_id, payload, error, created_at');

  if (filters.channel) query = query.eq('channel', filters.channel);
  if (filters.status) query = query.eq('status', filters.status);

  // notification_logs_owner_or_staff_read (0013_rls_and_storage_hardening.sql)
  // already scopes this to is_staff_or_above() — an unauthorized user querying
  // this table would only ever see their own rows, never anyone else's,
  // regardless of what this page requests.
  const { data } = await applyCursor(applyKeysetOrder(query, ORDER), cursor, ORDER, PAGE_SIZE);
  const rows = (data ?? []) as unknown as LogRow[];

  const recipientIds = [...new Set(rows.map((l) => l.recipient_id).filter((id): id is string => !!id))];
  const { data: profileRows } =
    recipientIds.length > 0
      ? await supabase.from('profiles').select('id, full_name').in('id', recipientIds)
      : { data: [] as unknown[] };
  const nameById = new Map(
    ((profileRows ?? []) as unknown as { id: string; full_name: string }[]).map((p) => [p.id, p.full_name])
  );

  const batch = toListBatch(rows, PAGE_SIZE, (row) => keysetCursorFor(row, ORDER));
  return {
    items: batch.items.map((log) => ({
      ...log,
      recipientName: log.recipient_id ? nameById.get(log.recipient_id) ?? 'Unknown' : null,
    })),
    nextCursor: batch.nextCursor,
  };
}

function renderLogRows(rows: (LogRow & { recipientName: string | null })[]) {
  return rows.map((log) => (
    <tr key={log.id}>
      <td className="px-5 py-3 text-ink-700">{log.recipientName ?? '—'}</td>
      <td className="px-5 py-3 text-ink-600 capitalize">{log.channel.replace('_', ' ')}</td>
      <td className="px-5 py-3">
        <span className={`rounded-full px-2.5 py-1 text-xs font-medium ${STATUS_STYLES[log.status]}`}>
          {log.status}
        </span>
      </td>
      <td className="px-5 py-3 text-xs text-ink-400">{formatIndiaDateTime(log.created_at)}</td>
      <td className="px-5 py-3">
        <details className="text-xs text-ink-500">
          <summary className="cursor-pointer text-primary-600">View</summary>
          <div className="mt-1.5 max-w-xs space-y-1">
            {log.provider_message_id ? <p>Message ID: {log.provider_message_id}</p> : null}
            {log.error ? <p className="text-primary-700">Error: {log.error}</p> : null}
            {log.payload ? (
              <pre className="whitespace-pre-wrap break-words rounded-lg bg-ink-50 p-2">
                {JSON.stringify(log.payload, null, 2)}
              </pre>
            ) : null}
            {!log.provider_message_id && !log.error && !log.payload ? <p>No further details.</p> : null}
          </div>
        </details>
      </td>
    </tr>
  ));
}

export default async function AdminNotificationsPage({
  searchParams,
}: {
  searchParams: { channel?: string; status?: string };
}) {
  const supabase = createClient();

  const filters: LogFilters = {
    channel: searchParams.channel ?? '',
    status: searchParams.status ?? '',
  };

  const firstBatch = await loadLogBatch(supabase, filters, null);
  const logs = firstBatch.items;

  async function loadMoreLogs(cursor: string | null): Promise<InfiniteScrollBatch> {
    'use server';
    const batch = await loadLogBatch(createClient(), filters, readCursor(cursor));
    return { rows: renderLogRows(batch.items), nextCursor: batch.nextCursor };
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-ink-950">Notifications</h1>
        <p className="mt-1 text-sm text-ink-500">Send announcements and review the delivery log for WhatsApp, SMS, push, and in-app notifications.</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Send an announcement</CardTitle>
        </CardHeader>
        <NotificationComposer />
      </Card>

      <form method="get" className="flex flex-wrap gap-2">
        <Select name="channel" defaultValue={filters.channel} className="w-auto">
          <option value="">All channels</option>
          <option value="whatsapp">WhatsApp</option>
          <option value="sms">SMS</option>
          <option value="push">Push</option>
          <option value="in_app">In-app</option>
        </Select>
        <Select name="status" defaultValue={filters.status} className="w-auto">
          <option value="">All statuses</option>
          <option value="queued">Queued</option>
          <option value="sent">Sent</option>
          <option value="delivered">Delivered</option>
          <option value="failed">Failed</option>
        </Select>
        <Button type="submit" variant="outline" size="sm">
          Filter
        </Button>
      </form>

      {logs.length === 0 ? (
        <AdminEmptyState
          icon={Bell}
          title="No notifications logged yet"
          body="Order updates, dispatch alerts, and other outbound notifications will show up here as they're sent."
        />
      ) : (
        <InfiniteScrollProvider
          loader={loadMoreLogs}
          initialCursor={firstBatch.nextCursor}
          initialHasMore={Boolean(firstBatch.nextCursor)}
          resetKey={`${filters.channel}|${filters.status}`}
        >
          <Card className="table-scroll p-0">
            <table className="w-full min-w-[680px] text-sm">
              <thead className="border-b border-ink-100 bg-ink-50 text-left text-xs uppercase tracking-wide text-ink-500">
                <tr>
                  <th className="px-5 py-3 font-medium">Recipient</th>
                  <th className="px-5 py-3 font-medium">Channel</th>
                  <th className="px-5 py-3 font-medium">Status</th>
                  <th className="px-5 py-3 font-medium">Sent</th>
                  <th className="px-5 py-3 font-medium">Details</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-ink-100">
                <InfiniteScrollRows skeleton={<InfiniteScrollTableSkeleton columns={5} />}>
                  {renderLogRows(logs)}
                </InfiniteScrollRows>
              </tbody>
            </table>
          </Card>

          <InfiniteScrollStatus endLabel="No more notifications" loadingLabel="Loading more…" />
        </InfiniteScrollProvider>
      )}
    </div>
  );
}
