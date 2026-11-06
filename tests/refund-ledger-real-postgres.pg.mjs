/* Real PostgreSQL integration test of the repository migrations and 0088.
 * Requires local test-only npm packages `embedded-postgres@17.11.0-beta.19`
 * and `pg` on NODE_PATH. Creates its own loopback-only temporary cluster; it
 * accepts no database URL and never connects to a remote or existing DB.
 * Auth/Storage platform objects are repository harness stubs; pg_net and
 * pg_cron migrations are skipped as in the PGlite harness. No GoTrue or actual
 * Storage service is present. Not a reset/restore or app-cancellation test. */
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

async function main() {
  const EmbeddedPostgres = (await import(pathToFileURL(runtimeRequire.resolve('embedded-postgres')).href)).default;
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'maharani-pg17-test-'));
  const port = await new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.on('error', reject).listen(0, '127.0.0.1', () => {
      const portNumber = probe.address().port;
      probe.close(() => resolve(portNumber));
    });
  });
  const password = randomUUID();
  const config = { host: '127.0.0.1', port, user: 'postgres', password, database: 'postgres' };
  const cluster = new EmbeddedPostgres({ databaseDir: path.join(temp, 'db'), user: 'postgres', password, port,
    postgresFlags: ['-c', 'listen_addresses=127.0.0.1'], persistent: true, onLog: () => {}, onError: (error) => console.error(String(error)) });
  const clients = [];
  let started = false;
  let passed = 0;
  async function client() { const c = new Client(config); await c.connect(); clients.push(c); return c; }
  async function test(name, fn) { await fn(); passed++; console.log(`PASS ${name}`); }
  async function asService(c) {
    await c.query('begin');
    await c.query('set local role service_role');
    await c.query("select set_config('request.jwt.claims', '{\"role\":\"service_role\"}', true)");
  }
  async function asUser(c, id) {
    await c.query('begin');
    await c.query('set local role authenticated');
    await c.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ role: 'authenticated', sub: id })]);
  }
  try {
    await cluster.initialise();
    await cluster.start();
    started = true;
    const admin = await client();
    const source = fs.readFileSync(path.join(__dirname, 'helpers/pg-harness.ts'), 'utf8');
    const stub = source.match(/const PLATFORM_STUB = `([\s\S]*?)`;/)?.[1];
    if (!stub) throw new Error('Repository platform stub not found');
    await admin.query(stub);
    const migrations = fs.readdirSync(path.join(__dirname, '../supabase/migrations')).filter((x) => x.endsWith('.sql')).sort();
    for (const file of migrations) {
      const sql = fs.readFileSync(path.join(__dirname, '../supabase/migrations', file), 'utf8')
        .replace(/create extension if not exists "(pg_net|pg_cron)";/g, '');
      try { await admin.query(sql); } catch (error) { throw new Error(`Migration ${file}: ${error.message}`); }
    }
    console.log(`Applied ${migrations.length} repository migrations on ${((await admin.query('show server_version')).rows[0]).server_version}.`);
    const area = (await admin.query("insert into public.areas (name) values ('Refund test district') returning id")).rows[0].id;
    await admin.query("insert into public.warehouses (name,area_id,is_active) values ('Test warehouse',$1,true)", [area]);
    let index = 0;
    async function fixture(status = 'cancelled') {
      index++;
      const retailer = randomUUID(), order = randomUUID(), debit = randomUUID();
      const metadata = JSON.stringify({ full_name: 'Test retailer', phone: `91${String(index).padStart(10, '0')}`, area_id: area });
      await admin.query('insert into auth.users (id,email,raw_user_meta_data) values ($1,$2,$3)', [retailer, `${retailer}@test.invalid`, metadata]);
      await admin.query("update public.retailers set status = 'active' where id = $1", [retailer]);
      await admin.query('insert into public.retailer_credit_accounts (retailer_id,credit_limit_paise) values ($1,100000)', [retailer]);
      await admin.query('insert into public.orders (id,order_number,retailer_id,status) values ($1,$2,$3,$4)', [order, `REAL-${order}`, retailer, status]);
      await admin.query(`insert into public.retailer_wallet_ledger (id,retailer_id,transaction_type,amount_paise,direction,reference_type,reference_id,description,idempotency_key)
        values ($1,$2,'ORDER_DEBIT',50000,'debit','order',$3,'test',$4)`, [debit, retailer, order, `debit:${debit}`]);
      return { retailer, order, debit };
    }
    async function balance(retailer) {
      return Number((await admin.query('select public.get_retailer_outstanding_paise($1) n', [retailer])).rows[0].n);
    }
    async function partial(c, f, amount, key) {
      return c.query('select public.refund_order_coins_partial($1,$2,$3,$4,$5)', [f.order, f.debit, amount, key, 'test']);
    }
    await test('refund grants deny anonymous callers and keep helper private', async () => {
      const names = ['refund_order_coins', 'refund_order_coins_partial', 'refund_sub_order_coins_event', 'cancel_order_coins_atomic'];
      for (const name of names) {
        const row = (await admin.query(`select has_function_privilege('anon', p.oid, 'EXECUTE') anon,
          has_function_privilege('authenticated', p.oid, 'EXECUTE') authn
          from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname=$1`, [name])).rows[0];
        assert.deepEqual(row, { anon: false, authn: true });
      }
      const helper = (await admin.query(`select has_function_privilege('authenticated', p.oid, 'EXECUTE') authn,
        has_function_privilege('service_role', p.oid, 'EXECUTE') service
        from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='_append_order_refund'`)).rows[0];
      assert.deepEqual(helper, { authn: false, service: false });
    });
    await test('full refund via actual refund_order_coins gives zero', async () => {
      const f = await fixture(); const c = await client(); await asService(c);
      await c.query('select public.refund_order_coins($1)', [f.order]); await c.query('commit');
      assert.equal(await balance(f.retailer), 0);
      const d = (await admin.query('select is_reversed from public.retailer_wallet_ledger where id=$1', [f.debit])).rows[0];
      assert.equal(d.is_reversed, false);
    });
    await test('partial refunds, duplicate event and cap', async () => {
      const f = await fixture(); const c = await client(); await asService(c);
      await partial(c, f, 20000, 'part-1'); await c.query('commit'); assert.equal(await balance(f.retailer), 30000);
      await asService(c); await partial(c, f, 20000, 'part-1'); await c.query('commit'); assert.equal(await balance(f.retailer), 30000);
      await asService(c); await assert.rejects(partial(c, f, 30001, 'too-much'), /exceeds/); await c.query('rollback');
      await asService(c); await partial(c, f, 30000, 'part-2'); await c.query('commit'); assert.equal(await balance(f.retailer), 0);
      assert.equal(Number((await admin.query('select count(*) n from public.retailer_wallet_ledger where reversal_of=$1', [f.debit])).rows[0].n), 2);
    });
    async function assertBlocked(waiter, blocker) {
      const waitingPid = (await waiter.query('select pg_backend_pid() pid')).rows[0].pid;
      const blockingPid = (await blocker.query('select pg_backend_pid() pid')).rows[0].pid;
      // Called before the waiting query is issued; returns a verifier closure.
      return async () => {
        for (let i = 0; i < 100; i++) {
          const blockers = (await admin.query('select pg_blocking_pids($1) pids', [waitingPid])).rows[0].pids;
          if (blockers.includes(blockingPid)) return;
          await new Promise((resolve) => setTimeout(resolve, 20));
        }
        throw new Error('Expected a real PostgreSQL lock wait');
      };
    }
    await test('concurrent partial refunds serialize and cannot exceed the debit', async () => {
      const f = await fixture(); const a = await client(), b = await client(); await asService(a); await asService(b);
      const verifyBlocked = await assertBlocked(b, a);
      await partial(a, f, 30000, 'a');
      const waiting = partial(b, f, 30000, 'b'); waiting.catch(() => {});
      await verifyBlocked(); await a.query('commit');
      await assert.rejects(waiting, /exceeds/); await b.query('rollback');
      assert.equal(await balance(f.retailer), 20000);
    });
    await test('concurrent duplicate events write one credit', async () => {
      const f = await fixture(); const a = await client(), b = await client(); await asService(a); await asService(b);
      const verifyBlocked = await assertBlocked(b, a);
      await partial(a, f, 20000, 'same-event');
      const waiting = partial(b, f, 20000, 'same-event'); waiting.catch(() => {});
      await verifyBlocked(); await a.query('commit'); await waiting; await b.query('commit');
      assert.equal(await balance(f.retailer), 30000);
      assert.equal(Number((await admin.query('select count(*) n from public.retailer_wallet_ledger where reversal_of=$1', [f.debit])).rows[0].n), 1);
    });
    await test('authenticated owner can cancel; foreign and inactive owners are denied', async () => {
      const own = await fixture('pending'); const stranger = await fixture('pending'); const c = await client();
      await asUser(c, stranger.retailer);
      await assert.rejects(c.query('select public.cancel_order_coins_atomic($1,$2)', [own.order, 'test']), /Access denied/);
      await c.query('rollback');
      await asUser(c, own.retailer); await c.query('select public.cancel_order_coins_atomic($1,$2)', [own.order, 'test']); await c.query('commit');
      assert.equal(await balance(own.retailer), 0);
      await admin.query('update public.profiles set is_active=false where id=$1', [stranger.retailer]);
      await asUser(c, stranger.retailer);
      await assert.rejects(c.query('select public.cancel_order_coins_atomic($1,$2)', [stranger.order, 'test']), /Active account required/);
      await c.query('rollback');
      assert.equal((await admin.query('select status from public.orders where id=$1', [stranger.order])).rows[0].status, 'pending');
    });
    await test('checkout debit waits for the refund account lock', async () => {
      const f = await fixture(); const a = await client(), b = await client(); await asService(a); await asService(b);
      const verifyBlocked = await assertBlocked(b, a);
      await partial(a, f, 20000, 'refund');
      const waiting = b.query('select public.check_and_debit_retailer_wallet($1,$2,$3,$4,$5,$6)',
        [f.retailer, randomUUID(), 10000, `checkout:${randomUUID()}`, f.retailer, 'test checkout']);
      waiting.catch(() => {}); await verifyBlocked(); await a.query('commit'); await waiting; await b.query('commit');
      assert.equal(await balance(f.retailer), 40000);
    });
    await test('atomic cancellation rolls status and wallet back on refund failure', async () => {
      const f = await fixture('pending'); const c = await client();
      await admin.query('update public.retailer_wallet_ledger set is_reversed=true where id=$1', [f.debit]);
      const before = await balance(f.retailer); await asService(c);
      await assert.rejects(c.query('select public.cancel_order_coins_atomic($1,$2)', [f.order, 'test']), /Historical reversed debit/);
      await c.query('rollback');
      assert.equal((await admin.query('select status from public.orders where id=$1', [f.order])).rows[0].status, 'pending');
      assert.equal(await balance(f.retailer), before);
      assert.equal(Number((await admin.query('select count(*) n from public.retailer_wallet_ledger where reversal_of=$1', [f.debit])).rows[0].n), 0);
    });
    await test('atomic cancellation commits status and refund together', async () => {
      const f = await fixture('pending'); const c = await client(); await asService(c);
      await c.query('select public.cancel_order_coins_atomic($1,$2)', [f.order, 'test']); await c.query('commit');
      assert.equal((await admin.query('select status from public.orders where id=$1', [f.order])).rows[0].status, 'cancelled');
      assert.equal(await balance(f.retailer), 0);
    });
    await test('atomic cancellation refuses split orders without changing status', async () => {
      const f = await fixture('pending');
      await admin.query("insert into public.sub_orders (parent_order_id, fulfilment_type) values ($1,'maharani')", [f.order]);
      const c = await client(); await asService(c);
      await assert.rejects(c.query('select public.cancel_order_coins_atomic($1,$2)', [f.order, 'test']), /Split order cancellation/);
      await c.query('rollback');
      assert.equal((await admin.query('select status from public.orders where id=$1', [f.order])).rows[0].status, 'pending');
      assert.equal(await balance(f.retailer), 50000);
    });
    await test('child event-keyed partial refunds preserve the original debit', async () => {
      const f = await fixture(); const child = randomUUID();
      await admin.query("insert into public.sub_orders (id,parent_order_id,fulfilment_type,status,coins_share_paise) values ($1,$2,'maharani','cancelled',50000)", [child, f.order]);
      await admin.query('update public.retailer_wallet_ledger set idempotency_key=$1 where id=$2', [`order:${f.order}:${child}`, f.debit]);
      const c = await client();
      for (const [amount, key] of [[20000,'child-1'],[20000,'child-1'],[30000,'child-2']]) {
        await asService(c);
        await c.query('select public.refund_sub_order_coins_event($1,$2,$3,$4)', [child,amount,key,'test']);
        await c.query('commit');
      }
      assert.equal(await balance(f.retailer), 0);
      assert.equal((await admin.query('select is_reversed from public.retailer_wallet_ledger where id=$1', [f.debit])).rows[0].is_reversed, false);
      assert.equal(Number((await admin.query('select count(*) n from public.retailer_wallet_ledger where reversal_of=$1', [f.debit])).rows[0].n), 2);
    });
    await test('legacy reversed flags are left unchanged and rejected', async () => {
      const f = await fixture(); await admin.query('update public.retailer_wallet_ledger set is_reversed=true where id=$1', [f.debit]);
      const before = await balance(f.retailer); const c = await client(); await asService(c);
      await assert.rejects(partial(c, f, 100, 'legacy'), /Historical reversed debit/); await c.query('rollback');
      assert.equal(await balance(f.retailer), before);
    });
    await test('legacy flagged debit with existing credit is not silently repaired', async () => {
      const f = await fixture();
      await admin.query('update public.retailer_wallet_ledger set is_reversed=true where id=$1', [f.debit]);
      await admin.query(`insert into public.retailer_wallet_ledger
        (retailer_id,transaction_type,amount_paise,direction,reference_type,reference_id,description,idempotency_key,reversal_of)
        values ($1,'ORDER_REVERSAL',50000,'credit','order',$2,'historic',$3,$4)`,
        [f.retailer, f.order, `historic:${f.debit}`, f.debit]);
      const before = await balance(f.retailer); assert.equal(before, -50000);
      const c = await client(); await asService(c);
      await assert.rejects(c.query('select public.refund_order_coins($1)', [f.order]), /Historical reversed debit/);
      await c.query('rollback'); assert.equal(await balance(f.retailer), before);
      assert.equal(Number((await admin.query('select count(*) n from public.retailer_wallet_ledger where reversal_of=$1', [f.debit])).rows[0].n), 1);
    });
    await test('fully credited malformed history is rejected rather than treated as a replay', async () => {
      const f = await fixture();
      await admin.query(`insert into public.retailer_wallet_ledger
        (retailer_id,transaction_type,amount_paise,direction,reference_type,reference_id,description,idempotency_key,reversal_of)
        values ($1,'ORDER_REVERSAL',50000,'credit','order',$2,'malformed',$3,$4)`,
        [f.retailer, randomUUID(), `malformed:${f.debit}`, f.debit]);
      const before = await balance(f.retailer); const c = await client(); await asService(c);
      await assert.rejects(c.query('select public.refund_order_coins($1)', [f.order]), /history requires reconciliation/);
      await c.query('rollback'); assert.equal(await balance(f.retailer), before);
    });
    await test('unlinked credit blocks even a fully refunded replay', async () => {
      const f = await fixture(); const c = await client(); await asService(c);
      await c.query('select public.refund_order_coins($1)', [f.order]); await c.query('commit');
      await admin.query(`insert into public.retailer_wallet_ledger
        (retailer_id,transaction_type,amount_paise,direction,reference_type,reference_id,description,idempotency_key)
        values ($1,'ORDER_REVERSAL',100,'credit','order',$2,'unlinked',$3)`,
        [f.retailer, f.order, `unlinked:${f.order}`]);
      const before = await balance(f.retailer); await asService(c);
      await assert.rejects(c.query('select public.refund_order_coins($1)', [f.order]), /Ambiguous prior order credits/);
      await c.query('rollback'); assert.equal(await balance(f.retailer), before);
    });
    console.log(`Real PostgreSQL integration: ${passed} passed.`);
  } finally {
    for (const c of clients) await c.end().catch(() => {});
    if (started) await cluster.stop();
    fs.rmSync(temp, { recursive: true, force: true });
  }
}
main().catch((error) => { console.error(error.stack || error); process.exitCode = 1; });
