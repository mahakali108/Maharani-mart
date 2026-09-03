import { piecePriceFromCase } from '@/lib/retailer/case-pricing';

/** Display helpers only. Never used as a source of prices or tax. */

export function formatInr(value: number): string {
  return `₹${value.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export function calcDiscountPercent(mrp: number | null | undefined, price: number | null | undefined): number {
  if (mrp == null || price == null || mrp <= price) return 0;
  return Math.round(((mrp - price) / mrp) * 100);
}

export function calcSavings(mrp: number | null | undefined, price: number | null | undefined, quantity = 1): number {
  if (mrp == null || price == null || mrp <= price || quantity < 1) return 0;
  return (mrp - price) * quantity;
}

/**
 * Calculates retailer gross profit margin on MRP: ((MRP - Price) / MRP) * 100.
 * Returns null if MRP is unavailable or not greater than price.
 * Never invents a margin percentage when authoritative comparison data is missing.
 */
export function calcRetailerMargin(
  mrp: number | null | undefined,
  price: number | null | undefined
): number | null {
  if (mrp == null || price == null || mrp <= price) return null;
  const margin = ((mrp - price) / mrp) * 100;
  return Math.round(margin * 100) / 100;
}

export function formatMargin(margin: number | null | undefined): string | null {
  if (margin == null || margin <= 0) return null;
  return `${margin.toFixed(2)}%`;
}

/**
 * Resolves the reference per-piece price for a pack. Delegates to
 * `piecePriceFromCase` in the pricing engine — the single definition of that
 * derivation — so a card, a table and the cart can never show three slightly
 * different per-piece numbers. Note this is a REFERENCE rate for MRP
 * comparisons and best-value ranking: a real order is priced per case plus per
 * loose tier, never by multiplying this figure.
 */
export function resolveUnitPrice(effectivePrice: number, unitsPerCase: number): number {
  return piecePriceFromCase(effectivePrice, unitsPerCase);
}

/**
 * Identifies the best-value pack tier based on the lowest unit price.
 * Only identifies a best-value tier when there are at least two packs and
 * a strictly lower unit price exists compared to the reference (highest unit price) pack.
 */
export function determineBestValueTier<T extends { id: string; unitPrice: number; pack_name?: string }>(
  packs: T[]
): { bestPackId: string | null; savingsVsRef: number | null; refPackName: string | null } {
  if (!packs || packs.length <= 1) {
    return { bestPackId: null, savingsVsRef: null, refPackName: null };
  }

  let minPrice = Infinity;
  let maxPrice = -Infinity;
  let bestPack: T | null = null;
  let refPack: T | null = null;

  for (const pack of packs) {
    if (pack.unitPrice < minPrice) {
      minPrice = pack.unitPrice;
      bestPack = pack;
    }
    if (pack.unitPrice > maxPrice) {
      maxPrice = pack.unitPrice;
      refPack = pack;
    }
  }

  // Only declare a best-value tier if there is a real price advantage (at least 0.01/unit)
  if (bestPack && refPack && bestPack.id !== refPack.id && maxPrice - minPrice >= 0.005) {
    const savingsVsRef = Math.round((maxPrice - minPrice) * 100) / 100;
    return {
      bestPackId: bestPack.id,
      savingsVsRef,
      refPackName: refPack.pack_name ?? null,
    };
  }

  return { bestPackId: null, savingsVsRef: null, refPackName: null };
}

export function greetingForHour(hour: number): string {
  if (hour < 12) return 'Good morning';
  if (hour < 17) return 'Good afternoon';
  return 'Good evening';
}
