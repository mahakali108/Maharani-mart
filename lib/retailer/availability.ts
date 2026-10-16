/**
 * Pack-level availability display mapping for the sanctioned, status-only
 * RPC. The customer vocabulary intentionally has just In Stock, Out of Stock
 * and an internal unknown fallback; exact counts remain on Admin screens and
 * checkout only reveals an available count when rejecting an over-sized order.
 *
 * Pure display mapping — no Supabase, no env, no secrets — so client
 * components may import it; the RPC itself stays server-side where it is called.
 */
export type AvailabilityState = 'in_stock' | 'out_of_stock' | 'unknown';

export function normalizeAvailabilityState(raw: string | null | undefined): AvailabilityState {
  if (raw === 'in_stock' || raw === 'out_of_stock') return raw;
  return 'unknown';
}

export function availabilityBadge(state: AvailabilityState): { label: string; className: string } | null {
  switch (state) {
    case 'out_of_stock':
      return { label: 'Out of stock', className: 'bg-slate-100 px-3 py-1.5 text-[11px] font-bold text-slate-700 rounded-full' };
    case 'in_stock':
      return { label: 'In Stock', className: 'bg-mint-50 px-3 py-1.5 text-[11px] font-bold text-mint-700 rounded-full' };
    default:
      return null;
  }
}

export function isOutOfStock(state: AvailabilityState): boolean {
  return state === 'out_of_stock';
}
