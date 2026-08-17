'use client';

import { useTransition } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Bell, CheckCheck, ChevronRight, Clock3, CreditCard, PackageCheck, Tag, Truck } from 'lucide-react';
import { markAllNotificationsReadAction, markNotificationReadAction } from '@/lib/retailer/notification-actions';

export interface NotificationItem {
  id: string;
  title: string;
  body: string;
  link_url: string | null;
  is_read: boolean;
  created_at: string;
}

function iconFor(title: string, body: string) {
  const text = `${title} ${body}`.toLowerCase();
  if (text.includes('credit') || text.includes('outstanding') || text.includes('limit')) return CreditCard;
  if (text.includes('scheme') || text.includes('offer') || text.includes('festival')) return Tag;
  if (text.includes('dispatch') || text.includes('deliver') || text.includes('on the way')) return Truck;
  if (text.includes('order')) return PackageCheck;
  return Bell;
}

export function NotificationList({ alerts }: { alerts: NotificationItem[] }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const unread = alerts.filter((alert) => !alert.is_read).length;

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
          {alerts.map((alert) => {
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
                    <Clock3 className="h-3 w-3" />{' '}
                    {new Date(alert.created_at).toLocaleString('en-IN', {
                      day: 'numeric',
                      month: 'short',
                      year: 'numeric',
                      hour: 'numeric',
                      minute: '2-digit',
                    })}
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
        </div>
      </section>
    </div>
  );
}
