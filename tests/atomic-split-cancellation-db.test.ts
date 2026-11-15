/**
 * Migration 0097 on real PostgreSQL 16 (PGlite): atomic cancellation of split
 * (multi sub-order) orders. Every assertion runs the actual functions,
 * triggers and policies. True multi-session concurrency is covered on a
 * disposable PostgreSQL 17 cluster by tests/pr126-review-fixes.pg.mjs
 * (PGlite has a single connection).
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { as, createMigratedDb, createRetailer, createUser, errorOf, type Db, type Tx } from './helpers/pg-harness';

let db: Db;
let admin: string;
let staff: string;

interface Split {
  retailer: string; order: string; pack: string; offer: string;
  sellerChild: string; maharaniChild: string; coupon: string | null;
}

/**
 * A checked-out split order: a seller-fulfilled child (2 pieces, seller stock)
 * and a Maharani child (3 pieces, pack stock), one wallet debit per child with
 * the checkout key `order:<parent>:<child>`. Rows that checkout would create
 * are seeded with triggers off; all triggers are back on before the test acts.
 */
async function splitOrder(opts: { sellerCoins?: number; maharaniCoins?: number; status?: string; coupon?: boolean } = {}): Promise<Split> {
  const sellerCoins = opts.sellerCoins ?? 20000;
  const maharaniCoins = opts.maharaniCoins ?? 30000;
  const retailer = (await createRetailer(db)).id;
  const order = randomUUID(), product = randomUUID(), pack = randomUUID(), seller = randomUUID();
  const offer = randomUUID(), sellerChild = randomUUID(), maharaniChild = randomUUID();
  await db.query(`insert into public.orders (id, order_number, retailer_id, status) values ($1, $2, $3, 'pending')`, [order, `S-${order.slice(0, 13)}`, retailer]);
  let coupon: string | null = null;
  await db.exec(`set session_replication_role = 'replica'`);
  try {
    await db.query(`insert into public.products (id, sku_code, name, unit, base_price) values ($1, $2, 'Split product', 'PCS', 10)`, [product, product]);
    await db.query(`insert into public.product_packs (id, product_id, pack_name, pack_sku_code, base_price, case_price, stock_quantity) values ($1, $2, 'Pack', $3, 10, 10, 7)`, [pack, product, pack]);
    await db.query(`insert into public.sellers (id, business_name, status) values ($1, $2, 'active')`, [seller, `Seller ${seller}`]);
    await db.query(`insert into public.seller_offers (id, seller_id, product_id, pack_id, fulfilment_type, unit_price_paise, stock_quantity) values ($1, $2, $3, $4, 'seller', 1000, 8)`, [offer, seller, product, pack]);
    await db.query(
      `insert into public.sub_orders (id, parent_order_id, seller_id, fulfilment_type, coins_share_paise, status)
       values ($1, $2, $3, 'seller', $5, $7), ($4, $2, null, 'maharani', $6, $7)`,
      [sellerChild, order, seller, maharaniChild, sellerCoins, maharaniCoins, opts.status ?? 'pending']);
    await db.query(
      `insert into public.order_items (order_id, product_id, pack_id, sub_order_id, seller_offer_id, source_type, fulfilment_type, quantity, unit_price, line_total, stock_deducted_quantity)
       values ($1, $2, $3, $4, $5, 'seller', 'seller', 2, 10, 20, 2), ($1, $2, $3, $6, null, 'maharani', 'maharani', 3, 10, 30, 3)`,
      [order, product, pack, sellerChild, offer, maharaniChild]);
    if (opts.status && opts.status !== 'pending') await db.query(`update public.orders set status = $2 where id = $1`, [order, opts.status]);
    if (opts.coupon) {
      coupon = randomUUID();
      await db.query(`insert into public.coupons (id, code, title, discount_type, discount_value, expires_at, used_count) values ($1, $2, 'Test', 'fixed', 10, now() + interval '1 day', 1)`, [coupon, `C${coupon.slice(0, 8).toUpperCase()}`]);
      await db.query(`insert into public.coupon_redemptions (coupon_id, retailer_id, order_id, discount_amount) values ($1, $2, $3, 10)`, [coupon, retailer, order]);
    }
  } finally {
    await db.exec(`set session_replication_role = 'origin'`);
  }
  for (const [child, amount] of [[sellerChild, sellerCoins], [maharaniChild, maharaniCoins]] as const) {
    if (amount > 0) {
      await db.query(
        `insert into public.retailer_wallet_ledger (retailer_id, transaction_type, amount_paise, direction, reference_type, reference_id, description, idempotency_key)
         values ($1, 'ORDER_DEBIT', $2, 'debit', 'order', $3, 'checkout', $4)`,
        [retailer, amount, order, `order:${order}:${child}`]);
    }
  }
  return { retailer, order, pack, offer, sellerChild, maharaniChild, coupon };
}

async function state(f: Split) {
  const one = async <T>(sql: string, params: unknown[]) => (await db.query<T>(sql, params)).rows;
  const order = (await one<{ status: string }>(`select status::text from public.orders where id = $1`, [f.order]))[0]!.status;
  const children = Object.fromEntries((await one<{ id: string; status: string }>(`select id, status from public.sub_orders where parent_order_id = $1`, [f.order])).map((r) => [r.id, r.status]));
  const packStock = (await one<{ n: number }>(`select stock_quantity n from public.product_packs where id = $1`, [f.pack]))[0]!.n;
  const offerStock = (await one<{ n: number }>(`select stock_quantity n from public.seller_offers where id = $1`, [f.offer]))[0]!.n;
  const reversals = (await one<{ amount_paise: string; idempotency_key: string }>(
    `select amount_paise, idempotency_key from public.retailer_wallet_ledger where reference_id = $1 and transaction_type = 'ORDER_REVERSAL' order by amount_paise`, [f.order]))
    .map((r) => Number(r.amount_paise));
  const outstanding = Number((await one<{ n: string }>(`select public.get_retailer_outstanding_paise($1) n`, [f.retailer]))[0]!.n);
  const redemptions = (await one(`select 1 from public.coupon_redemptions where order_id = $1`, [f.order])).length;
  const couponUsed = f.coupon ? (await one<{ n: number }>(`select used_count n from public.coupons where id = $1`, [f.coupon]))[0]!.n : null;
  return { order, seller: children[f.sellerChild], maharani: children[f.maharaniChild], packStock, offerStock, reversals, outstanding, redemptions, couponUsed };
}
const cancel = (who: string, f: Split, reason = 'changed mind') => as(db, who, async (tx: Tx) =>
  Number((await tx.query<{ n: string }>(`select public.cancel_order_coins_atomic($1, $2) n`, [f.order, reason])).rows[0]!.n));
const cancelError = (who: string, f: Split) => errorOf(db, who, (tx: Tx) => tx.query(`select public.cancel_order_coins_atomic($1, 'x')`, [f.order]));
const closeChild = (who: string, f: Split, child: string, status = 'cancelled', parent = f.order) => as(db, who, async (tx: Tx) =>
  (await tx.query<{ r: Record<string, unknown> }>(`select public.close_sub_order_atomic($1, $2, $3, 'admin decision') r`, [parent, child, status])).rows[0]!.r);
const closeError = (who: string, f: Split, child: string, parent = f.order) => errorOf(db, who, (tx: Tx) =>
  tx.query(`select public.close_sub_order_atomic($1, $2, 'cancelled', 'x')`, [parent, child]));

const UNTOUCHED = { order: 'pending', seller: 'pending', maharani: 'pending', packStock: 7, offerStock: 8, reversals: [], outstanding: 50000 };
const FULLY_CANCELLED = { order: 'cancelled', seller: 'cancelled', maharani: 'cancelled', packStock: 10, offerStock: 10, reversals: [20000, 30000], outstanding: 0 };

describe('0097 atomic split-order cancellation (PostgreSQL 16)', () => {
  beforeAll(async () => {
    db = await createMigratedDb();
    admin = await createUser(db, 'super_admin', 'Admin');
    staff = await createUser(db, 'staff', 'Staff');
    await db.query(`insert into public.warehouses (name, is_active) values ('WH 0097', true)`);
  }, 120_000);

  describe('whole-order cancellation with several child debits', () => {
    it('REPRODUCTION: the 0088 function refuses every split order (so callers fell back to non-atomic code)', async () => {
      const legacy = await createMigratedDb({ lastMigration: '0096_delivery_snapshot_integrity.sql' });
      const { rows } = await legacy.query<{ src: string }>(`select prosrc src from pg_proc where proname = 'cancel_order_coins_atomic'`);
      expect(rows[0]!.src).toContain('Split order cancellation requires separate reviewed handling.');
      await legacy.close();
    }, 120_000);

    it('a retailer cancels their pending split order: children, stock, BOTH debits and the coupon in one call', async () => {
      const f = await splitOrder({ coupon: true });
      expect(await state(f)).toMatchObject({ ...UNTOUCHED, redemptions: 1, couponUsed: 1 });
      expect(await cancel(f.retailer, f)).toBe(50000);
      expect(await state(f)).toMatchObject({ ...FULLY_CANCELLED, redemptions: 0, couponUsed: 0 });
    });

    it('uses one stable idempotency key per child debit', async () => {
      const f = await splitOrder();
      await cancel(f.retailer, f);
      const { rows } = await db.query<{ idempotency_key: string; debit_key: string }>(
        `select c.idempotency_key, d.idempotency_key debit_key from public.retailer_wallet_ledger c
           join public.retailer_wallet_ledger d on d.id = c.reversal_of
          where c.reference_id = $1 and c.transaction_type = 'ORDER_REVERSAL'`, [f.order]);
      expect(rows).toHaveLength(2);
      for (const row of rows) expect(row.idempotency_key).toMatch(/^order-refund-v1:[0-9a-f-]{36}:full$/);
      expect(rows.map((r) => r.debit_key).sort()).toEqual([`order:${f.order}:${f.sellerChild}`, `order:${f.order}:${f.maharaniChild}`].sort());
    });

    it('RETRY: repeating the call (retailer, then admin, then service) credits nothing more', async () => {
      const f = await splitOrder({ coupon: true });
      expect(await cancel(f.retailer, f)).toBe(50000);
      expect(await cancel(f.retailer, f)).toBe(0);
      expect(await cancel(admin, f)).toBe(0);
      expect(await cancel('service', f)).toBe(0);
      expect(await state(f)).toMatchObject({ ...FULLY_CANCELLED, redemptions: 0, couponUsed: 0 });
    });

    it('an admin cancels a confirmed split order; a retailer cannot', async () => {
      const f = await splitOrder({ status: 'confirmed' });
      expect(await cancelError(f.retailer, f)).toMatch(/cannot be cancelled in its current status/);
      expect(await state(f)).toMatchObject({ order: 'confirmed', seller: 'confirmed', reversals: [], outstanding: 50000 });
      expect(await cancel(admin, f)).toBe(50000);
      expect(await state(f)).toMatchObject(FULLY_CANCELLED);
    });

    it('handles a child with no Coins share and a child already refunded by its seller', async () => {
      const zero = await splitOrder({ sellerCoins: 0 });
      expect(await cancel(zero.retailer, zero)).toBe(30000);
      expect(await state(zero)).toMatchObject({ order: 'cancelled', reversals: [30000], outstanding: 0, packStock: 10, offerStock: 10 });

      // The seller cancelled their child earlier (0091 key "seller-child-cancel").
      const f = await splitOrder();
      await db.exec(`set session_replication_role = 'replica'`);
      await db.query(`update public.sub_orders set status = 'cancelled' where id = $1`, [f.sellerChild]);
      await db.query(`update public.order_items set stock_restored_quantity = 2 where sub_order_id = $1`, [f.sellerChild]);
      await db.query(`update public.seller_offers set stock_quantity = 10 where id = $1`, [f.offer]);
      await db.exec(`set session_replication_role = 'origin'`);
      await db.query(
        `select public._append_order_refund($1, (select id from public.retailer_wallet_ledger where idempotency_key = $2), 20000, 'seller-child-cancel', 'Seller cancelled sub-order', $3)`,
        [f.order, `order:${f.order}:${f.sellerChild}`, f.retailer]);
      expect(await cancel(f.retailer, f)).toBe(30000); // only what is still owed
      expect(await state(f)).toMatchObject(FULLY_CANCELLED); // no double refund, no double stock
    });
  });

  describe('PARTIAL FAILURE: any failing part rolls back every part', () => {
    it('a child debit that does not match its checkout share', async () => {
      const f = await splitOrder({ coupon: true });
      await db.exec(`set session_replication_role = 'replica'`);
      await db.query(`update public.retailer_wallet_ledger set amount_paise = 29999 where idempotency_key = $1`, [`order:${f.order}:${f.maharaniChild}`]);
      await db.exec(`set session_replication_role = 'origin'`);
      expect(await cancelError(f.retailer, f)).toMatch(/Split order cancellation requires reconciliation/);
      expect(await state(f)).toMatchObject({ order: 'pending', seller: 'pending', maharani: 'pending', packStock: 7, offerStock: 8, reversals: [], redemptions: 1, couponUsed: 1 });
    });

    it('a missing child debit (second debit absent)', async () => {
      const f = await splitOrder();
      await db.exec(`set session_replication_role = 'replica'`);
      await db.query(`delete from public.retailer_wallet_ledger where idempotency_key = $1`, [`order:${f.order}:${f.sellerChild}`]);
      await db.exec(`set session_replication_role = 'origin'`);
      expect(await cancelError(f.retailer, f)).toMatch(/Split order cancellation requires reconciliation/);
      expect(await state(f)).toMatchObject({ order: 'pending', seller: 'pending', maharani: 'pending', packStock: 7, offerStock: 8, reversals: [] });
    });

    it('stock that cannot be released (seller offer row gone)', async () => {
      const f = await splitOrder();
      await db.exec(`set session_replication_role = 'replica'`);
      await db.query(`update public.order_items set seller_offer_id = $2 where sub_order_id = $1`, [f.sellerChild, randomUUID()]);
      await db.exec(`set session_replication_role = 'origin'`);
      expect(await cancelError(f.retailer, f)).not.toBeNull();
      expect(await state(f)).toMatchObject(UNTOUCHED);
    });

    it('a wallet debit that no sub-order accounts for', async () => {
      const f = await splitOrder();
      await db.query(
        `insert into public.retailer_wallet_ledger (retailer_id, transaction_type, amount_paise, direction, reference_type, reference_id, description, idempotency_key)
         values ($1, 'ORDER_DEBIT', 700, 'debit', 'order', $2, 'stray', $3)`, [f.retailer, f.order, `stray:${f.order}`]);
      expect(await cancelError(f.retailer, f)).toMatch(/Split order cancellation requires reconciliation/);
      expect(await state(f)).toMatchObject({ order: 'pending', seller: 'pending', maharani: 'pending', packStock: 7, offerStock: 8, reversals: [] });
    });

    it('an earlier unlinked credit on the order (ambiguous refund history)', async () => {
      const f = await splitOrder();
      await db.query(
        `insert into public.retailer_wallet_ledger (retailer_id, transaction_type, amount_paise, direction, reference_type, reference_id, description, idempotency_key)
         values ($1, 'ORDER_REVERSAL', 100, 'credit', 'order', $2, 'legacy', $3)`, [f.retailer, f.order, `legacy:${f.order}`]);
      expect(await cancelError(admin, f)).toMatch(/Ambiguous prior order credits/);
      const after = await state(f);
      expect(after).toMatchObject({ order: 'pending', seller: 'pending', maharani: 'pending', packStock: 7, offerStock: 8 });
      expect(after.reversals).toEqual([100]);
    });

    it('a child that has already shipped', async () => {
      const f = await splitOrder({ status: 'confirmed' });
      await db.exec(`set session_replication_role = 'replica'`);
      await db.query(`update public.sub_orders set status = 'shipped' where id = $1`, [f.sellerChild]);
      await db.exec(`set session_replication_role = 'origin'`);
      expect(await cancelError(admin, f)).toMatch(/SPLIT_CANCEL: part of this order is already being fulfilled/);
      expect(await state(f)).toMatchObject({ order: 'confirmed', seller: 'shipped', maharani: 'confirmed', reversals: [], outstanding: 50000 });
    });

    it('a child with money already collected / posted to the seller', async () => {
      const f = await splitOrder();
      await db.exec(`set session_replication_role = 'replica'`);
      await db.query(`insert into public.seller_ledger (seller_id, sub_order_id, entry_type, amount_paise, idempotency_key) values ($1, $2, 'ALLOCATION', 100, $3)`, [randomUUID(), f.sellerChild, `alloc:${f.sellerChild}`]);
      await db.exec(`set session_replication_role = 'origin'`);
      expect(await cancelError(admin, f)).toMatch(/settled sub-order requires administrator reconciliation/);
      expect(await state(f)).toMatchObject(UNTOUCHED);
    });
  });

  describe('who may cancel', () => {
    it('another retailer, delivery staff and anonymous callers are refused and change nothing', async () => {
      const f = await splitOrder();
      const other = (await createRetailer(db)).id;
      expect(await cancelError(other, f)).toMatch(/Access denied/);
      expect(await cancelError(staff, f)).toMatch(/Access denied/);
      expect(await cancelError('anon', f)).toMatch(/permission denied|Authentication required/);
      expect(await state(f)).toMatchObject(UNTOUCHED);
    });
  });

  describe('a cancelled order can only come from the atomic function', () => {
    it('REPRODUCTION: before 0097 a retailer could cancel directly and skip the refund', async () => {
      const f = await splitOrder();
      await db.exec(`alter table public.orders disable trigger trg_guard_direct_order_cancellation`);
      try {
        expect(await errorOf(db, f.retailer, (tx: Tx) => tx.query(`update public.orders set status = 'cancelled' where id = $1`, [f.order]))).toBeNull();
      } finally {
        await db.exec(`alter table public.orders enable trigger trg_guard_direct_order_cancellation`);
      }
      expect(await state(f)).toMatchObject({ order: 'cancelled', reversals: [], outstanding: 50000 }); // cancelled, Coins NOT returned
    });

    it('rejects a direct status write by the retailer, an Admin and the service role', async () => {
      const f = await splitOrder();
      for (const who of [f.retailer, admin, 'service']) {
        expect(await errorOf(db, who, (tx: Tx) => tx.query(`update public.orders set status = 'cancelled' where id = $1`, [f.order])), who).toMatch(/CANCEL_GUARD/);
      }
      expect(await state(f)).toMatchObject(UNTOUCHED);
    });

    it('rejects a direct cancel / return write on a sub-order', async () => {
      const f = await splitOrder();
      for (const who of [f.retailer, staff, admin, 'service']) {
        for (const status of ['cancelled', 'returned']) {
          await errorOf(db, who, (tx: Tx) => tx.query(`update public.sub_orders set status = $2 where id = $1`, [f.sellerChild, status]));
        }
      }
      expect(await errorOf(db, 'service', (tx: Tx) => tx.query(`update public.sub_orders set status = 'cancelled' where id = $1`, [f.sellerChild]))).toMatch(/CANCEL_GUARD/);
      expect(await state(f)).toMatchObject(UNTOUCHED);
    });

    it('other order transitions are unaffected', async () => {
      const f = await splitOrder();
      expect(await errorOf(db, admin, (tx: Tx) => tx.query(`update public.orders set status = 'confirmed' where id = $1`, [f.order]))).toBeNull();
    });
  });

  describe('closing ONE sub-order (admin)', () => {
    it('cancels the child with its stock and its own debit only; the rest of the order is untouched', async () => {
      const f = await splitOrder({ coupon: true });
      const result = await closeChild(admin, f, f.sellerChild);
      expect(result).toMatchObject({ atomic: true, status: 'cancelled', parent_status: 'pending', stock_restored: 2, coins_refunded_paise: 20000 });
      expect(await state(f)).toMatchObject({ order: 'pending', seller: 'cancelled', maharani: 'pending', packStock: 7, offerStock: 10, reversals: [20000], outstanding: 30000, redemptions: 1, couponUsed: 1 });
      const { rows } = await db.query<{ k: string }>(`select idempotency_key k from public.retailer_wallet_ledger where reference_id = $1 and transaction_type = 'ORDER_REVERSAL'`, [f.order]);
      expect(rows[0]!.k).toMatch(/^order-refund-v1:[0-9a-f-]{36}:child-close$/);
    });

    it('RETRY is a no-op, and closing the last child cancels the parent and releases the coupon', async () => {
      const f = await splitOrder({ coupon: true });
      await closeChild(admin, f, f.sellerChild);
      expect(await closeChild(admin, f, f.sellerChild)).toMatchObject({ atomic: true, stock_restored: 0, coins_refunded_paise: 0 });
      expect(await closeChild('service', f, f.maharaniChild)).toMatchObject({ atomic: true, parent_status: 'cancelled', coins_refunded_paise: 30000 });
      expect(await state(f)).toMatchObject({ ...FULLY_CANCELLED, redemptions: 0, couponUsed: 0 });
      // And the whole-order function afterwards finds nothing left to do.
      expect(await cancel(admin, f)).toBe(0);
      expect(await state(f)).toMatchObject(FULLY_CANCELLED);
    });

    it('PARTIAL FAILURE: a Coins problem leaves the child NOT cancelled and its stock NOT released', async () => {
      const f = await splitOrder();
      await db.exec(`set session_replication_role = 'replica'`);
      await db.query(`update public.retailer_wallet_ledger set amount_paise = 19999 where idempotency_key = $1`, [`order:${f.order}:${f.sellerChild}`]);
      await db.exec(`set session_replication_role = 'origin'`);
      expect(await closeError(admin, f, f.sellerChild)).toMatch(/Child debit does not match checkout share/);
      expect(await state(f)).toMatchObject({ order: 'pending', seller: 'pending', maharani: 'pending', packStock: 7, offerStock: 8, reversals: [] });
    });

    it('PARTIAL FAILURE: a stock problem leaves the child NOT cancelled and its Coins NOT returned', async () => {
      const f = await splitOrder();
      await db.exec(`set session_replication_role = 'replica'`);
      await db.query(`update public.order_items set seller_offer_id = $2 where sub_order_id = $1`, [f.sellerChild, randomUUID()]);
      await db.exec(`set session_replication_role = 'origin'`);
      expect(await closeError(admin, f, f.sellerChild)).toMatch(/Seller offer not found while restoring/);
      expect(await state(f)).toMatchObject(UNTOUCHED);
    });

    it('set_sub_order_status(cancelled) is atomic too, so the old three-call client cannot strand a child', async () => {
      const f = await splitOrder();
      await as(db, admin, (tx: Tx) => tx.query(`select public.set_sub_order_status($1, 'cancelled', 'legacy client')`, [f.maharaniChild]));
      expect(await state(f)).toMatchObject({ order: 'pending', maharani: 'cancelled', packStock: 10, offerStock: 8, reversals: [30000], outstanding: 20000 });
    });

    it('REPAIR: a child left cancelled-without-refund by the old code is completed by a retry', async () => {
      const f = await splitOrder();
      await db.exec(`set session_replication_role = 'replica'`);
      await db.query(`update public.sub_orders set status = 'cancelled' where id = $1`, [f.sellerChild]);
      await db.exec(`set session_replication_role = 'origin'`);
      expect(await state(f)).toMatchObject({ seller: 'cancelled', offerStock: 8, reversals: [] });
      expect(await closeChild(admin, f, f.sellerChild)).toMatchObject({ atomic: true, stock_restored: 2, coins_refunded_paise: 20000 });
      expect(await state(f)).toMatchObject({ seller: 'cancelled', offerStock: 10, reversals: [20000], outstanding: 30000 });
    });

    it('refuses a child of another order, and retailer / staff / anonymous callers', async () => {
      const f = await splitOrder();
      const other = await splitOrder();
      expect(await closeError(admin, f, f.sellerChild, other.order)).toMatch(/does not belong to this order/);
      expect(await closeError(f.retailer, f, f.sellerChild)).toMatch(/admin\/server only/);
      expect(await closeError(staff, f, f.sellerChild)).toMatch(/admin\/server only/);
      expect(await closeError('anon', f, f.sellerChild)).toMatch(/permission denied|admin\/server only/);
      for (const helper of [`_close_sub_order_core('${f.sellerChild}', 'cancelled', 'x')`, `_set_sub_order_status_plain('${f.sellerChild}', 'cancelled', 'x')`, `_refund_child_share_remaining('${f.order}', '${f.sellerChild}', 'k', 'x', '${admin}')`]) {
        for (const who of [f.retailer, admin, 'service', 'anon']) {
          expect(await errorOf(db, who, (tx: Tx) => tx.query(`select public.${helper}`)), `${helper} as ${who}`).toMatch(/permission denied/);
        }
      }
      expect(await state(f)).toMatchObject(UNTOUCHED);
    });
  });

  describe('single (non-split) orders keep the 0088 behaviour', () => {
    it('cancels, refunds the one debit and is idempotent', async () => {
      const retailer = (await createRetailer(db)).id;
      const order = randomUUID();
      await db.query(`insert into public.orders (id, order_number, retailer_id, status) values ($1, $2, $3, 'pending')`, [order, `N-${order.slice(0, 13)}`, retailer]);
      await db.query(
        `insert into public.retailer_wallet_ledger (retailer_id, transaction_type, amount_paise, direction, reference_type, reference_id, description, idempotency_key)
         values ($1, 'ORDER_DEBIT', 12345, 'debit', 'order', $2, 'checkout', $3)`, [retailer, order, `order:${order}`]);
      const call = () => as(db, retailer, async (tx: Tx) => Number((await tx.query<{ n: string }>(`select public.cancel_order_coins_atomic($1, 'x') n`, [order])).rows[0]!.n));
      expect(await call()).toBe(12345);
      expect(await call()).toBe(0);
      const { rows } = await db.query<{ n: string }>(`select public.get_retailer_outstanding_paise($1) n`, [retailer]);
      expect(Number(rows[0]!.n)).toBe(0);
    });
  });
});

describe('0097 rollback script', () => {
  it('applies cleanly, restores the 0088 / 0066 bodies and can be re-applied', async () => {
    const fresh = await createMigratedDb();
    await fresh.exec(readFileSync('supabase/rollbacks/0097_atomic_split_order_cancellation.down.sql', 'utf8'));
    const names = async () => (await fresh.query<{ proname: string }>(
      `select proname from pg_proc where proname in ('close_sub_order_atomic','_close_sub_order_core','_set_sub_order_status_plain','_refund_child_share_remaining','guard_direct_order_cancellation','guard_direct_sub_order_closure') order by 1`)).rows.map((r) => r.proname);
    expect(await names()).toEqual([]);
    const { rows } = await fresh.query<{ src: string }>(`select prosrc src from pg_proc where proname = 'cancel_order_coins_atomic'`);
    expect(rows[0]!.src).toContain('Split order cancellation requires separate reviewed handling.');
    const { rows: triggers } = await fresh.query(`select 1 from pg_trigger where tgname in ('trg_guard_direct_order_cancellation','trg_guard_direct_sub_order_closure')`);
    expect(triggers).toHaveLength(0);
    await fresh.exec(readFileSync('supabase/migrations/0097_atomic_split_order_cancellation.sql', 'utf8'));
    expect(await names()).toHaveLength(6);
    await fresh.close();
  }, 120_000);
});
