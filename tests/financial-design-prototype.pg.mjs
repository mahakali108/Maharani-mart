/**
 * Isolated accounting DESIGN experiment, NOT the application implementation.
 * Requires an independently provisioned, Unix-socket-only synthetic PostgreSQL
 * cluster with cluster_name=maharani_synthetic_refund_test. Never connects to
 * Supabase, loads repository migrations, or accepts a TCP connection string.
 *
 * FINANCIAL_TEST_SOCKET=/path/to/socket FINANCIAL_TEST_PG_MODULE=/path/to/pg \
 *   node --test tests/financial-design-prototype.pg.mjs
 *
 * Proof applies only to the simplified fixture below, not production schemas,
 * RLS, existing ledgers, triggers, checkout, returns, or application code.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { isAbsolute } from 'node:path';

const socket = process.env.FINANCIAL_TEST_SOCKET;
const pgModule = process.env.FINANCIAL_TEST_PG_MODULE;
if (!socket?.startsWith('/tmp/') || !pgModule || !isAbsolute(pgModule)) {
  throw new Error('Provide an explicit disposable /tmp Unix socket and an absolute pg module path; no network databases are allowed.');
}
const { Pool } = createRequire(import.meta.url)(pgModule);
const pool = new Pool({ host: socket, port: 55439, database: 'postgres', user: 'local_test', max: 5, connectionTimeoutMillis: 3000 });
const schema = `synthetic_${randomUUID().replaceAll('-', '')}`;
const q = `"${schema}"`;
let schemaCreated = false;

before(async () => {
  const { rows: [server] } = await pool.query("select current_setting('cluster_name') as cluster, inet_server_addr() as address, current_user as username");
  assert.equal(server.cluster, 'maharani_synthetic_refund_test');
  assert.equal(server.address, null, 'must connect over a Unix socket, never TCP');
  assert.equal(server.username, 'local_test');
  // Entire fixture is created here; no Supabase/app tables or migrations loaded.
  await pool.query(`create schema ${q}`);
  schemaCreated = true;
  await pool.query(`
    create table ${q}.accounts (id text primary key, opening_paise bigint not null);
    create table ${q}.orders (id text primary key, account_id text not null references ${q}.accounts, status text not null);
    create table ${q}.ledger (
      id text primary key,
      account_id text not null references ${q}.accounts,
      order_id text not null references ${q}.orders,
      kind text not null check (kind in ('debit','refund')),
      amount_paise bigint not null check (amount_paise > 0),
      source_id text references ${q}.ledger(id),
      request_key text unique,
      check ((kind = 'debit' and source_id is null) or (kind = 'refund' and source_id is not null and request_key is not null))
    );
    create function ${q}.reject_mutation() returns trigger language plpgsql as $$
    begin raise exception 'synthetic ledger is append only'; end $$;
    create trigger immutable_ledger before update or delete on ${q}.ledger
      for each row execute function ${q}.reject_mutation();
    create function ${q}.refund(p_account text, p_order text, p_debit text, p_amount bigint, p_key text)
    returns bigint language plpgsql as $$
    declare d ${q}.ledger%rowtype; prior ${q}.ledger%rowtype; refunded bigint;
    begin
      if p_amount is null or p_amount <= 0 or p_key is null or length(trim(p_key)) = 0 then
        raise exception 'invalid refund request';
      end if;
      -- In the real design the common account/order/stock lock hierarchy and
      -- authorization must be proven across ALL competing writers.
      perform 1 from ${q}.accounts where id = p_account for update;
      if not found then raise exception 'invalid account'; end if;
      perform 1 from ${q}.orders where id = p_order and account_id = p_account and status = 'cancelled' for update;
      if not found then raise exception 'invalid or non-refundable order'; end if;
      select * into d from ${q}.ledger where id = p_debit and account_id = p_account and order_id = p_order and kind = 'debit' for update;
      if not found then raise exception 'invalid debit'; end if;
      select * into prior from ${q}.ledger where request_key = p_key;
      if found then
        if prior.kind != 'refund' or prior.account_id != p_account or prior.order_id != p_order
           or prior.source_id != p_debit or prior.amount_paise != p_amount then
          raise exception 'idempotency key payload mismatch';
        end if;
        return 0;
      end if;
      select coalesce(sum(amount_paise), 0) into refunded from ${q}.ledger where kind = 'refund' and source_id = p_debit;
      if refunded + p_amount > d.amount_paise then raise exception 'refund exceeds remaining debit'; end if;
      insert into ${q}.ledger(id, account_id, order_id, kind, amount_paise, source_id, request_key)
      values ('refund:' || p_key, p_account, p_order, 'refund', p_amount, p_debit, p_key);
      return p_amount;
    end $$;
  `);
});

after(async () => {
  if (schemaCreated) await pool.query(`drop schema ${q} cascade`);
  await pool.end();
});

async function fixture(tag, opening = 0) {
  const account = `account:${tag}`;
  const order = `order:${tag}`;
  const debit = `debit:${tag}`;
  await pool.query(`insert into ${q}.accounts values ($1,$2)`, [account, opening]);
  await pool.query(`insert into ${q}.orders values ($1,$2,'cancelled')`, [order, account]);
  await pool.query(`insert into ${q}.ledger(id,account_id,order_id,kind,amount_paise) values ($1,$2,$3,'debit',50000)`, [debit, account, order]);
  return { account, order, debit };
}
async function refund(client, f, amount, key) {
  return client.query(`select ${q}.refund($1,$2,$3,$4,$5) as moved`, [f.account, f.order, f.debit, amount, key]);
}
async function position(f) {
  const { rows: [row] } = await pool.query(`select a.opening_paise + coalesce(sum(case when l.kind='debit' then l.amount_paise else -l.amount_paise end),0) as outstanding,
    count(l.id) filter (where l.kind='refund')::int as credits
    from ${q}.accounts a left join ${q}.ledger l on l.account_id=a.id where a.id=$1 group by a.id`, [f.account]);
  return { outstanding: Number(row.outstanding), credits: row.credits };
}

async function waitForBlocked(blockerPid, waiterPid) {
  const deadline = Date.now() + 4000;
  while (Date.now() < deadline) {
    const { rows: [row] } = await pool.query('select $1::int = any(pg_blocking_pids($2::int)) as blocked', [blockerPid, waiterPid]);
    if (row.blocked) return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error('Second real PostgreSQL session did not wait for the first session');
}

test('₹500 debit + ₹500 refund restores starting outstanding', async () => {
  const f = await fixture('full');
  assert.equal(Number((await refund(pool, f, 50000, 'full-1')).rows[0].moved), 50000);
  assert.deepEqual(await position(f), { outstanding: 0, credits: 1 });
});

test('₹500 debit + ₹200 partial refund leaves ₹300, with a later partial supported', async () => {
  const f = await fixture('partial');
  await refund(pool, f, 20000, 'partial-1');
  assert.deepEqual(await position(f), { outstanding: 30000, credits: 1 });
  await refund(pool, f, 30000, 'partial-2');
  assert.deepEqual(await position(f), { outstanding: 0, credits: 2 });
});

test('duplicate key credits once; mismatched retry fails closed', async () => {
  const f = await fixture('duplicate');
  await refund(pool, f, 20000, 'same');
  assert.equal(Number((await refund(pool, f, 20000, 'same')).rows[0].moved), 0);
  await assert.rejects(refund(pool, f, 10000, 'same'), /payload mismatch/);
  assert.deepEqual(await position(f), { outstanding: 30000, credits: 1 });
});

test('missing/wrong debit, nonpositive amounts and over-refunds are rejected with no credit', async () => {
  const f = await fixture('invalid');
  await assert.rejects(refund(pool, { ...f, debit: 'missing' }, 20000, 'invalid-1'), /invalid debit/);
  await assert.rejects(refund(pool, f, 0, 'invalid-2'), /invalid refund request/);
  await assert.rejects(refund(pool, f, 50001, 'invalid-3'), /exceeds remaining/);
  const other = await fixture('other');
  await assert.rejects(refund(pool, { ...f, debit: other.debit }, 1, 'invalid-4'), /invalid debit/);
  await assert.rejects(refund(pool, { ...f, order: other.order }, 1, 'invalid-5'), /non-refundable order/);
  await pool.query(`update ${q}.orders set status='pending' where id=$1`, [f.order]);
  await assert.rejects(refund(pool, f, 1, 'invalid-6'), /non-refundable order/);
  assert.deepEqual(await position(f), { outstanding: 50000, credits: 0 });
});

test('two independent PostgreSQL sessions serialize and cannot over-credit', async () => {
  const f = await fixture('concurrent');
  const a = await pool.connect();
  const b = await pool.connect();
  try {
    const pidA = (await a.query('select pg_backend_pid() as pid')).rows[0].pid;
    const pidB = (await b.query('select pg_backend_pid() as pid')).rows[0].pid;
    assert.notEqual(pidA, pidB);
    await a.query('begin');
    await refund(a, f, 30000, 'race-a');
    const pending = refund(b, f, 30000, 'race-b').then(() => null, (error) => error);
    try { await waitForBlocked(pidA, pidB); } finally { await a.query('commit'); }
    const error = await pending;
    assert.match(error?.message ?? '', /exceeds remaining/);
    assert.deepEqual(await position(f), { outstanding: 20000, credits: 1 });
  } finally { a.release(); b.release(); }
});

test('concurrent retries with the same key produce one credit', async () => {
  const f = await fixture('concurrent-duplicate');
  const a = await pool.connect();
  const b = await pool.connect();
  try {
    const pidA = (await a.query('select pg_backend_pid() as pid')).rows[0].pid;
    const pidB = (await b.query('select pg_backend_pid() as pid')).rows[0].pid;
    await a.query('begin');
    await refund(a, f, 50000, 'race-same');
    const pending = refund(b, f, 50000, 'race-same');
    try { await waitForBlocked(pidA, pidB); } finally { await a.query('commit'); }
    assert.equal(Number((await pending).rows[0].moved), 0);
    assert.deepEqual(await position(f), { outstanding: 0, credits: 1 });
  } finally { a.release(); b.release(); }
});

test('a waiting retry can proceed after the first transaction rolls back', async () => {
  const f = await fixture('concurrent-rollback');
  const a = await pool.connect();
  const b = await pool.connect();
  try {
    const pidA = (await a.query('select pg_backend_pid() as pid')).rows[0].pid;
    const pidB = (await b.query('select pg_backend_pid() as pid')).rows[0].pid;
    await a.query('begin');
    await refund(a, f, 50000, 'rollback-then-retry');
    const pending = refund(b, f, 50000, 'rollback-then-retry');
    try { await waitForBlocked(pidA, pidB); } finally { await a.query('rollback'); }
    assert.equal(Number((await pending).rows[0].moved), 50000);
    assert.deepEqual(await position(f), { outstanding: 0, credits: 1 });
  } finally { a.release(); b.release(); }
});

test('failed transaction rolls back the refund entry', async () => {
  const f = await fixture('rollback');
  const client = await pool.connect();
  try {
    await client.query('begin');
    await refund(client, f, 20000, 'rollback-refund');
    await assert.rejects(client.query('select 1 / 0'), /division by zero/);
    await client.query('rollback');
  } finally { client.release(); }
  assert.deepEqual(await position(f), { outstanding: 50000, credits: 0 });
});

test('append-only entries reconcile to opening baseline plus debits minus credits', async () => {
  const f = await fixture('reconcile', 12000);
  await refund(pool, f, 20000, 'reconcile-1');
  const { rows } = await pool.query(`select kind, amount_paise from ${q}.ledger where account_id=$1 order by id`, [f.account]);
  const independentlySummed = rows.reduce((sum, row) => sum + (row.kind === 'debit' ? 1 : -1) * Number(row.amount_paise), 12000);
  assert.equal(independentlySummed, 42000);
  assert.equal((await position(f)).outstanding, independentlySummed);
  await assert.rejects(pool.query(`update ${q}.ledger set amount_paise=1 where id=$1`, [f.debit]), /append only/);
  await assert.rejects(pool.query(`delete from ${q}.ledger where id=$1`, [f.debit]), /append only/);

  // Independently reconcile every synthetic account exercised by this run.
  const accounts = await pool.query(`select id, opening_paise from ${q}.accounts order by id`);
  assert.ok(accounts.rows.length >= 9);
  for (const account of accounts.rows) {
    const entries = await pool.query(`select kind, amount_paise from ${q}.ledger where account_id=$1`, [account.id]);
    const independentlyRebuilt = entries.rows.reduce(
      (sum, row) => sum + (row.kind === 'debit' ? 1 : -1) * Number(row.amount_paise),
      Number(account.opening_paise),
    );
    assert.equal((await position({ account: account.id })).outstanding, independentlyRebuilt, account.id);
  }
});
