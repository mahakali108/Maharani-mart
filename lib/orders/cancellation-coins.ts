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

/**
 * Cancel an order and restore its Coins and coupon in ONE database transaction
 * through `cancel_order_coins_atomic` (0088). Returns true only when the RPC
 * succeeded AND the order row now reads `cancelled`. Returns false — never throws — when the RPC is unavailable,
 * rejects the caller, or declines the order (for example a split marketplace
 * order, which it refuses by design); the caller then continues with the
 * guarded status update followed by `restoreAndVerifyCancellationCoins`.
 *
 * Authorisation is enforced inside the function (owner of a pending order, or
 * Admin for pre-dispatch states), so calling it first cannot widen access.
 */
export async function tryAtomicOrderCancellation(
  supabase: SupabaseClient,
  orderId: string,
  reason: string,
): Promise<boolean> {
  try {
    const rpc = (supabase as unknown as {
      rpc?: (fn: string, args: Record<string, unknown>) => PromiseLike<{ error: { message?: string } | null }>;
    }).rpc;
    if (typeof rpc !== 'function') return false;
    const { error } = await rpc.call(supabase, 'cancel_order_coins_atomic', {
      p_order_id: orderId,
      p_reason: reason.slice(0, 500),
    });
    if (error) return false;
    // Never trust the call alone: the order row is the proof it committed.
    const { data: row, error: readError } = await supabase.from('orders')
      .select('status').eq('id', orderId).maybeSingle<{ status: string }>();
    return !readError && row?.status === 'cancelled';
  } catch {
    return false;
  }
}
