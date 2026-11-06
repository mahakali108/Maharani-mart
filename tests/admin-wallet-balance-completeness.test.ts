import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { readAdminWalletOutstanding } from '../lib/admin/wallet-balance';
import { as, createMigratedDb, createRetailer } from './helpers/pg-harness';

describe('admin wallet balance reads', () => {
  it('uses the database balance and preserves negative integer paise', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: '-123', error: null });
    expect(await readAdminWalletOutstanding({ rpc }, 'retailer-1')).toBe(-123);
    expect(rpc).toHaveBeenCalledWith('get_retailer_outstanding_paise', { p_retailer_id: 'retailer-1' });
  });
  it.each([null, undefined, '', '1.5', ' 1', 'NaN', Number.MAX_SAFE_INTEGER + 1, Infinity])(
    'fails closed for invalid result %s', async (data) => {
      await expect(readAdminWalletOutstanding({ rpc: async () => ({ data, error: null }) }, 'r')).rejects.toThrow();
    },
  );
  it('fails closed on an RPC error even if a value was returned', async () => {
    await expect(readAdminWalletOutstanding({ rpc: async () => ({ data: 0, error: { message: 'denied' } }) }, 'r')).rejects.toThrow();
  });
  it('both admin pages use the complete-balance RPC, not ledger aggregates', () => {
    for (const file of ['app/admin/wallets/page.tsx', 'app/admin/wallets/[id]/page.tsx']) {
      const source = readFileSync(file, 'utf8');
      expect(source).toContain('readAdminWalletOutstanding(');
      expect(source).toContain('known legacy accounting defect');
      expect(source).not.toContain('const outstandingPaise = computeOutstandingPaise(');
    }
  });
  it('the real migrated RPC includes entries older than the latest 100', async () => {
    const db = await createMigratedDb();
    try {
      const retailer = await createRetailer(db);
      await db.query(`insert into public.retailer_wallet_ledger
        (retailer_id, transaction_type, amount_paise, direction, description, idempotency_key)
        select $1, 'MANUAL_DEBIT', 100, 'debit', 'completeness test', 'complete-' || n
        from generate_series(1, 125) n`, [retailer.id]);
      const result = await as(db, retailer.id, (tx) => tx.query<{ amount: number }>(
        'select public.get_retailer_outstanding_paise($1) as amount', [retailer.id],
      ));
      expect(Number(result.rows[0]!.amount)).toBe(12500);
    } finally {
      await db.close();
    }
  }, 60000);
});
