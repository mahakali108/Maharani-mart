import 'server-only';
import { createClient } from '@/lib/supabase/server';

export async function reverseOrderWalletDebit(orderId: string, retailerId: string, reason: string, createdBy: string | null) {
  const supabase = createClient();

  // Find original ORDER_DEBIT
  const { data: original } = await supabase
    .from('retailer_wallet_ledger')
    .select('id, amount_paise, is_reversed')
    .eq('reference_id', orderId)
    .eq('transaction_type', 'ORDER_DEBIT')
    .eq('retailer_id', retailerId)
    .maybeSingle<{ id: string; amount_paise: number; is_reversed: boolean }>();

  if (!original || original.is_reversed) return { success: true };

  const { data: account } = await supabase
    .from('retailer_credit_accounts')
    .select('id')
    .eq('retailer_id', retailerId)
    .maybeSingle<{ id: string }>();

  const idempotencyKey = `reversal:${orderId}:${Date.now()}`;

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

  if (error) return { error: error.message };

  await supabase
    .from('retailer_wallet_ledger')
    .update({ is_reversed: true, reversed_at: new Date().toISOString(), reversed_by: createdBy } as never)
    .eq('id', original.id);

  return { success: true };
}
