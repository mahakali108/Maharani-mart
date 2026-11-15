/* PR #126 independent-review fixes on a REAL, disposable PostgreSQL 17 cluster.
 *
 * Why this file exists: PGlite (used by the vitest DB suites) has a single
 * connection, so it cannot prove anything about concurrent sessions. This
 * script starts its own loopback-only temporary cluster, applies every
 * repository migration (0001 - 0099), and then uses SEVERAL connections at
 * once. It accepts no database URL and never connects to a remote or existing
 * database. The cluster directory is deleted on exit.
 *
 * Requires test-only npm packages on NODE_PATH (not project dependencies):
 *   embedded-postgres@17.11.0-beta.19  and  pg
 * Run:  NODE_PATH=<dir>/node_modules node tests/pr126-review-fixes.pg.mjs
 *
 * Auth/Storage platform objects are the repository harness stubs; pg_net and
 * pg_cron are skipped exactly as in the PGlite harness. Roles are switched the
 * way PostgREST does it (SET LOCAL ROLE + request.jwt.claims).
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { randomUUID } from 'node:crypto';
const runtimeRequire = createRequire(import.meta.url);
const { Client } = runtimeRequire('pg');
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MIGRATIONS = path.join(__dirname, '../supabase/migrations');
const ROLLBACKS = path.join(__dirname, '../supabase/rollbacks');
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function main() {
  const EmbeddedPostgres = (await import(pathToFileURL(runtimeRequire.resolve('embedded-postgres')).href)).default;
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'maharani-pr126-pg17-'));
  const port = await new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.on('error', reject).listen(0, '127.0.0.1', () => { const n = probe.address().port; probe.close(() => resolve(n)); });
  });
  const password = randomUUID();
  const config = { host: '127.0.0.1', port, user: 'postgres', password, database: 'postgres' };
  const cluster = new EmbeddedPostgres({ databaseDir: path.join(temp, 'db'), user: 'postgres', password, port,
    postgresFlags: ['-c', 'listen_addresses=127.0.0.1', '-c', 'max_connections=80', '-c', 'deadlock_timeout=200ms'],
    persistent: true, onLog: () => {}, onError: (error) => console.error(String(error)) });
  const clients = [];
  let started = false;
  let passed = 0;
  async function client() { const c = new Client(config); c.on('error', () => {}); await c.connect(); clients.push(c); return c; }
  async function test(name, fn) { await fn(); passed++; console.log(`PASS ${name}`); }

  /** Open a transaction on `c` as `who` (the PostgREST way). */
  async function begin(c, who) {
    await c.query('begin');
    if (who === 'service') {
      await c.query('set local role service_role');
      await c.query(`select set_config('request.jwt.claims', '{"role":"service_role"}', true)`);
    } else if (who === 'anon') {
      await c.query('set local role anon');
      await c.query(`select set_config('request.jwt.claims', '{"role":"anon"}', true)`);
    } else {
      await c.query('set local role authenticated');
      await c.query(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify({ role: 'authenticated', sub: who })]);
    }
  }
  /** One statement as `who` in its own transaction on a fresh connection. Commits on success. */
  async function run(who, sql, params = []) {
    const c = await client();
    try {
      await begin(c, who);
      const result = await c.query(sql, params);
      await c.query('commit');
      return result;
    } catch (error) {
      await c.query('rollback').catch(() => {});
      throw error;
    } finally { await c.end().catch(() => {}); }
  }
  /** Did `who` achieve the effect? Always rolled back. DML needs rowCount > 0. */
  async function allowed(who, sql, params = []) {
    const c = await client();
    try {
      await begin(c, who);
      const result = await c.query(sql, params);
      const dml = /^\s*(update|delete|insert)/i.test(sql);
      return dml ? result.rowCount > 0 : true;
    } catch { return false; } finally { await c.query('rollback').catch(() => {}); await c.end().catch(() => {}); }
  }

  try {
    await cluster.initialise();
    await cluster.start();
    started = true;
    const admin = await client(); // superuser: fixtures and read-back only
    const source = fs.readFileSync(path.join(__dirname, 'helpers/pg-harness.ts'), 'utf8');
    const stub = source.match(/const PLATFORM_STUB = `([\s\S]*?)`;/)?.[1];
    if (!stub) throw new Error('Repository platform stub not found');
    await admin.query(stub);
    const migrations = fs.readdirSync(MIGRATIONS).filter((x) => x.endsWith('.sql')).sort();
    const readMigration = (file) => fs.readFileSync(path.join(MIGRATIONS, file), 'utf8').replace(/create extension if not exists "(pg_net|pg_cron)";/g, '');
    for (const file of migrations) {
      try { await admin.query(readMigration(file)); } catch (error) { throw new Error(`Migration ${file}: ${error.message}`); }
    }
    const version = (await admin.query('show server_version')).rows[0].server_version;
    console.log(`Applied ${migrations.length} repository migrations (${migrations[0].slice(0, 4)} - ${migrations.at(-1).slice(0, 4)}) on PostgreSQL ${version}.`);

    // ------------------------------------------------------------------ fixtures
    const area = (await admin.query(`insert into public.areas (name) values ('PR126 district') returning id`)).rows[0].id;
    const warehouse = (await admin.query(`insert into public.warehouses (name, area_id, is_active) values ('PR126 warehouse', $1, true) returning id`, [area])).rows[0].id;
    let counter = 0;
    async function user(role) {
      counter++;
      const id = randomUUID(), email = `${role}-${id}@test.invalid`;
      const meta = { full_name: `${role} ${counter}`, phone: `91${String(7000000000 + counter)}` };
      if (role !== 'staff' && role !== 'salesman') meta.area_id = area;
      if (role === 'staff' || role === 'salesman') await admin.query('insert into public.staff_account_invites (email, role) values ($1, $2)', [email, role]);
      await admin.query('insert into auth.users (id, email, raw_user_meta_data) values ($1, $2, $3)', [id, email, JSON.stringify(meta)]);
      if (role === 'admin' || role === 'super_admin' || role === 'seller') {
        await admin.query('delete from public.retailers where id = $1', [id]);
        await admin.query('update public.profiles set role = $2 where id = $1', [id, role]);
      }
      if (role === 'retailer') {
        await admin.query(`update public.retailers set status = 'active' where id = $1`, [id]);
        await admin.query('insert into public.retailer_credit_accounts (retailer_id, credit_limit_paise) values ($1, 1000000)', [id]);
      }
      return id;
    }
    const superAdmin = await user('super_admin');
    const adminUser = await user('admin');
    const staff = await user('staff');
    const otherStaff = await user('staff');
    await admin.query('insert into public.staff_assignments (staff_id, warehouse_id) values ($1, $2), ($3, $2)', [staff, warehouse, otherStaff]);
    const product = randomUUID();
    async function replica(fn) {
      await admin.query('begin');
      try { await admin.query(`set local session_replication_role = 'replica'`); const out = await fn(); await admin.query('commit'); return out; }
      catch (error) { await admin.query('rollback'); throw error; }
    }
    await replica(() => admin.query(`insert into public.products (id, sku_code, name, unit, base_price) values ($1, $2, 'PR126 product', 'PCS', 10)`, [product, product]));

    /** Split order: seller child (2 pcs, seller stock 8) + Maharani child (3 pcs, pack stock 7); one debit per child; a coupon. */
    async function splitOrder() {
      const retailer = await user('retailer');
      const order = randomUUID(), pack = randomUUID(), seller = randomUUID(), offer = randomUUID();
      const sellerChild = randomUUID(), maharaniChild = randomUUID(), coupon = randomUUID();
      await admin.query(`insert into public.orders (id, order_number, retailer_id, status) values ($1, $2, $3, 'pending')`, [order, `S-${order}`, retailer]);
      await replica(async () => {
        await admin.query(`insert into public.product_packs (id, product_id, pack_name, pack_sku_code, base_price, case_price, stock_quantity) values ($1, $2, $3, $4, 10, 10, 7)`, [pack, product, `Pack ${pack}`, `SKU-${pack}`]);
        await admin.query(`insert into public.sellers (id, business_name, status) values ($1, $2, 'active')`, [seller, `Seller ${seller}`]);
        await admin.query(`insert into public.seller_offers (id, seller_id, product_id, pack_id, fulfilment_type, unit_price_paise, stock_quantity) values ($1, $2, $3, $4, 'seller', 1000, 8)`, [offer, seller, product, pack]);
        await admin.query(`insert into public.sub_orders (id, parent_order_id, seller_id, fulfilment_type, coins_share_paise) values ($1, $2, $3, 'seller', 20000), ($4, $2, null, 'maharani', 30000)`, [sellerChild, order, seller, maharaniChild]);
        await admin.query(
          `insert into public.order_items (order_id, product_id, pack_id, sub_order_id, seller_offer_id, source_type, fulfilment_type, quantity, unit_price, line_total, stock_deducted_quantity)
           values ($1, $2, $3, $4, $5, 'seller', 'seller', 2, 10, 20, 2), ($1, $2, $3, $6, null, 'maharani', 'maharani', 3, 10, 30, 3)`,
          [order, product, pack, sellerChild, offer, maharaniChild]);
        await admin.query(`insert into public.coupons (id, code, title, discount_type, discount_value, expires_at, used_count) values ($1, $2, 'T', 'fixed', 10, now() + interval '1 day', 1)`, [coupon, `C${coupon}`]);
        await admin.query(`insert into public.coupon_redemptions (coupon_id, retailer_id, order_id, discount_amount) values ($1, $2, $3, 10)`, [coupon, retailer, order]);
      });
      for (const [child, amount] of [[sellerChild, 20000], [maharaniChild, 30000]]) {
        await admin.query(
          `insert into public.retailer_wallet_ledger (retailer_id, transaction_type, amount_paise, direction, reference_type, reference_id, description, idempotency_key)
           values ($1, 'ORDER_DEBIT', $2, 'debit', 'order', $3, 'checkout', $4)`, [retailer, amount, order, `order:${order}:${child}`]);
      }
      return { retailer, order, pack, offer, sellerChild, maharaniChild, coupon };
    }
    async function splitState(f) {
      const q = async (sql, p) => (await admin.query(sql, p)).rows;
      return {
        order: (await q('select status::text s from public.orders where id = $1', [f.order]))[0].s,
        children: (await q('select status from public.sub_orders where parent_order_id = $1 order by status', [f.order])).map((r) => r.status).join(','),
        packStock: (await q('select stock_quantity n from public.product_packs where id = $1', [f.pack]))[0].n,
        offerStock: (await q('select stock_quantity n from public.seller_offers where id = $1', [f.offer]))[0].n,
        reversals: (await q(`select amount_paise n from public.retailer_wallet_ledger where reference_id = $1 and transaction_type = 'ORDER_REVERSAL' order by amount_paise`, [f.order])).map((r) => Number(r.n)),
        outstanding: Number((await q('select public.get_retailer_outstanding_paise($1) n', [f.retailer]))[0].n),
        redemptions: (await q('select 1 from public.coupon_redemptions where order_id = $1', [f.order])).length,
        couponUsed: (await q('select used_count n from public.coupons where id = $1', [f.coupon]))[0].n,
      };
    }
    const DONE = { order: 'cancelled', children: 'cancelled,cancelled', packStock: 10, offerStock: 10, reversals: [20000, 30000], outstanding: 0, redemptions: 0, couponUsed: 0 };
    const UNTOUCHED = { order: 'pending', children: 'pending,pending', packStock: 7, offerStock: 8, reversals: [], outstanding: 50000, redemptions: 1, couponUsed: 1 };
    const CANCEL = 'select public.cancel_order_coins_atomic($1, $2) n';
    const CLOSE = `select public.close_sub_order_atomic($1, $2, 'cancelled', 'pg test') r`;
    async function isWaitingOnLock(c) {
      const pid = c.processID;
      const { rows } = await admin.query(`select wait_event_type from pg_stat_activity where pid = $1`, [pid]);
      return rows[0]?.wait_event_type === 'Lock';
    }

    // ============================================================ FIX 2: CONCURRENCY
    await test('split cancel: a second session WAITS for the first, then credits nothing (no double refund)', async () => {
      const f = await splitOrder();
      const a = await client(), b = await client();
      await begin(a, f.retailer);
      assert.equal(Number((await a.query(CANCEL, [f.order, 'first'])).rows[0].n), 50000); // not committed yet
      await begin(b, adminUser);
      let settled = false;
      const second = b.query(CANCEL, [f.order, 'second']).then((r) => { settled = true; return r; });
      await sleep(600);
      assert.equal(settled, false, 'second session must be blocked while the first is uncommitted');
      assert.equal(await isWaitingOnLock(b), true, 'second session is waiting on a row lock');
      assert.deepEqual(await splitState(f), UNTOUCHED, 'nothing is visible before commit');
      await a.query('commit');
      assert.equal(Number((await second).rows[0].n), 0);
      await b.query('commit');
      assert.deepEqual(await splitState(f), DONE);
    });

    await test('split cancel: the first session ROLLS BACK, the waiting session then performs the whole refund', async () => {
      const f = await splitOrder();
      const a = await client(), b = await client();
      await begin(a, f.retailer);
      await a.query(CANCEL, [f.order, 'first']);
      await begin(b, 'service');
      const second = b.query(CANCEL, [f.order, 'second']);
      await sleep(400);
      assert.equal(await isWaitingOnLock(b), true);
      await a.query('rollback'); // e.g. the first request died
      assert.equal(Number((await second).rows[0].n), 50000);
      await b.query('commit');
      assert.deepEqual(await splitState(f), DONE);
    });

    await test('split cancel: 16 simultaneous sessions (retailer, admin, service) refund exactly once', async () => {
      const f = await splitOrder();
      const callers = Array.from({ length: 16 }, (_, i) => [f.retailer, adminUser, 'service', superAdmin][i % 4]);
      const results = await Promise.allSettled(callers.map((who) => run(who, CANCEL, [f.order, 'burst'])));
      const failures = results.filter((r) => r.status === 'rejected').map((r) => r.reason.message);
      assert.deepEqual(failures, [], 'no session may fail or deadlock');
      const amounts = results.map((r) => Number(r.value.rows[0].n)).sort((x, y) => x - y);
      assert.equal(amounts.filter((n) => n === 50000).length, 1, 'exactly one session performs the refund');
      assert.equal(amounts.filter((n) => n === 0).length, 15);
      assert.deepEqual(await splitState(f), DONE);
    });

    await test('opposite entry points at once (whole order, child A, child B, legacy status RPC): no deadlock, exact totals - 25 rounds', async () => {
      const codes = new Set();
      for (let round = 0; round < 25; round++) {
        const f = await splitOrder();
        const jobs = [
          run(f.retailer, CANCEL, [f.order, 'retailer']),
          run(adminUser, CLOSE, [f.order, f.sellerChild]),
          run('service', CLOSE, [f.order, f.maharaniChild]),
          run(superAdmin, `select public.set_sub_order_status($1, 'cancelled', 'legacy client')`, [f.maharaniChild]),
          run(adminUser, CANCEL, [f.order, 'admin']),
          run('service', CLOSE, [f.order, f.sellerChild]),
        ];
        // Shuffle start order so each round interleaves differently.
        const results = await Promise.allSettled(jobs.sort(() => Math.random() - 0.5));
        for (const r of results) if (r.status === 'rejected') codes.add(`${r.reason.code}: ${r.reason.message}`);
        assert.deepEqual(await splitState(f), DONE, `round ${round}`);
      }
      assert.deepEqual([...codes], [], 'no deadlock (40P01), serialization or other error in any round');
    });

    await test('two admins close the two children at the same moment: parent cancelled once, coupon released once', async () => {
      for (let round = 0; round < 10; round++) {
        const f = await splitOrder();
        const [x, y] = await Promise.all([run(adminUser, CLOSE, [f.order, f.sellerChild]), run(superAdmin, CLOSE, [f.order, f.maharaniChild])]);
        assert.equal(x.rows[0].r.coins_refunded_paise, 20000);
        assert.equal(y.rows[0].r.coins_refunded_paise, 30000);
        assert.deepEqual(await splitState(f), DONE, `round ${round}`);
      }
    });

    await test('partial failure under concurrency: a failing session changes nothing and does not poison the next one', async () => {
      const f = await splitOrder();
      // Make the seller child impossible to release (offer row unreachable).
      const realOffer = (await admin.query('select seller_offer_id id from public.order_items where sub_order_id = $1', [f.sellerChild])).rows[0].id;
      await replica(() => admin.query('update public.order_items set seller_offer_id = $2 where sub_order_id = $1', [f.sellerChild, randomUUID()]));
      const results = await Promise.allSettled(Array.from({ length: 6 }, (_, i) => run(i % 2 ? adminUser : f.retailer, CANCEL, [f.order, 'will fail'])));
      assert.equal(results.every((r) => r.status === 'rejected'), true);
      assert.deepEqual(await splitState(f), UNTOUCHED, 'no status, stock, Coins or coupon change survived');
      await replica(() => admin.query('update public.order_items set seller_offer_id = $2 where sub_order_id = $1', [f.sellerChild, realOffer]));
      assert.equal(Number((await run(f.retailer, CANCEL, [f.order, 'retry'])).rows[0].n), 50000);
      assert.deepEqual(await splitState(f), DONE);
    });

    // Rewritten in the final-completion pass. The earlier version fired the three
    // statements with Promise.allSettled and required BOTH direct writes to be
    // refused. That was a race in the TEST: when the atomic call commits first,
    // a direct write that was waiting on the row lock re-reads the row, finds it
    // already cancelled and is a harmless no-op (no status change, so nothing to
    // refuse). The three orderings are now forced one by one, and each asserts
    // the stronger thing: the ledger, stock and coupon state.
    const DIRECT = `update public.orders set status = 'cancelled' where id = $1`;
    await test('direct status write BEFORE the atomic call: refused, nothing changes; the atomic call then completes', async () => {
      const f = await splitOrder();
      for (const who of [f.retailer, adminUser, 'service']) {
        await assert.rejects(run(who, DIRECT, [f.order]), /CANCEL_GUARD/);
      }
      assert.deepEqual(await splitState(f), UNTOUCHED);
      assert.equal(Number((await run(f.retailer, CANCEL, [f.order, 'atomic'])).rows[0].n), 50000);
      assert.deepEqual(await splitState(f), DONE);
    });

    await test('direct status writes WAITING on an uncommitted atomic call: after commit they change nothing (one refund only)', async () => {
      const f = await splitOrder();
      const a = await client(), b = await client();
      await begin(a, f.retailer);
      assert.equal(Number((await a.query(CANCEL, [f.order, 'atomic'])).rows[0].n), 50000); // holds the row locks
      await begin(b, adminUser);
      const waiting = b.query(DIRECT, [f.order]).then(() => null, (e) => e);
      await sleep(500);
      assert.equal(await isWaitingOnLock(b), true, 'the Admin direct write waits for the atomic call');
      assert.deepEqual(await splitState(f), UNTOUCHED, 'nothing is visible before commit');
      await a.query('commit');
      // Either refused, or a no-op on an order that is already cancelled.
      const error = await waiting;
      if (error) assert.match(error.message, /CANCEL_GUARD/);
      await b.query(error ? 'rollback' : 'commit');
      assert.deepEqual(await splitState(f), DONE);
      // Later direct writes by anyone change nothing either.
      for (const who of [f.retailer, adminUser, 'service']) {
        await run(who, DIRECT, [f.order]).catch((e) => assert.match(e.message, /CANCEL_GUARD|row-level security|permission denied/));
      }
      assert.deepEqual(await splitState(f), DONE, 'exactly one refund, one stock release, one coupon release');
    });

    await test('direct status write WAITING on an atomic call that ROLLS BACK: refused, nothing changes', async () => {
      const f = await splitOrder();
      const a = await client(), b = await client();
      await begin(a, f.retailer);
      await a.query(CANCEL, [f.order, 'atomic']);
      await begin(b, adminUser);
      const direct = b.query(DIRECT, [f.order]).then(() => null, (e) => e);
      await sleep(400);
      assert.equal(await isWaitingOnLock(b), true);
      await a.query('rollback');
      const error = await direct;
      assert.match(error?.message ?? '', /CANCEL_GUARD/, 'with the order still pending the direct write must be refused');
      await b.query('rollback');
      assert.deepEqual(await splitState(f), UNTOUCHED);
    });

    // ============================================================ FIX 1: DELIVERY SNAPSHOT
    async function dispatched(lines = [[1000, 10]]) {
      const retailer = await user('retailer');
      const order = randomUUID();
      const total = lines.reduce((sum, [value]) => sum + value, 0);
      await admin.query(`insert into public.orders (id, order_number, retailer_id, status, subtotal, gst_total, discount_total, grand_total, warehouse_id) values ($1, $2, $3, 'pending', $4, 0, 0, $4, $5)`, [order, `D-${order}`, retailer, total, warehouse]);
      const items = [];
      await replica(async () => {
        for (const [value, pieces] of lines) {
          items.push((await admin.query(`insert into public.order_items (order_id, product_id, quantity, unit_price, gst_percent, line_total) values ($1, $2, $3, $4, 0, $5) returning id`, [order, product, pieces, value / pieces, value])).rows[0].id);
        }
      });
      for (const status of ['confirmed', 'processing', 'packed', 'dispatched']) await admin.query('update public.orders set status = $2 where id = $1', [order, status]);
      const delivery = (await admin.query(`insert into public.order_deliveries (order_id, delivery_status, assigned_staff_id, assigned_by, assigned_at, otp_hash) values ($1, 'assigned', $2, $3, now(), 'keyed-hash') returning id`, [order, staff, adminUser])).rows[0].id;
      for (let i = 0; i < items.length; i++) await admin.query('insert into public.order_delivery_items (delivery_id, order_item_id, quantity_ordered) values ($1, $2, $3)', [delivery, items[i], lines[i][1]]);
      return { retailer, order, delivery, items };
    }
    const line = async (item) => (await admin.query('select delivery_id, order_item_id, quantity_ordered, quantity_delivered, quantity_missing, quantity_damaged from public.order_delivery_items where order_item_id = $1', [item])).rows[0];

    await test('snapshot: assigned staff cannot rewrite quantity_ordered / order_item_id / delivery_id, delete or forge a line', async () => {
      const mine = await dispatched([[1000, 10]]), other = await dispatched([[9000, 10]]);
      const before = await line(mine.items[0]);
      for (const [sql, params, pattern] of [
        ['update public.order_delivery_items set quantity_ordered = 1 where order_item_id = $1', [mine.items[0]], /is immutable/],
        ['update public.order_delivery_items set quantity_ordered = 100, quantity_missing = 100 where order_item_id = $1', [mine.items[0]], /is immutable/],
        ['update public.order_delivery_items set order_item_id = $2 where order_item_id = $1', [mine.items[0], other.items[0]], /is immutable/],
        ['update public.order_delivery_items set delivery_id = $2 where order_item_id = $1', [mine.items[0], other.delivery], /is immutable/],
        ['delete from public.order_delivery_items where order_item_id = $1', [mine.items[0]], /cannot be removed/],
      ]) {
        await assert.rejects(run(staff, sql, params), pattern, sql);
      }
      await admin.query('delete from public.order_delivery_items where order_item_id = $1', [other.items[0]]);
      await assert.rejects(run(staff, 'insert into public.order_delivery_items (delivery_id, order_item_id, quantity_ordered) values ($1, $2, 10)', [mine.delivery, other.items[0]]), /does not belong to this delivery's order/);
      assert.deepEqual(await line(mine.items[0]), before);
    });

    // Lock-order correction (0096, 15 Nov 2026): the line guard no longer WAITS
    // for the delivery row while holding a line lock (child -> parent), it asks
    // with NOWAIT. So the write is refused at once instead of after a wait. The
    // protected outcome is unchanged and asserted below: the write never lands.
    await test('snapshot race: completion holds the delivery; a concurrent staff quantity write is REFUSED AT ONCE (never waits child -> parent) and again after commit', async () => {
      const d = await dispatched([[1000, 10]]);
      await run(staff, 'update public.order_delivery_items set quantity_delivered = 10 where order_item_id = $1', [d.items[0]]);
      const completer = await client(), racer = await client();
      await begin(completer, 'service');
      await completer.query(`update public.order_deliveries set delivery_status = 'delivered', otp_verified_at = now(), completed_by = $2 where id = $1`, [d.delivery, staff]);
      await begin(racer, staff);
      const late = racer.query('update public.order_delivery_items set quantity_delivered = 0, quantity_missing = 10 where order_item_id = $1', [d.items[0]]);
      late.catch(() => {});
      await sleep(500);
      assert.equal(await isWaitingOnLock(racer), false, 'the staff write does not wait for the delivery row while holding the line row');
      await assert.rejects(late, (error) => error.code === '55P03' && /DELIVERY_GUARD:BUSY/.test(error.message));
      await racer.query('rollback');
      await completer.query('commit');
      await assert.rejects(run(staff, 'update public.order_delivery_items set quantity_delivered = 0, quantity_missing = 10 where order_item_id = $1', [d.items[0]]), /locked after completion|final once the delivery is completed/);
      await begin(racer, staff);
      await racer.query('rollback');
      assert.deepEqual(await line(d.items[0]), { delivery_id: d.delivery, order_item_id: d.items[0], quantity_ordered: 10, quantity_delivered: 10, quantity_missing: 0, quantity_damaged: 0 });
      assert.equal(Number((await admin.query('select public.delivery_shortfall_paise($1) n', [d.delivery])).rows[0].n), 0, 'no shortfall refund can be manufactured after completion');
    });

    await test('snapshot race: a staff quantity write in flight makes completion WAIT, and completion then re-checks the committed quantities', async () => {
      const d = await dispatched([[1000, 10]]);
      await run(staff, 'update public.order_delivery_items set quantity_delivered = 10 where order_item_id = $1', [d.items[0]]);
      const racer = await client(), completer = await client();
      await begin(racer, staff);
      await racer.query('update public.order_delivery_items set quantity_delivered = 7, quantity_missing = 3 where order_item_id = $1', [d.items[0]]);
      await begin(completer, 'service');
      const completion = completer.query(`update public.order_deliveries set delivery_status = 'delivered', otp_verified_at = now(), completed_by = $2 where id = $1`, [d.delivery, staff]);
      completion.catch(() => {});
      await sleep(500);
      assert.equal(await isWaitingOnLock(completer), true);
      await racer.query('commit');
      await assert.rejects(completion, /must be recorded as partially delivered/);
      await completer.query('rollback');
      assert.equal((await admin.query('select delivery_status::text s from public.order_deliveries where id = $1', [d.delivery])).rows[0].s, 'assigned');
    });

    await test('snapshot: refund and loyalty use the original order quantity end to end (Rs 1,000 / 10 pcs, 2 missing -> Rs 200 and 8 points)', async () => {
      const d = await dispatched([[1000, 10]]);
      await run(staff, 'update public.order_delivery_items set quantity_delivered = 8, quantity_missing = 2 where order_item_id = $1', [d.items[0]]);
      const c = await client();
      await begin(c, 'service');
      await c.query(`update public.order_deliveries set delivery_status = 'partially_delivered', otp_verified_at = now(), completed_by = $2 where id = $1`, [d.delivery, staff]);
      await c.query(`select public.order_shortfall_coins($1, 99999999, 'shortfall', $2, false)`, [d.delivery, staff]);
      await c.query(`update public.orders set status = 'delivered' where id = $1`, [d.order]);
      await c.query('commit');
      const credit = (await admin.query(`select amount_paise n from public.retailer_wallet_ledger where reference_type = 'delivery' and reference_id = $1`, [d.delivery])).rows.map((r) => Number(r.n));
      assert.deepEqual(credit, [20000]);
      const points = (await admin.query(`select points from public.loyalty_ledger where reference_id = $1 and entry_type = 'ORDER_EARN'`, [d.order])).rows.map((r) => r.points);
      assert.deepEqual(points, [8]);
    });

    // ============================================================ FIX 3: SELLER GATE
    await test('marketplace switch: two Super Admin sessions are serialised; the later decision wins; history keeps both', async () => {
      const second = await user('super_admin');
      const a = await client(), b = await client();
      await begin(a, superAdmin);
      await a.query(`select public.record_marketplace_launch_approval(true, 'OWNER-REF-A', 'CA-REF-A', 'open')`);
      await begin(b, second);
      const off = b.query(`select public.record_marketplace_launch_approval(false, null, null, 'close')`);
      await sleep(400);
      assert.equal(await isWaitingOnLock(b), true);
      await a.query('commit');
      await off; await b.query('commit');
      assert.equal((await admin.query('select public.third_party_offers_enabled() v')).rows[0].v, false);
      assert.equal((await admin.query('select count(*)::int n from public.marketplace_launch_approvals')).rows[0].n, 2);
    });

    await test('seller gate holds for every role on real PostgreSQL (switch off, then on without acceptance, then accepted)', async () => {
      const seller = randomUUID(), owner = await user('seller'), pack = randomUUID(), offer = randomUUID();
      await replica(async () => {
        await admin.query(`insert into public.sellers (id, business_name, status) values ($1, $2, 'active')`, [seller, `Gate ${seller}`]);
        await admin.query(`insert into public.seller_members (seller_id, profile_id, member_role) values ($1, $2, 'owner')`, [seller, owner]);
        await admin.query(`insert into public.product_packs (id, product_id, pack_name, pack_sku_code, base_price, case_price, stock_quantity) values ($1, $2, $3, $4, 10, 10, 7)`, [pack, product, `Pack ${pack}`, `SKU-${pack}`]);
        await admin.query(`insert into public.seller_offers (id, seller_id, product_id, pack_id, fulfilment_type, unit_price_paise, stock_quantity, is_active, moderation_status) values ($1, $2, $3, $4, 'seller', 1000, 5, false, 'pending')`, [offer, seller, product, pack]);
      });
      // Compliance (0086) is a separate gate; switch it off so the refusal below can only be 0098's.
      await admin.query(`alter table public.seller_offers disable trigger trg_compliance_seller_offer`);
      const activate = (who) => run(who, 'update public.seller_offers set is_active = true where id = $1', [offer]);
      for (const who of [owner, adminUser, superAdmin, 'service']) await assert.rejects(activate(who), /MARKETPLACE_NOT_OPEN/, `switch off, ${who}`);
      await run(superAdmin, `select public.record_marketplace_launch_approval(true, 'OWNER-REF-B', 'CA-REF-B', 'open')`);
      for (const who of [owner, adminUser, superAdmin, 'service']) await assert.rejects(activate(who), /SELLER_AGREEMENT_REQUIRED/, `no acceptance, ${who}`);
      await assert.rejects(run(owner, `select public.record_legal_acceptance('seller-agreement', '0.1', 'seller_onboarding')`), /LEGAL_VERSION_NOT_CURRENT/);
      await run(owner, `select public.record_legal_acceptance('seller-agreement', (select document_version from public.legal_document_current_versions where document_key = 'seller-agreement'), 'seller_onboarding')`);
      await activate(owner);
      await run(adminUser, `update public.seller_offers set moderation_status = 'approved', moderation_by = $2, moderated_at = now() where id = $1`, [offer, adminUser]);
      assert.deepEqual((await admin.query('select is_active, moderation_status from public.seller_offers where id = $1', [offer])).rows[0], { is_active: true, moderation_status: 'approved' });
      await run(superAdmin, `select public.record_marketplace_launch_approval(false, null, null, 'close again')`);
      await admin.query(`alter table public.seller_offers enable trigger trg_compliance_seller_offer`);
    });

    // ============================================================ ROLE / PERMISSION MATRIX
    await test('permission matrix: anonymous, retailer, other retailer, delivery staff, other staff, admin, super-admin, service role', async () => {
      const split = await splitOrder();
      const d = await dispatched([[1000, 10]]);
      await run(staff, 'update public.order_delivery_items set quantity_delivered = 10 where order_item_id = $1', [d.items[0]]);
      const otherRetailer = await user('retailer');
      const ticket = (await admin.query(`insert into public.support_tickets (ticket_number, retailer_id, subject, topic) values ($1, $2, 'Grievance about my order delivery', 'grievance') returning id`, [`T-${randomUUID()}`, split.retailer])).rows[0].id;
      const who = { anon: 'anon', retailer: split.retailer, otherRetailer, staff, otherStaff, admin: adminUser, superAdmin, service: 'service' };
      const order = ['anon', 'retailer', 'otherRetailer', 'staff', 'otherStaff', 'admin', 'superAdmin', 'service'];
      // Y = must succeed, n = must be refused / have no effect, - = not asserted.
      const matrix = [
        // --- Fix 1: delivery snapshot (retailer column = the retailer of THAT delivery is `otherRetailer`-like: a retailer never writes lines)
        ['snapshot: change quantity_ordered',            'nnnnnnnn', 'update public.order_delivery_items set quantity_ordered = 3 where order_item_id = $1', [d.items[0]]],
        ['snapshot: re-point order_item_id',             'nnnnnnnn', 'update public.order_delivery_items set order_item_id = $2 where order_item_id = $1', [d.items[0], randomUUID()]],
        ['snapshot: record delivered/missing/damaged',   'nnnYnYYY', 'update public.order_delivery_items set quantity_delivered = 9, quantity_damaged = 1 where order_item_id = $1', [d.items[0]]],
        ['snapshot: delete a line',                      'nnnnn---', 'delete from public.order_delivery_items where order_item_id = $1', [d.items[0]]],
        ['delivery: mark delivered directly (0094)',     'nnnnnYYY', `update public.order_deliveries set delivery_status = 'delivered', otp_verified_at = now() where id = $1`, [d.delivery]],
        ['delivery: read shortfall helper',              'nnnnnnnY', 'select public.delivery_shortfall_paise($1)', [d.delivery]],
        ['loyalty: mint points (0094)',                  'nnnnnYYY', `select public.record_loyalty_points($1, 50, 'MANUAL_CREDIT', 'matrix', null, null, $2)`, [split.retailer, `matrix-${randomUUID()}`]],
        // --- Fix 2: cancellation
        ['cancel: atomic whole-order cancel',            'nYnnnYYY', CANCEL, [split.order, 'matrix']],
        ['cancel: close one sub-order',                  'nnnnnYYY', CLOSE, [split.order, split.sellerChild]],
        ['cancel: legacy set_sub_order_status(cancelled)', 'nnnnnYYY', `select public.set_sub_order_status($1, 'cancelled', 'matrix')`, [split.sellerChild]],
        ['cancel: direct orders.status = cancelled',     'nnnnnnnn', `update public.orders set status = 'cancelled' where id = $1`, [split.order]],
        ['cancel: direct sub_orders.status = cancelled', 'nnnnnnnn', `update public.sub_orders set status = 'cancelled' where id = $1`, [split.sellerChild]],
        ['cancel: private core helper',                  'nnnnnnnn', `select public._close_sub_order_core($1, 'cancelled', 'x')`, [split.sellerChild]],
        ['cancel: private refund helper',                'nnnnnnnn', `select public._append_order_refund($1, $2, 1, 'k', 'x', $3)`, [split.order, randomUUID(), split.retailer]],
        // --- Fix 3: seller agreement / marketplace
        ['market: turn third-party offers on',           'nnnnnnYn', `select public.record_marketplace_launch_approval(true, 'OWNER-REF-M', 'CA-REF-M', 'matrix')`, []],
        ['market: write approval log directly',          'nnnnnnnn', `insert into public.marketplace_launch_approvals (third_party_offers_enabled, recorded_by) values (false, $1)`, [superAdmin]],
        ['market: publish a document version',           'nnnnnnYn', `select public.publish_legal_document_version('seller-agreement', '3.0')`, []],
        ['market: change current version directly',      'nnnnnnn-', `update public.legal_document_current_versions set document_version = '7.0' where document_key = 'seller-agreement'`, []],
        ['market: read the switch',                      'nnnnnnnY', 'select public.third_party_offers_enabled()', []],
        ['market: internal agreement predicate',         'nnnnnnnY', 'select public.seller_agreement_is_current($1)', [randomUUID()]],
        // --- 0095: acceptance, privacy, grievance
        ['legal: accept current Terms for myself',       'nYYYYYYn', `select public.record_legal_acceptance('terms', '1.0', 'account')`, []],
        ['legal: write an acceptance row directly',      'nnnnnnn-', `insert into public.legal_document_acceptances (user_id, document_key, document_version) values ($1, 'terms', '1.0')`, [split.retailer]],
        ['privacy: file a data-correction request (own)', 'nYnnn---', `insert into public.retailer_account_requests (retailer_id, request_type, note) values ($1, 'data_correction', 'fix my shop name')`, [split.retailer]],
        ['privacy: file a consent-withdrawal request (own)', 'nYnnn---', `insert into public.retailer_account_requests (retailer_id, request_type) values ($1, 'consent_withdrawal')`, [split.retailer]],
        ['grievance: forge acknowledged_at on a ticket', 'nnnnn---', 'update public.support_tickets set acknowledged_at = now() where id = $1', [ticket]],
      ];
      const failures = [];
      const table = [];
      for (const [name, expected, sql, params] of matrix) {
        let actual = '';
        for (let i = 0; i < order.length; i++) {
          const ok = await allowed(who[order[i]], sql, params);
          const want = expected[i];
          actual += want === '-' ? (ok ? 'y' : '.') : (ok ? 'Y' : 'n');
          if (want !== '-' && (want === 'Y') !== ok) failures.push(`${name}: ${order[i]} expected ${want === 'Y' ? 'ALLOW' : 'DENY'} got ${ok ? 'ALLOW' : 'DENY'}`);
        }
        table.push(`  ${actual}  ${name}`);
      }
      console.log(`  columns: ${order.join(', ')}  (Y allowed, n refused; y/. = observed, not asserted)`);
      console.log(table.join('\n'));
      assert.deepEqual(failures, []);
    });

    // ============================================================ CATALOGUE HYGIENE
    await test('new objects: no anon EXECUTE, fixed search_path, RLS on new tables', async () => {
      const names = ['guard_order_delivery_item_snapshot', 'guard_order_delivery_completion_lines', 'delivery_shortfall_paise',
        '_refund_child_share_remaining', '_set_sub_order_status_plain', '_close_sub_order_core', 'close_sub_order_atomic', 'set_sub_order_status',
        'cancel_order_coins_atomic', 'guard_direct_order_cancellation', 'guard_direct_sub_order_closure', 'remoderate_seller_offer_terms',
        'publish_legal_document_version', 'record_legal_acceptance', 'third_party_offers_enabled', 'record_marketplace_launch_approval',
        'seller_agreement_is_current', 'seller_offer_gate_status', 'enforce_seller_offer_launch_gate', 'enforce_order_item_marketplace_gate'];
      const { rows } = await admin.query(
        `select p.proname, has_function_privilege('anon', p.oid, 'execute') anon_exec,
                coalesce(array_to_string(p.proconfig, ','), '') config
           from pg_proc p join pg_namespace n on n.oid = p.pronamespace
          where n.nspname = 'public' and p.proname = any($1)`, [names]);
      assert.equal(new Set(rows.map((r) => r.proname)).size, names.length, 'every function exists');
      assert.deepEqual(rows.filter((r) => r.anon_exec).map((r) => r.proname), [], 'anon can execute none of them');
      assert.deepEqual(rows.filter((r) => !/search_path=/.test(r.config)).map((r) => r.proname), [], 'all pin search_path');
      const tables = (await admin.query(`select relname, relrowsecurity from pg_class where relnamespace = 'public'::regnamespace and relname in ('legal_document_current_versions','marketplace_launch_approvals','legal_document_acceptances')`)).rows;
      assert.equal(tables.length, 3);
      assert.equal(tables.every((t) => t.relrowsecurity), true);
    });

    // ============================================================ ROLLBACK SAFETY
    await test('rollback safety: 0098 -> 0094 roll back in order on a database WITH data, then 0094 -> 0098 re-apply', async () => {
      const before = {
        orders: (await admin.query('select count(*)::int n from public.orders')).rows[0].n,
        ledger: (await admin.query('select count(*)::int n, coalesce(sum(amount_paise),0)::bigint s from public.retailer_wallet_ledger')).rows[0],
        lines: (await admin.query('select count(*)::int n from public.order_delivery_items')).rows[0].n,
        approvals: (await admin.query('select count(*)::int n from public.marketplace_launch_approvals')).rows[0].n,
      };
      const review = ['0099_atomic_delivery_completion', '0098_seller_agreement_and_marketplace_gate', '0097_atomic_split_order_cancellation', '0096_delivery_snapshot_integrity', '0095_legal_acceptance_and_privacy_requests', '0094_delivery_trust_and_loyalty_integrity'];
      // 0095's rollback refuses while rows use the new request types / topics; clear the test rows it would trip on.
      await admin.query(`delete from public.support_tickets where topic in ('grievance', 'privacy')`);
      await admin.query(`delete from public.retailer_account_requests where request_type in ('data_correction', 'consent_withdrawal')`);
      for (const name of review) {
        try { await admin.query(fs.readFileSync(path.join(ROLLBACKS, `${name}.down.sql`), 'utf8')); }
        catch (error) { await admin.query('rollback').catch(() => {}); throw new Error(`Rollback ${name}: ${error.message}`); }
      }
      const gone = (await admin.query(`select proname from pg_proc where pronamespace = 'public'::regnamespace and proname in ('is_untrusted_api_caller','record_legal_acceptance','close_sub_order_atomic','third_party_offers_enabled','guard_order_delivery_item_snapshot','guard_direct_order_cancellation')`)).rows;
      assert.deepEqual(gone, []);
      assert.match((await admin.query(`select prosrc s from pg_proc where proname = 'cancel_order_coins_atomic'`)).rows[0].s, /Split order cancellation requires separate reviewed handling/);
      assert.equal((await admin.query('select count(*)::int n from public.marketplace_launch_approvals_rollback_archive')).rows[0].n, before.approvals, 'approval evidence is archived, not lost');
      // Business data is untouched by the rollbacks.
      assert.equal((await admin.query('select count(*)::int n from public.orders')).rows[0].n, before.orders);
      assert.deepEqual((await admin.query('select count(*)::int n, coalesce(sum(amount_paise),0)::bigint s from public.retailer_wallet_ledger')).rows[0], before.ledger);
      assert.equal((await admin.query('select count(*)::int n from public.order_delivery_items')).rows[0].n, before.lines);
      // Forward again.
      for (const name of [...review].reverse()) {
        try { await admin.query(readMigration(`${name}.sql`)); } catch (error) { throw new Error(`Re-apply ${name}: ${error.message}`); }
      }
      assert.equal((await admin.query('select public.third_party_offers_enabled() v')).rows[0].v, false, 're-applied with the marketplace CLOSED');
      const f = await splitOrder();
      assert.equal(Number((await run(f.retailer, CANCEL, [f.order, 'after re-apply'])).rows[0].n), 50000);
      assert.deepEqual(await splitState(f), DONE);
    });

    console.log(`PR #126 real PostgreSQL ${version}: ${passed} passed, 0 failed.`);
  } finally {
    for (const c of clients) await c.end().catch(() => {});
    if (started) await cluster.stop();
    fs.rmSync(temp, { recursive: true, force: true });
  }
}
main().catch((error) => { console.error(error.stack || error); process.exitCode = 1; });
