import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { as, createMigratedDb, createRetailer, type Db } from './helpers/pg-harness';

/** Disposable PGlite regression; not production data or concurrency evidence. */
describe('cancelled order Coins balance consistency', () => {
  let db: Db;
  let retailerId: string;
  beforeAll(async () => {
    db = await createMigratedDb();
    const retailer = await createRetailer(db);
    retailerId = retailer.id;
    await db.query("insert into warehouses (name, area_id, is_active) values ('Refund test warehouse', $1, true)", [retailer.areaId]);
  }, 60000);
  afterAll(async () => { await db?.close(); });

  it('returns the wallet to its original outstanding after one debit and refund', async () => {
    const original = await as(db, retailerId, (tx) => tx.query<{ outstanding: number }>(
      'select public.get_retailer_outstanding_paise($1) as outstanding', [retailerId],
    ));
    const order = await db.query<{ id: string }>(
      "insert into public.orders (order_number, retailer_id, status) values ('TEST-REFUND-BALANCE', $1, 'cancelled') returning id", [retailerId],
    );
    const orderId = order.rows[0]!.id;
    await db.query(`insert into public.retailer_wallet_ledger
      (retailer_id, transaction_type, amount_paise, direction, reference_type, reference_id, description, idempotency_key)
      values ($1, 'ORDER_DEBIT', 50000, 'debit', 'order', $2, 'Test debit', $3)`,
    [retailerId, orderId, `test-debit:${orderId}`]);
    await as(db, retailerId, (tx) => tx.query('select public.refund_order_coins($1, $2, $3)', [orderId, 'test refund', retailerId]));
    const after = await as(db, retailerId, (tx) => tx.query<{ outstanding: number }>(
      'select public.get_retailer_outstanding_paise($1) as outstanding', [retailerId],
    ));
    // An exact refund must undo the original debit once, not twice.
    expect(Number(after.rows[0]!.outstanding)).toBe(Number(original.rows[0]!.outstanding));
  }, 30000);
});
