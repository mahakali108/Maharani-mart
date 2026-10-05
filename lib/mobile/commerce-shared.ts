export interface CartIntentLine {
  packId: string;
  quantity: number;
}

/** Stable piece-cart keyset used to compare the review with the persisted cart. */
export function canonicalCartIntent(lines: CartIntentLine[]): CartIntentLine[] {
  return lines
    .map((line) => ({ packId: line.packId.trim().toLowerCase(), quantity: line.quantity }))
    .sort((left, right) => left.packId.localeCompare(right.packId));
}

/** Compare ids AND quantities; totals and prices are deliberately not accepted. */
export function sameCartIntent(left: CartIntentLine[], right: CartIntentLine[]): boolean {
  const a = canonicalCartIntent(left);
  const b = canonicalCartIntent(right);
  return a.length === b.length && a.every((line, index) =>
    line.packId === b[index]?.packId && line.quantity === b[index]?.quantity
  );
}

/** One saved cart line, reduced to the only fact the counts need. */
export interface CartCountableLine {
  quantity: number;
}

/**
 * The two counter facts the web shell's badge shows, defined ONCE for every
 * client: `lineCount` is the number of saved cart rows (what the web badge
 * displays) and `itemCount` is the total piece quantity. Computed on the
 * server from the same rows the cart response returns, so a native badge can
 * never disagree with the cart screen about how full the cart is.
 */
export function cartCounts(lines: readonly CartCountableLine[]): {
  lineCount: number;
  itemCount: number;
} {
  return {
    lineCount: lines.length,
    itemCount: lines.reduce((total, line) => {
      const quantity = Number.isFinite(line.quantity) ? Math.trunc(line.quantity) : 0;
      return total + Math.max(0, quantity);
    }, 0),
  };
}
