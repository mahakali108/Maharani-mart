'use client';

/**
 * The retailer's notification feed.
 *
 * It owns its rows as DATA (via the shared `useInfiniteList`) rather than
 * receiving pre-rendered markup, because every row is interactive: tapping an
 * unread alert marks it read. Scrolling appends to the same list, and the
 * "Mark all as read" shortcut counts only the rows actually loaded.
 */

import { useTransition } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Loader2, RotateCw, Bell, CheckCheck, ChevronRight, Clock3, CreditCard, PackageCheck, Tag, Truck } from 'lucide-react';
import { markAllNotificationsReadAction, markNotificationReadAction } from '@/lib/retailer/notification-actions';
import { formatIndiaRelativeDateTime } from '@/lib/datetime/india';
import { useInfiniteList, type InfiniteListState } from '@/components/ui/infinite-scroll';

export interface NotificationItem {
  id: string;
  title: string;
  body: string;
  link_url: string | null;
  is_read: boolean;
  created_at: string;
}

export type NotificationLoader = (
  cursor: string | null
) => Promise<{ items: NotificationItem[]; nextCursor: string | null }>;

function iconFor(title: string, body: string) {
  const text = `${title} ${body}`.toLowerCase();
  if (text.includes('coin') || text.includes('wallet')) return CreditCard;
  if (text.includes('scheme') || text.includes('offer') || text.includes('festival')) return Tag;
  if (text.includes('dispatch') || text.includes('deliver') || text.includes('on the way')) return Truck;
  if (text.includes('order')) return PackageCheck;
  return Bell;
}

function FeedStatus({ state }: { state: InfiniteListState<NotificationItem> }) {
  return (
    <div className="flex flex-col items-center gap-2 py-5 text-center">
      <div ref={state.registerSentinel} aria-hidden="true" className="h-px w-full" data-infinite-scroll-sentinel="" />
      <div role="status" aria-live="polite" className="flex min-h-[24px] items-center justify-center text-[11px]">
        {state.loading ? (
          <span className="flex items-center gap-2 font-medium text-slate-400">
            <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
            Loading more updates…
          </span>
        ) : state.error ? (
          <span className="flex flex-wrap items-center justify-center gap-2 text-slate-500">
            <span>{state.error}</span>
            <button
              type="button"
              onClick={state.retry}
              className="inline-flex items-center gap-1 rounded-lg border border-slate-200 px-2.5 py-1 text-[11px] font-semibold text-slate-700 transition hover:border-primary-200 hover:text-primary-600"
            >
              <RotateCw className="h-3 w-3" aria-hidden="true" />
              Retry
            </button>
          </span>
        ) : state.hasMore ? (
          state.needsManualTrigger ? (
            <button
              type="button"
              onClick={state.loadMore}
              className="rounded-lg border border-slate-200 px-3 py-1.5 text-[11px] font-semibold text-slate-700 transition hover:border-primary-200 hover:text-primary-600"
            >
              Load more
            </button>
          ) : null
        ) : (
          <span className="text-slate-400">No more updates</span>
        )}
      </div>
    </div>
  );
}

export function NotificationList({
  alerts,
  loader,
  initialCursor,
  initialHasMore,
}: {
  alerts: NotificationItem[];
  loader: NotificationLoader;
  initialCursor: string | null;
  initialHasMore: boolean;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const state = useInfiniteList<NotificationItem>({ loader, initialCursor, initialHasMore });

  const rows: NotificationItem[] = [...alerts];
  const seen = new Set(rows.map((alert) => alert.id));
  for (const alert of state.items) {
    if (seen.has(alert.id)) continue;
    seen.add(alert.id);
    rows.push(alert);
  }

  const unread = rows.filter((alert) => !alert.is_read).length;

  function markOne(id: string) {
    startTransition(async () => {
      await markNotificationReadAction(id);
      router.refresh();
    });
  }

  function markAll() {
    startTransition(async () => {
      await markAllNotificationsReadAction();
      router.refresh();
    });
  }

  return (
    <div className="space-y-3">
      {unread > 0 ? (
        <div className="flex justify-end">
          <button
            type="button"
            onClick={markAll}
            disabled={isPending}
            className="inline-flex h-9 items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 text-[11px] font-bold text-slate-700 shadow-sm disabled:opacity-60"
          >
            <CheckCheck className="h-3.5 w-3.5" /> Mark all as read
          </button>
        </div>
      ) : null}

      <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div className="divide-y divide-slate-100">
          {rows.map((alert) => {
            const Icon = iconFor(alert.title, alert.body);
            const inner = (
              <article
                className={`group flex gap-3 p-4 transition sm:gap-4 sm:p-5 ${alert.is_read ? 'hover:bg-slate-50' : 'bg-primary-50/40 hover:bg-primary-50/70'}`}
                onClick={() => {
                  if (!alert.is_read) markOne(alert.id);
                }}
              >
                <span
                  className={`relative flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${alert.is_read ? 'bg-slate-100 text-slate-500' : 'bg-primary-600 text-white'}`}
                >
                  <Icon className="h-4 w-4" />
                  {!alert.is_read ? <span className="absolute -right-1 -top-1 h-2.5 w-2.5 rounded-full border-2 border-white bg-amber-400" /> : null}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-start justify-between gap-3">
                    <h2 className="text-xs font-bold text-slate-900 sm:text-sm">{alert.title}</h2>
                    {alert.link_url ? (
                      <ChevronRight className="h-4 w-4 shrink-0 text-slate-300 transition group-hover:translate-x-0.5 group-hover:text-primary-500" />
                    ) : null}
                  </div>
                  <p className="mt-1 text-[10px] leading-4 text-slate-600 sm:text-xs sm:leading-5">{alert.body}</p>
                  <p className="mt-2 flex items-center gap-1 text-[9px] text-slate-400">
                    <Clock3 className="h-3 w-3" /> {formatIndiaRelativeDateTime(alert.created_at)}
                  </p>
                </div>
              </article>
            );
            return alert.link_url ? (
              <Link key={alert.id} href={alert.link_url} className="block">
                {inner}
              </Link>
            ) : (
              <div key={alert.id}>{inner}</div>
            );
          })}
          {state.loading
            ? [0, 1, 2].map((index) => (
                <div key={`loading-${index}`} aria-hidden="true" className="flex gap-3 p-4 sm:gap-4 sm:p-5">
                  <span className="h-10 w-10 shrink-0 animate-pulse rounded-xl bg-slate-100" />
                  <div className="min-w-0 flex-1 space-y-2">
                    <span className="block h-3 w-32 animate-pulse rounded bg-slate-100" />
                    <span className="block h-3 w-48 animate-pulse rounded bg-slate-100" />
                  </div>
                </div>
              ))
            : null}
        </div>
      </section>

      <FeedStatus state={state} />
    </div>
  );
}
