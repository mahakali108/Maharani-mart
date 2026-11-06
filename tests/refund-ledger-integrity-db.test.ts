import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { as, createMigratedDb, createRetailer, errorOf, type Db } from './helpers/pg-harness';

describe('new event-keyed refund ledger (migrated disposable PGlite)', () => {
  let db: Db;
  let retailerId: string;
  beforeAll(async () => {
    db = await createMigratedDb();
    const retailer = await createRetailer(db);
    retailerId = retailer.id;
    await db.query("insert into warehouses (name, area_id, is_active) values ('Refund test warehouse', $1, true)", [retailer.areaId]);
  }, 60000);
  afterAll(async () => { await db?.close(); });

  async function fixture(amount = 50000) {
    const orderId = randomUUID();
    const debitId = randomUUID();
    await db.query("insert into public.orders (id, order_number, retailer_id, status) values ($1, $2, $3, 'cancelled')", [orderId, `REFUND-${orderId}`, retailerId]);
    await db.query(`insert into public.retailer_wallet_ledger
      (id, retailer_id, transaction_type, amount_paise, direction, reference_type, reference_id, description, idempotency_key)
      values ($1, $2, 'ORDER_DEBIT', $3, 'debit', 'order', $4, 'test', $5)`,
    [debitId, retailerId, amount, orderId, `refund-test:${debitId}`]);
    return { orderId, debitId };
  }
  const balance = async () => Number((await as(db, retailerId, (tx) => tx.query<{ n: number }>(
    'select public.get_retailer_outstanding_paise($1) as n', [retailerId],
  ))).rows[0]!.n);
  const partial = (orderId: string, debitId: string, amount: number, key: string, reason = 'test') => as(db, 'service', (tx) => tx.query(
    'select public.refund_order_coins_partial($1, $2, $3, $4, $5)', [orderId, debitId, amount, key, reason],
  ));

  it('handles multiple partials, exact replays and over-refund rejection', async () => {
    const before = await balance();
    const { orderId, debitId } = await fixture();
    await partial(orderId, debitId, 20000, 'event-1');
    expect(await balance()).toBe(before + 30000);
    await partial(orderId, debitId, 20000, 'event-1');
    expect(await balance()).toBe(before + 30000);
    await expect(partial(orderId, debitId, 20001, 'event-1')).rejects.toThrow(/conflicts/);
    await expect(partial(orderId, debitId, 20000, 'event-1', 'different')).rejects.toThrow(/conflicts/);
    await expect(partial(orderId, debitId, 30001, 'event-2')).rejects.toThrow(/exceeds/);
    await partial(orderId, debitId, 30000, 'event-2');
    expect(await balance()).toBe(before);
    const result = await db.query<{ n: number; reversed: boolean }>(
      `select count(*)::int n, bool_or(is_reversed) reversed from public.retailer_wallet_ledger where reversal_of = $1`, [debitId],
    );
    expect(result.rows[0]).toEqual({ n: 2, reversed: false });
    expect((await db.query<{ is_reversed: boolean }>('select is_reversed from public.retailer_wallet_ledger where id=$1', [debitId])).rows[0]!.is_reversed).toBe(false);
  });

  it('finishes a partial refund on full cancellation without double-crediting', async () => {
    const before = await balance();
    const { orderId, debitId } = await fixture();
    await partial(orderId, debitId, 20000, 'part');
    await as(db, retailerId, (tx) => tx.query('select public.refund_order_coins($1)', [orderId]));
    expect(await balance()).toBe(before);
    const replay = await as(db, retailerId, (tx) => tx.query<{ n: number }>('select public.refund_order_coins($1) as n', [orderId]));
    expect(Number(replay.rows[0]!.n)).toBe(0);
  });

  it('rejects retailer access to partial API and actor spoofing', async () => {
    const { orderId, debitId } = await fixture();
    expect(await errorOf(db, retailerId, (tx) => tx.query('select public.refund_order_coins_partial($1,$2,1,$3,$4)', [orderId, debitId, 'other', 'test']))).toMatch(/Access denied/);
    expect(await errorOf(db, retailerId, (tx) => tx.query('select public.refund_order_coins($1,$2,$3)', [orderId, 'test', randomUUID()]))).toMatch(/Actor mismatch/);
  });

  it('does not change or reinterpret a historical reversed debit', async () => {
    const { orderId, debitId } = await fixture();
    await db.query('update public.retailer_wallet_ledger set is_reversed = true where id = $1', [debitId]);
    const before = await balance();
    await expect(partial(orderId, debitId, 100, 'history')).rejects.toThrow(/Historical reversed debit/);
    await expect(as(db, retailerId, (tx) => tx.query('select public.refund_order_coins($1)', [orderId]))).rejects.toThrow(/Historical reversed debit/);
    expect(await balance()).toBe(before);
  });
});
