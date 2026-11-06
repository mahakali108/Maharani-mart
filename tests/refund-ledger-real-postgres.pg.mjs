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
    // Seed representative already-checked-out split lines with triggers disabled
    // only inside this isolated cluster. Restore all triggers before exercising
    // the real parent cancellation and stock routines. This tests restoration,
    // not the checkout/compliance path which created these fixtures.
    async function splitStockFixture(sellerStock = 8, shipped = 0) {
      const f = await fixture('pending');
      const product = randomUUID(), pack = randomUUID(), seller = randomUUID();
      const offer = randomUUID(), sellerChild = randomUUID(), maharaniChild = randomUUID();
      await admin.query('begin');
      try {
        await admin.query("set local session_replication_role = 'replica'");
        await admin.query("insert into public.products(id,sku_code,name,unit,base_price) values ($1,$2,'Test product','PCS',10)", [product, product]);
        await admin.query("insert into public.product_packs(id,product_id,pack_name,pack_sku_code,base_price,case_price,stock_quantity) values ($1,$2,'Test pack',$3,10,10,7)", [pack, product, pack]);
        await admin.query("insert into public.sellers(id,business_name,status) values ($1,$2,'active')", [seller, `Seller ${seller}`]);
        await admin.query("insert into public.seller_offers(id,seller_id,product_id,pack_id,fulfilment_type,unit_price_paise,stock_quantity) values ($1,$2,$3,$4,'seller',1000,$5)", [offer,seller,product,pack,sellerStock]);
        await admin.query("insert into public.sub_orders(id,parent_order_id,seller_id,fulfilment_type) values ($1,$2,$3,'seller'),($4,$2,null,'maharani')", [sellerChild,f.order,seller,maharaniChild]);
        await admin.query(`insert into public.order_items(order_id,product_id,pack_id,sub_order_id,seller_offer_id,source_type,fulfilment_type,quantity,unit_price,line_total,stock_deducted_quantity,shipped_quantity)
          values ($1,$2,$3,$4,$5,'seller','seller',2,10,20,2,$6),($1,$2,$3,$7,null,'maharani','maharani',3,10,30,3,0)`, [f.order,product,pack,sellerChild,offer,shipped,maharaniChild]);
        await admin.query('commit');
      } catch (error) { await admin.query('rollback'); throw error; }
      return { ...f, pack, offer, seller, sellerChild, maharaniChild };
    }
    await test('split parent cancellation restores each stock owner and retries safely', async () => {
      const f = await splitStockFixture();
      await admin.query("update public.orders set status='cancelled' where id=$1", [f.order]);
      assert.equal((await admin.query('select stock_quantity from public.product_packs where id=$1', [f.pack])).rows[0].stock_quantity, 10);
      assert.equal((await admin.query('select stock_quantity from public.seller_offers where id=$1', [f.offer])).rows[0].stock_quantity, 10);
      assert.equal((await admin.query('select public.restore_simple_order_stock($1,null) n', [f.order])).rows[0].n, 0);
    });
    await test('split parent stock restoration excludes units still in transit', async () => {
      const f = await splitStockFixture(8, 1);
      await admin.query("update public.orders set status='cancelled' where id=$1", [f.order]);
      assert.equal((await admin.query('select stock_quantity from public.seller_offers where id=$1', [f.offer])).rows[0].stock_quantity, 9);
      assert.equal((await admin.query('select stock_quantity from public.product_packs where id=$1', [f.pack])).rows[0].stock_quantity, 10);
    });
    await test('split stock failure rolls back parent status and every stock change', async () => {
      const f = await splitStockFixture(2000000000);
      await assert.rejects(admin.query("update public.orders set status='cancelled' where id=$1", [f.order]), /Seller offer stock could not be restored/);
      assert.equal((await admin.query('select status from public.orders where id=$1', [f.order])).rows[0].status, 'pending');
      assert.equal((await admin.query('select stock_quantity from public.product_packs where id=$1', [f.pack])).rows[0].stock_quantity, 7);
      assert.equal((await admin.query('select stock_quantity from public.seller_offers where id=$1', [f.offer])).rows[0].stock_quantity, 2000000000);
      assert.deepEqual((await admin.query('select stock_restored_quantity from public.order_items where order_id=$1', [f.order])).rows.map(r => r.stock_restored_quantity), [0,0]);
    });
    await test('admin manual debit reversal is linked, atomic and idempotent', async () => {
      const f = await fixture(); const operator = await fixture();
      await admin.query("update public.profiles set role='admin' where id=$1", [operator.retailer]);
      const id = randomUUID();
      await admin.query(`insert into public.retailer_wallet_ledger
        (id,retailer_id,transaction_type,amount_paise,direction,reference_type,description,idempotency_key)
        values ($1,$2,'MANUAL_DEBIT',20000,'debit','adjustment','test',$3)`, [id,f.retailer,`manual:${id}`]);
      const c = await client();
      for (let i = 0; i < 2; i++) {
        await asUser(c, operator.retailer);
        await c.query('select public.reverse_manual_wallet_adjustment($1,$2,$3)', [f.retailer,id,'correct entry']);
        await c.query('commit');
      }
      assert.equal(await balance(f.retailer), 50000);
      const rows = (await admin.query('select direction,amount_paise,is_reversed from public.retailer_wallet_ledger where id=$1 or reversal_of=$1 order by direction', [id])).rows;
      assert.deepEqual(rows, [{ direction:'credit', amount_paise:'20000', is_reversed:false },{ direction:'debit', amount_paise:'20000', is_reversed:false }]);
      await asUser(c, operator.retailer);
      await assert.rejects(c.query('select public.reverse_manual_wallet_adjustment($1,$2,$3)', [f.retailer,id,'another reason']), /retry conflicts/);
      await c.query('rollback');
    });
    await test('manual reversal rejects non-admins and order debit even for an admin', async () => {
      const f = await fixture(); const operator = await fixture(); const c = await client();
      await asUser(c, f.retailer);
      await assert.rejects(c.query('select public.reverse_manual_wallet_adjustment($1,$2,$3)', [f.retailer,f.debit,'valid reason']), /Active administrator required/);
      await c.query('rollback');
      await admin.query("update public.profiles set role='admin' where id=$1", [operator.retailer]);
      await asUser(c, operator.retailer);
      await assert.rejects(c.query('select public.reverse_manual_wallet_adjustment($1,$2,$3)', [f.retailer,f.debit,'valid reason']), /Only an unreversed manual adjustment/);
      await c.query('rollback');
      assert.equal(await balance(f.retailer), 50000);
    });
    await test('concurrent manual reversal replays serialize on the account', async () => {
      const f = await fixture(); const operator = await fixture();
      await admin.query("update public.profiles set role='admin' where id=$1", [operator.retailer]);
      const id = randomUUID();
      await admin.query(`insert into public.retailer_wallet_ledger
        (id,retailer_id,transaction_type,amount_paise,direction,reference_type,description,idempotency_key)
        values ($1,$2,'MANUAL_CREDIT',10000,'credit','adjustment','test',$3)`, [id,f.retailer,`manual:${id}`]);
      const a = await client(), b = await client(); await asUser(a,operator.retailer); await asUser(b,operator.retailer);
      const waitPid = (await b.query('select pg_backend_pid() pid')).rows[0].pid;
      const blockPid = (await a.query('select pg_backend_pid() pid')).rows[0].pid;
      const sql = 'select public.reverse_manual_wallet_adjustment($1,$2,$3) id';
      const first = await a.query(sql,[f.retailer,id,'correct entry']);
      const second = b.query(sql,[f.retailer,id,'correct entry']); second.catch(() => {});
      let blocked = false;
      for (let i = 0; i < 100; i++) {
        if ((await admin.query('select pg_blocking_pids($1) pids',[waitPid])).rows[0].pids.includes(blockPid)) { blocked = true; break; }
        await new Promise(resolve => setTimeout(resolve,20));
      }
      assert.equal(blocked,true); await a.query('commit');
      assert.equal((await second).rows[0].id,first.rows[0].id); await b.query('commit');
      assert.equal(await balance(f.retailer),50000);
      assert.equal(Number((await admin.query('select count(*) n from public.retailer_wallet_ledger where reversal_of=$1',[id])).rows[0].n),1);
    });
    async function sellerCancellationFixture() {
      const f = await splitStockFixture(); const actor = await fixture();
      await admin.query("update public.profiles set role='seller' where id=$1", [actor.retailer]);
      await admin.query('insert into public.seller_members(seller_id,profile_id) values ($1,$2)', [f.seller,actor.retailer]);
      await admin.query('begin');
      try {
        await admin.query("set local session_replication_role = 'replica'");
        await admin.query('update public.sub_orders set coins_share_paise=50000 where id=$1',[f.sellerChild]);
        await admin.query('update public.retailer_wallet_ledger set idempotency_key=$1 where id=$2',[`order:${f.order}:${f.sellerChild}`,f.debit]);
        await admin.query('commit');
      } catch (error) { await admin.query('rollback'); throw error; }
      return { ...f, actor: actor.retailer };
    }
    await test('seller child cancellation refunds its checkout share and stock atomically, replay safe', async () => {
      const f = await sellerCancellationFixture(); const c = await client();
      for (let i = 0; i < 2; i++) {
        await asUser(c,f.actor); await c.query("select public.seller_update_sub_order($1,'cancelled',null,null)",[f.sellerChild]); await c.query('commit');
      }
      assert.equal(await balance(f.retailer),0);
      assert.equal((await admin.query('select stock_quantity from public.seller_offers where id=$1',[f.offer])).rows[0].stock_quantity,10);
      assert.equal((await admin.query('select stock_quantity from public.product_packs where id=$1',[f.pack])).rows[0].stock_quantity,7);
      assert.equal((await admin.query('select status from public.sub_orders where id=$1',[f.sellerChild])).rows[0].status,'cancelled');
      assert.equal((await admin.query('select status from public.orders where id=$1',[f.order])).rows[0].status,'pending');
      assert.equal(Number((await admin.query('select count(*) n from public.retailer_wallet_ledger where reversal_of=$1',[f.debit])).rows[0].n),1);
      assert.equal(Number((await admin.query('select count(*) n from public.seller_ledger where sub_order_id=$1',[f.sellerChild])).rows[0].n),0);
    });
    await test('seller child refund failure rolls back status, shipment and stock', async () => {
      const f = await sellerCancellationFixture(); const c = await client();
      await admin.query('update public.retailer_wallet_ledger set is_reversed=true where id=$1',[f.debit]);
      await asUser(c,f.actor);
      await assert.rejects(c.query("select public.seller_update_sub_order($1,'cancelled',null,null)",[f.sellerChild]),/Child debit does not match/);
      await c.query('rollback');
      assert.equal((await admin.query('select status from public.sub_orders where id=$1',[f.sellerChild])).rows[0].status,'pending');
      assert.equal((await admin.query('select status from public.orders where id=$1',[f.order])).rows[0].status,'pending');
      assert.equal((await admin.query('select stock_quantity from public.seller_offers where id=$1',[f.offer])).rows[0].stock_quantity,8);
      assert.equal(Number((await admin.query('select count(*) n from public.seller_shipments where sub_order_id=$1',[f.sellerChild])).rows[0].n),0);
      assert.equal(Number((await admin.query('select count(*) n from public.retailer_wallet_ledger where reversal_of=$1',[f.debit])).rows[0].n),0);
    });
    await test('seller cancellation after a linked partial refunds only remaining share', async () => {
      const f = await sellerCancellationFixture(); const c = await client();
      await admin.query(`insert into public.retailer_wallet_ledger
        (retailer_id,transaction_type,amount_paise,direction,reference_type,reference_id,description,idempotency_key,reversal_of)
        values ($1,'ORDER_REVERSAL',20000,'credit','order',$2,'test',$3,$4)`,[f.retailer,f.order,`partial:${f.debit}`,f.debit]);
      assert.equal(await balance(f.retailer),30000);
      await asUser(c,f.actor); await c.query("select public.seller_update_sub_order($1,'cancelled',null,null)",[f.sellerChild]); await c.query('commit');
      assert.equal(await balance(f.retailer),0);
      assert.equal(Number((await admin.query('select sum(amount_paise) n from public.retailer_wallet_ledger where reversal_of=$1',[f.debit])).rows[0].n),50000);
    });
    await test('seller may not cancel another seller child or call the private transition', async () => {
      const f = await sellerCancellationFixture(); const other = await sellerCancellationFixture(); const c = await client();
      await asUser(c,other.actor);
      await assert.rejects(c.query("select public.seller_update_sub_order($1,'cancelled',null,null)",[f.sellerChild]),/Sub-order not found/); await c.query('rollback');
      const grant = (await admin.query("select has_function_privilege('authenticated', 'public._seller_update_sub_order_before_atomic_refund(uuid,text,text,text)', 'EXECUTE') allowed")).rows[0].allowed;
      assert.equal(grant,false);
      assert.equal(await balance(f.retailer),50000);
    });
    await test('concurrent seller child cancellation retries serialize without extra credits or stock', async () => {
      const f = await sellerCancellationFixture(); const a = await client(), b = await client();
      await asUser(a,f.actor); await asUser(b,f.actor);
      const waitPid = (await b.query('select pg_backend_pid() pid')).rows[0].pid;
      const blockPid = (await a.query('select pg_backend_pid() pid')).rows[0].pid;
      const sql = "select public.seller_update_sub_order($1,'cancelled',null,null)";
      await a.query(sql,[f.sellerChild]); const waiting = b.query(sql,[f.sellerChild]); waiting.catch(() => {});
      let blocked = false;
      for (let i = 0; i < 100; i++) {
        if ((await admin.query('select pg_blocking_pids($1) pids',[waitPid])).rows[0].pids.includes(blockPid)) { blocked = true; break; }
        await new Promise(resolve => setTimeout(resolve,20));
      }
      assert.equal(blocked,true); await a.query('commit'); await waiting; await b.query('commit');
      assert.equal(await balance(f.retailer),0);
      assert.equal((await admin.query('select stock_quantity from public.seller_offers where id=$1',[f.offer])).rows[0].stock_quantity,10);
      assert.equal(Number((await admin.query('select count(*) n from public.retailer_wallet_ledger where reversal_of=$1',[f.debit])).rows[0].n),1);
    });
    await test('seller refund does not grant the seller wallet-read privileges', async () => {
      const f = await sellerCancellationFixture(); const c = await client();
      await asUser(c,f.actor);
      await assert.rejects(c.query('select public.get_retailer_outstanding_paise($1)',[f.retailer]),/Access denied/); await c.query('rollback');
      assert.equal((await admin.query("select has_function_privilege('authenticated','public._wallet_outstanding_for_trigger(uuid)','EXECUTE') ok")).rows[0].ok,false);
    });
    await test('seller cancellation refuses allocated seller settlements without changing either plane', async () => {
      const f = await sellerCancellationFixture(); const c = await client();
      await admin.query("insert into public.seller_ledger(seller_id,sub_order_id,entry_type,amount_paise,idempotency_key) values ($1,$2,'ALLOCATION',1000,$3)", [f.seller,f.sellerChild,`allocation:${f.sellerChild}`]);
      await asUser(c,f.actor); await assert.rejects(c.query("select public.seller_update_sub_order($1,'cancelled',null,null)",[f.sellerChild]),/Settled child requires administrator reconciliation/); await c.query('rollback');
      assert.equal((await admin.query('select status from public.sub_orders where id=$1',[f.sellerChild])).rows[0].status,'pending');
      assert.equal(await balance(f.retailer),50000);
      assert.equal((await admin.query('select stock_quantity from public.seller_offers where id=$1',[f.offer])).rows[0].stock_quantity,8);
      assert.equal(Number((await admin.query('select count(*) n from public.seller_ledger where sub_order_id=$1',[f.sellerChild])).rows[0].n),1);
    });
    await test('last child cancellation restores both stock owners and releases parent coupon', async () => {
      const f = await sellerCancellationFixture(); const c = await client(); const coupon = randomUUID();
      await admin.query("update public.sub_orders set status='cancelled' where id=$1",[f.maharaniChild]);
      await admin.query("insert into public.coupons(id,code,title,discount_type,discount_value,expires_at,used_count) values ($1,$2,'Test','fixed',1,now()+interval '1 day',1)",[coupon,`TEST-${coupon}`]);
      await admin.query('insert into public.coupon_redemptions(coupon_id,retailer_id,order_id,discount_amount) values ($1,$2,$3,1)',[coupon,f.retailer,f.order]);
      await asUser(c,f.actor); await c.query("select public.seller_update_sub_order($1,'cancelled',null,null)",[f.sellerChild]); await c.query('commit');
      assert.equal((await admin.query('select status from public.orders where id=$1',[f.order])).rows[0].status,'cancelled');
      assert.equal((await admin.query('select stock_quantity from public.product_packs where id=$1',[f.pack])).rows[0].stock_quantity,10);
      assert.equal((await admin.query('select stock_quantity from public.seller_offers where id=$1',[f.offer])).rows[0].stock_quantity,10);
      assert.equal((await admin.query('select used_count from public.coupons where id=$1',[coupon])).rows[0].used_count,0);
      assert.equal(Number((await admin.query('select count(*) n from public.coupon_redemptions where order_id=$1',[f.order])).rows[0].n),0);
      assert.equal(await balance(f.retailer),0);
    });
    await test('partial replay rejects malformed linked history added after the first event', async () => {
      const f = await fixture(); const c = await client();
      await asService(c); await partial(c,f,20000,'replay'); await c.query('commit');
      await admin.query(`insert into public.retailer_wallet_ledger
        (retailer_id,transaction_type,amount_paise,direction,reference_type,reference_id,description,idempotency_key,reversal_of)
        values ($1,'ADJUSTMENT',1,'debit','order',$2,'malformed',$3,$4)`,[f.retailer,f.order,`bad:${f.debit}`,f.debit]);
      await asService(c); await assert.rejects(partial(c,f,20000,'replay'),/linked refund history requires reconciliation/); await c.query('rollback');
      assert.equal(Number((await admin.query("select count(*) n from public.retailer_wallet_ledger where reversal_of=$1 and transaction_type='ORDER_REVERSAL'",[f.debit])).rows[0].n),1);
    });
    await test('child partial refund rejects a debit exceeding its immutable share', async () => {
      const f = await fixture(); const child = randomUUID(); const c = await client();
      await admin.query("insert into public.sub_orders(id,parent_order_id,fulfilment_type,status,coins_share_paise) values ($1,$2,'maharani','cancelled',20000)",[child,f.order]);
      await admin.query('update public.retailer_wallet_ledger set idempotency_key=$1 where id=$2',[`order:${f.order}:${child}`,f.debit]);
      await asService(c); await assert.rejects(c.query("select public.refund_sub_order_coins_event($1,20000,'part','test')",[child]),/Child debit does not match/); await c.query('rollback');
      assert.equal(await balance(f.retailer),50000);
    });
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
