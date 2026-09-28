import 'server-only';
import { createClient } from '@/lib/supabase/server';
import { reversalIdempotencyKey } from '@/lib/retailer/wallet-math';

/**
 * 🪙 COIN REFUNDS — the ONE path that puts coins back.
 *
 * An order spends coins by writing an `ORDER_DEBIT` row (see
 * lib/coins/server.ts). Refunding that spend must:
 *
 *   - be ATOMIC (the credit and the "original reversed" flag belong together),
 *   - be IDEMPOTENT (cancelling twice refunds once),
 *   - be LINKED to the original transaction (`reversal_of`, notes, metadata),
 *   - reverse EXACTLY the amount that was spent — never more.
 *
 * All three properties come from the ledger's own guarantees: the credit row is
 * inserted with the deterministic idempotency key `reversal:<original-id>`,
 * which the unique `idempotency_key` constraint enforces, and the original row
 * is only flagged after that insert succeeds. A retried or concurrent refund
 * therefore hits `23505` and is reported as an already-applied success instead
 * of crediting the shop twice.
 *
 * Historical credit rows are NOT touched: this only ever appends, so the
 * pre-coins ledger stays intact for audit.
 */
export async function reverseOrderWalletDebit(
  orderId: string,
  retailerId: string,
  reason: string,
  createdBy: string | null
): Promise<{ success: true; refundedPaise: number } | { error: string }> {
  const supabase = createClient();

  // PREFERRED PATH — the database function (0053). It is the only way a refund
  // can be written when the caller is the RETAILER (cancelling their own order)
  // or STAFF (recording a return): the ledger table itself stays admin-only, and
  // the function additionally enforces "order is cancelled/returned" and "once
  // per debit" while doing the credit + reverse flag in ONE transaction.
  const rpcResult = await (
    supabase as unknown as {
      rpc: (
        name: string,
        args: Record<string, unknown>
      ) => Promise<{ data: unknown; error: { message: string; code?: string } | null }>;
    }
  ).rpc('refund_order_coins', {
    p_order_id: orderId,
    p_reason: reason,
    p_created_by: createdBy,
  });

  if (!rpcResult.error) {
    return { success: true, refundedPaise: Number(rpcResult.data ?? 0) };
  }

  // A database that has not run 0053 yet (older deployment, or a mocked client
  // in tests) falls back to the direct write, which works for admin callers.
  // Any OTHER error is a real failure and must not be hidden.
  if (!/does not exist|could not find the function|schema cache/i.test(rpcResult.error.message)) {
    return { error: rpcResult.error.message };
  }

  // The coins this order actually spent. A pre-coins order has no debit row.
  const { data: original } = await supabase
    .from('retailer_wallet_ledger')
    .select('id, amount_paise, is_reversed')
    .eq('reference_id', orderId)
    .eq('transaction_type', 'ORDER_DEBIT')
    .eq('retailer_id', retailerId)
    .maybeSingle<{ id: string; amount_paise: number; is_reversed: boolean }>();

  // Nothing to refund, or already refunded: success with zero movement, so a
  // second cancellation is a no-op rather than an error or a duplicate credit.
  if (!original || original.is_reversed) return { success: true, refundedPaise: 0 };

  const { data: account } = await supabase
    .from('retailer_credit_accounts')
    .select('id')
    .eq('retailer_id', retailerId)
    .maybeSingle<{ id: string }>();

  const idempotencyKey = reversalIdempotencyKey(original.id);

  const { error } = await supabase.from('retailer_wallet_ledger').insert({
    retailer_id: retailerId,
    account_id: account?.id ?? null,
    transaction_type: 'ORDER_REVERSAL',
    amount_paise: original.amount_paise,
    direction: 'credit',
    reference_type: 'order',
    reference_id: orderId,
    description: `Reversal of order ${orderId} — ${reason}`,
    reason,
    created_by: createdBy,
    notes: `Reverses ORDER_DEBIT ${original.id}`,
    idempotency_key: idempotencyKey,
    reversal_of: original.id,
    metadata: {
      reversal_of: original.id,
      order_id: orderId,
    },
  } as never);

  if (error) {
    // A concurrent/retried refund with the same deterministic key already
    // created the credit — treat as success rather than double-refunding.
    if (error.code === '23505') return { success: true, refundedPaise: 0 };
    return { error: error.message };
  }

  await supabase
    .from('retailer_wallet_ledger')
    .update({ is_reversed: true, reversed_at: new Date().toISOString(), reversed_by: createdBy } as never)
    .eq('id', original.id);

  return { success: true, refundedPaise: original.amount_paise };
}
