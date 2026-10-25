import Link from 'next/link';
import { Bell, BellRing, ChevronRight } from 'lucide-react';
import { createClient } from '@/lib/supabase/server';
import { requireUser } from '@/lib/auth/session';
import { NotificationList, type NotificationItem } from '@/components/retailer/notification-list';
import {
  applyCursor,
  applyKeysetOrder,
  keysetCursorFor,
  readCursor,
  toListBatch,
  type KeysetColumn,
} from '@/lib/infinite-scroll/keyset';
import type { ListCursor } from '@/lib/infinite-scroll/cursor';

interface NotificationRow {
  id: string;
  title: string;
  body: string;
  link_url: string | null;
  is_read: boolean;
  created_at: string;
}

/** Rows per batch. */
const BATCH_SIZE = 20;

/**
 * Newest first. `created_at` is NOT NULL (0001_init.sql) and `id` is the
 * primary key, so a keyset cursor on the pair can never skip or repeat a row.
 */
const ORDER: KeysetColumn[] = [
  { column: 'created_at', ascending: false },
  { column: 'id', ascending: false },
];

type SupabaseClient = ReturnType<typeof createClient>;

/**
 * One batch of the retailer's own notifications.
 *
 * The recipient is re-derived from the session inside the Server Action, never
 * taken from the cursor, and `notifications` is RLS-scoped to the signed-in
 * user — so a cursor can only ever walk that user's own feed.
 */
async function loadNotificationBatch(
  supabase: SupabaseClient,
  recipientId: string,
  cursor: ListCursor | null
): Promise<{ items: NotificationItem[]; nextCursor: string | null }> {
  const query = supabase
    .from('notifications')
    .select('id, title, body, link_url, is_read, created_at')
    .eq('recipient_id', recipientId);

  const { data } = await applyCursor(applyKeysetOrder(query, ORDER), cursor, ORDER, BATCH_SIZE);
  const rows = (data ?? []) as unknown as NotificationRow[];
  const batch = toListBatch(rows, BATCH_SIZE, (row) => keysetCursorFor(row, ORDER));

  return {
    items: batch.items.map((row) => ({
      id: row.id,
      title: row.title,
      body: row.body,
      link_url: row.link_url,
      is_read: row.is_read,
      created_at: row.created_at,
    })),
    nextCursor: batch.nextCursor,
  };
}

export default async function RetailerAlertsPage() {
  const user = await requireUser();
  const supabase = createClient();

  const [firstBatch, { count: unreadCount }] = await Promise.all([
    loadNotificationBatch(supabase, user.id, null),
    supabase
      .from('notifications')
      .select('id', { count: 'exact', head: true })
      .eq('recipient_id', user.id)
      .eq('is_read', false),
  ]);
  const alerts = firstBatch.items;
  const unread = unreadCount ?? alerts.filter((alert) => !alert.is_read).length;

  /** Server Action for the batches after the first; the recipient is re-derived. */
  async function loadMoreNotifications(
    cursor: string | null
  ): Promise<{ items: NotificationItem[]; nextCursor: string | null }> {
    'use server';
    const caller = await requireUser();
    const batch = await loadNotificationBatch(createClient(), caller.id, readCursor(cursor));
    return { items: batch.items, nextCursor: batch.nextCursor };
  }

  return (
    <div className="space-y-5 sm:space-y-6">
      <div className="flex items-center gap-1.5 text-[10px] font-semibold text-slate-500 sm:text-xs">
        <Link href="/retailer/home" className="hover:text-primary-600">
          Home
        </Link>
        <ChevronRight className="h-3 w-3" />
        <span className="text-slate-800">Updates</span>
      </div>

      <section className="relative overflow-hidden rounded-2xl border border-slate-200 bg-lavender-50 p-5 shadow-[0_1px_2px_rgba(15,23,42,0.04)] sm:p-7">
        <div className="flex items-start gap-4">
          <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-primary-600 text-white shadow-sm">
            <BellRing className="h-5 w-5" aria-hidden="true" />
          </span>
          <div className="shop-intro">
          <p className="shop-eyebrow">Stay informed</p>
            <h1 className="shop-heading mt-1 font-semibold tracking-tight text-slate-950">Updates &amp; alerts</h1>
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
            Order updates, scheme alerts and coin messages will appear here.
          </p>
        </section>
      ) : (
        <NotificationList
          alerts={alerts}
          loader={loadMoreNotifications}
          initialCursor={firstBatch.nextCursor}
          initialHasMore={Boolean(firstBatch.nextCursor)}
        />
      )}
    </div>
  );
}
