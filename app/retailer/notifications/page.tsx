import Link from 'next/link';
import { Bell, BellRing, ChevronRight } from 'lucide-react';
import { createClient } from '@/lib/supabase/server';
import { requireUser } from '@/lib/auth/session';
import { NotificationList } from '@/components/retailer/notification-list';

interface NotificationRow {
  id: string;
  title: string;
  body: string;
  link_url: string | null;
  is_read: boolean;
  created_at: string;
}

export default async function RetailerAlertsPage() {
  const user = await requireUser();
  const supabase = createClient();
  const { data } = await supabase
    .from('notifications')
    .select('id, title, body, link_url, is_read, created_at')
    .eq('recipient_id', user.id)
    .order('created_at', { ascending: false })
    .returns<NotificationRow[]>();
  const alerts = data ?? [];
  const unread = alerts.filter((alert) => !alert.is_read).length;

  return (
    <div className="space-y-5 sm:space-y-6">
      <div className="flex items-center gap-1.5 text-[10px] font-semibold text-slate-500 sm:text-xs">
        <Link href="/retailer/home" className="hover:text-primary-600">
          Home
        </Link>
        <ChevronRight className="h-3 w-3" />
        <span className="text-slate-800">Updates</span>
      </div>

      <section className="relative overflow-hidden rounded-2xl border border-slate-200 bg-gradient-to-br from-primary-50 via-white to-rose-50/50 p-5 shadow-[0_1px_2px_rgba(15,23,42,0.04)] sm:p-7">
        <div className="flex items-start gap-4">
          <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-primary-600 text-white shadow-sm">
            <BellRing className="h-5 w-5" aria-hidden="true" />
          </span>
          <div>
            <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-primary-600">Stay informed</p>
            <h1 className="mt-1 text-2xl font-bold tracking-tight text-slate-950 sm:text-3xl">Updates &amp; alerts</h1>
            <p className="mt-1 text-xs leading-5 text-slate-600 sm:text-sm">
              Order activity, account messages and marketplace news.
            </p>
            {unread > 0 ? (
              <span className="mt-3 inline-flex rounded-full bg-primary-50 px-3 py-1.5 text-[10px] font-bold text-primary-700">
                {unread} unread update{unread === 1 ? '' : 's'}
              </span>
            ) : null}
          </div>
        </div>
      </section>

      {alerts.length === 0 ? (
        <section className="flex min-h-[360px] flex-col items-center justify-center rounded-2xl border border-slate-200 bg-white px-5 text-center shadow-sm">
          <span className="flex h-16 w-16 items-center justify-center rounded-full bg-slate-100 text-slate-400">
            <Bell className="h-7 w-7" aria-hidden="true" />
          </span>
          <h2 className="mt-4 text-lg font-bold text-slate-800">You&rsquo;re all caught up</h2>
          <p className="mt-2 text-xs text-slate-500">
            Order updates, scheme alerts and credit messages will appear here.
          </p>
        </section>
      ) : (
        <NotificationList alerts={alerts} />
      )}
    </div>
  );
}
