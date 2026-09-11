import 'server-only';

/**
 * Availability display mapping for the sanctioned
 * `get_retailer_product_availability` RPC. Kept out of page files so the
 * availability vocabulary lives in exactly one place (and so the product
 * page's "no invented availability numbers" guard keeps holding).
 */
export type AvailabilityState = 'in_stock' | 'low_stock' | 'out_of_stock' | 'unknown';

export function normalizeAvailabilityState(raw: string | null | undefined): AvailabilityState {
  if (raw === 'in_stock' || raw === 'low_stock' || raw === 'out_of_stock') return raw;
  return 'unknown';
}

export function availabilityBadge(state: AvailabilityState): { label: string; className: string } | null {
  switch (state) {
    case 'out_of_stock':
      return { label: 'Unavailable right now', className: 'bg-rose-50 px-3 py-1.5 text-[11px] font-bold text-rose-700 rounded-full' };
    case 'low_stock':
      return { label: 'Running low', className: 'bg-amber-50 px-3 py-1.5 text-[11px] font-bold text-amber-700 rounded-full' };
    case 'in_stock':
      return { label: 'Available now', className: 'bg-emerald-50 px-3 py-1.5 text-[11px] font-bold text-emerald-700 rounded-full' };
    default:
      return null;
  }
}

export function isOutOfStock(state: AvailabilityState): boolean {
  return state === 'out_of_stock';
}
