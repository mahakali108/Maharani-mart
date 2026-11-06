import 'server-only';

import type { createClient } from '@/lib/supabase/server';

type SupabaseClient = Awaited<ReturnType<typeof createClient>>;

export interface DeliveryDestination {
  district?: string | null;
  state?: string | null;
  pincode?: string | null;
}

export type DeliveryTerms =
  | { ok: true; areaId: string; minimumOrderPaise: number; deliveryFeePaise: number }
  | { ok: false; code: 'address_required' | 'unavailable' | 'database_unavailable'; message: string };

/** Only an active, explicitly configured district/state/PIN is serviceable.
 * Called with the retailer's OWN authenticated client; the DB RPC hides the
 * admin directory and fails closed on error. This is a preview / server-side
 * validation; the order INSERT trigger rechecks it under a row lock at commit.
 */
export async function checkDeliveryTerms(
  supabase: SupabaseClient,
  address: DeliveryDestination | null | undefined
): Promise<DeliveryTerms> {
  const district = address?.district?.trim();
  const state = address?.state?.trim();
  const pincode = address?.pincode?.trim();
  if (!district || !state || !pincode || !/^[0-9]{6}$/.test(pincode)) {
    return { ok: false, code: 'address_required', message: 'Select a saved delivery address with district, state and a 6-digit PIN.' };
  }
  const { data, error } = await supabase.rpc('check_delivery_serviceability' as never, {
    p_district: district,
    p_state: state,
    p_pincode: pincode,
  } as never);
  if (error || !Array.isArray(data)) {
    return { ok: false, code: 'database_unavailable', message: 'Delivery coverage could not be confirmed. Please try again.' };
  }
  const row = data[0] as { area_id?: unknown; minimum_order_paise?: unknown; delivery_fee_paise?: unknown } | undefined;
  if (!row) {
    return { ok: false, code: 'unavailable', message: 'Delivery is not confirmed for this district, state and PIN. Choose another saved address or contact the team.' };
  }
  const minimumOrderPaise = Number(row.minimum_order_paise);
  const deliveryFeePaise = Number(row.delivery_fee_paise);
  if (typeof row.area_id !== 'string' || !Number.isSafeInteger(minimumOrderPaise) || minimumOrderPaise < 0
      || !Number.isSafeInteger(deliveryFeePaise) || deliveryFeePaise < 0) {
    return { ok: false, code: 'database_unavailable', message: 'Delivery coverage could not be confirmed. Please try again.' };
  }
  return { ok: true, areaId: row.area_id, minimumOrderPaise, deliveryFeePaise };
}

/** Fees cannot be silently omitted: the existing atomic multi-seller RPCs do
 * not allocate a delivery charge, so an area configured with one is offline. */
export function deliveryOrderBlocker(terms: DeliveryTerms, grandTotalPaise: number): string | null {
  if (!terms.ok) return terms.message;
  if (terms.deliveryFeePaise > 0) {
    return 'Online ordering is not available for this PIN while its delivery fee is being configured. Contact the team.';
  }
  if (grandTotalPaise < terms.minimumOrderPaise) {
    return `This delivery PIN requires a minimum order of ₹${(terms.minimumOrderPaise / 100).toLocaleString('en-IN', { minimumFractionDigits: 2 })}.`;
  }
  return null;
}
