import { z } from 'zod';
import {
  enforceRateLimit,
  jsonError,
  jsonOk,
  logServerError,
  newRequestId,
  parseJsonBody,
} from '@/lib/mobile';
import { requireRetailerCommerceSession } from '@/lib/mobile/commerce-route';

export const dynamic = 'force-dynamic';

const preferencesSchema = z.object({
  orderUpdates: z.boolean(),
  paymentUpdates: z.boolean(),
  walletUpdates: z.boolean(),
  offerUpdates: z.boolean(),
}).strict();

type PreferencesRow = {
  order_updates: boolean;
  payment_updates: boolean;
  wallet_updates: boolean;
  offer_updates: boolean;
};

/**
 * GET/PATCH /api/mobile/v1/notifications/preferences
 *
 * Defaults match the PWA: an absent row means all categories are enabled.
 * The retailer id is always taken from the verified bearer session.
 */
export async function GET(request: Request): Promise<Response> {
  const requestId = newRequestId();
  const auth = await requireRetailerCommerceSession(request, requestId, 'orders.create');
  if ('response' in auth) return auth.response;
  const limited = enforceRateLimit('read.orders', request, { requestId, keySuffix: auth.session.userId });
  if (limited) return limited;

  try {
    const { data, error } = await auth.session.supabase.from('retailer_notification_prefs')
      .select('order_updates, payment_updates, wallet_updates, offer_updates')
      .eq('retailer_id', auth.session.userId)
      .maybeSingle<PreferencesRow>();
    if (error) throw error;
    return jsonOk({
      orderUpdates: data?.order_updates ?? true,
      paymentUpdates: data?.payment_updates ?? true,
      walletUpdates: data?.wallet_updates ?? true,
      offerUpdates: data?.offer_updates ?? true,
    }, { requestId });
  } catch (cause) {
    logServerError('notification-preferences.read', requestId, cause);
    return jsonError('database_unavailable', 'Notification settings could not be loaded. Please try again.', {
      status: 503,
      requestId,
    });
  }
}

export async function PATCH(request: Request): Promise<Response> {
  const requestId = newRequestId();
  const auth = await requireRetailerCommerceSession(request, requestId, 'orders.create');
  if ('response' in auth) return auth.response;
  const limited = enforceRateLimit('write.orders', request, { requestId, keySuffix: auth.session.userId });
  if (limited) return limited;

  const body = await parseJsonBody(request, preferencesSchema, requestId);
  if (!body.ok) return body.response;

  try {
    const { error } = await auth.session.supabase.from('retailer_notification_prefs').upsert({
      retailer_id: auth.session.userId,
      order_updates: body.data.orderUpdates,
      payment_updates: body.data.paymentUpdates,
      wallet_updates: body.data.walletUpdates,
      offer_updates: body.data.offerUpdates,
      updated_at: new Date().toISOString(),
    } as unknown as never, { onConflict: 'retailer_id' });
    if (error) throw error;
    return jsonOk({ ok: true }, { requestId });
  } catch (cause) {
    logServerError('notification-preferences.update', requestId, cause);
    return jsonError('database_unavailable', 'Notification settings could not be saved. Please try again.', {
      status: 503,
      requestId,
    });
  }
}
