/**
 * Pure wallet arithmetic — the single source of truth for how the B2B credit
 * position is derived from integer paise values.
 *
 * The authoritative calculation lives in the database
 * (`get_retailer_outstanding_paise`, migration 0031) and is:
 *
 *     outstanding = opening_outstanding_paise
 *                 + (valid ledger debits) - (valid ledger credits)
 *     available  = credit_limit_paise - outstanding
 *     overdue    = max(0, outstanding - credit_limit_paise)
 *
 * This module mirrors that formula in pure TypeScript so server pages and
 * tests share one implementation and can never drift from the SQL. It never
 * touches the network, never trusts a client-supplied balance, and always
 * works in integer paise.
 */

/** Outstanding = frozen opening baseline + debits - credits (integer paise). */
export function computeOutstandingPaise(
  openingPaise: number,
  debitsPaise: number,
  creditsPaise: number
): number {
  return Math.round(openingPaise) + Math.round(debitsPaise) - Math.round(creditsPaise);
}

/** Available credit = limit - outstanding (may be negative when overdue allowed). */
export function computeAvailablePaise(limitPaise: number, outstandingPaise: number): number {
  return Math.round(limitPaise) - Math.round(outstandingPaise);
}

/** Overdue amount = outstanding above the limit, else 0. */
export function computeOverduePaise(limitPaise: number, outstandingPaise: number): number {
  const outstanding = Math.round(outstandingPaise);
  const limit = Math.round(limitPaise);
  return outstanding > limit ? outstanding - limit : 0;
}

export interface WalletPositionPaise {
  creditLimitPaise: number;
  outstandingPaise: number;
  availablePaise: number;
  overduePaise: number;
  hasConfiguredLimit: boolean;
  isOverLimit: boolean;
}

/**
 * Full position from the three authoritative inputs. A zero limit preserves the
 * existing "no credit facility configured" meaning (hasConfiguredLimit=false).
 */
export function computeWalletPositionPaise(input: {
  creditLimitPaise: number;
  openingOutstandingPaise?: number;
  debitsPaise?: number;
  creditsPaise?: number;
}): WalletPositionPaise {
  const creditLimitPaise = Math.round(input.creditLimitPaise);
  const openingOutstandingPaise = Math.round(input.openingOutstandingPaise ?? 0);
  const debitsPaise = Math.round(input.debitsPaise ?? 0);
  const creditsPaise = Math.round(input.creditsPaise ?? 0);

  const outstandingPaise = computeOutstandingPaise(openingOutstandingPaise, debitsPaise, creditsPaise);
  const availablePaise = computeAvailablePaise(creditLimitPaise, outstandingPaise);
  const overduePaise = computeOverduePaise(creditLimitPaise, outstandingPaise);

  return {
    creditLimitPaise,
    outstandingPaise,
    availablePaise,
    overduePaise,
    hasConfiguredLimit: creditLimitPaise > 0,
    isOverLimit: creditLimitPaise > 0 && outstandingPaise > creditLimitPaise,
  };
}

/**
 * Deterministic idempotency key for a reversal of a specific source row.
 * Using the source id (not a timestamp/random) means a retried reversal maps to
 * the SAME key and the ledger's unique idempotency_key constraint blocks a
 * duplicate reversal entry.
 */
export function reversalIdempotencyKey(sourceId: string): string {
  return `reversal:${sourceId}`;
}
