import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { as, createMigratedDb, createRetailer, createUser, errorOf, type Db, type Tx } from './helpers/pg-harness';
import { LEGAL_DOCUMENTS } from '@/lib/legal/documents';

/** Migration 0095 against real PostgreSQL 16 (PGlite): acceptance records and request types. */
describe('0095 legal acceptance records and privacy request types (PostgreSQL 16)', () => {
  let db: Db;
  let retailerA: string;
  let retailerB: string;
  let admin: string;

  beforeAll(async () => {
    db = await createMigratedDb();
    retailerA = (await createRetailer(db)).id;
    retailerB = (await createRetailer(db)).id;
    admin = await createUser(db, 'admin');
  }, 120_000);
  afterAll(async () => { await db.close(); });

  const accept = (who: string, key: string, version: string, context = 'account') =>
    as(db, who, async (tx: Tx) =>
      (await tx.query<{ id: string }>(`select public.record_legal_acceptance($1, $2, $3) as id`, [key, version, context])).rows[0]!.id);

  it('records an acceptance for the caller with a database timestamp, once per version', async () => {
    const first = await accept(retailerA, 'terms', '1.0', 'registration');
    const again = await accept(retailerA, 'terms', '1.0', 'account');
    expect(again).toBe(first);
    const { rows } = await db.query<{ user_id: string; context: string; fresh: boolean }>(
      `select user_id, context, accepted_at > now() - interval '1 minute' as fresh
         from public.legal_document_acceptances where document_key = 'terms'`);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ user_id: retailerA, context: 'registration', fresh: true });
  });

  it('keeps a separate record when a new version is accepted', async () => {
    await accept(retailerA, 'terms', '1.1', 'policy_update');
    const { rows } = await db.query<{ n: string }>(
      `select count(*)::text as n from public.legal_document_acceptances where user_id = $1 and document_key = 'terms'`, [retailerA]);
    expect(rows[0]!.n).toBe('2');
  });

  it('accepts every registered document key and version format', async () => {
    for (const doc of LEGAL_DOCUMENTS) await accept(retailerB, doc.key, doc.version);
  });

  it('rejects malformed keys, versions and contexts', async () => {
    expect(await errorOf(db, retailerA, (tx: Tx) => tx.query(`select public.record_legal_acceptance('Terms; drop', '1.0', 'account')`))).toMatch(/key_format/);
    expect(await errorOf(db, retailerA, (tx: Tx) => tx.query(`select public.record_legal_acceptance('terms', 'latest', 'account')`))).toMatch(/version_format/);
    expect(await errorOf(db, retailerA, (tx: Tx) => tx.query(`select public.record_legal_acceptance('terms', '1.0', 'forged')`))).toMatch(/context_check/);
  });

  it('refuses anonymous callers', async () => {
    expect(await errorOf(db, 'anon', (tx: Tx) => tx.query(`select public.record_legal_acceptance('terms', '1.0', 'account')`))).toMatch(/permission denied|Sign in/);
  });

  it('cannot be forged, back-dated, edited or deleted through the Data API', async () => {
    expect(await errorOf(db, retailerA, (tx: Tx) => tx.query(
      `insert into public.legal_document_acceptances (user_id, document_key, document_version, accepted_at)
       values ($1, 'seller-agreement', '1.0', '2020-01-01')`, [retailerB]))).toMatch(/permission denied/);
    expect(await errorOf(db, retailerA, (tx: Tx) => tx.query(
      `update public.legal_document_acceptances set accepted_at = '2020-01-01' where user_id = $1`, [retailerA]))).toMatch(/permission denied/);
    expect(await errorOf(db, retailerA, (tx: Tx) => tx.query(
      `delete from public.legal_document_acceptances where user_id = $1`, [retailerA]))).toMatch(/permission denied/);
    expect(await errorOf(db, admin, (tx: Tx) => tx.query(
      `delete from public.legal_document_acceptances where user_id = $1`, [retailerA]))).toMatch(/permission denied/);
  });

  it('shows a user only their own records; an admin sees all', async () => {
    const own = await as(db, retailerA, (tx: Tx) => tx.query<{ user_id: string }>(`select user_id from public.legal_document_acceptances`));
    expect(own.rows.length).toBeGreaterThan(0);
    expect(own.rows.every((row) => row.user_id === retailerA)).toBe(true);
    const all = await as(db, admin, (tx: Tx) => tx.query<{ user_id: string }>(`select distinct user_id from public.legal_document_acceptances`));
    expect(all.rows.map((row) => row.user_id).sort()).toEqual([retailerA, retailerB].sort());
    const anon = await errorOf(db, 'anon', (tx: Tx) => tx.query(`select 1 from public.legal_document_acceptances`));
    expect(anon).toMatch(/permission denied/);
  });

  it('lets a retailer file correction and consent-withdrawal requests for themself only', async () => {
    for (const type of ['data_correction', 'consent_withdrawal']) {
      await as(db, retailerA, (tx: Tx) => tx.query(
        `insert into public.retailer_account_requests (retailer_id, request_type, note) values ($1, $2, 'Please update my shop address.')`, [retailerA, type]));
    }
    expect(await errorOf(db, retailerA, (tx: Tx) => tx.query(
      `insert into public.retailer_account_requests (retailer_id, request_type) values ($1, 'data_correction')`, [retailerB]))).toMatch(/row-level security/);
    expect(await errorOf(db, retailerA, (tx: Tx) => tx.query(
      `insert into public.retailer_account_requests (retailer_id, request_type) values ($1, 'make_me_admin')`, [retailerA]))).toMatch(/type_check/);
    const seen = await as(db, retailerB, (tx: Tx) => tx.query(`select 1 from public.retailer_account_requests`));
    expect(seen.rows).toHaveLength(0);
  });

  it('is re-runnable and its rollback refuses to discard user requests', async () => {
    await db.exec(readFileSync('supabase/migrations/0095_legal_acceptance_and_privacy_requests.sql', 'utf8'));
    const down = readFileSync('supabase/rollbacks/0095_legal_acceptance_and_privacy_requests.down.sql', 'utf8');
    await expect(db.exec(down)).rejects.toThrow(/Rollback blocked/);
    await db.exec('rollback');
    const { rows } = await db.query<{ n: string }>(`select count(*)::text as n from public.legal_document_acceptances`);
    expect(Number(rows[0]!.n)).toBeGreaterThan(0);
  });

  it('rollback applies cleanly on a database with no such requests', async () => {
    const scratch = await createMigratedDb();
    await scratch.exec(readFileSync('supabase/rollbacks/0095_legal_acceptance_and_privacy_requests.down.sql', 'utf8'));
    const { rows } = await scratch.query<{ n: string }>(
      `select count(*)::text as n from pg_class where relname = 'legal_document_acceptances'`);
    expect(rows[0]!.n).toBe('0');
    await scratch.close();
  }, 120_000);
});
