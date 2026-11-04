import 'server-only';

import type { createClient } from '@/lib/supabase/server';
import { getRetailerWalletPosition, paiseToRupees, rupeesToPaise } from '@/lib/retailer/wallet';
import { computeCoinPayment, coinBalancePaise, coinDebitKey, type CoinPayment } from '@/lib/coins/math';

/**
 * 🪙 COINS — server-authoritative balance and spending.
 *
 * The browser NEVER decides a coin amount. Every function here re-reads the
 * authoritative wallet position from the database (integer paise) and computes
 * the deduction itself:
 *
 *   - `getRetailerCoinPosition`  → what the shop owns right now
 *   - `quoteCoinPayment`         → how many coins THIS order would use (preview)
 *   - `debitCoinsForOrder`       → the only path that spends coins, atomic and
 *                                  idempotent, clamped by the balance
 *   - `refundOrderCoins`         → the only path that gives them back, linked to
 *                                  the original ledger row
 *
 * Atomicity lives in the `check_and_debit_retailer_wallet` RPC (0030): it locks
 * the account row, re-reads the ledger, refuses to go over the balance, and is
 * idempotent on `p_idempotency_key`. Two concurrent checkouts therefore cannot
 * double-spend the same coins, and a retried checkout cannot spend twice.
 */

export type SupabaseClient = Awaited<ReturnType<typeof createClient>>;

/** Minimal shape of the RPC surface this module needs (avoids `any`). */
interface RpcCapable {
  rpc: (
    name: string,
    args: Record<string, unknown>
  ) => Promise<{ data: unknown; error: { message: string } | null }>;
}

export interface CoinPosition {
  /** Coins available to spend, in integer paise. Never negative. */
  balancePaise: number;
  balanceRupees: number;
  limitPaise: number;
  outstandingPaise: number;
}

/** Authoritative coin balance for one retailer, from the wallet ledger RPCs. */
export async function getRetailerCoinPosition(
  supabase: SupabaseClient,
  retailerId: string
): Promise<CoinPosition> {
  const position = await getRetailerWalletPosition(supabase, retailerId);
  const balancePaise = coinBalancePaise(position.creditLimitPaise, position.outstandingPaise);
  return {
    balancePaise,
    balanceRupees: paiseToRupees(balancePaise),
    limitPaise: position.creditLimitPaise,
    outstandingPaise: position.outstandingPaise,
  };
}

/** How an order of `orderTotalRupees` would be paid with the current balance. */
export async function quoteCoinPayment(
  supabase: SupabaseClient,
  retailerId: string,
  orderTotalRupees: number
): Promise<CoinPayment> {
  const position = await getRetailerCoinPosition(supabase, retailerId);
  return computeCoinPayment({
    orderTotalPaise: rupeesToPaise(orderTotalRupees),
    balancePaise: position.balancePaise,
  });
}

export interface OrderCoinMovement {
  /** Coins debited for this order (0 when it spent none). */
  spentPaise: number;
  /** Coins given back when the order was cancelled/returned. */
  refundedPaise: number;
  /** What the order actually costs the shop in coins today. */
  netPaise: number;
  /** True once the original debit row has been reversed. */
  refunded: boolean;
}

/**
 * What one order did to the coin balance, read straight from the ledger.
 *
 * This is how an order screen shows "coins used" without a denormalised column
 * that could drift: `ORDER_DEBIT` rows are the spend and `ORDER_REVERSAL` rows
 * (matched by `reference_id`) are the give-back. A cancelled order therefore
 * reports 0 spent, which is the truth the shop cares about.
 */
export async function getOrderCoinMovement(
  supabase: SupabaseClient,
  orderId: string,
  retailerId: string
): Promise<OrderCoinMovement> {
  const { data, error } = await supabase
    .from('retailer_wallet_ledger')
    .select('transaction_type, amount_paise, is_reversed, reversal_of')
    .eq('reference_id', orderId)
    .eq('retailer_id', retailerId)
    .returns<{ transaction_type: string; amount_paise: number; is_reversed: boolean; reversal_of: string | null }[]>();

  if (error) throw new Error('Order coin movement could not be verified.');
  const rows = data ?? [];
  const debits = rows.filter((row) => row.transaction_type === 'ORDER_DEBIT');
  const reversals = rows.filter((row) => row.transaction_type === 'ORDER_REVERSAL' && row.reversal_of !== null);
  const spentPaise = debits
    .filter((row) => !row.is_reversed)
    .reduce((sum, row) => sum + row.amount_paise, 0);
  const refundedPaise = reversals.reduce((sum, row) => sum + row.amount_paise, 0);
  // A reversed debit is already excluded from `spentPaise`, so the net is the
  // remaining spend; `refundedPaise` is reported separately for the audit line.
  return { spentPaise, refundedPaise, netPaise: spentPaise, refunded: reversals.length > 0 };
}

export type DebitCoinsResult =
  | { ok: true; usedPaise: number; remainingPaise: number; balancePaise: number }
  | { ok: false; error: string };

/**
 * Spend coins for an order — the single write path.
 *
 * - The amount is recomputed from the LIVE balance one last time (a concurrent
 *   order between the quote and this call can only reduce what is spent, never
 *   produce a negative balance).
 * - Nothing is charged when the shop has no coins: the whole total simply stays
 *   payable, so an order never fails for lack of a balance.
 * - `p_idempotency_key = order:<orderId>` makes a retry a no-op.
 */
export async function debitCoinsForOrder(
  supabase: SupabaseClient,
  {
    retailerId,
    orderId,
    orderTotalPaise,
    createdBy,
    description,
  }: {
    retailerId: string;
    orderId: string;
    orderTotalPaise: number;
    createdBy: string | null;
    description: string;
  }
): Promise<DebitCoinsResult> {
  const rpc = supabase as unknown as RpcCapable;

  // Two attempts at most: if the balance moved under us, one recomputation is
  // enough (the second read sees the committed concurrent debit).
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const position = await getRetailerCoinPosition(supabase, retailerId);
    const payment = computeCoinPayment({ orderTotalPaise, balancePaise: position.balancePaise });

    if (payment.usedPaise <= 0) {
      // No coins available (or a zero-value order): nothing to deduct, and no
      // ledger row is written. The order proceeds with the full amount payable.
      return {
        ok: true,
        usedPaise: 0,
        remainingPaise: payment.remainingPaise,
        balancePaise: position.balancePaise,
      };
    }

    const { error } = await rpc.rpc('check_and_debit_retailer_wallet', {
      p_retailer_id: retailerId,
      p_order_id: orderId,
      p_amount_paise: payment.usedPaise,
      p_idempotency_key: coinDebitKey(orderId),
      p_created_by: createdBy ?? retailerId,
      p_description: description,
    });

    if (!error) {
      return {
        ok: true,
        usedPaise: payment.usedPaise,
        remainingPaise: payment.remainingPaise,
        balancePaise: payment.balanceAfterPaise,
      };
    }

    // "Insufficient credit" here means another checkout spent coins in between:
    // recompute once. Anything else (unknown RPC, connection error) is a real
    // failure — the wallet must never be silently skipped.
    if (!/insufficient/i.test(error.message) || attempt === 1) {
      return { ok: false, error: error.message };
    }
  }

  return { ok: false, error: 'The coin balance could not be debited. Please try again.' };
}

/**
 * Refund the coins an order actually spent.
 *
 * Delegates to the reversal engine (lib/orders/wallet-reversal.ts), which reads
 * the original ORDER_DEBIT row, writes ONE `ORDER_REVERSAL` credit linked to it
 * (`reversal_of`) and marks the original reversed. Idempotent by construction:
 * a second cancellation finds the original already reversed and does nothing.
 */
export async function refundOrderCoins(
  orderId: string,
  retailerId: string,
  reason: string,
  createdBy: string | null
): Promise<{ success: true; refundedPaise: number } | { success: false; error: string }> {
  const { reverseOrderWalletDebit } = await import('@/lib/orders/wallet-reversal');
  const result = await reverseOrderWalletDebit(orderId, retailerId, reason, createdBy);
  if ('error' in result) return { success: false, error: result.error };
  return { success: true, refundedPaise: result.refundedPaise };
}
