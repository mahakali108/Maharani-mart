import 'server-only';
import type { createClient } from '@/lib/supabase/server';
import { reverseOrderWalletDebit } from '@/lib/orders/wallet-reversal';

type SupabaseClient = Awaited<ReturnType<typeof createClient>>;
type LedgerRow = {
  id: string;
  transaction_type: string;
  amount_paise: number;
  direction: string;
  is_reversed: boolean;
  reversal_of: string | null;
};

/**
 * A conservative verification of linked refunds for one order debit.
 * This does NOT make cancellation and restoration one transaction. Multiple
 * child debits require a new transactional database design, not repeated calls
 * to the legacy RPC (which only examines the first debit).
 */
export async function restoreAndVerifyCancellationCoins(
  supabase: SupabaseClient,
  orderId: string,
  retailerId: string,
  reason: string,
  actorId: string | null,
): Promise<{ success: true } | { error: string }> {
  const unverified = { error: 'The order is cancelled, but Coins restoration could not be verified. Contact support before retrying.' };
  async function readLedger(): Promise<LedgerRow[] | null> {
    const { data, error, count } = await supabase.from('retailer_wallet_ledger')
      .select('id, transaction_type, amount_paise, direction, is_reversed, reversal_of', { count: 'exact' })
      .eq('retailer_id', retailerId)
      .eq('reference_id', orderId)
      .in('transaction_type', ['ORDER_DEBIT', 'ORDER_REVERSAL'])
      .limit(1000)
      .returns<LedgerRow[]>();
    if (error || !data || count === null || count !== data.length || data.length >= 1000) return null;
    return data;
  }
  try {
    const initial = await readLedger();
    if (!initial) return unverified;
    const debits = initial.filter((row) => row.transaction_type === 'ORDER_DEBIT');
    if (debits.length > 1) return unverified;
    // The RPC is idempotent for a single debit and operates only after the
    // order is cancelled. The non-transactional direct-write fallback is not
    // permitted on this path, even if the RPC is absent.
    const reversal = await reverseOrderWalletDebit(orderId, retailerId, reason, actorId, supabase, { requireRefundRpc: true });
    if ('error' in reversal) return unverified;
    const rows = await readLedger();
    if (!rows) return unverified;
    const finalDebits = rows.filter((row) => row.transaction_type === 'ORDER_DEBIT');
    const credits = rows.filter((row) => row.transaction_type === 'ORDER_REVERSAL');
    if (finalDebits.length !== debits.length || finalDebits.length > 1) return unverified;
    if (finalDebits.length === 0 && credits.length !== 0) return unverified;
    if (finalDebits.length === 1) {
      const debit = finalDebits[0];
      if (!debit || debit.id !== debits[0]?.id || debit.is_reversed || debit.direction !== 'debit'
        || !Number.isSafeInteger(Number(debit.amount_paise)) || Number(debit.amount_paise) <= 0
        || credits.length === 0) return unverified;
      let credited = 0;
      for (const credit of credits) {
        const amount = Number(credit.amount_paise);
        if (credit.is_reversed || credit.direction !== 'credit' || credit.reversal_of !== debit.id
          || !Number.isSafeInteger(amount) || amount <= 0) return unverified;
        credited += amount;
        if (!Number.isSafeInteger(credited)) return unverified;
      }
      if (credited !== Number(debit.amount_paise)) return unverified;
    }
    return { success: true };
  } catch {
    return unverified;
  }
}

export type AtomicCancellationOutcome =
  /** The RPC committed and the order row reads `cancelled`. */
  | { status: 'cancelled' }
  /**
   * The database examined the order and declined. NOTHING was changed. The
   * caller must stop: falling back to "set status, then refund" here is
   * exactly the partial-refund defect this function exists to prevent.
   */
  | { status: 'refused'; error: string; conflict: boolean }
  /** The RPC is not installed / not reachable. Only then may a legacy path run. */
  | { status: 'unavailable' };

const NOT_CANCELLABLE = 'This order can no longer be cancelled — it may already be processing.';
const NOT_SAFE = 'This order could not be cancelled safely, so nothing was changed. Please contact support.';

function isMissingFunction(error: { code?: string; message?: string }): boolean {
  return error.code === 'PGRST202' || error.code === '42883'
    || /could not find the function|function .* does not exist/i.test(error.message ?? '');
}

/**
 * Cancel an order — including a split (multi sub-order) order — with every
 * child status, stock release, wallet debit reversal and the coupon release in
 * ONE database transaction (`cancel_order_coins_atomic`, 0088 + 0097).
 *
 * Never throws. Authorisation is enforced inside the function.
 */
export async function attemptAtomicOrderCancellation(
  supabase: SupabaseClient,
  orderId: string,
  reason: string,
): Promise<AtomicCancellationOutcome> {
  try {
    const rpc = (supabase as unknown as {
      rpc?: (fn: string, args: Record<string, unknown>) => PromiseLike<{ error: { message?: string; code?: string } | null }>;
    }).rpc;
    if (typeof rpc !== 'function') return { status: 'unavailable' };
    const { error } = await rpc.call(supabase, 'cancel_order_coins_atomic', {
      p_order_id: orderId,
      p_reason: reason.slice(0, 500),
    });
    if (error) {
      if (isMissingFunction(error)) return { status: 'unavailable' };
      const message = error.message ?? '';
      const conflict = /current status|SPLIT_CANCEL: part of this order|Access denied|Authentication required|Active account required|Order not found/i.test(message);
      return { status: 'refused', error: conflict ? NOT_CANCELLABLE : NOT_SAFE, conflict };
    }
    // Never trust the call alone: the order row is the proof it committed.
    const { data: row, error: readError } = await supabase.from('orders')
      .select('status').eq('id', orderId).maybeSingle<{ status: string }>();
    if (!readError && row?.status === 'cancelled') return { status: 'cancelled' };
    return { status: 'unavailable' };
  } catch {
    // The request may or may not have reached the database. A retry is safe
    // (the function is idempotent); a non-atomic fallback is not.
    return { status: 'refused', error: 'Cancellation could not be confirmed. Check the order before retrying.', conflict: false };
  }
}

/**
 * Boolean form of `attemptAtomicOrderCancellation`: true only when the RPC
 * succeeded AND the order row now reads `cancelled`. Never throws.
 */
export async function tryAtomicOrderCancellation(
  supabase: SupabaseClient,
  orderId: string,
  reason: string,
): Promise<boolean> {
  return (await attemptAtomicOrderCancellation(supabase, orderId, reason)).status === 'cancelled';
}
