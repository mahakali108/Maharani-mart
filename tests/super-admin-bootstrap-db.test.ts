import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { as, createArea, createMigratedDb, errorOf, type Db } from './helpers/pg-harness';

/**
 * Migration 0106 — first Super Admin bootstrap, on real PostgreSQL 16 (PGlite).
 *
 * The live project has no auth users and no profiles, so nothing can satisfy
 * is_super_admin(). This is the only sanctioned path to the first one, and it
 * must be: SQL-console only, one-time, attributable to the allowlisted e-mail,
 * and refused for every API caller.
 */
const OWNER_EMAIL = 'owner@example.invalid';

describe('0106 first Super Admin bootstrap (PostgreSQL 16)', () => {
  let db: Db;
  beforeAll(async () => { db = await createMigratedDb(); }, 180_000);
  afterAll(async () => { await db.close(); });

  /** Creates a real signup the way production does: auth user → trigger → profile. */
  async function signUp(email: string, confirmed: boolean, fullName = ''): Promise<string> {
    const id = randomUUID();
    const areaId = await createArea(db);
    await db.query(
      `insert into auth.users (id, email, raw_user_meta_data, email_confirmed_at)
       values ($1, $2, $3, $4)`,
      [id, email, JSON.stringify({ full_name: fullName, phone: `+91${Math.floor(1e9 + Math.random() * 8e9)}`, area_id: areaId }), confirmed ? new Date() : null],
    );
    return id;
  }

  const allow = (email: string) => db.query(
    `insert into public.super_admin_bootstrap_allowlist (email, full_name, phone, note)
     values ($1, 'Operator Name', '8987023959', 'test')`,
    [email],
  );

  const bootstrap = (id: string) => db.query<{ ok: null }>(`select public.bootstrap_super_admin($1)`, [id]);

  it('starts with no Super Admin and no allowlist row', async () => {
    const { rows } = await db.query<{ super_admins: number; allowed: number; events: number }>(
      `select (select count(*)::int from public.profiles where role = 'super_admin') as super_admins,
              (select count(*)::int from public.super_admin_bootstrap_allowlist) as allowed,
              (select count(*)::int from public.super_admin_bootstrap_events) as events`,
    );
    expect(rows[0]).toEqual({ super_admins: 0, allowed: 0, events: 0 });
  });

  it('refuses without an authorising allowlist row', async () => {
    const id = await signUp(OWNER_EMAIL, true);
    await expect(bootstrap(id)).rejects.toThrow(/No bootstrap allowlist row/);
  });

  it('refuses an unconfirmed e-mail address', async () => {
    const id = await signUp(OWNER_EMAIL, false);
    await allow(OWNER_EMAIL);
    await expect(bootstrap(id)).rejects.toThrow(/Confirm the e-mail address/);
  });

  it('refuses an account whose address is not the allowlisted one', async () => {
    const id = await signUp('someone-else@example.invalid', true);
    await expect(bootstrap(id)).rejects.toThrow(/does not match this account/);
    // the allowlist row is untouched by a failed attempt
    const { rows } = await db.query<{ consumed: number }>(
      `select count(*) filter (where consumed_at is not null)::int as consumed from public.super_admin_bootstrap_allowlist`,
    );
    expect(rows[0]!.consumed).toBe(0);
  });

  it('promotes the allowlisted, verified account exactly once and records it', async () => {
    const id = await signUp(OWNER_EMAIL, true);
    await bootstrap(id);

    const { rows } = await db.query<{ role: string; is_active: boolean; full_name: string }>(
      `select role, is_active, full_name from public.profiles where id = $1`, [id],
    );
    expect(rows[0]).toEqual({ role: 'super_admin', is_active: true, full_name: 'Operator Name' });

    const allowRows = await db.query<{ consumed_at: Date | null; consumed_profile_id: string | null }>(
      `select consumed_at, consumed_profile_id from public.super_admin_bootstrap_allowlist where id = 1`,
    );
    expect(allowRows.rows[0]!.consumed_at).not.toBeNull();
    expect(allowRows.rows[0]!.consumed_profile_id).toBe(id);

    const events = await db.query<{ email: string; previous_role: string; session_role: string }>(
      `select email, previous_role, session_role from public.super_admin_bootstrap_events`,
    );
    expect(events.rows).toHaveLength(1);
    expect(events.rows[0]).toMatchObject({ email: OWNER_EMAIL, previous_role: 'retailer' });
  });

  it('refuses a second bootstrap even with a fresh allowlist row', async () => {
    await db.query(`update public.super_admin_bootstrap_allowlist set consumed_at = null, consumed_profile_id = null where id = 1`);
    const other = await signUp(OWNER_EMAIL, true);
    await expect(bootstrap(other)).rejects.toThrow(/A Super Admin already exists/);
    // and only one event exists
    const { rows } = await db.query<{ n: number }>(`select count(*)::int as n from public.super_admin_bootstrap_events`);
    expect(rows[0]!.n).toBe(1);
  });

  it('is not executable by any API role', async () => {
    const retailer = await signUp('retailer@example.invalid', true);
    expect(await errorOf(db, retailer, (tx) => tx.query(`select public.bootstrap_super_admin($1)`, [retailer])))
      .toMatch(/permission denied for function/);
    expect(await errorOf(db, 'anon', (tx) => tx.query(`select public.bootstrap_super_admin($1)`, [retailer])))
      .toMatch(/permission denied for function/);
    expect(await errorOf(db, 'service', (tx) => tx.query(`select public.bootstrap_super_admin($1)`, [retailer])))
      .toMatch(/permission denied for function/);
  });

  it('keeps the allowlist and the audit trail away from API roles', async () => {
    for (const who of ['anon', 'service']) {
      expect(await errorOf(db, who, (tx) => tx.query(`insert into public.super_admin_bootstrap_allowlist (email, full_name, phone) values ('x@y.invalid','x','8987023959')`)))
        .toMatch(/permission denied/);
      expect(await errorOf(db, who, (tx) => tx.query(`insert into public.super_admin_bootstrap_events (profile_id, email, previous_role, session_role) values (gen_random_uuid(),'x@y.invalid','retailer','postgres')`)))
        .toMatch(/permission denied/);
    }
    // service_role may read the allowlist for operational checks, but not write it
    const readable = await as(db, 'service', (tx) => tx.query<{ n: number }>(`select count(*)::int as n from public.super_admin_bootstrap_allowlist`));
    expect(readable.rows[0]!.n).toBe(1);
  });

  it('blocks an API caller from inserting a privileged profile', async () => {
    for (const who of ['service', 'anon']) {
      const message = await errorOf(db, who, (tx) => tx.query(
        `insert into public.profiles (id, role, full_name, phone) values (gen_random_uuid(), 'super_admin', 'x', $1)`,
        [`9${Math.floor(1e8 + Math.random() * 8e8)}`],
      ));
      // either the RLS policy or the new trigger refuses; both are acceptable, and
      // the trigger is the one that survives a future policy change.
      expect(message).toMatch(/permission denied|Privileged profiles are created by the database owner/);
    }
  });

  it('has a rollback that refuses while the audit trail holds a row', async () => {
    const sql = readFileSync('supabase/rollbacks/0106_first_super_admin_bootstrap.down.sql', 'utf8');
    expect(await errorOf(db, 'service', (tx) => tx.exec(sql))).toMatch(/Rollback refused/);
    await db.exec(`set maharani.allow_data_loss = 'true'`);
    await db.exec(sql);
    const { rows } = await db.query<{ tables: string | null; fn: string | null; trigger: number }>(
      `select to_regclass('public.super_admin_bootstrap_allowlist')::text as tables,
              to_regprocedure('public.bootstrap_super_admin(uuid)')::text as fn,
              (select count(*)::int from pg_trigger where tgname = 'trg_guard_profile_role_insert') as trigger`,
    );
    expect(rows[0]!.tables).toBeNull();
    expect(rows[0]!.fn).toBeNull();
    expect(rows[0]!.trigger).toBe(0);
    // the Super Admin it created is still an administrator: the rollback does not demote
    const still = await db.query<{ n: number }>(`select count(*)::int as n from public.profiles where role = 'super_admin'`);
    expect(still.rows[0]!.n).toBe(1);
  });
});
