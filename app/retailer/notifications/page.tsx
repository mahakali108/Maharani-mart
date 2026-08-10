import Link from 'next/link';
import { Bell } from 'lucide-react';
import { createClient } from '@/lib/supabase/server';
import { requireUser } from '@/lib/auth/session';
import { Card } from '@/components/ui/card';
import { AdminEmptyState } from '@/components/admin/empty-state';

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

  // notifications_owner RLS (0001_init.sql) already restricts this to
  // recipient_id = auth.uid() — the .eq() below is for query clarity,
  // not the security boundary itself.
  const { data } = await supabase
    .from('notifications')
    .select('id, title, body, link_url, is_read, created_at')
    .eq('recipient_id', user.id)
    .order('created_at', { ascending: false })
    .returns<NotificationRow[]>();

  const alerts = data ?? [];

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-semibold text-ink-950">Alerts</h1>
        <p className="mt-1 text-sm text-ink-500">Updates on your orders and account.</p>
      </div>

      {alerts.length === 0 ? (
        <AdminEmptyState
          icon={Bell}
          title="No alerts yet"
          body="Order updates and other account alerts will show up here."
        />
      ) : (
        <div className="space-y-2">
          {alerts.map((alert) => {
            const content = (
              <Card
                className={`space-y-1 ${alert.is_read ? '' : 'border-primary-200 bg-primary-50/40'}`}
              >
                <div className="flex items-start justify-between gap-2">
                  <p className="text-sm font-medium text-ink-900">{alert.title}</p>
                  {!alert.is_read ? <span className="mt-1 h-2 w-2 shrink-0 rounded-full bg-primary-600" /> : null}
                </div>
                <p className="text-sm text-ink-600">{alert.body}</p>
                <p className="text-xs text-ink-400">{new Date(alert.created_at).toLocaleString('en-IN')}</p>
              </Card>
            );

            return alert.link_url ? (
              <Link key={alert.id} href={alert.link_url} className="block">
                {content}
              </Link>
            ) : (
              <div key={alert.id}>{content}</div>
            );
          })}
        </div>
      )}
    </div>
  );
}
