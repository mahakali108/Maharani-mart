/* PR #126 atomic delivery completion (migration 0099) on a REAL, disposable PostgreSQL 17 cluster.
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
 * Run:  NODE_PATH=<dir>/node_modules node tests/pr126-delivery-completion.pg.mjs
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
import { createHash, randomUUID } from 'node:crypto';
const runtimeRequire = createRequire(import.meta.url);
const { Client } = runtimeRequire('pg');
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MIGRATIONS = path.join(__dirname, '../supabase/migrations');
const ROLLBACKS = path.join(__dirname, '../supabase/rollbacks');
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function main() {
  const EmbeddedPostgres = (await import(pathToFileURL(runtimeRequire.resolve('embedded-postgres')).href)).default;
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'maharani-pr126-dc-pg17-'));
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

    // ================================================================ BASICS
    await test('one call completes everything: lines, delivery, order, Rs 200 credit, 8 points, attribution', async () => {
      const f = await dispatched([[1000, 10]]);
      const out = await complete(args(f, { missing: 2 }));
      assert.equal(out.ok, true, out.message);
      assert.equal(out.r.status, 'completed'); assert.equal(out.r.replayed, false); assert.equal(Number(out.r.credit_back_paise), 20000);
      assert.deepEqual(await state(f), { delivery: 'partially_delivered', attempts: 0, by: staff, order: 'delivered', lines: ['8/2'], credits: [20000], loyalty: ['ORDER_EARN:8'], requests: 1 });
      const history = (await admin.query(`select changed_by from public.order_status_history where order_id = $1 and status = 'delivered'`, [f.order])).rows;
      assert.deepEqual(history.map((h) => h.changed_by), [staff], 'status history names the delivery person');
      const audit = (await admin.query(`select changed_by from public.audit_logs where record_id = $1 and table_name = 'orders' and action = 'update' order by created_at desc limit 1`, [f.order])).rows;
      assert.deepEqual(audit.map((h) => h.changed_by), [staff], 'audit log names the delivery person');
    });

    await test('the spoofed actor identity does not outlive the call inside the same transaction', async () => {
      const f = await dispatched();
      const c = await client();
      await begin(c, 'service');
      await c.query(COMPLETE, args(f));
      assert.equal((await c.query('select auth.uid() u, auth.role() r')).rows[0].u, null, 'auth.uid() is restored');
      await c.query('commit');
    });

    await test('only service_role can execute; anon, retailer, staff, admin and super-admin are refused', async () => {
      const f = await dispatched();
      for (const who of ['anon', f.retailer, staff, adminUser, superAdmin]) {
        const c = await client();
        await begin(c, who);
        await assert.rejects(c.query(COMPLETE, args(f)), /permission denied for function complete_delivery_atomic/);
        await c.query('rollback'); await c.end();
      }
      // The table owner outside the API (no JWT role) is refused by the function itself.
      await assert.rejects(admin.query(COMPLETE, args(f)), /DELIVERY_COMPLETE:FORBIDDEN/);
      assert.deepEqual(await state(f), untouched(f));
    });

    // ============================================================ COMPLETION RACES
    await test('two sessions complete at once (same request): the second WAITS, then gets the first result; one settlement', async () => {
      const f = await dispatched([[1000, 10]]);
      const a = await client(), b = await client();
      await begin(a, 'service');
      const first = (await a.query(COMPLETE, args(f, { missing: 2 }))).rows[0].r; // not committed
      assert.equal(first.replayed, false);
      await begin(b, 'service');
      const second = b.query(COMPLETE, args(f, { missing: 2 }));
      second.catch(() => {});
      await sleep(500);
      assert.equal(await isWaitingOnLock(b), true, 'second session waits on the order row');
      assert.deepEqual(await state(f), untouched(f), 'nothing visible before commit');
      await a.query('commit');
      const replay = (await second).rows[0].r;
      await b.query('commit');
      assert.equal(replay.status, 'completed'); assert.equal(replay.replayed, true);
      assert.equal(Number(replay.credit_back_paise), 20000);
      assert.deepEqual(await state(f), { delivery: 'partially_delivered', attempts: 0, by: staff, order: 'delivered', lines: ['8/2'], credits: [20000], loyalty: ['ORDER_EARN:8'], requests: 1 });
    });

    await test('two sessions complete at once with DIFFERENT quantities: exactly one wins, the other is refused, no mixed state', async () => {
      const f = await dispatched([[1000, 10]]);
      const [x, y] = await Promise.all([complete(args(f, { missing: 2 })), complete(args(f, { missing: 5 }))]);
      assert.equal([x, y].filter((o) => o.ok).length, 1);
      assert.match([x, y].find((o) => !o.ok).message, /DELIVERY_COMPLETE:ALREADY_COMPLETED/);
      const s = await state(f);
      const won = x.ok ? 2 : 5;
      assert.deepEqual(s, { delivery: 'partially_delivered', attempts: 0, by: staff, order: 'delivered', lines: [`${10 - won}/${won}`], credits: [won * 10000], loyalty: [`ORDER_EARN:${10 - won}`], requests: 1 });
    });

    await test('24 simultaneous sessions (assignee, admin, super-admin; mixed payloads) settle exactly once - 10 rounds', async () => {
      for (let round = 0; round < 10; round++) {
        const f = await dispatched([[1000, 10], [500, 5]]);
        const calls = [];
        for (let i = 0; i < 24; i++) {
          const actor = [staff, adminUser, superAdmin][i % 3];
          calls.push(complete(args(f, { actor, missing: i % 4 })));
        }
        const results = await Promise.all(calls);
        const fresh = results.filter((o) => o.ok && o.r.replayed === false);
        assert.equal(fresh.length, 1, `round ${round}: exactly one session performed the settlement`);
        for (const o of results.filter((x) => !x.ok)) assert.match(o.message, /DELIVERY_COMPLETE:ALREADY_COMPLETED/, o.message);
        for (const o of results.filter((x) => x.ok && x.r.replayed)) assert.deepEqual({ ...o.r, replayed: false }, fresh[0].r, 'a replay returns the winner\'s result');
        const s = await state(f);
        const credit = Number(fresh[0].r.credit_back_paise);
        assert.deepEqual(s.credits, credit > 0 ? [credit] : []);
        assert.equal(s.requests, 1);
        assert.equal(s.loyalty.length, 1);
        assert.equal(s.loyalty[0], `ORDER_EARN:${Math.floor((150000 - credit) / 10000)}`);
        assert.equal(s.order, 'delivered');
      }
    });

    await test('the first session ROLLS BACK: the waiting session then performs the whole settlement', async () => {
      const f = await dispatched([[1000, 10]]);
      const a = await client(), b = await client();
      await begin(a, 'service');
      await a.query(COMPLETE, args(f, { missing: 2 }));
      await begin(b, 'service');
      const second = b.query(COMPLETE, args(f, { missing: 2 }));
      second.catch(() => {});
      await sleep(400);
      assert.equal(await isWaitingOnLock(b), true);
      await a.query('rollback'); // the first request died before commit
      const r = (await second).rows[0].r;
      await b.query('commit');
      assert.equal(r.replayed, false);
      assert.deepEqual((await state(f)).credits, [20000]);
      assert.equal((await state(f)).requests, 1);
    });

    await test('lost response: the commit happened, the retry on a new connection returns the same result and adds nothing', async () => {
      const f = await dispatched([[1000, 10]]);
      const c = await client();
      await begin(c, 'service');
      await c.query(COMPLETE, args(f, { missing: 3 }));
      await c.query('commit');
      c.connection.stream.destroy(); // the client never reads the answer
      const before = await state(f);
      const retry = await complete(args(f, { missing: 3 }));
      assert.equal(retry.ok, true); assert.equal(retry.r.replayed, true); assert.equal(Number(retry.r.credit_back_paise), 30000);
      assert.deepEqual(await state(f), before);
      // A replay needs the same actor and the still-current OTP digest.
      assert.match((await complete(args(f, { missing: 3, actor: adminUser, key: args(f, { missing: 3 })[3] }))).message, /ALREADY_COMPLETED/);
      assert.match((await complete(args(f, { missing: 3, otp: digest('wrong') }))).message, /ALREADY_COMPLETED/);
      assert.deepEqual(await state(f), before);
    });

    // ================================================================= OTP RACES
    await test('40 simultaneous wrong OTPs: exactly 10 are counted, 30 are refused as locked, the limit is never passed', async () => {
      const f = await dispatched();
      const results = await Promise.all(Array.from({ length: 40 }, (_, i) => complete(args(f, { otp: digest(`guess-${i}`) }))));
      const counted = results.filter((o) => o.ok && o.r.status === 'otp_incorrect');
      const locked = results.filter((o) => !o.ok && /DELIVERY_COMPLETE:OTP_LOCKED/.test(o.message));
      assert.equal(counted.length, 10); assert.equal(locked.length, 30);
      assert.deepEqual(counted.map((o) => o.r.attempts_remaining).sort((x, y) => x - y), [0, 1, 2, 3, 4, 5, 6, 7, 8, 9], 'each attempt saw a distinct counter value');
      assert.deepEqual(await state(f), untouched(f, 10));
      assert.match((await complete(args(f))).message, /OTP_LOCKED/, 'the right OTP no longer works once locked');
      assert.deepEqual(await state(f), untouched(f, 10));
    });

    await test('9 wrong OTPs racing 1 correct one: the delivery completes once and at most 9 attempts are counted', async () => {
      const f = await dispatched([[1000, 10]]);
      const calls = Array.from({ length: 9 }, (_, i) => complete(args(f, { otp: digest(`bad-${i}`) })));
      calls.splice(4, 0, complete(args(f, { missing: 1 })));
      const results = await Promise.all(calls);
      assert.equal(results.filter((o) => o.ok && o.r.status === 'completed').length, 1);
      const s = await state(f);
      assert.equal(s.delivery, 'partially_delivered'); assert.deepEqual(s.credits, [10000]); assert.equal(s.requests, 1);
      assert.ok(s.attempts <= 9);
      // Guesses that arrived after completion were refused without being counted.
      const late = results.filter((o) => !o.ok);
      for (const o of late) assert.match(o.message, /ALREADY_COMPLETED/);
      assert.equal(s.attempts + late.length, 9);
    });

    await test('a wrong OTP is counted even though the caller\'s transaction did nothing else; a later rollback-inducing error is not counted', async () => {
      const f = await dispatched();
      const wrong = await complete(args(f, { otp: digest('nope') }));
      assert.deepEqual(wrong.r, { status: 'otp_incorrect', attempts_remaining: 9 });
      const bad = [...args(f)]; bad[5] = JSON.stringify([{ order_item_id: f.items[0], delivered: 3, missing: 0, damaged: 0 }]);
      assert.match((await complete(bad)).message, /DELIVERY_COMPLETE:QUANTITY_SPLIT/);
      assert.deepEqual(await state(f), untouched(f, 1));
    });

    // ====================================================== RACES WITH OTHER WRITERS
    await test('a staff quantity write in flight: completion WAITS (no deadlock), then overwrites with the verified quantities', async () => {
      const f = await dispatched([[1000, 10]]);
      const writer = await client(), completer = await client();
      await begin(writer, staff);
      await writer.query('update public.order_delivery_items set quantity_delivered = 4, quantity_missing = 6 where order_item_id = $1', [f.items[0]]);
      await begin(completer, 'service');
      const pending = completer.query(COMPLETE, args(f, { missing: 1 }));
      pending.catch(() => {});
      await sleep(500);
      assert.equal(await isWaitingOnLock(completer), true, 'completion waits for the line lock');
      await writer.query('commit');
      const r = (await pending).rows[0].r;
      await completer.query('commit');
      assert.equal(Number(r.credit_back_paise), 10000, 'the credit follows the OTP-verified submission, not the earlier scribble');
      assert.deepEqual((await state(f)).lines, ['9/1']);
    });

    await test('completion in flight: a staff quantity write WAITS and is then refused (locked after completion)', async () => {
      const f = await dispatched([[1000, 10]]);
      const completer = await client(), writer = await client();
      await begin(completer, 'service');
      await completer.query(COMPLETE, args(f, { missing: 1 }));
      await begin(writer, staff);
      const late = writer.query('update public.order_delivery_items set quantity_delivered = 0, quantity_missing = 10 where order_item_id = $1', [f.items[0]]);
      late.catch(() => {});
      await sleep(500);
      assert.equal(await isWaitingOnLock(writer), true);
      await completer.query('commit');
      await assert.rejects(late, /locked after completion/);
      await writer.query('rollback');
      assert.deepEqual((await state(f)).lines, ['9/1']); assert.deepEqual((await state(f)).credits, [10000]);
    });

    await test('staff line writes and completion hammered together never deadlock - 20 rounds', async () => {
      for (let round = 0; round < 20; round++) {
        const f = await dispatched([[1000, 10], [500, 5]]);
        const scribble = (item, n) => run(staff, 'update public.order_delivery_items set quantity_delivered = $2, quantity_missing = 0 where order_item_id = $1', [item, n]).then(() => 'ok', (e) => e.message);
        const results = await Promise.all([
          scribble(f.items[1], 5), scribble(f.items[0], 10), complete(args(f, { missing: round % 3 })), scribble(f.items[0], 10), scribble(f.items[1], 5),
        ]);
        for (const r of results) {
          const text = typeof r === 'string' ? r : (r.ok ? 'ok' : r.message);
          assert.doesNotMatch(text, /deadlock/i, `round ${round}: ${text}`);
        }
        assert.equal(results[2].ok, true, results[2].message);
        const s = await state(f);
        assert.deepEqual(s.lines, [`${10 - (round % 3)}/${round % 3}`, '5/0']);
      }
    });

    await test('completion racing an Admin cancelling the order: one of them wins cleanly, never both', async () => {
      for (let round = 0; round < 6; round++) {
        const f = await dispatched([[1000, 10]]);
        const cancel = run(superAdmin, 'select public.cancel_order_coins_atomic($1, $2) as n', [f.order, 'race']).then(() => ({ ok: true }), (e) => ({ ok: false, message: e.message }));
        const [done, cancelled] = await Promise.all(round % 2 ? [complete(args(f)), cancel] : [cancel, complete(args(f))].reverse());
        const s = await state(f);
        if (s.order === 'delivered') { assert.equal(s.delivery, 'delivered'); assert.equal(s.requests, 1); }
        else { assert.equal(s.delivery, 'assigned'); assert.equal(s.requests, 0); assert.deepEqual(s.loyalty, []); assert.equal(done.ok, false); }
        assert.ok(['delivered', 'cancelled', 'dispatched'].includes(s.order), s.order);
        void cancelled;
      }
    });

    // ================================================================== ROLLBACK
    for (const [label, table, when] of [
      ['wallet credit', 'retailer_wallet_ledger', 'insert'],
      ['order status update', 'orders', 'update'],
      ['loyalty award', 'loyalty_ledger', 'insert'],
      ['delivery row update', 'order_deliveries', 'update'],
      ['idempotency record', 'delivery_completion_requests', 'insert'],
    ]) {
      await test(`failure of the ${label} rolls back every change, and the next attempt succeeds`, async () => {
        const f = await dispatched([[1000, 10]]);
        await withFailure(table, when, async () => {
          const out = await complete(args(f, { missing: 2 }));
          assert.equal(out.ok, false); assert.match(out.message, /TEST_INJECTED_FAILURE/);
          assert.deepEqual(await state(f), untouched(f));
        });
        const ok = await complete(args(f, { missing: 2 }));
        assert.equal(ok.ok, true, ok.message); assert.equal(ok.r.replayed, false);
        assert.deepEqual(await state(f), { delivery: 'partially_delivered', attempts: 0, by: staff, order: 'delivered', lines: ['8/2'], credits: [20000], loyalty: ['ORDER_EARN:8'], requests: 1 });
      });
    }

    await test('an error inside an open transaction aborts it: nothing partial survives', async () => {
      const f = await dispatched([[1000, 10]]);
      const c = await client();
      await begin(c, 'service');
      await c.query('savepoint before_completion');
      await admin.query(`create or replace function public._test_fail() returns trigger language plpgsql as $$ begin raise exception 'TEST_INJECTED_FAILURE'; end $$`);
      await admin.query(`create trigger trg_test_fail before insert on public.loyalty_ledger for each row execute function public._test_fail()`);
      try { await assert.rejects(c.query(COMPLETE, args(f, { missing: 2 })), /TEST_INJECTED_FAILURE/); }
      finally { await c.query('rollback'); await admin.query('drop trigger trg_test_fail on public.loyalty_ledger'); }
      assert.deepEqual(await state(f), untouched(f));
    });

    // ========================================================= ACTOR / LOYALTY / HYGIENE
    await test('actor checks: unassigned staff, retailer, deactivated account and unknown id are refused; assigned salesman and admin succeed', async () => {
      const f = await dispatched();
      assert.match((await complete(args(f, { actor: otherStaff }))).message, /DELIVERY_COMPLETE:NOT_ASSIGNED/);
      assert.match((await complete(args(f, { actor: f.retailer }))).message, /DELIVERY_COMPLETE:NO_PERMISSION/);
      assert.match((await complete(args(f, { actor: randomUUID() }))).message, /DELIVERY_COMPLETE:NO_PERMISSION/);
      await admin.query('update public.profiles set is_active = false where id = $1', [staff]);
      assert.match((await complete(args(f))).message, /DELIVERY_COMPLETE:NO_PERMISSION/);
      await admin.query('update public.profiles set is_active = true where id = $1', [staff]);
      assert.deepEqual(await state(f), untouched(f));
      assert.equal((await complete(args(f, { actor: adminUser }))).ok, true);
      const g = await dispatched([[1000, 10]], salesman);
      assert.equal((await complete(args(g, { actor: salesman, missing: 1 }))).ok, true);
      assert.deepEqual((await state(g)).credits, [10000]);
    });

    await test('order already marked delivered by an Admin: points come down to the delivered value; a return then nets to zero', async () => {
      const f = await dispatched([[1000, 10]]);
      await admin.query(`update public.orders set status = 'delivered' where id = $1`, [f.order]);
      assert.deepEqual((await state(f)).loyalty, ['ORDER_EARN:10']);
      assert.equal((await complete(args(f, { missing: 3 }))).ok, true);
      assert.deepEqual((await state(f)).loyalty, ['ORDER_EARN:10', 'ORDER_REVERSAL:-3']);
      await admin.query(`update public.orders set status = 'returned' where id = $1`, [f.order]);
      const net = (await admin.query('select coalesce(sum(points), 0)::int n from public.loyalty_ledger where reference_id = $1', [f.order])).rows[0].n;
      assert.equal(net, 0);
    });

    await test('catalogue hygiene: definer + fixed search_path, no PUBLIC/anon/authenticated execute, RLS on and no API grants on the idempotency table', async () => {
      const fn = (await admin.query(`select p.proname, p.prosecdef, p.proconfig::text cfg,
          has_function_privilege('anon', p.oid, 'execute') anon, has_function_privilege('authenticated', p.oid, 'execute') authn,
          has_function_privilege('service_role', p.oid, 'execute') svc, coalesce(p.proacl::text, '') acl
        from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname in ('complete_delivery_atomic', '_order_loyalty_points_due') order by 1`)).rows;
      assert.equal(fn.length, 2);
      for (const f of fn) {
        assert.equal(f.prosecdef, true); assert.match(f.cfg, /search_path=public, pg_temp/);
        assert.equal(f.anon, false); assert.equal(f.authn, false);
        assert.doesNotMatch(f.acl, /(^|[{,])=X/, `${f.proname} has no PUBLIC execute`);
      }
      assert.equal(fn.find((f) => f.proname === 'complete_delivery_atomic').svc, true);
      assert.equal(fn.find((f) => f.proname === '_order_loyalty_points_due').svc, false);
      const t = (await admin.query(`select relrowsecurity rls from pg_class where oid = 'public.delivery_completion_requests'::regclass`)).rows[0];
      assert.equal(t.rls, true);
      const grants = (await admin.query(`select grantee, privilege_type from information_schema.table_privileges where table_schema = 'public' and table_name = 'delivery_completion_requests' and grantee in ('anon', 'authenticated', 'PUBLIC')`)).rows;
      assert.deepEqual(grants, []);
    });

    await test('rollback 0099 with data present keeps every row; re-apply (twice) works and completes a delivery', async () => {
      const f = await dispatched([[1000, 10]]);
      const counts = async () => (await admin.query(`select (select count(*) from public.delivery_completion_requests)::int r, (select count(*) from public.retailer_wallet_ledger)::int w, (select count(*) from public.loyalty_ledger)::int l, (select count(*) from public.order_deliveries)::int d, (select count(*) from public.orders)::int o`)).rows[0];
      const before = await counts();
      await admin.query(fs.readFileSync(path.join(ROLLBACKS, '0099_atomic_delivery_completion.down.sql'), 'utf8'));
      assert.equal((await admin.query(`select to_regproc('public.complete_delivery_atomic') is null gone`)).rows[0].gone, true);
      assert.deepEqual(await counts(), before);
      assert.match((await complete(args(f))).message, /does not exist/);
      await admin.query(readMigration('0099_atomic_delivery_completion.sql'));
      await admin.query(readMigration('0099_atomic_delivery_completion.sql'));
      assert.equal((await complete(args(f, { missing: 2 }))).ok, true);
      assert.deepEqual((await state(f)).credits, [20000]);
    });

    console.log(`PR #126 delivery completion on real PostgreSQL ${version}: ${passed} passed, 0 failed.`);
  } finally {
    for (const c of clients) await c.end().catch(() => {});
    if (started) await cluster.stop();
    fs.rmSync(temp, { recursive: true, force: true });
  }
}
main().catch((error) => { console.error(error.stack || error); process.exitCode = 1; });
