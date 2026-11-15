/* PR #126 lock order (0096 / 0099) and atomic dispatch / failure / return (0100)
 * on a REAL, disposable PostgreSQL 17 cluster, with SEVERAL sessions at once.
 *
 * What is proven here and cannot be proven on PGlite (one connection):
 *   - a delivery completion racing direct line edits never deadlocks and
 *     never leaves mixed quantities, in every forced interleaving;
 *   - a CONTROL run with the old waiting line guard DOES deadlock on the same
 *     schedule, so the schedule really exercises the lock inversion;
 *   - concurrent dispatch / failed-delivery / return-to-warehouse calls do
 *     their work exactly once (stock, wallet, loyalty), and an injected
 *     failure at any write rolls every table back;
 *   - proof files are checked against storage.objects (existence, bucket,
 *     folder, uploader) and the Storage policies agree with that check.
 *
 * It starts its own loopback-only temporary cluster, applies every repository
 * migration, accepts no database URL and never connects to a remote or
 * existing database. The cluster directory is deleted on exit.
 *
 * Requires test-only npm packages on NODE_PATH (not project dependencies):
 *   embedded-postgres@17.11.0-beta.19  and  pg
 * Run:  NODE_PATH=<dir>/node_modules node tests/pr126-fulfilment-and-locks.pg.mjs
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
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function main() {
  const EmbeddedPostgres = (await import(pathToFileURL(runtimeRequire.resolve('embedded-postgres')).href)).default;
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'maharani-pr126-fl-pg17-'));
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

    async function isWaitingOnLock(c) {
      const { rows } = await admin.query(`select wait_event_type from pg_stat_activity where pid = $1`, [c.processID]);
      return rows[0]?.wait_event_type === 'Lock';
    }
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
    async function state(f) {
      const d = (await admin.query('select delivery_status s, otp_attempts a, completed_by c from public.order_deliveries where id = $1', [f.delivery])).rows[0];
      const o = (await admin.query('select status::text s from public.orders where id = $1', [f.order])).rows[0];
      const l = (await admin.query('select quantity_delivered d, quantity_missing m from public.order_delivery_items where delivery_id = $1 order by created_at, id', [f.delivery])).rows;
      const w = (await admin.query(`select amount_paise::int p from public.retailer_wallet_ledger where reference_type = 'delivery' and reference_id = $1`, [f.delivery])).rows;
      const p = (await admin.query('select entry_type t, points n from public.loyalty_ledger where reference_id = $1 order by created_at', [f.order])).rows;
      const r = (await admin.query('select count(*)::int n from public.delivery_completion_requests where delivery_id = $1', [f.delivery])).rows[0].n;
      return { delivery: d.s, attempts: d.a, by: d.c, order: o.s, lines: l.map((x) => `${x.d}/${x.m}`), credits: w.map((x) => x.p), loyalty: p.map((x) => `${x.t}:${x.n}`), requests: r };
    }
    const untouched = (f, attempts = 0) => ({ delivery: 'assigned', attempts, by: null, order: 'dispatched', lines: f.items.map(() => '0/0'), credits: [], loyalty: [], requests: 0 });
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
    const FAIL = `select public.fail_delivery_atomic($1, $2, $3) as r`;
    const RETURN = `select public.return_delivery_to_warehouse_atomic($1, $2, $3) as r`;
    const COMPLETE_PROOF = `select public.complete_delivery_atomic($1, $2, $3, $4, $5, null, $7, $8, $6::jsonb) as r`;
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
    /** sent() -> completed through the real function (missing = pieces short on the line). */
    async function delivered({ missing = 0, actor = staff } = {}) {
      const f = await sent(actor);
      const out = await complete(args(f, { actor, missing }));
      assert.equal(out.ok, true, out.message);
      return f;
    }
    async function full(f) {
      const o = (await q('select status::text s, dispatched_by b from public.orders where id = $1', [f.order]))[0];
      const d = (await q('select id, delivery_status s, assigned_staff_id a, otp_hash h, failure_reason fr from public.order_deliveries where order_id = $1', [f.order]));
      const l = d.length ? await q('select quantity_ordered o, quantity_delivered d, quantity_missing m from public.order_delivery_items where delivery_id = $1 order by created_at, id', [d[0].id]) : [];
      return {
        order: o.s,
        deliveries: d.map((x) => x.s),
        lines: l.map((x) => `${x.o}:${x.d}/${x.m}`),
        packStock: f.pack ? (await q('select stock_quantity n from public.product_packs where id = $1', [f.pack]))[0].n : null,
        restored: f.pack ? (await q('select stock_restored_quantity n from public.order_items where id = $1', [f.items[0]]))[0].n : null,
        reversals: (await q(`select amount_paise::int n from public.retailer_wallet_ledger where reference_type = 'order' and reference_id = $1 and transaction_type = 'ORDER_REVERSAL' order by 1`, [f.order])).map((x) => x.n),
        shortfall: f.delivery ? (await q(`select amount_paise::int n from public.retailer_wallet_ledger where reference_type = 'delivery' and reference_id = $1`, [f.delivery])).map((x) => x.n) : [],
        loyalty: (await q('select entry_type t, points n from public.loyalty_ledger where reference_id = $1 order by created_at, points desc', [f.order])).map((x) => `${x.t}:${x.n}`),
      };
    }
    const LINE_WRITE = 'update public.order_delivery_items set quantity_delivered = 4, quantity_missing = 6 where order_item_id = $1';
    async function waitFor(c, label) {
      for (let i = 0; i < 100; i++) { if (await isWaitingOnLock(c)) return; await sleep(50); }
      throw new Error(`${label}: session never reached a lock wait`);
    }
    /** Settles a query on an open transaction into {ok, r | message, code}. */
    const settle = (promise) => promise.then((res) => ({ ok: true, r: res.rows[0]?.r }), (error) => ({ ok: false, message: error.message, code: error.code }));

    // ===================================================== LOCK ORDER (0096 / 0099)
    // The dangerous window: a direct line UPDATE has locked the LINE row but its
    // guard trigger has not yet asked for the DELIVERY row. A pause trigger that
    // fires before the guard (triggers fire in name order) holds it exactly there.
    await admin.query(`create or replace function public._test_pause() returns trigger language plpgsql as $$ begin perform pg_advisory_xact_lock(4242); return new; end $$`);
    async function forcedWindow() {
      const f = await dispatched([[1000, 10]]);
      await admin.query(`create trigger trg_a_test_pause before update on public.order_delivery_items for each row execute function public._test_pause()`);
      const gate = await client(), writer = await client(), completer = await client();
      try {
        await gate.query('select pg_advisory_lock(4242)');
        await begin(writer, staff);
        const write = settle(writer.query(LINE_WRITE, [f.items[0]]));
        await waitFor(writer, 'line writer');                    // holds the line row, parked before the guard
        await begin(completer, 'service');
        const completion = settle(completer.query(COMPLETE, args(f, { missing: 1 })));
        await waitFor(completer, 'completion');                  // holds order + delivery, waits for the line row
        await gate.query('select pg_advisory_unlock(4242)');     // the guard now asks for the delivery row
        const [w, c] = await Promise.all([write, completion]);
        await writer.query(w.ok ? 'commit' : 'rollback');
        await completer.query(c.ok ? 'commit' : 'rollback');
        return { f, w, c };
      } finally {
        await gate.query('select pg_advisory_unlock_all()');
        await admin.query('drop trigger trg_a_test_pause on public.order_delivery_items');
      }
    }

    await test('LOCK ORDER: line row locked first, completion holds the delivery row: the line write is refused at once, completion finishes, NO deadlock', async () => {
      const { f, w, c } = await forcedWindow();
      assert.equal(c.ok, true, c.message);
      assert.equal(w.ok, false);
      assert.equal(w.code, '55P03', w.message);
      assert.match(w.message, /DELIVERY_GUARD:BUSY/);
      assert.deepEqual(await state(f), { delivery: 'partially_delivered', attempts: 0, by: staff, order: 'delivered', lines: ['9/1'], credits: [10000], loyalty: ['ORDER_EARN:9'], requests: 1 });
    });

    await test('CONTROL: with the OLD waiting line guard the same schedule DEADLOCKS (proves the schedule exercises the inversion); the real guard is then restored', async () => {
      const real = readMigration('0096_delivery_snapshot_integrity.sql');
      assert.equal(real.split('for share of od nowait').length, 2, 'exactly one NOWAIT lock in the 0096 guard');
      await admin.query(real.replace('for share of od nowait', 'for share of od'));
      let outcome;
      try { outcome = await forcedWindow(); } finally { await admin.query(real); }
      const { f, w, c } = outcome;
      assert.equal([w, c].filter((x) => !x.ok && x.code === '40P01').length, 1, `one session is a deadlock victim: ${w.message} | ${c.message}`);
      const s = await state(f);
      assert.ok(['assigned', 'partially_delivered'].includes(s.delivery));
      const again = await forcedWindow();
      assert.equal(again.c.ok, true, again.c.message);
      assert.equal(again.w.code, '55P03');
    });

    await test('LOCK ORDER: completion committed first: a waiting line write is then refused; quantities stay as verified', async () => {
      const f = await dispatched([[1000, 10]]);
      const completer = await client(), writer = await client();
      await begin(completer, 'service');
      await completer.query(COMPLETE, args(f, { missing: 1 }));
      await begin(writer, staff);
      const write = settle(writer.query(LINE_WRITE, [f.items[0]]));
      await waitFor(writer, 'line writer');
      await completer.query('commit');
      const w = await write;
      await writer.query('rollback');
      assert.equal(w.ok, false);
      assert.notEqual(w.code, '40P01');
      assert.deepEqual((await state(f)).lines, ['9/1']);
    });

    await test('LOCK ORDER: line write committed first: completion waits at the DELIVERY row (holding no line lock), then applies the verified quantities', async () => {
      const f = await dispatched([[1000, 10]]);
      const writer = await client(), completer = await client();
      await begin(writer, staff);
      await writer.query(LINE_WRITE, [f.items[0]]);
      await begin(completer, 'service');
      const completion = settle(completer.query(COMPLETE, args(f, { missing: 1 })));
      await waitFor(completer, 'completion');
      const held = await q(`select c.relname from pg_locks l join pg_class c on c.oid = l.relation where l.pid = $1 and l.locktype = 'tuple'`, [completer.processID]);
      const waiting = await q(`select c.relname from pg_locks l join pg_class c on c.oid = l.relation where l.pid = $1 and l.locktype = 'tuple' and c.relname = 'order_delivery_items'`, [completer.processID]);
      assert.deepEqual(waiting, [], `completion must not be queued on a line row while waiting (${JSON.stringify(held)})`);
      await writer.query('commit');
      const c = await completion;
      await completer.query('commit');
      assert.equal(c.ok, true, c.message);
      assert.deepEqual((await state(f)).lines, ['9/1']);
      assert.deepEqual((await state(f)).credits, [10000]);
    });

    await test('LOCK ORDER: completion vs line UPDATEs, line INSERTs and admin line edits, free-running - 40 rounds, zero deadlocks, every delivery consistent', async () => {
      for (let round = 0; round < rounds(40); round++) {
        const f = await dispatched([[1000, 10], [500, 5]]);
        const jobs = [];
        const jitter = () => sleep(Math.floor(Math.random() * 12));
        for (let i = 0; i < 4; i++) jobs.push(jitter().then(() => run(staff, 'update public.order_delivery_items set quantity_delivered = $2, quantity_missing = quantity_ordered - $2 where order_item_id = $1', [f.items[i % 2], i + 1]).then(() => ({ ok: true }), (e) => ({ ok: false, message: e.message, code: e.code }))).then(note));
        for (let i = 0; i < 2; i++) jobs.push(jitter().then(() => run(superAdmin, 'update public.order_delivery_items set quantity_damaged = 1, quantity_delivered = quantity_ordered - 1, quantity_missing = 0 where order_item_id = $1', [f.items[i]]).then(() => ({ ok: true }), (e) => ({ ok: false, message: e.message, code: e.code }))).then(note));
        jobs.push(jitter().then(() => run(superAdmin, 'insert into public.order_delivery_items (delivery_id, order_item_id, quantity_ordered) values ($1, $2, 10)', [f.delivery, f.items[0]]).then(() => ({ ok: true }), (e) => ({ ok: false, message: e.message, code: e.code }))).then(note));
        const completions = [0, 1, 2].map((n) => jitter().then(() => complete(args(f, { missing: 2, actor: n === 2 ? superAdmin : staff, key: `race:${f.order}:shared-key....` }))).then(note));
        const done = await Promise.all([...jobs, ...completions]);
        const won = (await Promise.all(completions)).filter((x) => x.ok);
        assert.ok(won.length >= 1, `round ${round}: a completion succeeds (${done.filter((x) => !x.ok).map((x) => x.message).join(' | ')})`);
        const s = await state(f);
        assert.deepEqual({ d: s.delivery, o: s.order, l: s.lines, c: s.credits, r: s.requests }, { d: 'partially_delivered', o: 'delivered', l: ['8/2', '5/0'], c: [20000], r: 1 }, `round ${round}`);
        assert.deepEqual(s.loyalty, ['ORDER_EARN:13'], `round ${round}`);
      }
      assert.deepEqual(deadlocks, [], 'no session was a deadlock victim');
    });

    await test('LOCK ORDER: the shortfall credit function called directly (delivery row first) racing completion (order first) does not deadlock', async () => {
      for (let round = 0; round < rounds(15); round++) {
        const f = await dispatched([[1000, 10]]);
        const direct = [0, 1].map(() => run(superAdmin, `select public.order_shortfall_coins($1, 0, 'race', null, false) r`, [f.delivery]).then(() => ({ ok: true }), (e) => ({ ok: false, message: e.message, code: e.code })).then(note));
        const out = await Promise.all([complete(args(f, { missing: 2 })).then(note), ...direct]);
        assert.equal(out[0].ok, true, out[0].message);
        assert.deepEqual((await state(f)).credits, [20000], 'exactly one credit');
      }
      assert.deepEqual(deadlocks, []);
    });

    // ============================================================ PROOF FILES
    const putProof = (name, owner, extra = {}) => admin.query(
      `insert into storage.objects (bucket_id, name, owner, owner_id, archived_at, is_delete_marker) values ($1, $2, $3, $4, $5, $6)`,
      [extra.bucket ?? 'delivery-proofs', name, owner, owner ? String(owner) : null, extra.archived ? new Date() : null, extra.deleteMarker ?? false]);
    const proofArgs = (f, sig, photo, actor = staff) => [...args(f, { actor, key: `proof:${digest(`${f.order}:${sig}:${photo}:${actor}`)}` }), sig, photo];
    const completeProof = (a) => svc(COMPLETE_PROOF, a);

    await test('PROOF: a file uploaded by the assignee into this order\'s folder is accepted and stored', async () => {
      const f = await dispatched();
      const sig = `deliveries/${f.order}/${randomUUID()}.png`, photo = `deliveries/${f.order}/${randomUUID()}.jpg`;
      await putProof(sig, staff); await putProof(photo, staff);
      const out = await completeProof(proofArgs(f, sig, photo));
      assert.equal(out.ok, true, out.message);
      assert.deepEqual((await q('select signature_url s, photo_url p from public.order_deliveries where id = $1', [f.delivery]))[0], { s: sig, p: photo });
    });

    await test('PROOF: refused and NOTHING written - nonexistent file, another order\'s file, another user\'s file, a retailer\'s file, wrong bucket, forged paths, archived, delete marker, no uploader', async () => {
      const other = await dispatched();
      const otherFile = `deliveries/${other.order}/${randomUUID()}.png`;
      await putProof(otherFile, staff);
      const cases = [];
      const add = async (label, makeRef, pattern) => { const f = await dispatched(); cases.push({ label, f, ref: await makeRef(f), pattern }); };
      await add('nonexistent', (f) => `deliveries/${f.order}/${randomUUID()}.png`, /PROOF_MISSING/);
      await add('another order', () => otherFile, /DELIVERY_COMPLETE:PROOF:/);
      await add('another staff member', async (f) => { const n = `deliveries/${f.order}/${randomUUID()}.png`; await putProof(n, otherStaff); return n; }, /PROOF_OWNER/);
      await add('a retailer', async (f) => { const n = `deliveries/${f.order}/${randomUUID()}.png`; await putProof(n, f.retailer); return n; }, /PROOF_OWNER/);
      await add('unassigned salesman', async (f) => { const n = `deliveries/${f.order}/${randomUUID()}.png`; await putProof(n, salesman); return n; }, /PROOF_OWNER/);
      await add('wrong bucket', async (f) => { const n = `deliveries/${f.order}/${randomUUID()}.png`; await putProof(n, staff, { bucket: 'payment-proofs' }); return n; }, /PROOF_MISSING/);
      await add('path traversal', (f) => `deliveries/${f.order}/../${other.order}/${otherFile.split('/')[2]}`, /DELIVERY_COMPLETE:PROOF:/);
      await add('prefix trick', (f) => `deliveries/${f.order}x/${randomUUID()}.png`, /DELIVERY_COMPLETE:PROOF:/);
      await add('absolute url', (f) => `https://evil.invalid/deliveries/${f.order}/a.png`, /DELIVERY_COMPLETE:PROOF:/);
      await add('archived version', async (f) => { const n = `deliveries/${f.order}/${randomUUID()}.png`; await putProof(n, staff, { archived: true }); return n; }, /PROOF_MISSING/);
      await add('delete marker', async (f) => { const n = `deliveries/${f.order}/${randomUUID()}.png`; await putProof(n, staff, { deleteMarker: true }); return n; }, /PROOF_MISSING/);
      await add('no recorded uploader', async (f) => { const n = `deliveries/${f.order}/${randomUUID()}.png`; await putProof(n, null); return n; }, /PROOF_OWNER/);
      for (const c of cases) {
        for (const slot of ['signature', 'photo']) {
          const out = await completeProof(proofArgs(c.f, slot === 'signature' ? c.ref : null, slot === 'photo' ? c.ref : null));
          assert.equal(out.ok, false, `${c.label} (${slot}) must be refused`);
          assert.match(out.message, c.pattern, `${c.label} (${slot}): ${out.message}`);
        }
        assert.deepEqual(await state(c.f), untouched(c.f), `${c.label}: nothing written`);
      }
    });

    await test('PROOF: an Admin\'s upload is accepted for any delivery; the assignee\'s upload is accepted when an Admin completes', async () => {
      const a = await dispatched();
      const byAdmin = `deliveries/${a.order}/${randomUUID()}.png`;
      await putProof(byAdmin, adminUser);
      assert.equal((await completeProof(proofArgs(a, byAdmin, null))).ok, true);
      const b = await dispatched();
      const byAssignee = `deliveries/${b.order}/${randomUUID()}.png`;
      await putProof(byAssignee, staff);
      const out = await completeProof(proofArgs(b, byAssignee, null, superAdmin));
      assert.equal(out.ok, true, out.message);
    });

    await test('PROOF: Storage policies agree with the RPC - only the assignee or an Admin can upload into the folder; nobody can rewrite or delete a proof; no direct RPC call', async () => {
      const f = await dispatched();
      const name = () => `deliveries/${f.order}/${randomUUID()}.png`;
      const insert = `insert into storage.objects (bucket_id, name, owner, owner_id) values ('delivery-proofs', $1, $2, $3)`;
      const mine = name();
      await run(staff, insert, [mine, staff, staff]);
      await run(adminUser, insert, [name(), adminUser, adminUser]);
      for (const who of [otherStaff, salesman, f.retailer]) {
        await assert.rejects(run(who, insert, [name(), who, who]), /row-level security/, 'non-assignee upload is refused by Storage RLS');
      }
      await assert.rejects(run('anon', insert, [name(), null, null]), /row-level security|permission denied/);
      // No UPDATE / DELETE policy exists for the bucket: ownership cannot be rewritten or a proof swapped.
      for (const who of [staff, otherStaff, f.retailer]) {
        assert.equal((await run(who, `update storage.objects set owner_id = $2, owner = $3 where name = $1`, [mine, who, who])).rowCount, 0);
        assert.equal((await run(who, `delete from storage.objects where name = $1`, [mine])).rowCount, 0);
      }
      assert.equal((await q('select owner_id from storage.objects where name = $1', [mine]))[0].owner_id, staff);
      const policies = await q(`select cmd from pg_policies where schemaname = 'storage' and tablename = 'objects' and (coalesce(qual, '') || coalesce(with_check, '')) like '%delivery-proofs%' order by 1`);
      assert.deepEqual(policies.map((p) => p.cmd), ['INSERT', 'SELECT']);
      for (const who of [staff, adminUser, superAdmin, f.retailer, 'anon']) {
        await assert.rejects(run(who, COMPLETE_PROOF, proofArgs(f, mine, null)), /permission denied/);
      }
      assert.deepEqual(await state(f), untouched(f));
    });

    // ================================================================ DISPATCH
    await test('DISPATCH: one call moves the order, creates one delivery task for the actor with the OTP digest, and snapshots every line; attribution is the real actor', async () => {
      const f = await packed();
      const out = await svc(DISPATCH, [f.order, staff, f.otp]);
      assert.equal(out.ok, true, out.message);
      assert.equal(out.r.status, 'dispatched'); assert.equal(out.r.redispatch, false);
      assert.deepEqual(out.r.product_ids, [product]);
      f.delivery = out.r.delivery_id;
      const s = await full(f);
      assert.deepEqual({ o: s.order, d: s.deliveries, l: s.lines, stock: s.packStock }, { o: 'dispatched', d: ['assigned'], l: ['3:0/0'], stock: 7 });
      const d = (await q('select assigned_staff_id a, assigned_by b, otp_hash h, otp_attempts n from public.order_deliveries where id = $1', [f.delivery]))[0];
      assert.deepEqual(d, { a: staff, b: staff, h: f.otp, n: 0 });
      assert.equal((await q('select dispatched_by b from public.orders where id = $1', [f.order]))[0].b, staff);
      const history = await q(`select changed_by from public.order_status_history where order_id = $1 and status = 'dispatched'`, [f.order]);
      assert.deepEqual(history.map((h) => h.changed_by), [staff]);
    });

    await test('DISPATCH: 12 simultaneous calls (staff, admin, super-admin) - exactly one dispatches; one task, one snapshot; the rest are refused cleanly', async () => {
      for (let round = 0; round < rounds(5); round++) {
        const f = await packed();
        const actors = [staff, adminUser, superAdmin];
        const out = (await Promise.all(Array.from({ length: 12 }, (_, i) => svc(DISPATCH, [f.order, actors[i % 3], digest(`otp:${f.order}:${i}`)])))).map(note);
        const won = out.filter((x) => x.ok);
        assert.equal(won.length, 1, out.map((x) => x.message).join(' | '));
        for (const lost of out.filter((x) => !x.ok)) assert.match(lost.message, /DISPATCH:ALREADY_DISPATCHED/);
        f.delivery = won[0].r.delivery_id;
        const s = await full(f);
        assert.deepEqual({ o: s.order, d: s.deliveries, l: s.lines, stock: s.packStock }, { o: 'dispatched', d: ['assigned'], l: ['3:0/0'], stock: 7 });
      }
      assert.deepEqual(deadlocks, []);
    });

    await test('DISPATCH: an injected failure at ANY write (order, delivery task, line snapshot) leaves the order exactly as it was; the retry then succeeds', async () => {
      for (const [table, when] of [['orders', 'update'], ['order_deliveries', 'insert'], ['order_delivery_items', 'insert']]) {
        const f = await packed();
        await withFailure(table, when, async () => {
          const out = await svc(DISPATCH, [f.order, staff, f.otp]);
          assert.equal(out.ok, false); assert.match(out.message, /TEST_INJECTED_FAILURE/);
        });
        const s = await full(f);
        assert.deepEqual({ o: s.order, d: s.deliveries, l: s.lines, stock: s.packStock }, { o: 'packed', d: [], l: [], stock: 7 }, `${table}: nothing partial`);
        assert.equal((await svc(DISPATCH, [f.order, staff, f.otp])).ok, true);
      }
    });

    await test('DISPATCH: a pre-0054 (batch stock) order with no stock is refused by the stock step and nothing changes', async () => {
      const f = await packed();
      await replica(() => admin.query('update public.orders set simple_stock_mode = false where id = $1', [f.order]));
      const out = await svc(DISPATCH, [f.order, staff, f.otp]);
      assert.equal(out.ok, false, 'no batch stock exists for this product');
      const s = await full(f);
      assert.deepEqual({ o: s.order, d: s.deliveries, l: s.lines }, { o: 'packed', d: [], l: [] });
      assert.equal((await q(`select count(*)::int n from public.stock_movements where reference_id = $1`, [f.order]).catch(() => [{ n: 0 }]))[0].n, 0);
    });

    await test('DISPATCH: who may - API roles cannot execute; salesman, retailer, deactivated, unknown and out-of-scope staff are refused; wrong states are refused', async () => {
      const f = await packed();
      for (const who of [staff, adminUser, superAdmin, f.retailer, 'anon']) await assert.rejects(run(who, DISPATCH, [f.order, staff, f.otp]), /permission denied/);
      for (const actor of [salesman, f.retailer, randomUUID()]) assert.match((await svc(DISPATCH, [f.order, actor, f.otp])).message, /DISPATCH:NO_PERMISSION/);
      const inactive = await user('staff');
      await admin.query('insert into public.staff_assignments (staff_id, warehouse_id) values ($1, $2)', [inactive, warehouse]);
      await admin.query('update public.profiles set is_active = false where id = $1', [inactive]);
      assert.match((await svc(DISPATCH, [f.order, inactive, f.otp])).message, /DISPATCH:NO_PERMISSION/);
      const outsider = await user('staff'); // no warehouse / area assignment
      assert.match((await svc(DISPATCH, [f.order, outsider, f.otp])).message, /DISPATCH:SCOPE/);
      assert.match((await svc(DISPATCH, [f.order, staff, 'not-a-digest'])).message, /DISPATCH:INVALID_INPUT/);
      assert.match((await svc(DISPATCH, [randomUUID(), staff, f.otp])).message, /DISPATCH:NOT_FOUND/);
      const pending = await packed();
      await replica(() => admin.query(`update public.orders set status = 'pending' where id = $1`, [pending.order]));
      assert.match((await svc(DISPATCH, [pending.order, staff, pending.otp])).message, /DISPATCH:ORDER_STATE:pending/);
      const s = await full(f);
      assert.deepEqual({ o: s.order, d: s.deliveries }, { o: 'packed', d: [] });
    });

    await test('GUARD: no API role can dispatch, return or re-open an order with a plain UPDATE (admin, super-admin, staff, service key)', async () => {
      const f = await packed();
      for (const who of [adminUser, superAdmin, 'service']) {
        await assert.rejects(run(who, `update public.orders set status = 'dispatched' where id = $1`, [f.order]), /FULFILMENT_GUARD/);
      }
      assert.equal((await full(f)).order, 'packed');
      const g = await sent();
      for (const who of [adminUser, superAdmin, 'service']) {
        await assert.rejects(run(who, `update public.orders set status = 'processing' where id = $1`, [g.order]), /FULFILMENT_GUARD/);
        await assert.rejects(run(who, `update public.orders set status = 'returned' where id = $1`, [g.order]), /FULFILMENT_GUARD/);
      }
      assert.equal((await full(g)).order, 'dispatched');
      const h = await delivered();
      for (const who of [adminUser, superAdmin, 'service']) {
        await assert.rejects(run(who, `update public.orders set status = 'returned' where id = $1`, [h.order]), /FULFILMENT_GUARD/);
      }
      const s = await full(h);
      assert.deepEqual({ o: s.order, r: s.reversals, stock: s.packStock }, { o: 'delivered', r: [], stock: 7 });
    });

    await test('GUARD: no API role can fail, re-open or return a DELIVERY TASK with a plain UPDATE, or rewrite quantities after completion', async () => {
      const f = await sent();
      for (const who of [adminUser, superAdmin, 'service']) {
        await assert.rejects(run(who, `update public.order_deliveries set delivery_status = 'failed' where id = $1`, [f.delivery]), /FULFILMENT_GUARD/);
      }
      await svc(FAIL, [f.order, staff, 'Shop closed']);
      for (const who of [adminUser, superAdmin, 'service']) {
        await assert.rejects(run(who, `update public.order_deliveries set delivery_status = 'assigned' where id = $1`, [f.delivery]), /FULFILMENT_GUARD/);
      }
      assert.deepEqual((await full(f)).deliveries, ['failed']);
      const done = await delivered();
      for (const who of [adminUser, superAdmin, 'service']) {
        await assert.rejects(run(who, `update public.order_deliveries set delivery_status = 'returned_to_warehouse' where id = $1`, [done.delivery]), /FULFILMENT_GUARD/);
        await assert.rejects(run(who, `update public.order_delivery_items set quantity_delivered = 1, quantity_missing = 2 where delivery_id = $1`, [done.delivery]), /DELIVERY_GUARD/);
        await assert.rejects(run(who, `delete from public.order_delivery_items where delivery_id = $1`, [done.delivery]), /DELIVERY_GUARD/);
      }
      const s = await full(done);
      assert.deepEqual({ d: s.deliveries, l: s.lines, stock: s.packStock, r: s.reversals }, { d: ['delivered'], l: ['3:3/0'], stock: 7, r: [] });
    });

    // ========================================================= FAILED DELIVERY
    await test('FAIL: one call marks the delivery failed and re-opens the order; a repeat is a replay that writes nothing', async () => {
      const f = await sent();
      const out = await svc(FAIL, [f.order, staff, 'Shop closed']);
      assert.equal(out.ok, true, out.message);
      assert.deepEqual({ replayed: out.r.replayed, reopened: out.r.order_reopened }, { replayed: false, reopened: true });
      const before = await q('select delivery_status s, failure_reason r, updated_at u from public.order_deliveries where id = $1', [f.delivery]);
      assert.deepEqual({ s: before[0].s, r: before[0].r }, { s: 'failed', r: 'Shop closed' });
      assert.equal((await full(f)).order, 'processing');
      const again = await svc(FAIL, [f.order, staff, 'Another reason']);
      assert.equal(again.r.replayed, true);
      const after = await q('select delivery_status s, failure_reason r, updated_at u from public.order_deliveries where id = $1', [f.delivery]);
      assert.deepEqual(after, before, 'the replay changed nothing, not even the reason');
    });

    await test('FAIL: 10 simultaneous calls - exactly one writes, nine replay; an injected failure on the order update rolls the delivery back too', async () => {
      const f = await sent();
      const out = (await Promise.all(Array.from({ length: 10 }, (_, i) => svc(FAIL, [f.order, i % 2 ? staff : superAdmin, `Reason ${i}`])))).map(note);
      assert.equal(out.every((x) => x.ok), true, out.map((x) => x.message).join(' | '));
      assert.equal(out.filter((x) => x.r.replayed === false).length, 1);
      assert.equal((await q(`select count(*)::int n from public.order_status_history where order_id = $1 and status = 'processing'`, [f.order]))[0].n, 2, 'processing once before dispatch, once after the failure');
      const g = await sent();
      await withFailure('orders', 'update', async () => {
        assert.match((await svc(FAIL, [g.order, staff, 'Shop closed'])).message, /TEST_INJECTED_FAILURE/);
      });
      const s = await full(g);
      assert.deepEqual({ o: s.order, d: s.deliveries }, { o: 'dispatched', d: ['assigned'] }, 'no failed task on a still-dispatched order');
      assert.deepEqual(deadlocks, []);
    });

    await test('FAIL: who may - only the assignee or an Admin; API roles cannot execute; a completed delivery cannot be failed', async () => {
      const f = await sent();
      for (const who of [staff, adminUser, f.retailer, 'anon']) await assert.rejects(run(who, FAIL, [f.order, staff, 'Shop closed']), /permission denied/);
      assert.match((await svc(FAIL, [f.order, otherStaff, 'Shop closed'])).message, /DELIVERY_FAIL:NOT_ASSIGNED/);
      assert.match((await svc(FAIL, [f.order, salesman, 'Shop closed'])).message, /DELIVERY_FAIL:NOT_ASSIGNED/);
      assert.match((await svc(FAIL, [f.order, f.retailer, 'Shop closed'])).message, /DELIVERY_FAIL:NO_PERMISSION/);
      assert.match((await svc(FAIL, [f.order, staff, 'x'])).message, /DELIVERY_FAIL:REASON/);
      assert.deepEqual((await full(f)).deliveries, ['assigned']);
      const done = await delivered();
      assert.match((await svc(FAIL, [done.order, staff, 'Shop closed'])).message, /DELIVERY_FAIL:NOT_OPEN:delivered/);
      assert.equal((await full(done)).order, 'delivered');
    });

    await test('RE-DISPATCH after a failure: the SAME task is reset (new OTP, attempts 0, fresh 0/0 lines); two racing re-dispatches produce one; a failure mid-way keeps the failed state', async () => {
      const f = await sent();
      await run(staff, LINE_WRITE.replace('quantity_delivered = 4, quantity_missing = 6', 'quantity_delivered = 1, quantity_missing = 2'), [f.items[0]]);
      await admin.query('update public.order_deliveries set otp_attempts = 3 where id = $1', [f.delivery]);
      assert.equal((await svc(FAIL, [f.order, staff, 'Shop closed'])).ok, true);
      await withFailure('order_delivery_items', 'insert', async () => {
        assert.match((await svc(DISPATCH, [f.order, staff, digest('second')])).message, /TEST_INJECTED_FAILURE/);
      });
      let s = await full(f);
      assert.deepEqual({ o: s.order, d: s.deliveries, l: s.lines }, { o: 'processing', d: ['failed'], l: ['3:1/2'] }, 'failed re-dispatch left everything as it was');
      const out = (await Promise.all([svc(DISPATCH, [f.order, staff, digest('third-a')]), svc(DISPATCH, [f.order, adminUser, digest('third-b')])])).map(note);
      assert.equal(out.filter((x) => x.ok).length, 1, out.map((x) => x.message).join(' | '));
      const won = out.find((x) => x.ok);
      assert.equal(won.r.delivery_id, f.delivery, 'same delivery task');
      assert.equal(won.r.redispatch, true);
      s = await full(f);
      assert.deepEqual({ o: s.order, d: s.deliveries, l: s.lines, stock: s.packStock }, { o: 'dispatched', d: ['assigned'], l: ['3:0/0'], stock: 7 });
      const d = (await q('select otp_hash h, otp_attempts n, failure_reason r from public.order_deliveries where id = $1', [f.delivery]))[0];
      assert.equal(d.n, 0); assert.equal(d.r, null); assert.ok([digest('third-a'), digest('third-b')].includes(d.h));
      assert.deepEqual(deadlocks, []);
    });

    // ===================================================== RETURN TO WAREHOUSE
    await test('RETURN: one call returns stock, closes the delivery and the order, refunds the Coins and reverses the points; attribution is the real actor', async () => {
      const f = await delivered();
      let s = await full(f);
      assert.deepEqual({ o: s.order, stock: s.packStock, r: s.reversals, p: s.loyalty }, { o: 'delivered', stock: 7, r: [], p: ['ORDER_EARN:3'] });
      const out = await svc(RETURN, [f.order, staff, 'Retailer refused the goods']);
      assert.equal(out.ok, true, out.message);
      assert.deepEqual({ replayed: out.r.replayed, refunded: Number(out.r.refunded_paise) }, { replayed: false, refunded: 30000 });
      s = await full(f);
      assert.deepEqual(s, { order: 'returned', deliveries: ['returned_to_warehouse'], lines: ['3:3/0'], packStock: 10, restored: 3, reversals: [30000], shortfall: [], loyalty: ['ORDER_EARN:3', 'ORDER_REVERSAL:-3'] });
      const history = await q(`select changed_by from public.order_status_history where order_id = $1 and status = 'returned'`, [f.order]);
      assert.deepEqual(history.map((h) => h.changed_by), [staff]);
      const ledger = await q(`select created_by from public.retailer_wallet_ledger where reference_id = $1 and transaction_type = 'ORDER_REVERSAL'`, [f.order]);
      assert.deepEqual(ledger.map((h) => h.created_by), [staff]);
    });

    await test('RETURN: a retry after success is a replay - no second stock movement, refund or points reversal', async () => {
      const f = await delivered();
      assert.equal((await svc(RETURN, [f.order, staff, null])).ok, true);
      const before = await full(f);
      for (const actor of [staff, adminUser, superAdmin]) {
        const again = await svc(RETURN, [f.order, actor, 'again']);
        assert.equal(again.ok, true, again.message);
        assert.deepEqual({ replayed: again.r.replayed, refunded: Number(again.r.refunded_paise) }, { replayed: true, refunded: 0 });
      }
      assert.deepEqual(await full(f), before);
      assert.equal(before.packStock, 10);
    });

    await test('RETURN: 16 simultaneous calls - stock returned once, one refund, one points reversal - 5 rounds', async () => {
      for (let round = 0; round < rounds(5); round++) {
        const f = await delivered();
        const actors = [staff, adminUser, superAdmin];
        const out = (await Promise.all(Array.from({ length: 16 }, (_, i) => svc(RETURN, [f.order, actors[i % 3], `call ${i}`])))).map(note);
        assert.equal(out.every((x) => x.ok), true, out.map((x) => x.message).join(' | '));
        assert.equal(out.filter((x) => x.r.replayed === false).length, 1);
        assert.equal(out.reduce((sum, x) => sum + Number(x.r.refunded_paise), 0), 30000);
        const s = await full(f);
        assert.deepEqual(s, { order: 'returned', deliveries: ['returned_to_warehouse'], lines: ['3:3/0'], packStock: 10, restored: 3, reversals: [30000], shortfall: [], loyalty: ['ORDER_EARN:3', 'ORDER_REVERSAL:-3'] }, `round ${round}`);
      }
      assert.deepEqual(deadlocks, []);
    });

    await test('RETURN: an injected failure at ANY write (stock, delivery, order, wallet refund, points reversal) rolls back everything; the retry then does it all once', async () => {
      for (const [table, when] of [['product_packs', 'update'], ['order_deliveries', 'update'], ['orders', 'update'], ['retailer_wallet_ledger', 'insert'], ['loyalty_ledger', 'insert']]) {
        const f = await delivered();
        const before = await full(f);
        await withFailure(table, when, async () => {
          const out = await svc(RETURN, [f.order, staff, null]);
          assert.equal(out.ok, false, `${table} failure must surface`); assert.match(out.message, /TEST_INJECTED_FAILURE/);
        });
        assert.deepEqual(await full(f), before, `${table}: nothing partial (order still delivered, stock 7, no refund, no reversal)`);
        const out = await svc(RETURN, [f.order, staff, null]);
        assert.equal(out.ok, true, out.message);
        const s = await full(f);
        assert.deepEqual({ o: s.order, stock: s.packStock, r: s.reversals, p: s.loyalty }, { o: 'returned', stock: 10, r: [30000], p: ['ORDER_EARN:3', 'ORDER_REVERSAL:-3'] }, table);
      }
    });

    await test('RETURN: a delivery that already has a shortfall credit is refused BEFORE anything changes (0088 reconciliation rule), not half-returned', async () => {
      const f = await delivered({ missing: 1 });
      const before = await full(f);
      assert.deepEqual({ d: before.deliveries, c: before.shortfall }, { d: ['partially_delivered'], c: [10000] });
      const out = await svc(RETURN, [f.order, superAdmin, null]);
      assert.equal(out.ok, false);
      assert.match(out.message, /DELIVERY_RETURN:RECONCILE/);
      assert.deepEqual(await full(f), before);
    });

    await test('RETURN: an order with no Coins debit returns its stock with a zero refund', async () => {
      const f = await packed({ debit: false });
      f.delivery = (await svc(DISPATCH, [f.order, staff, f.otp])).r.delivery_id;
      assert.equal((await complete(args(f))).ok, true);
      const out = await svc(RETURN, [f.order, staff, null]);
      assert.equal(out.ok, true, out.message);
      assert.equal(Number(out.r.refunded_paise), 0);
      const s = await full(f);
      assert.deepEqual({ o: s.order, stock: s.packStock, r: s.reversals }, { o: 'returned', stock: 10, r: [] });
    });

    await test('RETURN: who may - API roles cannot execute; salesman, retailer, out-of-scope staff refused; an open or failed delivery cannot be returned', async () => {
      const f = await delivered();
      for (const who of [staff, adminUser, superAdmin, f.retailer, 'anon']) await assert.rejects(run(who, RETURN, [f.order, staff, null]), /permission denied/);
      for (const actor of [salesman, f.retailer, randomUUID()]) assert.match((await svc(RETURN, [f.order, actor, null])).message, /DELIVERY_RETURN:NO_PERMISSION/);
      const outsider = await user('staff');
      assert.match((await svc(RETURN, [f.order, outsider, null])).message, /DELIVERY_RETURN:SCOPE/);
      assert.match((await svc(RETURN, [f.order, staff, 'x'.repeat(1001)])).message, /DELIVERY_RETURN:NOTES/);
      const s = await full(f);
      assert.deepEqual({ o: s.order, stock: s.packStock, r: s.reversals }, { o: 'delivered', stock: 7, r: [] });
      const open = await sent();
      assert.match((await svc(RETURN, [open.order, staff, null])).message, /DELIVERY_RETURN:NOT_RETURNABLE:assigned/);
      await svc(FAIL, [open.order, staff, 'Shop closed']);
      assert.match((await svc(RETURN, [open.order, staff, null])).message, /DELIVERY_RETURN:NOT_RETURNABLE:failed/);
      assert.equal((await full(open)).order, 'processing');
    });

    await test('RACE: completion, failure and return fired together on one dispatched order - a legal end state, each ledger written at most once - 15 rounds', async () => {
      for (let round = 0; round < rounds(15); round++) {
        const f = await sent();
        const out = (await Promise.all([
          complete(args(f)), complete(args(f)),
          svc(FAIL, [f.order, staff, 'Shop closed']), svc(FAIL, [f.order, superAdmin, 'Shop closed']),
          svc(RETURN, [f.order, staff, null]), svc(RETURN, [f.order, adminUser, null]),
          run(staff, 'update public.order_delivery_items set quantity_delivered = 1, quantity_missing = 2 where order_item_id = $1', [f.items[0]]).then(() => ({ ok: true }), (e) => ({ ok: false, message: e.message, code: e.code })),
        ])).map(note);
        const s = await full(f);
        const key = `${s.order}/${s.deliveries[0]}`;
        assert.ok(['delivered/delivered', 'processing/failed', 'returned/returned_to_warehouse'].includes(key), `round ${round}: ${key} :: ${out.map((x) => x.message ?? 'ok').join(' | ')}`);
        if (key === 'processing/failed') assert.deepEqual({ r: s.reversals, p: s.loyalty, stock: s.packStock }, { r: [], p: [], stock: 7 });
        if (key === 'delivered/delivered') assert.deepEqual({ r: s.reversals, p: s.loyalty, stock: s.packStock, l: s.lines }, { r: [], p: ['ORDER_EARN:3'], stock: 7, l: ['3:3/0'] });
        if (key === 'returned/returned_to_warehouse') assert.deepEqual({ r: s.reversals, p: s.loyalty, stock: s.packStock }, { r: [30000], p: ['ORDER_EARN:3', 'ORDER_REVERSAL:-3'], stock: 10 });
      }
      assert.deepEqual(deadlocks, [], 'no deadlock in any round');
    });

    // =============================================================== CATALOGUE
    await test('catalogue hygiene (0100): definer + fixed search_path, no PUBLIC/anon/authenticated execute; the helper is closed to service_role too', async () => {
      const fn = await q(`select p.proname, p.prosecdef, p.proconfig::text cfg,
          has_function_privilege('anon', p.oid, 'execute') anon, has_function_privilege('authenticated', p.oid, 'execute') authn,
          has_function_privilege('service_role', p.oid, 'execute') svc, coalesce(p.proacl::text, '') acl
        from pg_proc p where p.pronamespace = 'public'::regnamespace
         and p.proname in ('dispatch_order_atomic', 'fail_delivery_atomic', 'return_delivery_to_warehouse_atomic', '_fulfilment_actor_role',
           'guard_direct_order_fulfilment_transition', 'guard_direct_delivery_fulfilment_transition', 'guard_settled_delivery_lines') order by 1`);
      assert.equal(fn.length, 7);
      for (const f of fn) {
        assert.match(f.cfg, /search_path=public, pg_temp/, f.proname);
        assert.equal(f.anon, false, f.proname); assert.equal(f.authn, false, f.proname);
        assert.doesNotMatch(f.acl, /(^|[{,])=X/, `${f.proname} has no PUBLIC execute`);
        const callable = ['dispatch_order_atomic', 'fail_delivery_atomic', 'return_delivery_to_warehouse_atomic'].includes(f.proname);
        assert.equal(f.svc, callable, f.proname);
        assert.equal(f.prosecdef, !f.proname.startsWith('guard_'), f.proname);
      }
    });

    await test('rollback 0100 with data present keeps every row and removes the functions and the guard; re-apply (twice) works', async () => {
      const f = await delivered();
      const counts = async () => (await q(`select (select count(*) from public.orders)::int o, (select count(*) from public.order_deliveries)::int d, (select count(*) from public.order_delivery_items)::int l, (select count(*) from public.retailer_wallet_ledger)::int w, (select count(*) from public.loyalty_ledger)::int p`))[0];
      const before = await counts();
      await admin.query(fs.readFileSync(path.join(ROLLBACKS, '0100_atomic_dispatch_failure_and_return.down.sql'), 'utf8'));
      assert.deepEqual(await counts(), before);
      assert.match((await svc(RETURN, [f.order, staff, null])).message, /does not exist/);
      assert.equal((await q(`select count(*)::int n from pg_trigger where tgname = 'trg_guard_direct_order_fulfilment_transition'`))[0].n, 0);
      await admin.query(readMigration('0100_atomic_dispatch_failure_and_return.sql'));
      await admin.query(readMigration('0100_atomic_dispatch_failure_and_return.sql'));
      assert.equal((await svc(RETURN, [f.order, staff, null])).ok, true);
      assert.equal((await full(f)).packStock, 10);
    });

    console.log(`PR #126 lock order + atomic fulfilment on real PostgreSQL ${version}: ${passed} passed, 0 failed. Deadlock victims outside the control run: ${deadlocks.length}.`);
  } finally {
    for (const c of clients) await c.end().catch(() => {});
    if (started) await cluster.stop();
    fs.rmSync(temp, { recursive: true, force: true });
  }
}
main().catch((error) => { console.error(error.stack || error); process.exitCode = 1; });
