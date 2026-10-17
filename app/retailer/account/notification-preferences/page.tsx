import Link from 'next/link';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { createClient } from '@/lib/supabase/server';
import { requireUser } from '@/lib/auth/session';
import { NotificationPrefsForm, type NotificationPrefsValues } from '@/components/retailer/notification-prefs-form';
import { currentOfferRollout, displayOfferPreference } from '@/lib/notifications/offer-eligibility';

interface PrefsRow {
  order_updates: boolean;
  payment_updates: boolean;
  wallet_updates: boolean;
  offer_updates: boolean;
  offer_preference_recorded_at: string | null;
}

export const metadata = { title: 'Notification settings — Maharani Traders' };

export default async function NotificationPreferencesPage() {
  const user = await requireUser();
  const supabase = createClient();

  const { data: row } = await supabase
    .from('retailer_notification_prefs')
    .select('order_updates, payment_updates, wallet_updates, offer_updates, offer_preference_recorded_at')
    .eq('retailer_id', user.id)
    .maybeSingle<PrefsRow | never>();

  // Keep transactional defaults, but a legacy true without a post-0059
  // explicit preference marker is NOT an affirmative choice for offers.
  const rollout = currentOfferRollout();
  const offersEnabled = rollout.approved && Number.isFinite(Date.parse(rollout.noticePublishedAt ?? ''));
  const initial: NotificationPrefsValues = {
    orderUpdates: row?.order_updates ?? true,
    paymentUpdates: row?.payment_updates ?? true,
    walletUpdates: row?.wallet_updates ?? true,
    offerUpdates: displayOfferPreference(row, rollout),
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

      <div className="shop-intro">
          <p className="shop-eyebrow">Notifications</p>
        <h1 className="shop-heading mt-1 font-semibold tracking-tight text-slate-950">Notification settings</h1>
        <p className="mt-1 text-xs text-slate-500">Choose update categories. {offersEnabled
          ? 'Optional offers require a new choice after the published notice; check your channel permissions.'
          : 'Optional offers are paused until the notice and channel permissions are approved.'}</p>
      </div>

      <NotificationPrefsForm initial={initial} />
    </div>
  );
}
