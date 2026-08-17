import Link from 'next/link';
import { Bell, BellRing, ChevronRight, Clock3 } from 'lucide-react';
import { createClient } from '@/lib/supabase/server';
import { requireUser } from '@/lib/auth/session';

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
      <div className="flex items-center gap-1.5 text-[10px] font-semibold text-slate-500 sm:text-xs"><Link href="/retailer/home" className="hover:text-primary-600">Home</Link><ChevronRight className="h-3 w-3" /><span className="text-slate-800">Updates</span></div>

      <section className="relative overflow-hidden rounded-2xl bg-gradient-to-r from-slate-950 via-slate-900 to-primary-950 p-5 text-white shadow-lg sm:p-8">
        <BellRing className="absolute -bottom-6 -right-3 h-36 w-36 rotate-12 text-white/5 sm:h-48 sm:w-48" />
        <div className="relative"><p className="text-[10px] font-bold uppercase tracking-[0.2em] text-amber-300">Stay informed</p><h1 className="mt-2 text-2xl font-bold tracking-tight sm:text-4xl">Updates & alerts</h1><p className="mt-2 text-xs text-slate-300 sm:text-sm">Order activity, account messages and marketplace news.</p>{unread > 0 ? <span className="mt-4 inline-flex rounded-full bg-white/10 px-3 py-1.5 text-[10px] font-bold text-white">{unread} unread update{unread === 1 ? '' : 's'}</span> : null}</div>
      </section>

      {alerts.length === 0 ? (
        <section className="flex min-h-[360px] flex-col items-center justify-center rounded-2xl border border-slate-200 bg-white px-5 text-center shadow-sm"><span className="flex h-16 w-16 items-center justify-center rounded-full bg-slate-100 text-slate-400"><Bell className="h-7 w-7" /></span><h2 className="mt-4 text-lg font-bold text-slate-800">You’re all caught up</h2><p className="mt-2 text-xs text-slate-500">Order updates and account alerts will appear here.</p></section>
      ) : (
        <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
          <div className="divide-y divide-slate-100">
            {alerts.map((alert) => {
              const content = (
                <article className={`group flex gap-3 p-4 transition sm:gap-4 sm:p-5 ${alert.is_read ? 'hover:bg-slate-50' : 'bg-primary-50/40 hover:bg-primary-50/70'}`}>
                  <span className={`relative flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${alert.is_read ? 'bg-slate-100 text-slate-500' : 'bg-primary-600 text-white'}`}><Bell className="h-4 w-4" />{!alert.is_read ? <span className="absolute -right-1 -top-1 h-2.5 w-2.5 rounded-full border-2 border-white bg-amber-400" /> : null}</span>
                  <div className="min-w-0 flex-1"><div className="flex items-start justify-between gap-3"><h2 className="text-xs font-bold text-slate-900 sm:text-sm">{alert.title}</h2>{alert.link_url ? <ChevronRight className="h-4 w-4 shrink-0 text-slate-300 transition group-hover:translate-x-0.5 group-hover:text-primary-500" /> : null}</div><p className="mt-1 text-[10px] leading-4 text-slate-600 sm:text-xs sm:leading-5">{alert.body}</p><p className="mt-2 flex items-center gap-1 text-[9px] text-slate-400"><Clock3 className="h-3 w-3" /> {new Date(alert.created_at).toLocaleString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' })}</p></div>
                </article>
              );
              return alert.link_url ? <Link key={alert.id} href={alert.link_url} className="block">{content}</Link> : <div key={alert.id}>{content}</div>;
            })}
          </div>
        </section>
      )}
    </div>
  );
}
