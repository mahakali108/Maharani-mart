/* PR #126 atomic return-request approval / rejection (0101) on a REAL,
 * disposable PostgreSQL 17 cluster, with SEVERAL sessions at once.
 *
 * What is proven here:
 *   - the whole lifecycle: a retailer session submits a request, an Admin
 *     approves or rejects it through the service-role function;
 *   - approval restores stock exactly once under repeats and under 16
 *     simultaneous calls, and never moves Coins or loyalty points;
 *   - an injected failure at ANY write (stock, restored counter, request
 *     status, history row) rolls everything back - stock can never be restored
 *     without the committed "approved" state, and the retry then works once;
 *   - the old two-step route is closed: no API role can call
 *     return_order_stock or flip a request with a plain UPDATE;
 *   - rejection never touches stock or money; approve and reject racing each
 *     other end in exactly one resolution;
 *   - shortfall-credit returns, seller-fulfilled lines, already-returned
 *     orders and invalid quantities are refused before any write;
 *   - partial (per-line) returns, split orders and pre-0054 legacy orders;
 *   - a final sweep: every stock unit restored by a return request is matched
 *     by exactly one history row, and no return request wrote to the wallet.
 *
 * It starts its own loopback-only temporary cluster, applies every repository
 * migration, accepts no database URL and never connects to a remote or
 * existing database. The cluster directory is deleted on exit.
 *
 * Requires test-only npm packages on NODE_PATH (not project dependencies):
 *   embedded-postgres@17.11.0-beta.19  and  pg
 * Run:  NODE_PATH=<dir>/node_modules node tests/pr126-return-requests.pg.mjs
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createHash, randomUUID } from 'node:crypto';
const runtimeRequire = createRequire(import.meta.url);
const { Client } = runtimeRequire('pg');
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MIGRATIONS = path.join(__dirname, '../supabase/migrations');
const ROLLBACKS = path.join(__dirname, '../supabase/rollbacks');

async function main() {
  const EmbeddedPostgres = (await import(pathToFileURL(runtimeRequire.resolve('embedded-postgres')).href)).default;
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'maharani-pr126-ret-pg17-'));
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

    const salesman = await user('salesman');
    const digest = (seed) => createHash('sha256').update(seed).digest('hex'); // stands in for the server's keyed HMAC
    const COMPLETE = `select public.complete_delivery_atomic($1, $2, $3, $4, $5, null, null, null, $6::jsonb) as r`;

    /** A dispatched order assigned to `assignee`. lines = [rupees, pieces]. */
    async function dispatched(lines = [[1000, 10]], assignee = staff) {
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
      const otp = digest(`otp:${order}`);
      const delivery = (await admin.query(`insert into public.order_deliveries (order_id, delivery_status, assigned_staff_id, assigned_by, assigned_at, otp_hash) values ($1, 'assigned', $2, $3, now(), $4) returning id`, [order, assignee, superAdmin, otp])).rows[0].id;
      for (let i = 0; i < items.length; i++) await admin.query('insert into public.order_delivery_items (delivery_id, order_item_id, quantity_ordered) values ($1, $2, $3)', [delivery, items[i], lines[i][1]]);
      return { retailer, order, delivery, items, otp, pieces: lines.map(([, p]) => p) };
    }
    /** Arguments for COMPLETE. shortfall = missing pieces on line 0. */
    const args = (f, { actor = staff, otp = f.otp, missing = 0, key } = {}) => {
      const items = f.items.map((id, i) => ({ order_item_id: id, delivered: f.pieces[i] - (i === 0 ? missing : 0), missing: i === 0 ? missing : 0, damaged: 0 }));
      return [f.order, actor, otp, key ?? `key:${f.order}:${actor}:${missing}`.padEnd(24, '.'), 'Shop Owner', JSON.stringify(items)];
    };
    /** Run COMPLETE as the service role on its own connection; resolves to {ok, r} or {ok:false, message}. */
    const complete = (a) => run('service', COMPLETE, a).then((res) => ({ ok: true, r: res.rows[0].r }), (error) => ({ ok: false, message: error.message }));
    async function withFailure(table, when, fn) {
      await admin.query(`create or replace function public._test_fail() returns trigger language plpgsql as $$ begin raise exception 'TEST_INJECTED_FAILURE on %', tg_table_name; end $$`);
      await admin.query(`create trigger trg_test_fail before ${when} on public.${table} for each row execute function public._test_fail()`);
      try { await fn(); } finally { await admin.query(`drop trigger trg_test_fail on public.${table}`); }
    }


    const q = async (sql, p = []) => (await admin.query(sql, p)).rows;
    const svc = (sql, p) => run('service', sql, p).then((res) => ({ ok: true, r: res.rows[0].r }), (error) => ({ ok: false, message: error.message, code: error.code }));
    const DISPATCH = `select public.dispatch_order_atomic($1, $2, $3) as r`;
    const RETURN = `select public.return_delivery_to_warehouse_atomic($1, $2, $3) as r`;
    const deadlocks = [];
    // PR126_QUICK=1 shortens the repeated rounds while developing; evidence runs use the full counts.
    const rounds = (n) => (process.env.PR126_QUICK ? Math.max(2, Math.ceil(n / 8)) : n);
    if (process.env.PR126_QUICK) console.log('QUICK MODE: reduced round counts - not an evidence run.');
    const note = (out) => { if (!out.ok && (out.code === '40P01' || /deadlock detected/i.test(out.message))) deadlocks.push(out.message); return out; };

    /** A PACKED simple-stock order: one line of 3 packs (Rs 300), pack stock 7 after checkout, Rs 300 paid in Coins. */
    async function packed({ debit = true } = {}) {
      const retailer = await user('retailer');
      const order = randomUUID(), pack = randomUUID();
      await admin.query(`insert into public.orders (id, order_number, retailer_id, status, subtotal, gst_total, discount_total, grand_total, warehouse_id) values ($1, $2, $3, 'pending', 300, 0, 0, 300, $4)`, [order, `F-${order}`, retailer, warehouse]);
      let item;
      await replica(async () => {
        await admin.query(`insert into public.product_packs (id, product_id, pack_name, pack_sku_code, base_price, case_price, stock_quantity) values ($1, $2, $3, $4, 100, 100, 7)`, [pack, product, `Pack ${pack}`, `SKU-${pack}`]);
        item = (await admin.query(`insert into public.order_items (order_id, product_id, pack_id, source_type, fulfilment_type, quantity, unit_price, gst_percent, line_total, stock_deducted_quantity) values ($1, $2, $3, 'maharani', 'maharani', 3, 100, 0, 300, 3) returning id`, [order, product, pack])).rows[0].id;
      });
      if (debit) await admin.query(`insert into public.retailer_wallet_ledger (retailer_id, transaction_type, amount_paise, direction, reference_type, reference_id, description, idempotency_key) values ($1, 'ORDER_DEBIT', 30000, 'debit', 'order', $2, 'checkout', $3)`, [retailer, order, `order:${order}`]);
      for (const status of ['confirmed', 'processing', 'packed']) await admin.query('update public.orders set status = $2 where id = $1', [order, status]);
      return { retailer, order, pack, items: [item], pieces: [3], otp: digest(`otp:${order}`) };
    }
    /** packed() -> dispatched through the real function by `actor`. */
    async function sent(actor = staff, opts) {
      const f = await packed(opts);
      const out = await svc(DISPATCH, [f.order, actor, f.otp]);
      assert.equal(out.ok, true, out.message);
      f.delivery = out.r.delivery_id;
      return f;
    }

    // =================================================================== 0101
    const APPROVE = `select public.approve_return_request_atomic($1, $2, $3) as r`;
    const REJECT = `select public.reject_return_request_atomic($1, $2, $3) as r`;
    const otherAdmin = await user('admin');

    /** A DELIVERED simple-stock order through the real dispatch + completion functions.
     *  pieces = packs per line (each line has its own pack: stock 7 after checkout, Rs 100 a pack).
     *  missing = pieces short on line 0 (creates the shortfall Coins credit). The whole order is paid in Coins. */
    async function deliveredOrder({ pieces = [3], missing = 0 } = {}) {
      const retailer = await user('retailer');
      const order = randomUUID();
      const total = pieces.reduce((s, p) => s + p * 100, 0);
      await admin.query(`insert into public.orders (id, order_number, retailer_id, status, subtotal, gst_total, discount_total, grand_total, warehouse_id) values ($1, $2, $3, 'pending', $4, 0, 0, $4, $5)`, [order, `R-${order}`, retailer, total, warehouse]);
      const items = [], packs = [];
      await replica(async () => {
        for (const n of pieces) {
          const pack = randomUUID();
          await admin.query(`insert into public.product_packs (id, product_id, pack_name, pack_sku_code, base_price, case_price, stock_quantity) values ($1, $2, $3, $4, 100, 100, 7)`, [pack, product, `Pack ${pack}`, `SKU-${pack}`]);
          items.push((await admin.query(`insert into public.order_items (order_id, product_id, pack_id, source_type, fulfilment_type, quantity, unit_price, gst_percent, line_total, stock_deducted_quantity) values ($1, $2, $3, 'maharani', 'maharani', $4, 100, 0, $5, $4) returning id`, [order, product, pack, n, n * 100])).rows[0].id);
          packs.push(pack);
        }
      });
      await admin.query(`insert into public.retailer_wallet_ledger (retailer_id, transaction_type, amount_paise, direction, reference_type, reference_id, description, idempotency_key) values ($1, 'ORDER_DEBIT', $2, 'debit', 'order', $3, 'checkout', $4)`, [retailer, total * 100, order, `order:${order}`]);
      for (const status of ['confirmed', 'processing', 'packed']) await admin.query('update public.orders set status = $2 where id = $1', [order, status]);
      const f = { retailer, order, items, packs, pieces, otp: digest(`otp:${order}`) };
      const sent = await svc(DISPATCH, [order, staff, f.otp]);
      assert.equal(sent.ok, true, sent.message);
      f.delivery = sent.r.delivery_id;
      const done = await complete(args(f, { missing }));
      assert.equal(done.ok, true, done.message);
      return f;
    }
    /** The retailer submits the request from their own session (row-level security applies). */
    async function request(f, item = null, reason = 'Wrong shade delivered') {
      return (await run(f.retailer, `insert into public.return_requests (order_id, order_item_id, retailer_id, reason) values ($1, $2, $3, $4) returning id`, [f.order, item, f.retailer, reason])).rows[0].id;
    }
    /** Everything a return may touch for one order. */
    async function snap(f) {
      return {
        order: (await q('select status::text s from public.orders where id = $1', [f.order]))[0].s,
        packs: (await q('select stock_quantity n from public.product_packs where id = any($1::uuid[]) order by array_position($1::uuid[], id)', [f.packs ?? []])).map((x) => x.n),
        restored: (await q('select stock_restored_quantity n from public.order_items where order_id = $1 order by array_position($2::uuid[], id)', [f.order, f.items])).map((x) => x.n),
        requests: (await q('select status::text s, resolved_by b from public.return_requests where order_id = $1 order by requested_at, id', [f.order])).map((x) => `${x.s}:${x.b ?? '-'}`),
        events: (await q('select action a, units_restored u, refund_paise::int p, actor_id b from public.return_request_events where order_id = $1 order by created_at, id', [f.order])).map((x) => `${x.a}:${x.u}:${x.p}:${x.b}`),
        wallet: (await q(`select transaction_type t, amount_paise::int n from public.retailer_wallet_ledger where retailer_id = $1 order by created_at, id`, [f.retailer])).map((x) => `${x.t}:${x.n}`),
        loyalty: (await q('select entry_type t, points n from public.loyalty_ledger where reference_id = $1 order by created_at, points desc', [f.order])).map((x) => `${x.t}:${x.n}`),
      };
    }
    const approve = (id, actor = adminUser, noteText = null) => svc(APPROVE, [id, actor, noteText]).then(note);
    const reject = (id, actor = adminUser, noteText = 'Outside policy') => svc(REJECT, [id, actor, noteText]).then(note);

    await test('LIFECYCLE: a retailer submits a request from their own session; only for their own delivered order; never pre-resolved; never for another order\'s item', async () => {
      const f = await deliveredOrder();
      const other = await deliveredOrder();
      const id = await request(f);
      assert.deepEqual((await snap(f)).requests, ['requested:-']);
      // someone else's order, an order that is not delivered, a request that claims to be approved already
      await assert.rejects(run(other.retailer, `insert into public.return_requests (order_id, retailer_id, reason) values ($1, $2, 'x')`, [f.order, other.retailer]), /row-level security/);
      await assert.rejects(run(other.retailer, `insert into public.return_requests (order_id, retailer_id, reason) values ($1, $2, 'x')`, [f.order, f.retailer]), /row-level security/);
      const open = await sent();
      await assert.rejects(run(open.retailer, `insert into public.return_requests (order_id, retailer_id, reason) values ($1, $2, 'x')`, [open.order, open.retailer]), /row-level security/);
      await assert.rejects(run(f.retailer, `insert into public.return_requests (order_id, retailer_id, reason, status) values ($1, $2, 'x', 'approved')`, [f.order, f.retailer]), /RETURN_GUARD/);
      await assert.rejects(run(f.retailer, `insert into public.return_requests (order_id, retailer_id, reason, resolved_by, resolved_at) values ($1, $2, 'x', $3, now())`, [f.order, f.retailer, adminUser]), /RETURN_GUARD/);
      await assert.rejects(run(f.retailer, `insert into public.return_requests (order_id, order_item_id, retailer_id, reason) values ($1, $2, $3, 'x')`, [f.order, other.items[0], f.retailer]), /RETURN_GUARD: that item does not belong/);
      // the retailer can read their own request and (later) its history, not somebody else's
      assert.equal((await run(f.retailer, 'select id from public.return_requests where id = $1', [id])).rowCount, 1);
      assert.equal((await run(other.retailer, 'select id from public.return_requests where id = $1', [id])).rowCount, 0);
      // and cannot resolve it themselves
      await assert.rejects(run(f.retailer, `update public.return_requests set status = 'approved' where id = $1 returning id`, [id]).then((r) => { if (r.rowCount === 0) throw new Error('RETURN_GUARD (no row visible to update)'); }), /RETURN_GUARD/);
      assert.deepEqual((await snap(f)).requests, ['requested:-']);
    });

    await test('APPROVE: one call restores the stock, approves the request and writes the history row; no Coins, no points; the audit log names the Admin', async () => {
      const f = await deliveredOrder();
      const before = await snap(f);
      assert.deepEqual([before.order, before.packs, before.restored, before.wallet, before.loyalty], ['delivered', [7], [0], ['ORDER_DEBIT:30000'], ['ORDER_EARN:3']]);
      const id = await request(f);
      const out = await approve(id, adminUser, '  Checked at the counter  ');
      assert.equal(out.ok, true, out.message);
      assert.deepEqual(out.r, { status: 'approved', replayed: false, return_request_id: id, order_id: f.order, order_number: `R-${f.order}`, retailer_id: f.retailer, order_item_id: null, units_restored: 3, refund_paise: 0 });
      assert.deepEqual(await snap(f), { order: 'delivered', packs: [10], restored: [3], requests: [`approved:${adminUser}`], events: [`approved:3:0:${adminUser}`], wallet: before.wallet, loyalty: before.loyalty });
      const event = (await q('select * from public.return_request_events where return_request_id = $1', [id]))[0];
      assert.deepEqual([event.from_status, event.to_status, event.actor_role, event.note, event.lines, event.order_item_id, event.retailer_id], ['requested', 'approved', 'admin', 'Checked at the counter', [{ order_item_id: f.items[0], units: 3 }], null, f.retailer]);
      const row = (await q('select resolution_note n, resolved_at t from public.return_requests where id = $1', [id]))[0];
      assert.equal(row.n, 'Checked at the counter'); assert.ok(row.t);
      const audit = (await q(`select changed_by b from public.audit_logs where table_name = 'return_requests' and record_id = $1 and action ilike 'update' order by created_at desc limit 1`, [id]))[0];
      assert.equal(audit.b, adminUser);
      // the retailer sees the history of their own request; another retailer sees nothing
      assert.equal((await run(f.retailer, 'select id from public.return_request_events where return_request_id = $1', [id])).rowCount, 1);
      const stranger = await user('retailer');
      assert.equal((await run(stranger, 'select id from public.return_request_events where return_request_id = $1', [id])).rowCount, 0);
    });

    await test('REPEAT: approving again (same Admin, another Admin, Super Admin) is a replay - no second stock movement, one history row, first approver kept', async () => {
      const f = await deliveredOrder();
      const id = await request(f);
      assert.equal((await approve(id)).r.replayed, false);
      const after = await snap(f);
      for (const actor of [adminUser, otherAdmin, superAdmin, adminUser]) {
        const again = await approve(id, actor, 'second note');
        assert.equal(again.ok, true, again.message);
        assert.equal(again.r.replayed, true);
        assert.equal(again.r.units_restored, 3);
        assert.deepEqual(await snap(f), after);
      }
      assert.deepEqual(after.packs, [10]);
      assert.equal((await q('select resolution_note n from public.return_requests where id = $1', [id]))[0].n, null);
    });

    await test(`CONCURRENT: 16 simultaneous approvals of one request - stock restored once, one history row, 15 replays - ${rounds(5)} rounds`, async () => {
      for (let round = 0; round < rounds(5); round++) {
        const f = await deliveredOrder();
        const id = await request(f);
        const actors = [adminUser, otherAdmin, superAdmin];
        const outs = await Promise.all(Array.from({ length: 16 }, (_, i) => approve(id, actors[i % 3])));
        assert.equal(outs.every((o) => o.ok), true, outs.find((o) => !o.ok)?.message);
        assert.equal(outs.filter((o) => !o.r.replayed).length, 1);
        assert.equal(outs.filter((o) => o.r.replayed).length, 15);
        const s = await snap(f);
        assert.deepEqual([s.packs, s.restored, s.events.length, s.wallet, s.loyalty], [[10], [3], 1, ['ORDER_DEBIT:30000'], ['ORDER_EARN:3']]);
        const winner = outs.find((o) => !o.r.replayed);
        assert.equal(s.requests[0].startsWith('approved:'), true);
        assert.equal(winner.r.units_restored, 3);
      }
    });

    await test(`CONCURRENT: two requests for the SAME goods approved together - only one restores; the other is refused, nothing doubled - ${rounds(5)} rounds`, async () => {
      for (let round = 0; round < rounds(5); round++) {
        const f = await deliveredOrder();
        const a = await request(f), b = await request(f, f.items[0], 'duplicate');
        const outs = await Promise.all([approve(a), approve(b, otherAdmin), approve(a, superAdmin), approve(b)]);
        const fresh = outs.filter((o) => o.ok && !o.r.replayed);
        assert.equal(fresh.length, 1);
        for (const o of outs.filter((x) => !x.ok)) assert.match(o.message, /RETURN_APPROVE:ALREADY_RESTORED/);
        const s = await snap(f);
        assert.deepEqual([s.packs, s.restored, s.events.length], [[10], [3], 1]);
        assert.equal(s.requests.filter((r) => r.startsWith('approved')).length, 1);
        assert.equal(s.requests.filter((r) => r.startsWith('requested')).length, 1);
      }
    });

    await test('FAILURE between stock and status (and at every other write): everything rolls back - stock is never restored without the approved state; the retry then works once', async () => {
      for (const [table, when] of [['product_packs', 'update'], ['order_items', 'update'], ['return_requests', 'update'], ['return_request_events', 'insert'], ['audit_logs', 'insert']]) {
        const f = await deliveredOrder();
        const id = await request(f);
        const before = await snap(f);
        await withFailure(table, when, async () => {
          const out = await approve(id);
          assert.equal(out.ok, false, `${table}: must fail`);
          assert.match(out.message, /TEST_INJECTED_FAILURE/, table);
        });
        assert.deepEqual(await snap(f), before, `${table}: nothing may remain`);
        assert.deepEqual(before.packs, [7]);
        const retry = await approve(id);
        assert.equal(retry.ok, true, retry.message);
        assert.equal(retry.r.replayed, false);
        assert.deepEqual([(await snap(f)).packs, (await snap(f)).events.length], [[10], 1], table);
      }
    });

    await test('OLD ROUTE CLOSED: no API role can restore order stock directly, flip or edit a request with a plain UPDATE, or write the history', async () => {
      const f = await deliveredOrder();
      const id = await request(f);
      const before = await snap(f);
      for (const who of [staff, adminUser, superAdmin, f.retailer, 'service', 'anon']) {
        await assert.rejects(run(who, 'select public.return_order_stock($1, null)', [f.order]), /permission denied for function return_order_stock/, String(who));
        await assert.rejects(run(who, 'select public._return_request_restorable_lines($1, null)', [f.order]), /permission denied/, String(who));
        await assert.rejects(run(who, `insert into public.return_request_events (return_request_id, order_id, retailer_id, action, from_status, to_status, actor_id, actor_role, units_restored) values ($1, $2, $3, 'approved', 'requested', 'approved', $4, 'admin', 3)`, [id, f.order, f.retailer, adminUser]), /permission denied|row-level security/, String(who));
      }
      for (const who of [staff, adminUser, superAdmin, 'service']) {
        for (const sql of [`update public.return_requests set status = 'approved', resolved_by = $2, resolved_at = now() where id = $1`, `update public.return_requests set status = 'rejected', resolved_by = $2 where id = $1`, `update public.return_requests set status = 'completed' where id = $1 and $2::uuid is not null`, `update public.return_requests set reason = 'edited' where id = $1 and $2::uuid is not null`, `update public.return_requests set order_item_id = null, retailer_id = $2 where id = $1`]) {
          await assert.rejects(run(who, sql, [id, adminUser]), /RETURN_GUARD/, `${who}: ${sql}`);
        }
      }
      for (const who of [adminUser, superAdmin, staff]) await assert.rejects(run(who, APPROVE, [id, adminUser, null]), /permission denied for function approve_return_request_atomic/);
      for (const who of [adminUser, superAdmin, staff, 'anon']) await assert.rejects(run(who, REJECT, [id, adminUser, 'nope']), /permission denied for function reject_return_request_atomic/);
      assert.deepEqual(await snap(f), before);
      // history is append-only even for the database owner
      assert.equal((await approve(id)).ok, true);
      await assert.rejects(admin.query(`update public.return_request_events set units_restored = 1 where return_request_id = $1`, [id]), /append-only/);
      await assert.rejects(admin.query(`delete from public.return_request_events where return_request_id = $1`, [id]), /append-only/);
      await assert.rejects(admin.query(`insert into public.return_request_events (return_request_id, order_id, retailer_id, action, from_status, to_status, actor_id, actor_role, units_restored) values ($1, $2, $3, 'rejected', 'requested', 'rejected', $4, 'admin', 0)`, [id, f.order, f.retailer, adminUser]), /return_request_events_one_resolution/);
      await assert.rejects(admin.query(`insert into public.return_request_events (return_request_id, order_id, retailer_id, action, from_status, to_status, actor_id, actor_role, units_restored, refund_paise) values ($1, $2, $3, 'approved', 'requested', 'approved', $4, 'admin', 3, 100)`, [randomUUID(), f.order, f.retailer, adminUser]), /check constraint/);
    });

    await test('UNAUTHORISED: staff, salesman, retailer, a deactivated Admin and an unknown actor are refused by the database; nothing changes', async () => {
      const f = await deliveredOrder();
      const id = await request(f);
      const before = await snap(f);
      const fired = await user('admin');
      await admin.query('update public.profiles set is_active = false where id = $1', [fired]);
      for (const actor of [staff, otherStaff, salesman, f.retailer, fired, randomUUID()]) {
        for (const [sql, prefix] of [[APPROVE, 'RETURN_APPROVE'], [REJECT, 'RETURN_REJECT']]) {
          const out = await svc(sql, [id, actor, 'a valid reason']);
          assert.equal(out.ok, false);
          assert.match(out.message, new RegExp(`${prefix}:NO_PERMISSION`), String(actor));
          assert.equal(out.code, '42501');
        }
      }
      assert.match((await svc(APPROVE, [id, null, null])).message, /RETURN_APPROVE:INVALID_INPUT/);
      assert.match((await svc(APPROVE, [randomUUID(), adminUser, null])).message, /RETURN_APPROVE:NOT_FOUND/);
      assert.match((await svc(REJECT, [randomUUID(), adminUser, 'a reason'])).message, /RETURN_REJECT:NOT_FOUND/);
      assert.match((await svc(APPROVE, [id, adminUser, 'x'.repeat(1001)])).message, /RETURN_APPROVE:NOTE/);
      assert.deepEqual(await snap(f), before);
      assert.equal((await approve(id, superAdmin)).r.replayed, false); // a Super Admin may
    });

    await test('REJECT: needs a reason; changes the request and writes history; never touches stock, Coins or points; replays; a rejected request cannot be approved and vice versa', async () => {
      const f = await deliveredOrder();
      const id = await request(f);
      const before = await snap(f);
      for (const bad of [null, '', '  ', 'no', 'x'.repeat(1001)]) assert.match((await reject(id, adminUser, bad)).message, /RETURN_REJECT:NOTE/);
      assert.deepEqual(await snap(f), before);
      const out = await reject(id, adminUser, ' Seal was broken by the buyer ');
      assert.equal(out.ok, true, out.message);
      assert.deepEqual(out.r, { status: 'rejected', replayed: false, return_request_id: id, order_id: f.order, order_number: `R-${f.order}`, retailer_id: f.retailer });
      const after = await snap(f);
      assert.deepEqual(after, { ...before, requests: [`rejected:${adminUser}`], events: [`rejected:0:0:${adminUser}`] });
      assert.equal((await q('select resolution_note n from public.return_requests where id = $1', [id]))[0].n, 'Seal was broken by the buyer');
      const again = await reject(id, otherAdmin, 'another reason');
      assert.equal(again.r.replayed, true);
      assert.match((await approve(id)).message, /RETURN_APPROVE:ALREADY_RESOLVED:rejected/);
      assert.deepEqual(await snap(f), after);
      const g = await deliveredOrder();
      const gid = await request(g);
      assert.equal((await approve(gid)).ok, true);
      const approved = await snap(g);
      assert.match((await reject(gid)).message, /RETURN_REJECT:ALREADY_RESOLVED:approved/);
      assert.deepEqual(await snap(g), approved);
      // a failure while writing the history rolls the rejection back too
      const h = await deliveredOrder();
      const hid = await request(h);
      const hBefore = await snap(h);
      await withFailure('return_request_events', 'insert', async () => assert.match((await reject(hid)).message, /TEST_INJECTED_FAILURE/));
      assert.deepEqual(await snap(h), hBefore);
    });

    await test(`RACE: approve and reject fired together - exactly one resolution; stock moves only if the approval won - ${rounds(15)} rounds`, async () => {
      const wins = { approved: 0, rejected: 0 };
      for (let round = 0; round < rounds(15); round++) {
        const f = await deliveredOrder();
        const id = await request(f);
        const calls = round % 2 ? [reject(id), approve(id, otherAdmin), reject(id, superAdmin), approve(id)] : [approve(id), reject(id, otherAdmin), approve(id, superAdmin), reject(id)];
        const outs = await Promise.all(calls);
        const fresh = outs.filter((o) => o.ok && !o.r.replayed);
        assert.equal(fresh.length, 1, JSON.stringify(outs));
        const s = await snap(f);
        assert.equal(s.events.length, 1);
        wins[fresh[0].r.status]++;
        if (fresh[0].r.status === 'approved') assert.deepEqual([s.packs, s.restored, s.requests[0].split(':')[0], s.events[0].split(':')[0]], [[10], [3], 'approved', 'approved']);
        else assert.deepEqual([s.packs, s.restored, s.requests[0].split(':')[0], s.events[0].split(':')[0]], [[7], [0], 'rejected', 'rejected']);
        for (const o of outs.filter((x) => !x.ok)) assert.match(o.message, /ALREADY_RESOLVED/);
        assert.deepEqual(s.wallet, ['ORDER_DEBIT:30000']);
      }
      console.log(`     (approval won ${wins.approved}, rejection won ${wins.rejected})`);
    });

    await test('INVALID: a request for another order\'s item, for another retailer, for an order that is not delivered, or restoring more than was delivered is refused; nothing changes', async () => {
      const f = await deliveredOrder();
      const other = await deliveredOrder();
      const forge = async (order, item, retailer) => {
        const id = randomUUID();
        await replica(() => admin.query(`insert into public.return_requests (id, order_id, order_item_id, retailer_id, reason) values ($1, $2, $3, $4, 'forged row')`, [id, order, item, retailer]));
        return id;
      };
      const before = [await snap(f), await snap(other)];
      assert.match((await approve(await forge(f.order, other.items[0], f.retailer))).message, /RETURN_APPROVE:INVALID_ITEM/);
      assert.match((await approve(await forge(f.order, null, other.retailer))).message, /RETURN_APPROVE:INVALID_REQUEST/);
      const open = await sent();
      assert.match((await approve(await forge(open.order, null, open.retailer))).message, /RETURN_APPROVE:ORDER_STATE:dispatched/);
      // the stock counter says 3 packs can come back, the delivery record says 2 were delivered
      const g = await deliveredOrder();
      const gid = await request(g);
      await replica(() => admin.query('update public.order_delivery_items set quantity_ordered = 2, quantity_delivered = 2 where delivery_id = $1', [g.delivery]));
      const gBefore = await snap(g);
      const out = await approve(gid);
      assert.match(out.message, /RETURN_APPROVE:QUANTITY/);
      assert.deepEqual(await snap(g), gBefore);
      assert.deepEqual(gBefore.packs, [7]);
      const after = [await snap(f), await snap(other)];
      assert.deepEqual(after.map((s) => [s.packs, s.restored, s.events, s.wallet]), before.map((s) => [s.packs, s.restored, s.events, s.wallet]));
    });

    await test('SHORTFALL CREDIT: a return over goods already settled in Coins is refused before any write - the credit is neither reversed nor repeated; a fully delivered line of the same order can still be returned', async () => {
      const f = await deliveredOrder({ pieces: [3, 2], missing: 1 });
      const before = await snap(f);
      assert.deepEqual(before.wallet, ['ORDER_DEBIT:50000', 'REFUND_CREDIT:10000']);
      const whole = await request(f), shortLine = await request(f, f.items[0]), fullLine = await request(f, f.items[1]);
      for (const id of [whole, shortLine]) {
        const out = await approve(id);
        assert.equal(out.ok, false);
        assert.match(out.message, /RETURN_APPROVE:RECONCILE/);
        assert.equal(out.code, '22023');
      }
      assert.deepEqual(await snap(f), { ...before, requests: ['requested:-', 'requested:-', 'requested:-'] });
      const ok = await approve(fullLine);
      assert.equal(ok.ok, true, ok.message);
      assert.equal(ok.r.units_restored, 2);
      const after = await snap(f);
      assert.deepEqual([after.packs, after.restored, after.wallet, after.loyalty], [[7, 9], [0, 2], before.wallet, before.loyalty]);
      // the blocked requests stay open for the Admin; rejecting them moves nothing
      assert.equal((await reject(whole, adminUser, 'Settled by hand, see ledger')).ok, true);
      assert.deepEqual([(await snap(f)).packs, (await snap(f)).wallet], [[7, 9], before.wallet]);
      // the full return-to-warehouse flow keeps its own refusal (0100)
      assert.match((await svc(RETURN, [f.order, staff, null])).message, /DELIVERY_RETURN:RECONCILE/);
      assert.deepEqual((await snap(f)).wallet, before.wallet);
    });

    await test('PARTIAL RETURNS: a line request restores that line only; the same line cannot be restored twice; a later whole-order request restores only what is left', async () => {
      const f = await deliveredOrder({ pieces: [3, 2, 4] });
      const lineB = await request(f, f.items[1]);
      const out = await approve(lineB);
      assert.deepEqual([out.r.units_restored, out.r.order_item_id], [2, f.items[1]]);
      assert.deepEqual([(await snap(f)).packs, (await snap(f)).restored], [[7, 9, 7], [0, 2, 0]]);
      const again = await request(f, f.items[1], 'same line again');
      assert.match((await approve(again)).message, /RETURN_APPROVE:ALREADY_RESTORED/);
      const whole = await request(f);
      const rest = await approve(whole, otherAdmin);
      assert.equal(rest.r.units_restored, 7);
      const s = await snap(f);
      assert.deepEqual([s.packs, s.restored, s.order], [[10, 9, 11], [3, 2, 4], 'delivered']);
      assert.deepEqual((await q('select lines from public.return_request_events where return_request_id = $1', [whole]))[0].lines, [f.items[0], f.items[2]].sort().map((id) => ({ order_item_id: id, units: id === f.items[0] ? 3 : 4 })));
      const third = await request(f);
      assert.match((await approve(third)).message, /RETURN_APPROVE:ALREADY_RESTORED/);
      assert.deepEqual([s.wallet, s.loyalty], [['ORDER_DEBIT:90000'], ['ORDER_EARN:9']]);
      assert.equal(s.events.length, 2);
    });

    await test('ALREADY RETURNED / REFUNDED: after return-to-warehouse the request cannot be approved (no second stock return, no second refund); after an approved line, return-to-warehouse restores only the rest and refunds once', async () => {
      const f = await deliveredOrder();
      const id = await request(f);
      const rto = await svc(RETURN, [f.order, staff, 'customer refused']);
      assert.equal(rto.ok, true, rto.message);
      const returned = await snap(f);
      assert.deepEqual([returned.order, returned.packs, returned.restored, returned.wallet], ['returned', [10], [3], ['ORDER_DEBIT:30000', 'ORDER_REVERSAL:30000']]);
      const out = await approve(id);
      assert.match(out.message, /RETURN_APPROVE:ORDER_STATE:returned/);
      assert.deepEqual(await snap(f), returned);
      assert.equal((await reject(id, adminUser, 'Order already returned to warehouse')).ok, true);
      assert.deepEqual([(await snap(f)).packs, (await snap(f)).wallet], [returned.packs, returned.wallet]);

      const g = await deliveredOrder({ pieces: [3, 2] });
      assert.equal((await approve(await request(g, g.items[0]))).r.units_restored, 3);
      const rto2 = await svc(RETURN, [g.order, staff, null]);
      assert.equal(rto2.ok, true, rto2.message);
      const s = await snap(g);
      assert.deepEqual([s.order, s.packs, s.restored, s.wallet], ['returned', [10, 9], [3, 2], ['ORDER_DEBIT:50000', 'ORDER_REVERSAL:50000']]);
      assert.equal((await svc(RETURN, [g.order, staff, null])).r.replayed, true);
      assert.deepEqual(await snap(g), s);
    });

    await test('SPLIT ORDERS: a Maharani-fulfilled line returns to pack stock only; a seller-fulfilled line (and a whole-order request that includes one) is refused; seller stock is never touched', async () => {
      const retailer = await user('retailer');
      const order = randomUUID(), pack = randomUUID(), seller = randomUUID(), offer = randomUUID(), sellerChild = randomUUID(), maharaniChild = randomUUID();
      await admin.query(`insert into public.orders (id, order_number, retailer_id, status, warehouse_id) values ($1, $2, $3, 'pending', $4)`, [order, `S-${order}`, retailer, warehouse]);
      let items;
      await replica(async () => {
        await admin.query(`insert into public.product_packs (id, product_id, pack_name, pack_sku_code, base_price, case_price, stock_quantity) values ($1, $2, $3, $4, 10, 10, 7)`, [pack, product, `Pack ${pack}`, `SKU-${pack}`]);
        await admin.query(`insert into public.sellers (id, business_name, status) values ($1, $2, 'active')`, [seller, `Seller ${seller}`]);
        await admin.query(`insert into public.seller_offers (id, seller_id, product_id, pack_id, fulfilment_type, unit_price_paise, stock_quantity) values ($1, $2, $3, $4, 'seller', 1000, 8)`, [offer, seller, product, pack]);
        await admin.query(`insert into public.sub_orders (id, parent_order_id, seller_id, fulfilment_type, coins_share_paise) values ($1, $2, $3, 'seller', 0), ($4, $2, null, 'maharani', 0)`, [sellerChild, order, seller, maharaniChild]);
        items = (await admin.query(
          `insert into public.order_items (order_id, product_id, pack_id, sub_order_id, seller_offer_id, source_type, fulfilment_type, quantity, unit_price, line_total, stock_deducted_quantity, shipped_quantity, accepted_quantity)
           values ($1, $2, $3, $4, $5, 'seller', 'seller', 2, 10, 20, 2, 2, 2), ($1, $2, $3, $6, null, 'maharani', 'maharani', 3, 10, 30, 3, 0, 0) returning id, source_type`,
          [order, product, pack, sellerChild, offer, maharaniChild])).rows;
        await admin.query(`update public.orders set status = 'delivered' where id = $1`, [order]);
      });
      const sellerLine = items.find((x) => x.source_type === 'seller').id, maharaniLine = items.find((x) => x.source_type === 'maharani').id;
      const f = { retailer, order, packs: [pack], items: [sellerLine, maharaniLine] };
      const offerStock = async () => (await q('select stock_quantity n from public.seller_offers where id = $1', [offer]))[0].n;
      const before = await snap(f);
      assert.deepEqual([before.packs, before.restored, await offerStock()], [[7], [0, 0], 8]);
      const whole = await request(f), sellerReq = await request(f, sellerLine), maharaniReq = await request(f, maharaniLine);
      for (const id of [whole, sellerReq]) assert.match((await approve(id)).message, /RETURN_APPROVE:SELLER_RETURN/);
      assert.deepEqual([(await snap(f)).packs, (await snap(f)).restored, await offerStock(), (await snap(f)).events], [[7], [0, 0], 8, []]);
      const ok = await approve(maharaniReq);
      assert.equal(ok.ok, true, ok.message);
      assert.equal(ok.r.units_restored, 3);
      assert.deepEqual([(await snap(f)).packs, (await snap(f)).restored, await offerStock()], [[10], [0, 3], 8]);
      assert.match((await approve(whole)).message, /RETURN_APPROVE:SELLER_RETURN/);
      assert.deepEqual([(await snap(f)).packs, await offerStock(), (await snap(f)).events.length, (await snap(f)).wallet], [[10], 8, 1, []]);
    });

    await test('LEGACY ORDERS (before pack stock, no batch allocations): the old stock function booked the line again on every call - now it is booked once', async () => {
      const f = await dispatched([[1000, 10]]);
      await replica(() => admin.query('update public.orders set simple_stock_mode = false where id = $1', [f.order]));
      const done = await complete(args(f));
      assert.equal(done.ok, true, done.message);
      const movements = async () => (await q(`select quantity::int n from public.stock_movements where reference_order_id = $1 and movement_type = 'return' order by created_at`, [f.order])).map((x) => x.n);
      assert.deepEqual(await movements(), []);
      // CONTROL: the untouched 0017 function really does double-book (run as an Admin, rolled back)
      const c = await client();
      await c.query('begin');
      await c.query(`select set_config('request.jwt.claims', $1, true), set_config('request.jwt.claim.sub', $2, true)`, [JSON.stringify({ role: 'authenticated', sub: adminUser }), adminUser]);
      await c.query('select public.return_legacy_order_stock($1, null)', [f.order]);
      await c.query('select public.return_legacy_order_stock($1, null)', [f.order]);
      assert.equal((await c.query(`select count(*)::int n from public.stock_movements where reference_order_id = $1 and movement_type = 'return'`, [f.order])).rows[0].n, 2);
      await c.query('rollback');
      await c.end();
      assert.deepEqual(await movements(), []);

      const a = await request(f), b = await request(f, null, 'second request, same goods');
      const outs = await Promise.all([approve(a), approve(b, otherAdmin), approve(a, superAdmin)]);
      assert.equal(outs.filter((o) => o.ok && !o.r.replayed).length, 1, JSON.stringify(outs));
      assert.deepEqual(await movements(), [10]);
      for (const id of [a, b]) {
        const again = await approve(id);
        assert.ok(again.ok ? again.r.replayed : /RETURN_APPROVE:ALREADY_RESTORED/.test(again.message), again.message);
      }
      assert.deepEqual(await movements(), [10]);
      // even the owner calling the wrapper again restores nothing
      const d = await client();
      await d.query('begin');
      await d.query(`select set_config('request.jwt.claims', $1, true), set_config('request.jwt.claim.sub', $2, true)`, [JSON.stringify({ role: 'authenticated', sub: adminUser }), adminUser]);
      // (the order line is on record, so the stock function finds nothing left and writes nothing)
      assert.equal((await d.query('select public.return_order_stock($1, null) as r', [f.order])).rows[0].r.units, 0);
      assert.equal((await d.query(`select count(*)::int n from public.stock_movements where reference_order_id = $1 and movement_type = 'return'`, [f.order])).rows[0].n, 1);
      // and the record itself cannot be booked twice or edited, even by the owner
      await d.query('savepoint s');
      await assert.rejects(d.query('insert into public.order_item_legacy_stock_returns (order_item_id, order_id, product_id, units) values ($1, $2, $3, 10)', [f.items[0], f.order, product]), /duplicate key/);
      await d.query('rollback to savepoint s');
      await assert.rejects(d.query('delete from public.order_item_legacy_stock_returns where order_item_id = $1', [f.items[0]]), /append-only/);
      await d.query('rollback');
      await d.end();
      assert.deepEqual(await movements(), [10]);
    });

    // ============================================== same product on two lines
    // Legacy (pre pack-stock) return movements carry the product, not the order
    // line. An order may hold the SAME product on two lines. The duplicate
    // guard must work per order line, and never let more come back than left.
    const hasMarkers = (await q(`select to_regclass('public.order_item_legacy_stock_returns') is not null as y`))[0].y;
    /** A DELIVERED legacy order (no pack stock, no batch allocations). Every line is the SAME product. */
    async function legacyDelivered(lines = [[300, 3], [200, 2]]) {
      const f = await dispatched(lines);
      await replica(() => admin.query('update public.orders set simple_stock_mode = false where id = $1', [f.order]));
      const done = await complete(args(f));
      assert.equal(done.ok, true, done.message);
      return f;
    }
    const shelf = async () => (await q('select coalesce(sum(quantity), 0)::int n from public.inventory_stock where product_id = $1 and warehouse_id = $2', [product, warehouse]))[0].n;
    async function legacySnap(f) {
      return {
        order: (await q('select status::text s from public.orders where id = $1', [f.order]))[0].s,
        movements: (await q(`select quantity::int n from public.stock_movements where reference_order_id = $1 and movement_type = 'return' order by created_at, id`, [f.order])).map((x) => x.n),
        booked: hasMarkers ? (await q('select coalesce((select m.units from public.order_item_legacy_stock_returns m where m.order_item_id = i.id), 0)::int n from unnest($1::uuid[]) with ordinality as i(id, o) order by i.o', [f.items])).map((x) => x.n) : null,
        shelf: await shelf(),
        requests: (await q('select status::text s, resolved_by b from public.return_requests where order_id = $1 order by requested_at, id', [f.order])).map((x) => `${x.s}:${x.b ?? '-'}`),
        events: (await q('select action a, units_restored u, refund_paise::int p, lines l from public.return_request_events where order_id = $1 order by created_at, id', [f.order])).map((x) => `${x.a}:${x.u}:${x.p}:${f.items.map((id) => x.l.find((y) => y.order_item_id === id)?.units).filter(Boolean).join('+')}`),
        wallet: (await q(`select transaction_type t, amount_paise::int n from public.retailer_wallet_ledger where retailer_id = $1 order by created_at, id`, [f.retailer])).map((x) => `${x.t}:${x.n}`),
        loyalty: (await q('select entry_type t, points n from public.loyalty_ledger where reference_id = $1 order by created_at, points desc', [f.order])).map((x) => `${x.t}:${x.n}`),
      };
    }
    const fresh = (outs) => outs.filter((o) => o.ok && !o.r.replayed);

    await test('SAME PRODUCT ON TWO LINES (legacy): each line is restored exactly once - the second line is NOT mistaken for the first; repeats, a third request and a whole-order request restore nothing more', async () => {
      const f = await legacyDelivered();
      const before = await legacySnap(f);
      assert.deepEqual(before.movements, []);
      const a = await request(f, f.items[0]);
      const first = await approve(a);
      assert.equal(first.ok, true, first.message);
      assert.equal(first.r.units_restored, 3);
      const b = await request(f, f.items[1]);
      const second = await approve(b, otherAdmin);
      assert.equal(second.ok, true, `second line of the same product: ${second.message}`);
      assert.deepEqual([second.r.units_restored, second.r.replayed, second.r.order_item_id], [2, false, f.items[1]]);
      const after = await legacySnap(f);
      assert.deepEqual([after.movements, after.shelf - before.shelf, after.events], [[3, 2], 5, ['approved:3:0:3', 'approved:2:0:2']]);
      if (hasMarkers) assert.deepEqual(after.booked, [3, 2]);
      assert.deepEqual([after.wallet, after.loyalty, after.order], [before.wallet, before.loyalty, 'delivered']);
      // repeats are replays; nothing moves
      for (const [id, actor] of [[a, adminUser], [b, adminUser], [a, superAdmin], [b, otherAdmin]]) {
        const again = await approve(id, actor);
        assert.deepEqual([again.ok, again.r?.replayed], [true, true], again.message);
      }
      // a third request for either line, and a whole-order request, find nothing left
      for (const item of [f.items[0], f.items[1], null]) {
        const extra = await approve(await request(f, item, 'again'));
        assert.match(extra.message ?? 'approved', /RETURN_APPROVE:ALREADY_RESTORED/);
      }
      const end = await legacySnap(f);
      assert.deepEqual([end.movements, end.shelf, end.events, end.booked], [after.movements, after.shelf, after.events, after.booked]);
    });

    await test('SAME PRODUCT ON TWO LINES (legacy), partial: a line first, then the whole order restores only the other line; whole order first restores both lines once and later line requests are refused', async () => {
      const f = await legacyDelivered([[300, 3], [200, 2], [400, 4]]);
      const start = await shelf();
      assert.equal((await approve(await request(f, f.items[1]))).r?.units_restored, 2);
      const whole = await approve(await request(f));
      assert.equal(whole.ok, true, whole.message);
      assert.equal(whole.r.units_restored, 7);
      const s1 = await legacySnap(f);
      assert.deepEqual([s1.movements.slice().sort(), s1.shelf - start, s1.events], [[2, 3, 4], 9, ['approved:2:0:2', 'approved:7:0:3+4']]);
      if (hasMarkers) assert.deepEqual(s1.booked, [3, 2, 4]);

      const g = await legacyDelivered();
      const gStart = await shelf();
      const all = await approve(await request(g));
      assert.deepEqual([all.ok, all.r?.units_restored], [true, 5], all.message);
      for (const item of g.items) assert.match((await approve(await request(g, item))).message ?? 'approved', /RETURN_APPROVE:ALREADY_RESTORED/);
      const s2 = await legacySnap(g);
      assert.deepEqual([s2.movements.slice().sort(), s2.shelf - gStart], [[2, 3], 5]);
    });

    await test(`SAME PRODUCT ON TWO LINES (legacy), concurrent: both line requests, a whole-order request and duplicates approved together - every line comes back exactly once - ${rounds(8)} rounds`, async () => {
      for (let round = 0; round < rounds(8); round++) {
        const f = await legacyDelivered();
        const start = await shelf();
        const a = await request(f, f.items[0]), b = await request(f, f.items[1]), w = await request(f), a2 = await request(f, f.items[0], 'duplicate');
        const outs = await Promise.all([
          approve(a), approve(b, otherAdmin), approve(w, superAdmin), approve(a2), approve(a, otherAdmin), approve(b), approve(b, superAdmin), approve(w),
        ]);
        for (const o of outs) assert.ok(o.ok || /RETURN_APPROVE:ALREADY_RESTORED/.test(o.message), o.message);
        const s = await legacySnap(f);
        assert.equal(s.shelf - start, 5, `round ${round}: ${JSON.stringify(s)}`);
        assert.equal(s.movements.reduce((x, y) => x + y, 0), 5);
        assert.deepEqual(s.movements.slice().sort(), [2, 3]);
        if (hasMarkers) assert.deepEqual(s.booked, [3, 2]);
        // what the history says came back equals what really came back
        assert.equal(fresh(outs).reduce((x, o) => x + o.r.units_restored, 0), 5);
        assert.equal(s.events.length, fresh(outs).length);
      }
    });

    await test('SAME PRODUCT ON TWO LINES (legacy), failure at each write while approving the SECOND line: everything rolls back, the first line stays restored once; the retry then works once', async () => {
      const writes = [['stock_movements', 'insert'], ['return_requests', 'update'], ['return_request_events', 'insert'], ['audit_logs', 'insert']];
      if (hasMarkers) writes.push(['order_item_legacy_stock_returns', 'insert']);
      for (const [table, when] of writes) {
        const f = await legacyDelivered();
        assert.equal((await approve(await request(f, f.items[0]))).ok, true);
        const b = await request(f, f.items[1]);
        const before = await legacySnap(f);
        await withFailure(table, when, async () => {
          const out = await approve(b);
          assert.match(out.message ?? 'approved', /TEST_INJECTED_FAILURE/, table);
        });
        assert.deepEqual(await legacySnap(f), before, `${table}: nothing may remain`);
        const retry = await approve(b);
        assert.deepEqual([retry.ok, retry.r?.units_restored, retry.r?.replayed], [true, 2, false], `${table}: ${retry.message}`);
        const after = await legacySnap(f);
        assert.deepEqual([after.movements, after.shelf - before.shelf], [[3, 2], 2]);
      }
    });

    await test('SAME PRODUCT ON TWO LINES (legacy), stock booked before 0101 with no line recorded: never more comes back than the order took out; an unclear remainder is refused, not guessed', async () => {
      // A return movement written by the old route: product known, order line unknown.
      const old = (f, n) => admin.query(`insert into public.stock_movements (product_id, warehouse_id, movement_type, quantity, reference_type, reference_id, reference_order_id, reason, performed_by)
        values ($1, $2, 'return', $3, 'order', $4, $4, 'before 0101', $5)`, [product, warehouse, n, f.order, adminUser]);
      // two equal lines, one already booked the old way: one more line may come back, not two
      const f = await legacyDelivered([[300, 3], [300, 3]]);
      await old(f, 3);
      const start = await shelf();
      const outs = [await approve(await request(f, f.items[0])), await approve(await request(f, f.items[1])), await approve(await request(f))];
      assert.equal(fresh(outs).length, 1, JSON.stringify(outs));
      assert.equal((await shelf()) - start, 3);
      assert.equal((await legacySnap(f)).movements.reduce((x, y) => x + y, 0), 6);
      // lines of 3 and 2, 3 already booked the old way: the line of 2 still fits; the line of 3 does not and is refused
      const g = await legacyDelivered();
      await old(g, 3);
      const gStart = await shelf();
      assert.match((await approve(await request(g, g.items[0]))).message ?? 'approved', /RETURN_APPROVE:ALREADY_RESTORED/);
      assert.equal((await approve(await request(g, g.items[1]))).r?.units_restored, 2);
      assert.match((await approve(await request(g))).message ?? 'approved', /RETURN_APPROVE:ALREADY_RESTORED/);
      assert.equal((await shelf()) - gStart, 2);
      // everything already booked the old way: nothing more
      const h = await legacyDelivered();
      await old(h, 5);
      const hStart = await shelf();
      for (const item of [h.items[0], h.items[1], null]) assert.match((await approve(await request(h, item))).message ?? 'approved', /RETURN_APPROVE:ALREADY_RESTORED/);
      assert.equal((await shelf()) - hStart, 0);
    });

    await test(`SAME PRODUCT ON TWO LINES (pack stock): each line restores its own pack quantity once - in sequence, repeated, and ${rounds(8)} concurrent rounds; a failure rolls back; a short line stays blocked; the same PACK twice in one order is impossible by schema`, async () => {
      // Pack-stock orders keep the restored count on the order line itself, and
      // the schema allows one line per pack in an unsplit order (0064).
      const f = await deliveredOrder({ pieces: [3, 2] }); // one product, two packs, two lines
      assert.equal((await q('select count(distinct product_id)::int n from public.order_items where order_id = $1', [f.order]))[0].n, 1);
      await assert.rejects(replica(() => admin.query('update public.order_items set pack_id = $2 where id = $1', [f.items[1], f.packs[0]])), /uq_order_items_legacy_pack/);
      const before = await snap(f);
      const a = await request(f, f.items[0]), b = await request(f, f.items[1]);
      assert.equal((await approve(a)).r?.units_restored, 3);
      await withFailure('return_request_events', 'insert', async () => {
        assert.match((await approve(b)).message ?? 'approved', /TEST_INJECTED_FAILURE/);
      });
      assert.deepEqual([(await snap(f)).packs, (await snap(f)).restored], [[before.packs[0] + 3, before.packs[1]], [3, 0]]);
      const second = await approve(b);
      assert.deepEqual([second.ok, second.r?.units_restored], [true, 2], second.message);
      for (const id of [a, b]) assert.equal((await approve(id, superAdmin)).r?.replayed, true);
      for (const item of [f.items[0], f.items[1], null]) assert.match((await approve(await request(f, item, 'again'))).message ?? 'approved', /RETURN_APPROVE:ALREADY_RESTORED/);
      const after = await snap(f);
      assert.deepEqual([after.packs, after.restored, after.wallet, after.loyalty], [[before.packs[0] + 3, before.packs[1] + 2], [3, 2], before.wallet, before.loyalty]);

      for (let round = 0; round < rounds(8); round++) {
        const g = await deliveredOrder({ pieces: [3, 2] });
        const start = (await snap(g)).packs;
        const ga = await request(g, g.items[0]), gb = await request(g, g.items[1]), gw = await request(g);
        const outs = await Promise.all([approve(ga), approve(gb, otherAdmin), approve(gw, superAdmin), approve(ga, otherAdmin), approve(gb), approve(gw)]);
        for (const o of outs) assert.ok(o.ok || /RETURN_APPROVE:ALREADY_RESTORED/.test(o.message), o.message);
        const s2 = await snap(g);
        assert.deepEqual([s2.packs, s2.restored], [[start[0] + 3, start[1] + 2], [3, 2]], `round ${round}`);
        assert.equal(fresh(outs).reduce((x, o) => x + o.r.units_restored, 0), 5);
      }

      // shortfall on line 0 only: line 0 stays blocked, the other line of the same product returns
      const k = await deliveredOrder({ pieces: [3, 2], missing: 1 });
      const kBefore = await snap(k);
      assert.match((await approve(await request(k, k.items[0]))).message ?? 'approved', /RETURN_APPROVE:RECONCILE/);
      assert.equal((await approve(await request(k, k.items[1]))).r?.units_restored, 2);
      const kAfter = await snap(k);
      assert.deepEqual([kAfter.packs, kAfter.restored, kAfter.wallet], [[kBefore.packs[0], kBefore.packs[1] + 2], [0, 2], kBefore.wallet]);
    });

    await test('SAME PRODUCT ON TWO LINES, REJECTION: rejecting either line or the whole order changes no inventory, no Coins and no points - legacy and pack stock; a rejected line can still be returned by a new request, once', async () => {
      const f = await legacyDelivered();
      const before = await legacySnap(f);
      const ids = [await request(f, f.items[0]), await request(f, f.items[1]), await request(f)];
      for (const id of ids) assert.deepEqual([(await reject(id)).r?.status, (await reject(id, superAdmin)).r?.replayed], ['rejected', true]);
      const after = await legacySnap(f);
      assert.deepEqual([after.movements, after.shelf, after.booked, after.wallet, after.loyalty, after.order], [before.movements, before.shelf, before.booked, before.wallet, before.loyalty, before.order]);
      assert.deepEqual(after.events, ['rejected:0:0:', 'rejected:0:0:', 'rejected:0:0:']);
      for (const id of ids) assert.match((await approve(id)).message ?? 'approved', /RETURN_APPROVE:ALREADY_RESOLVED:rejected/);
      assert.equal((await approve(await request(f, f.items[1], 'new request'))).r?.units_restored, 2);
      assert.deepEqual((await legacySnap(f)).movements, [2]);

      const g = await deliveredOrder({ pieces: [3, 2] });
      const gBefore = await snap(g);
      for (const item of [g.items[0], g.items[1], null]) assert.equal((await reject(await request(g, item))).r?.status, 'rejected');
      const gAfter = await snap(g);
      assert.deepEqual([gAfter.packs, gAfter.restored, gAfter.wallet, gAfter.loyalty, gAfter.order], [gBefore.packs, gBefore.restored, gBefore.wallet, gBefore.loyalty, gBefore.order]);
    });

    await test('CONSISTENCY SWEEP over every order touched above: history, request state, stock counters and wallet agree', async () => {
      // 1. every resolved request has exactly one history row of the same kind, and every history row has its request
      const mismatched = await q(`
        select r.id from public.return_requests r
          left join public.return_request_events e on e.return_request_id = r.id
         where (r.status::text in ('approved', 'rejected') and (e.id is null or e.action <> r.status::text or e.actor_id <> r.resolved_by))
            or (r.status::text = 'requested' and (e.id is not null or r.resolved_by is not null or r.resolved_at is not null))`);
      assert.deepEqual(mismatched, []);
      assert.equal((await q(`select count(*)::int n from public.return_request_events e where not exists (select 1 from public.return_requests r where r.id = e.return_request_id)`))[0].n, 0);
      assert.equal((await q(`select count(*)::int n from (select return_request_id from public.return_request_events group by 1 having count(*) > 1) x`))[0].n, 0);
      // 2. approvals restored > 0 units and rejections 0; the per-line detail adds up
      assert.equal((await q(`select count(*)::int n from public.return_request_events e where (e.action = 'approved') <> (e.units_restored > 0) or e.refund_paise <> 0
         or e.units_restored <> coalesce((select sum((l ->> 'units')::int) from jsonb_array_elements(e.lines) l), 0)`))[0].n, 0);
      // 3. simple-stock orders that are still "delivered": the restored counter equals what approved requests restored, line by line
      const drift = await q(`
        with per_line as (
          select (l ->> 'order_item_id')::uuid item, sum((l ->> 'units')::int)::int units
            from public.return_request_events e, jsonb_array_elements(e.lines) l where e.action = 'approved' group by 1)
        select oi.id, oi.stock_restored_quantity, coalesce(p.units, 0) units
          from public.order_items oi join public.orders o on o.id = oi.order_id left join per_line p on p.item = oi.id
         where o.simple_stock_mode and o.status::text = 'delivered' and oi.stock_restored_quantity <> coalesce(p.units, 0)`);
      assert.deepEqual(drift, []);
      // 4. nothing was ever restored beyond what was deducted
      assert.equal((await q(`select count(*)::int n from public.order_items where stock_restored_quantity > stock_deducted_quantity`))[0].n, 0);
      // 5. a return request never wrote to the wallet or the loyalty ledger
      const requestIds = (await q('select id from public.return_requests')).map((x) => x.id);
      assert.ok(requestIds.length > 30, `requests exercised: ${requestIds.length}`);
      assert.equal((await q(`select count(*)::int n from public.retailer_wallet_ledger where reference_id = any($1::uuid[]) or reference_type ilike '%return_request%'`, [requestIds]))[0].n, 0);
      assert.equal((await q(`select count(*)::int n from public.loyalty_ledger where reference_id = any($1::uuid[])`, [requestIds]))[0].n, 0);
      // 6. every order that is still "delivered" kept exactly its checkout debit (plus a shortfall credit where one was issued); no refund without "returned"
      assert.equal((await q(`select count(*)::int n from public.retailer_wallet_ledger l join public.orders o on o.id = l.reference_id
         where l.reference_type = 'order' and l.transaction_type = 'ORDER_REVERSAL' and o.status::text <> 'returned'`))[0].n, 0);
      console.log(`     (${requestIds.length} return requests, ${(await q('select count(*)::int n from public.return_request_events'))[0].n} history rows checked)`);
    });

    await test('catalogue hygiene (0101): fixed search_path, no PUBLIC/anon/authenticated execute; only the two entry points are open to service_role; both new tables have RLS and no write grant', async () => {
      const fn = await q(`select p.proname, p.prosecdef, p.proconfig::text cfg,
          has_function_privilege('anon', p.oid, 'execute') anon, has_function_privilege('authenticated', p.oid, 'execute') authn,
          has_function_privilege('service_role', p.oid, 'execute') svc, coalesce(p.proacl::text, '') acl
        from pg_proc p where p.pronamespace = 'public'::regnamespace
         and p.proname in ('approve_return_request_atomic', 'reject_return_request_atomic', '_return_request_restorable_lines', 'return_order_stock',
           'guard_return_request_write', 'guard_return_request_events_append_only') order by 1`);
      assert.equal(fn.length, 6);
      for (const f of fn) {
        assert.match(f.cfg, /search_path=public, pg_temp/, f.proname);
        assert.equal(f.anon, false, f.proname); assert.equal(f.authn, false, f.proname);
        assert.doesNotMatch(f.acl, /(^|[{,])=X/, `${f.proname} has no PUBLIC execute`);
        assert.equal(f.svc, ['approve_return_request_atomic', 'reject_return_request_atomic'].includes(f.proname), f.proname);
        assert.equal(f.prosecdef, !f.proname.startsWith('guard_'), f.proname);
      }
      const tableSql = `select c.relrowsecurity rls, has_table_privilege('authenticated', c.oid, 'insert') ai, has_table_privilege('authenticated', c.oid, 'update') au, has_table_privilege('authenticated', c.oid, 'delete') ad,
          has_table_privilege('service_role', c.oid, 'insert') si, has_table_privilege('service_role', c.oid, 'update') su, has_table_privilege('service_role', c.oid, 'delete') sd, has_table_privilege('service_role', c.oid, 'truncate') st,
          has_table_privilege('anon', c.oid, 'select') an, has_table_privilege('authenticated', c.oid, 'select') asel, has_table_privilege('authenticated', c.oid, 'truncate') atr
        from pg_class c where c.oid = $1::regclass`;
      for (const table of ['public.return_request_events', 'public.order_item_legacy_stock_returns']) {
        assert.deepEqual((await q(tableSql, [table]))[0], { rls: true, ai: false, au: false, ad: false, si: false, su: false, sd: false, st: false, an: false, asel: true, atr: false }, table);
      }
      // the per-line record of legacy stock returns is visible to Admins only
      const legacy = await legacyDelivered();
      assert.equal((await approve(await request(legacy, legacy.items[0]))).ok, true);
      const seen = async (who) => (await run(who, 'select count(*)::int n from public.order_item_legacy_stock_returns where order_id = $1', [legacy.order])).rows[0].n;
      assert.deepEqual([await seen(adminUser), await seen(superAdmin), await seen(staff), await seen(legacy.retailer)], [1, 1, 0, 0]);
      await assert.rejects(run('anon', 'select count(*) from public.order_item_legacy_stock_returns'), /permission denied/);
      for (const who of [adminUser, 'service']) {
        await assert.rejects(run(who, 'insert into public.order_item_legacy_stock_returns (order_item_id, order_id, product_id, units) values ($1, $2, $3, 1)', [legacy.items[1], legacy.order, product]), /permission denied/);
      }
    });

    await test('rollback 0101 with data present keeps every row (history archived), restores the 0054 stock function and grants; re-apply (twice) works and resolves a request', async () => {
      const f = await deliveredOrder();
      const id = await request(f);
      const counts = async (events) => (await q(`select (select count(*) from public.orders)::int o, (select count(*) from public.return_requests)::int r, (select count(*) from public.${events})::int e, (select count(*) from public.retailer_wallet_ledger)::int w, (select count(*) from public.order_items)::int i`))[0];
      // a legacy order with the same product on two lines; line 0 is returned BEFORE the rollback
      const lg = await legacyDelivered();
      assert.equal((await approve(await request(lg, lg.items[0]))).r?.units_restored, 3);
      const lgB = await request(lg, lg.items[1]), lgA2 = await request(lg, lg.items[0], 'after re-apply'), lgAll = await request(lg, null, 'after re-apply');
      const before = await counts('return_request_events');
      const marks = (await q('select count(*)::int n from public.order_item_legacy_stock_returns'))[0].n;
      assert.ok(marks > 0);
      const down = fs.readFileSync(path.join(ROLLBACKS, '0101_atomic_return_request_resolution.down.sql'), 'utf8');
      await admin.query(down);
      assert.deepEqual(await counts('return_request_events_rollback_archive'), before);
      assert.match((await approve(id)).message, /does not exist/);
      assert.equal((await q(`select count(*)::int n from pg_trigger where tgname in ('trg_guard_return_request_write', 'trg_guard_return_request_events_append_only')`))[0].n, 0);
      assert.equal((await q(`select has_function_privilege('authenticated', 'public.return_order_stock(uuid, uuid)', 'execute') x`))[0].x, true);
      assert.equal((await q(`select to_regclass('public.return_request_events') is null x`))[0].x, true);
      assert.equal((await q(`select to_regclass('public.order_item_legacy_stock_returns') is null x`))[0].x, true);
      assert.equal((await q('select count(*)::int n from public.order_item_legacy_stock_returns_rollback_archive'))[0].n, marks);
      await admin.query(readMigration('0101_atomic_return_request_resolution.sql'));
      await admin.query(readMigration('0101_atomic_return_request_resolution.sql'));
      const out = await approve(id);
      assert.equal(out.ok, true, out.message);
      assert.deepEqual([(await snap(f)).packs, (await snap(f)).events.length], [[10], 1]);
      // the per-line record started empty again, yet the line returned before the rollback cannot come back a second time
      // (the product-level limit counts the movement already written); the other line of the same product still can, once
      assert.equal((await q('select count(*)::int n from public.order_item_legacy_stock_returns where order_id = $1', [lg.order]))[0].n, 0);
      assert.equal((await approve(lgB)).r?.units_restored, 2);
      assert.match((await approve(lgAll)).message ?? 'approved', /RETURN_APPROVE:ALREADY_RESTORED/);
      assert.match((await approve(lgA2)).message ?? 'approved', /RETURN_APPROVE:ALREADY_RESTORED/);
      assert.deepEqual((await legacySnap(lg)).movements, [3, 2]);
      // a second rollback folds the new history into the archive without losing a row
      await admin.query(down);
      assert.equal((await counts('return_request_events_rollback_archive')).e, before.e + 2);
      await admin.query(readMigration('0101_atomic_return_request_resolution.sql'));
      assert.equal((await q(`select has_function_privilege('authenticated', 'public.return_order_stock(uuid, uuid)', 'execute') x`))[0].x, false);
      // the 0100 full return still works with 0101 in place (it calls the now-private stock function)
      const g = await deliveredOrder();
      const rto = await svc(RETURN, [g.order, staff, null]);
      assert.equal(rto.ok, true, rto.message);
      assert.deepEqual((await snap(g)).packs, [10]);
    });

    // =================================================================== 0102
    await test('0102: anonymous reads of products / product_packs / product_images return no rows and no error; signed-in Admin still reads; rollback brings the permission error back; re-apply (twice) fixes it again', async () => {
      const anonRows = async (table) => (await run('anon', `select 1 from public.${table}`)).rowCount;
      assert.ok((await q('select count(*)::int n from public.products'))[0].n > 0);
      for (const table of ['products', 'product_packs', 'product_images']) assert.equal(await anonRows(table), 0, table);
      await assert.rejects(run('anon', 'select public.product_is_sale_eligible($1)', [product]), /permission denied for function product_is_sale_eligible/);
      assert.ok((await run(adminUser, 'select 1 from public.products')).rowCount > 0);
      assert.deepEqual((await q(`select policyname, roles::text from pg_policies where schemaname = 'public' and policyname in ('products_read', 'product_packs_read', 'sellers_select') order by 1`)).map((r) => r.roles), ['{authenticated}', '{authenticated}', '{authenticated}']);

      const down = fs.readFileSync(path.join(ROLLBACKS, '0102_anonymous_read_policies_fail_closed.down.sql'), 'utf8');
      const rowsBefore = (await q('select (select count(*) from public.products)::int p, (select count(*) from public.product_packs)::int k'))[0];
      await admin.query(down);
      await assert.rejects(run('anon', 'select 1 from public.products'), /permission denied for function product_is_sale_eligible/);
      assert.deepEqual((await q('select (select count(*) from public.products)::int p, (select count(*) from public.product_packs)::int k'))[0], rowsBefore);
      await admin.query(readMigration('0102_anonymous_read_policies_fail_closed.sql'));
      await admin.query(readMigration('0102_anonymous_read_policies_fail_closed.sql'));
      for (const table of ['products', 'product_packs', 'product_images']) assert.equal(await anonRows(table), 0, table);
      assert.ok((await run(adminUser, 'select 1 from public.product_packs')).rowCount > 0);
    });

    console.log(`PR #126 atomic return requests on real PostgreSQL ${version}: ${passed} passed, 0 failed. Deadlock victims: ${deadlocks.length}.`);
    assert.equal(deadlocks.length, 0);
  } finally {
    for (const c of clients) await c.end().catch(() => {});
    if (started) await cluster.stop();
    fs.rmSync(temp, { recursive: true, force: true });
  }
}
main().catch((error) => { console.error(error.stack || error); process.exitCode = 1; });
