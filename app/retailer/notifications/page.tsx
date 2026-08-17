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
        <Link href="/retailer/home" className="hover:text-primary-600">Home</Link>
        <ChevronRight className="h-3 w-3" />
        <span className="text-slate-800">Updates</span>
      </div>

      <section className="relative overflow-hidden rounded-2xl bg-gradient-to-r from-slate-950 via-slate-900 to-primary-950 p-5 text-white shadow-lg sm:p-8">
        <BellRing className="absolute -bottom-6 -right-3 h-36 w-36 rotate-12 text-white/5 sm:h-48 sm:w-48" />
        <div className="relative">
          <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-amber-300">Stay informed</p>
          <h1 className="mt-2 text-2xl font-bold tracking-tight sm:text-4xl">Updates & alerts</h1>
          <p className="mt-2 text-xs text-slate-300 sm:text-sm">Order activity, account messages and marketplace news.</p>
          {unread > 0 ? (
            <span className="mt-4 inline-flex rounded-full bg-white/10 px-3 py-1.5 text-[10px] font-bold text-white">
              {unread} unread update{unread === 1 ? '' : 's'}
            </span>
          ) : null}
        </div>
      </section>

      {alerts.length === 0 ? (
        <section className="flex min-h-[360px] flex-col items-center justify-center rounded-2xl border border-slate-200 bg-white px-5 text-center shadow-sm">
          <span className="flex h-16 w-16 items-center justify-center rounded-full bg-slate-100 text-slate-400">
            <Bell className="h-7 w-7" />
          </span>
          <h2 className="mt-4 text-lg font-bold text-slate-800">You’re all caught up</h2>
          <p className="mt-2 text-xs text-slate-500">Order updates, scheme alerts and credit messages will appear here.</p>
        </section>
      ) : (
        <NotificationList alerts={alerts} />
      )}
    </div>
  );
}
