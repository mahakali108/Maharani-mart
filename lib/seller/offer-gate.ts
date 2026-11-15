import 'server-only';
import type { createClient } from '@/lib/supabase/server';
import { legalDocumentByKey } from '@/lib/legal/documents';

type SupabaseClient = Awaited<ReturnType<typeof createClient>>;

export const SELLER_AGREEMENT_KEY = 'seller-agreement';

export const MARKETPLACE_NOT_OPEN_MESSAGE =
  'Third-party seller offers are not open yet. They stay disabled until the owner and the Chartered Accountant have approved the marketplace launch requirements.';
export const SELLER_AGREEMENT_REQUIRED_MESSAGE =
  'Accept the current Seller Agreement (Seller portal → Profile) before an offer can be activated or published.';
export const SELLER_GATE_UNAVAILABLE_MESSAGE =
  'Seller offers cannot be activated or published right now: the Seller Agreement check is not available. Nothing was changed.';

export type SellerOfferGate = { open: true } | { open: false; reason: 'marketplace' | 'agreement' | 'unavailable'; error: string };

/**
 * Server-side half of the Seller Agreement / marketplace gate (the database
 * half is migration 0098, triggers on seller_offers and order_items).
 *
 * FAILS CLOSED. If the gate function is missing, errors, or reports a
 * different agreement version from the one this build publishes, offers stay
 * off. That is deliberate: third-party selling must not open by accident, and
 * no tax (TCS/TDS) position is assumed by the application.
 */
export async function checkSellerOfferGate(supabase: SupabaseClient, sellerId: string): Promise<SellerOfferGate> {
  const unavailable: SellerOfferGate = { open: false, reason: 'unavailable', error: SELLER_GATE_UNAVAILABLE_MESSAGE };
  const published = legalDocumentByKey(SELLER_AGREEMENT_KEY);
  if (!published) return unavailable;
  try {
    const { data, error } = await supabase.rpc('seller_offer_gate_status' as never, { p_seller_id: sellerId } as never);
    if (error || !data || typeof data !== 'object') return unavailable;
    const status = data as { marketplace_open?: unknown; agreement_current?: unknown; agreement_version?: unknown };
    if (status.marketplace_open !== true) {
      return { open: false, reason: 'marketplace', error: MARKETPLACE_NOT_OPEN_MESSAGE };
    }
    // The database and this build must agree on which version is current.
    if (status.agreement_version !== published.version) return unavailable;
    if (status.agreement_current !== true) {
      return { open: false, reason: 'agreement', error: SELLER_AGREEMENT_REQUIRED_MESSAGE };
    }
    return { open: true };
  } catch {
    return unavailable;
  }
}

/** Friendly text for the database-side refusals (0098). */
export function mapSellerGateError(message: string): string | null {
  if (message.includes('MARKETPLACE_NOT_OPEN')) return MARKETPLACE_NOT_OPEN_MESSAGE;
  if (message.includes('SELLER_AGREEMENT_REQUIRED')) return SELLER_AGREEMENT_REQUIRED_MESSAGE;
  return null;
}
