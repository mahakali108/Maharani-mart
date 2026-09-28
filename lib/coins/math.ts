/**
 * 🪙 COINS — the customer balance.
 *
 * Maharani Traders has NO retailer credit. What a shopkeeper sees is a COIN
 * balance (1 coin = ₹1), funded by the distributor and spent on orders. The
 * existing wallet ledger is the storage layer (it is already atomic,
 * idempotent and audited); this module is the *business meaning* on top of it,
 * and it is the only place the coin arithmetic is written down.
 *
 *   coins balance  = funded limit − spent (outstanding), in paise
 *   order payment  = min(balance, order total)   — never more, never negative
 *   remaining      = order total − coins used (payable on delivery)
 *
 * PURE — no Supabase, no `next/*`, no env. Imported by both the server
 * (authoritative order placement) and the client (display), so what the
 * checkout shows and what the server charges come from ONE implementation.
 */

/** Coins are rupees: 1 coin = ₹1. Amounts are integer paise internally. */
export const COINS_PER_RUPEE = 1;
export const COIN_LABEL = 'Coins';
export const COIN_SYMBOL = '🪙';

/** Coins balance in paise, from the wallet position. Never negative. */
export function coinBalancePaise(limitPaise: number, outstandingPaise: number): number {
  const balance = Math.round(limitPaise) - Math.round(outstandingPaise);
  return balance > 0 ? balance : 0;
}

export interface CoinPayment {
  /** Coins available before this order (clamped at 0). */
  balancePaise: number;
  /** Order total in paise (clamped at 0). */
  orderTotalPaise: number;
  /** Coins actually deducted: min(balance, total). */
  usedPaise: number;
  /** Amount still payable after coins (never negative). */
  remainingPaise: number;
  /** Balance after the deduction (never negative). */
  balanceAfterPaise: number;
  /** True when the shop had fewer coins than the order total. */
  partial: boolean;
}

/**
 * THE coin payment rule, used by the checkout preview AND by the server when it
 * debits the ledger. The browser can never widen it: the server recomputes from
 * the authoritative balance immediately before writing.
 */
export function computeCoinPayment({
  orderTotalPaise,
  balancePaise,
}: {
  orderTotalPaise: number;
  balancePaise: number;
}): CoinPayment {
  const total = Math.max(0, Math.round(orderTotalPaise));
  const balance = Math.max(0, Math.round(balancePaise));
  const used = Math.min(balance, total);
  return {
    balancePaise: balance,
    orderTotalPaise: total,
    usedPaise: used,
    remainingPaise: total - used,
    balanceAfterPaise: balance - used,
    partial: used < total,
  };
}

/**
 * Idempotency key for the coin deduction of one order. Deterministic: a
 * retried/duplicated checkout maps to the SAME key, and the ledger's unique
 * `idempotency_key` constraint then makes a second deduction impossible.
 */
export function coinDebitKey(orderId: string): string {
  return `order:${orderId}`;
}

/**
 * Reversals (refunds) use `reversalIdempotencyKey` from lib/retailer/wallet-math
 * — one deterministic key per reversed ledger row, so a retried refund cannot
 * credit the same coins twice. The debit side uses `coinDebitKey` above.
 */

/** Coin transactions a retailer sees as "coins in / coins spent". */
export function coinDirectionLabel(direction: 'debit' | 'credit'): string {
  return direction === 'credit' ? 'Coins added' : 'Coins spent';
}
