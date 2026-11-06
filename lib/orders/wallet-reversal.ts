import 'server-only';
import { createClient } from '@/lib/supabase/server';

/** Refund through the database only. Never fall back to separate ledger
 * writes: an insert and a flag update in different requests can double-count
 * or commit only halfway. A missing RPC is an error, not a successful refund.
 * The RPC itself validates the order owner, status and actor. */
export async function reverseOrderWalletDebit(
  orderId: string,
  _retailerId: string,
  reason: string,
  createdBy: string | null,
  callerClient?: Awaited<ReturnType<typeof createClient>>,
  _options?: { requireRefundRpc?: boolean },
): Promise<{ success: true; refundedPaise: number } | { error: string }> {
  void _retailerId;
  void _options;
  const supabase = callerClient ?? (await createClient());
  const result = await (supabase as unknown as {
    rpc: (name: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: { message: string } | null }>;
  }).rpc('refund_order_coins', { p_order_id: orderId, p_reason: reason, p_created_by: createdBy });
  if (result.error) return { error: result.error.message };
  const amount = Number(result.data);
  if (result.data === null || result.data === undefined || !Number.isSafeInteger(amount) || amount < 0) {
    return { error: 'Refund result could not be verified.' };
  }
  return { success: true, refundedPaise: amount };
}
