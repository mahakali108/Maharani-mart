import { describe, expect, it } from 'vitest';
import { getOrderCoinMovement } from '@/lib/coins/server';
import { supabaseFixture } from './helpers/supabase-fixture';

const debit = { id: 'debit', retailer_id: 'retailer', reference_id: 'order', transaction_type: 'ORDER_DEBIT', amount_paise: 50000, is_reversed: false, reversal_of: null };
const refund = (id: string, amount: number) => ({ id, retailer_id: 'retailer', reference_id: 'order', transaction_type: 'ORDER_REVERSAL', amount_paise: amount, is_reversed: false, reversal_of: 'debit' });
const read = (rows: Record<string, unknown>[]) => getOrderCoinMovement(supabaseFixture({ retailer_wallet_ledger: rows }) as never, 'order', 'retailer');

describe('order coin display with linked refunds', () => {
  it('shows the remaining net after a partial credit', async () => {
    expect(await read([debit, refund('c1', 20000)])).toEqual({ spentPaise: 30000, refundedPaise: 20000, netPaise: 30000, refunded: true });
  });
  it('shows zero after multiple partial credits exhaust the debit', async () => {
    expect(await read([debit, refund('c1', 20000), refund('c2', 30000)])).toEqual({ spentPaise: 0, refundedPaise: 50000, netPaise: 0, refunded: true });
  });
  it('fails closed on over-credit or an unknown debit', async () => {
    await expect(read([debit, refund('c1', 50001)])).rejects.toThrow('could not be verified');
    await expect(read([refund('c1', 100)])).rejects.toThrow('could not be verified');
  });
  it('preserves the prior display behavior of flagged historical debits', async () => {
    expect(await read([{ ...debit, is_reversed: true }, refund('c1', 50000)])).toMatchObject({ spentPaise: 0, refundedPaise: 50000 });
  });
});
