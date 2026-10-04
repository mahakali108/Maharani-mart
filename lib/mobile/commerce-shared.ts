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
