import { describe, expect, it } from 'vitest';
import {
  COIN_LABEL,
  COIN_SYMBOL,
  coinBalancePaise,
  coinDebitKey,
  coinDirectionLabel,
  computeCoinPayment,
} from '@/lib/coins/math';
import { reversalIdempotencyKey } from '@/lib/retailer/wallet-math';

/**
 * 🪙 COINS — the money rules.
 *
 * The customer balance is coins, the server decides the deduction, and the
 * arithmetic must never produce a negative balance, over-spend, or a second
 * deduction for the same order.
 */

describe('coin balance', () => {
  it('is funded limit minus spent, in paise', () => {
    expect(coinBalancePaise(100_000, 35_000)).toBe(65_000);
  });

  it('never goes negative — a legacy over-limit account simply has no coins', () => {
    expect(coinBalancePaise(10_000, 25_000)).toBe(0);
    expect(coinBalancePaise(0, 0)).toBe(0);
  });

  it('works when coins are funded by top-ups instead of a limit', () => {
    // limit 0, ledger credit 500 → outstanding -500 → 500 coins available.
    expect(coinBalancePaise(0, -50_000)).toBe(50_000);
  });
});

describe('coin payment', () => {
  it('spends the whole total when the balance covers it', () => {
    const payment = computeCoinPayment({ orderTotalPaise: 50_000, balancePaise: 80_000 });
    expect(payment).toMatchObject({
      usedPaise: 50_000,
      remainingPaise: 0,
      balanceAfterPaise: 30_000,
      partial: false,
    });
  });

  it('spends partially when the balance is smaller, leaving the rest payable', () => {
    const payment = computeCoinPayment({ orderTotalPaise: 50_000, balancePaise: 12_345 });
    expect(payment).toMatchObject({
      usedPaise: 12_345,
      remainingPaise: 37_655,
      balanceAfterPaise: 0,
      partial: true,
    });
  });

  it('never spends more than the order total and never overdraws', () => {
    for (const [total, balance] of [
      [1, 999_999],
      [999_999, 1],
      [0, 5_000],
      [5_000, 0],
    ] as const) {
      const payment = computeCoinPayment({ orderTotalPaise: total, balancePaise: balance });
      expect(payment.usedPaise).toBeLessThanOrEqual(payment.orderTotalPaise);
      expect(payment.usedPaise).toBeLessThanOrEqual(payment.balancePaise);
      expect(payment.remainingPaise).toBeGreaterThanOrEqual(0);
      expect(payment.balanceAfterPaise).toBeGreaterThanOrEqual(0);
      expect(payment.usedPaise + payment.remainingPaise).toBe(payment.orderTotalPaise);
    }
  });

  it('treats a negative (legacy overdrawn) balance as zero coins, not as a charge', () => {
    const payment = computeCoinPayment({ orderTotalPaise: 10_000, balancePaise: -250 });
    expect(payment.usedPaise).toBe(0);
    expect(payment.remainingPaise).toBe(10_000);
    expect(payment.balanceAfterPaise).toBe(0);
  });

  it('a fully covered order leaves nothing payable and a partially covered one always sums exactly', () => {
    const full = computeCoinPayment({ orderTotalPaise: 100, balancePaise: 100 });
    expect(full.remainingPaise).toBe(0);
    const partial = computeCoinPayment({ orderTotalPaise: 101, balancePaise: 100 });
    expect(partial.remainingPaise).toBe(1);
    expect(partial.partial).toBe(true);
  });
});

describe('idempotency keys', () => {
  it('derives one deterministic debit key per order (a retry cannot spend twice)', () => {
    expect(coinDebitKey('order-1')).toBe('order:order-1');
    expect(coinDebitKey('order-1')).toBe(coinDebitKey('order-1'));
    expect(coinDebitKey('order-1')).not.toBe(coinDebitKey('order-2'));
  });

  it('derives one deterministic refund key per reversed ledger row', () => {
    expect(reversalIdempotencyKey('ledger-9')).toBe('reversal:ledger-9');
    expect(reversalIdempotencyKey('ledger-9')).toBe(reversalIdempotencyKey('ledger-9'));
  });

  it('uses different namespaces for spending and refunding', () => {
    expect(coinDebitKey('x')).not.toBe(reversalIdempotencyKey('x'));
  });
});

describe('labels', () => {
  it('names the balance coins, with a coin symbol', () => {
    expect(COIN_LABEL).toBe('Coins');
    expect(COIN_SYMBOL).toBe('🪙');
    expect(coinDirectionLabel('credit')).toBe('Coins added');
    expect(coinDirectionLabel('debit')).toBe('Coins spent');
  });
});
