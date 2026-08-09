import { Bell } from 'lucide-react';
import { createClient } from '@/lib/supabase/server';
import { Card } from '@/components/ui/card';
import { Select } from '@/components/ui/select';
import { Button } from '@/components/ui/button';
import { AdminEmptyState } from '@/components/admin/empty-state';

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
  delivered: 'bg-green-50 text-green-700',
  failed: 'bg-primary-50 text-primary-700',
};

const PAGE_SIZE = 25;

function buildPageQuery(params: { channel?: string; status?: string }, page: number): string {
  const entries: [string, string][] = [];
  if (params.channel) entries.push(['channel', params.channel]);
  if (params.status) entries.push(['status', params.status]);
  entries.push(['page', String(page)]);
  return new URLSearchParams(entries).toString();
}

export default async function AdminNotificationsPage({
  searchParams,
}: {
  searchParams: { channel?: string; status?: string; page?: string };
}) {
  const supabase = createClient();
  const page = Math.max(1, Number(searchParams.page) || 1);
  const from = (page - 1) * PAGE_SIZE;
  const to = from + PAGE_SIZE - 1;

  // notification_logs_owner_or_staff_read (0013_rls_and_storage_hardening.sql)
  // already scopes this to is_staff_or_above() — an unauthorized user
  // querying this table would only ever see their own rows, never
  // anyone else's, regardless of what this page requests.
  let query = supabase
    .from('notification_logs')
    .select('id, recipient_id, channel, status, provider_message_id, payload, error, created_at', {
      count: 'exact',
    })
    .order('created_at', { ascending: false })
    .range(from, to);

  if (searchParams.channel) query = query.eq('channel', searchParams.channel);
  if (searchParams.status) query = query.eq('status', searchParams.status);

  const { data: logRows, count } = await query;
  const logs = (logRows ?? []) as unknown as LogRow[];

  const recipientIds = [...new Set(logs.map((l) => l.recipient_id).filter((id): id is string => !!id))];
  const { data: profileRows } =
    recipientIds.length > 0
      ? await supabase.from('profiles').select('id, full_name').in('id', recipientIds)
      : { data: [] as unknown[] };
  const nameById = new Map(((profileRows ?? []) as unknown as { id: string; full_name: string }[]).map((p) => [p.id, p.full_name]));

  const totalPages = count ? Math.ceil(count / PAGE_SIZE) : 1;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-ink-950">Notifications</h1>
        <p className="mt-1 text-sm text-ink-500">Delivery log for WhatsApp, SMS, push, and in-app notifications.</p>
      </div>

      <form method="get" className="flex flex-wrap gap-2">
        <Select name="channel" defaultValue={searchParams.channel ?? ''} className="w-auto">
          <option value="">All channels</option>
          <option value="whatsapp">WhatsApp</option>
          <option value="sms">SMS</option>
          <option value="push">Push</option>
          <option value="in_app">In-app</option>
        </Select>
        <Select name="status" defaultValue={searchParams.status ?? ''} className="w-auto">
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
        <>
          <Card className="overflow-hidden p-0">
            <table className="w-full text-sm">
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
                {logs.map((log) => (
                  <tr key={log.id}>
                    <td className="px-5 py-3 text-ink-700">
                      {log.recipient_id ? nameById.get(log.recipient_id) ?? 'Unknown' : '—'}
                    </td>
                    <td className="px-5 py-3 text-ink-600 capitalize">{log.channel.replace('_', ' ')}</td>
                    <td className="px-5 py-3">
                      <span className={`rounded-full px-2.5 py-1 text-xs font-medium ${STATUS_STYLES[log.status]}`}>
                        {log.status}
                      </span>
                    </td>
                    <td className="px-5 py-3 text-xs text-ink-400">
                      {new Date(log.created_at).toLocaleString('en-IN')}
                    </td>
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
                ))}
              </tbody>
            </table>
          </Card>

          {totalPages > 1 ? (
            <div className="flex items-center justify-between text-sm text-ink-500">
              <span>
                Page {page} of {totalPages}
              </span>
              <div className="flex gap-2">
                {page > 1 ? (
                  <a
                    href={`?${buildPageQuery(searchParams, page - 1)}`}
                    className="rounded-lg border border-ink-200 px-3 py-1.5 hover:bg-ink-50"
                  >
                    Previous
                  </a>
                ) : null}
                {page < totalPages ? (
                  <a
                    href={`?${buildPageQuery(searchParams, page + 1)}`}
                    className="rounded-lg border border-ink-200 px-3 py-1.5 hover:bg-ink-50"
                  >
                    Next
                  </a>
                ) : null}
              </div>
            </div>
          ) : null}
        </>
      )}
    </div>
  );
}
