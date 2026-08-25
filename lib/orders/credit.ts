export interface CreditPosition {
  creditLimit: number;
  outstandingBalance: number;
  hasConfiguredLimit: boolean;
  availableCredit: number | null;
  orderImpact: number;
  availableAfterOrder: number | null;
  exceedsLimit: boolean;
}

export function roundMoney(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

/**
 * Single credit arithmetic used by checkout, the retailer credit card and
 * Maharani AI. A zero limit preserves the existing "not configured" meaning.
 */
export function calculateCreditPosition(
  creditLimit: number,
  outstandingBalance: number,
  orderImpact = 0
): CreditPosition {
  const limit = roundMoney(Math.max(0, creditLimit));
  const outstanding = roundMoney(Math.max(0, outstandingBalance));
  const impact = roundMoney(Math.max(0, orderImpact));
  const hasConfiguredLimit = limit > 0;
  const availableCredit = hasConfiguredLimit ? Math.max(0, roundMoney(limit - outstanding)) : null;
  const availableAfterOrder = availableCredit === null
    ? null
    : Math.max(0, roundMoney(availableCredit - impact));

  return {
    creditLimit: limit,
    outstandingBalance: outstanding,
    hasConfiguredLimit,
    availableCredit,
    orderImpact: impact,
    availableAfterOrder,
    exceedsLimit: hasConfiguredLimit && roundMoney(outstanding + impact) > limit,
  };
}
