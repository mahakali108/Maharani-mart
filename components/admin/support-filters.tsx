'use client';

import { useRouter } from 'next/navigation';
import {
  SUPPORT_PRIORITIES,
  SUPPORT_PRIORITY_LABELS,
  SUPPORT_STATUSES,
  SUPPORT_STATUS_LABELS,
  SUPPORT_TOPICS,
  SUPPORT_TOPIC_LABELS,
  type SupportPriority,
  type SupportStatus,
  type SupportTopic,
} from '@/lib/retailer/support';

function supportHref(params: { status?: string; topic?: string; priority?: string }): string {
  const query = new URLSearchParams();
  if (params.status) query.set('status', params.status);
  if (params.topic) query.set('topic', params.topic);
  if (params.priority) query.set('priority', params.priority);
  const s = query.toString();
  return `/admin/support${s ? `?${s}` : ''}`;
}

/**
 * Status tabs + category/priority filters for the admin ticket queue.
 * Plain router.push navigation — the page re-runs the (RLS-scoped) query
 * server-side on every change.
 */
export function SupportFilters({
  status,
  topic,
  priority,
}: {
  status: SupportStatus | 'all';
  topic: SupportTopic | '';
  priority: SupportPriority | '';
}) {
  const router = useRouter();

  return (
    <div className="flex flex-wrap items-center gap-2">
      <div className="flex flex-wrap gap-2">
        {[
          { value: 'all' as const, label: 'All' },
          { value: 'open' as const, label: 'Open' },
          ...SUPPORT_STATUSES.slice(1).map((s) => ({ value: s, label: SUPPORT_STATUS_LABELS[s] })),
        ].map((tab) => (
          <button
            key={tab.value}
            type="button"
            onClick={() =>
              router.push(
                supportHref({
                  status: tab.value === 'open' ? undefined : tab.value,
                  topic,
                  priority,
                })
              )
            }
            aria-current={status === tab.value ? 'page' : undefined}
            className={`rounded-full px-3 py-1.5 text-xs font-semibold transition ${
              status === tab.value
                ? 'bg-ink-950 text-white'
                : 'bg-ink-50 text-ink-600 hover:bg-ink-100'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>
      <div className="ml-auto flex flex-wrap gap-2">
        <select
          aria-label="Filter by category"
          value={topic}
          onChange={(e) =>
            router.push(
              supportHref({
                status: status === 'open' ? undefined : status,
                topic: e.target.value as SupportTopic | '',
                priority,
              })
            )
          }
          className="h-8 rounded-lg border border-ink-200 bg-white px-2 text-xs text-ink-700 outline-none focus:border-primary-300"
        >
          <option value="">All categories</option>
          {SUPPORT_TOPICS.map((t) => (
            <option key={t} value={t}>
              {SUPPORT_TOPIC_LABELS[t]}
            </option>
          ))}
        </select>
        <select
          aria-label="Filter by priority"
          value={priority}
          onChange={(e) =>
            router.push(
              supportHref({
                status: status === 'open' ? undefined : status,
                topic,
                priority: e.target.value as SupportPriority | '',
              })
            )
          }
          className="h-8 rounded-lg border border-ink-200 bg-white px-2 text-xs text-ink-700 outline-none focus:border-primary-300"
        >
          <option value="">All priorities</option>
          {SUPPORT_PRIORITIES.map((p) => (
            <option key={p} value={p}>
              {SUPPORT_PRIORITY_LABELS[p]}
            </option>
          ))}
        </select>
      </div>
    </div>
  );
}
