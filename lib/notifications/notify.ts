import 'server-only';
import { createClient } from '@/lib/supabase/server';
import type { Database } from '@/types/database.types';
import { currentOfferRollout, isOfferEligible } from '@/lib/notifications/offer-eligibility';

export type NotificationChannel = 'whatsapp' | 'sms' | 'push' | 'in_app';

/**
 * Classified retailer notifications respect the same preference before both
 * in-app inserts and outbound queue inserts. Missing rows allow transactional
 * notices only. Critical/account and legacy unclassified notices are not
 * filtered; callers must never label a marketing message as transactional.
 */
export type NotificationCategory = 'transactional' | 'account' | 'order' | 'payment' | 'wallet' | 'promotional';

export interface NotifyInput {
  recipientId: string;
  title: string;
  body: string;
  /**
   * Text persisted in the outbound channel queue (`notification_logs`)
   * instead of `body`. REQUIRED whenever `body` contains a secret (e.g. a
   * delivery OTP): the queue is an operational log, so secrets must never be
   * written there. The in-app notification (recipient-only RLS) keeps `body`.
   */
  channelBody?: string;
  linkUrl?: string;
  category?: NotificationCategory;
}

type NotificationInsert = Database['public']['Tables']['notifications']['Insert'];
type NotificationLogInsert = Database['public']['Tables']['notification_logs']['Insert'];
type PreferenceColumn = 'order_updates' | 'payment_updates' | 'wallet_updates' | 'offer_updates';
const PREFERENCE_COLUMNS: Partial<Record<NotificationCategory, PreferenceColumn>> = {
  order: 'order_updates',
  payment: 'payment_updates',
  wallet: 'wallet_updates',
  promotional: 'offer_updates',
};

/**
 * Notification architecture (Phase 1 scaffolding — real DB writes,
 * no external provider calls yet):
 *
 * 1. `createInAppNotification` writes to `notifications`, which the
 *    recipient sees immediately via Supabase Realtime (Notification
 *    Center — Phase 2 UI).
 * 2. `queueChannelNotification` writes a `notification_logs` row with
 *    status 'queued'. Phase 2+ wires this to a Supabase Edge Function
 *    that actually calls the WhatsApp Cloud API / SMS gateway and
 *    updates the row to 'sent' | 'delivered' | 'failed' with the
 *    provider's message id.
 *
 * Deliberately no demo sends, no fake provider responses — this is
 * the pipeline, not a simulation of it.
 *
 * Both inserts below are explicitly typed against the real Insert
 * shape, then passed through an `unknown` cast at the call site only
 * — the same targeted workaround used in lib/auth/actions.ts for the
 * `.insert()` overload quirk that can resolve to `never[]`.
 */

type PrefsRow = {
  order_updates: boolean;
  payment_updates: boolean;
  wallet_updates: boolean;
  offer_updates: boolean;
  offer_preference_recorded_at: string | null;
};

async function mayDeliver(supabase: ReturnType<typeof createClient>, input: NotifyInput): Promise<boolean> {
  const preferenceColumn = input.category ? PREFERENCE_COLUMNS[input.category] : undefined;
  if (!preferenceColumn) return true; // essential account / unclassified operational notices

  // Do not send offers on a legacy true preference, or without an owner-approved
  // privacy/marketing rollout. The switch is server-only and OFF when unset.
  if (input.category === 'promotional' && !currentOfferRollout().approved) return false;

  try {
    const { data: prefs, error } = await supabase
      .from('retailer_notification_prefs')
      .select('order_updates, payment_updates, wallet_updates, offer_updates, offer_preference_recorded_at')
      .eq('retailer_id', input.recipientId)
      .maybeSingle<PrefsRow>();
    if (error) return false; // read failure must not override a possible opt-out
    if (input.category === 'promotional') {
      return isOfferEligible(prefs, currentOfferRollout());
    }
    // An absent row continues to allow order/payment/wallet updates.
    return prefs?.[preferenceColumn] !== false;
  } catch {
    return false;
  }
}

export async function createInAppNotification(input: NotifyInput): Promise<boolean> {
  const supabase = createClient();
  if (!(await mayDeliver(supabase, input))) return false;

  const payload: NotificationInsert = {
    recipient_id: input.recipientId,
    title: input.title,
    body: input.body,
    link_url: input.linkUrl ?? null,
  };
  const { error } = await supabase.from('notifications').insert(payload as unknown as never);
  if (error) throw new Error(`Failed to create notification: ${error.message}`);
  return true;
}

export async function queueChannelNotification(
  channel: Exclude<NotificationChannel, 'in_app'>,
  input: NotifyInput
) {
  const supabase = createClient();
  if (!(await mayDeliver(supabase, input))) return;
  const payload: NotificationLogInsert = {
    recipient_id: input.recipientId,
    channel,
    status: 'queued',
    payload: { title: input.title, body: input.channelBody ?? input.body, link_url: input.linkUrl ?? null },
  };
  const { error } = await supabase.from('notification_logs').insert(payload as unknown as never);
  if (error) throw new Error(`Failed to queue ${channel} notification: ${error.message}`);

  // Phase 2+: trigger the delivery Edge Function here, e.g.
  //   await fetch(`${process.env.SUPABASE_FUNCTIONS_URL}/send-${channel}`, { method: 'POST', ... })
}

/**
 * Convenience wrapper: raises an in-app notification and queues the
 * same message on WhatsApp, mirroring how order-status updates should
 * reach a retailer in Phase 2.
 */
export async function notifyOrderEvent(input: NotifyInput) {
  // Order-event callers that omit a category must not bypass an order opt-out.
  // Essential delivery-OTP callers explicitly use 'account' instead.
  const classified = { ...input, category: input.category ?? 'order' };
  await createInAppNotification(classified);
  await queueChannelNotification('whatsapp', classified);
}
