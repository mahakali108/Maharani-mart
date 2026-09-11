import Link from 'next/link';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { createClient } from '@/lib/supabase/server';
import { requireUser } from '@/lib/auth/session';
import { NotificationPrefsForm, type NotificationPrefsValues } from '@/components/retailer/notification-prefs-form';

interface PrefsRow {
  order_updates: boolean;
  payment_updates: boolean;
  wallet_updates: boolean;
  offer_updates: boolean;
}

export const metadata = { title: 'Notification settings — Maharani Traders' };

export default async function NotificationPreferencesPage() {
  const user = await requireUser();
  const supabase = createClient();

  const { data: row } = await supabase
    .from('retailer_notification_prefs')
    .select('order_updates, payment_updates, wallet_updates, offer_updates')
    .eq('retailer_id', user.id)
    .maybeSingle<PrefsRow | never>();

  // Absent row = everything on (the documented default).
  const initial: NotificationPrefsValues = {
    orderUpdates: row?.order_updates ?? true,
    paymentUpdates: row?.payment_updates ?? true,
    walletUpdates: row?.wallet_updates ?? true,
    offerUpdates: row?.offer_updates ?? true,
  };

  return (
    <div className="mx-auto w-full max-w-2xl space-y-5">
      <nav aria-label="Breadcrumb" className="flex items-center gap-1 text-[10px] font-semibold text-slate-500 sm:text-xs">
        <Link href="/retailer/account" className="flex items-center gap-1 rounded px-1 py-0.5 hover:text-primary-600">
          <ChevronLeft className="h-3.5 w-3.5" /> Account
        </Link>
        <ChevronRight className="h-3 w-3" />
        <span className="truncate text-slate-800">Notification settings</span>
      </nav>

      <div>
        <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-primary-600">Notifications</p>
        <h1 className="mt-1 text-xl font-bold tracking-tight text-slate-950 sm:text-2xl">Notification settings</h1>
        <p className="mt-1 text-xs text-slate-500">Choose which in-app updates you want to hear about.</p>
      </div>

      <NotificationPrefsForm initial={initial} />
    </div>
  );
}
