/**
 * Migration 0078 — privilege hardening, executed (not asserted as text).
 *
 * The harness applies every file in supabase/migrations in order on
 * PostgreSQL 16 (PGlite), so these cases run against the real catalog after
 * 0078 — the same evidence the audit document cites. Limits: PGlite is a
 * single-connection Postgres with stubbed auth/storage schemas, so this proves
 * privilege wiring and definitions, not a live PostgREST call.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createMigratedDb, errorOf, as, type Db } from './helpers/pg-harness';

const ROOT = join(__dirname, '..');
let db: Db;

beforeAll(async () => {
  db = await createMigratedDb();
}, 120_000);

const exec = (who: string, sql: string) => errorOf(db, who, (tx) => tx.query(sql));

describe('0078 revokes API-role EXECUTE on unguarded SECURITY DEFINER helpers', () => {
  it('fefo_plan_for_product is not executable by anon or authenticated', async () => {
    expect(
      await exec('anon', `select * from fefo_plan_for_product(gen_random_uuid(), gen_random_uuid(), 1)`)
    ).toMatch(/permission denied for function fefo_plan_for_product/i);
    expect(
      await exec('authenticated', `select * from fefo_plan_for_product(gen_random_uuid(), gen_random_uuid(), 1)`)
    ).toMatch(/permission denied for function fefo_plan_for_product/i);
  });

  it('current_offer_floor_paise is not executable by authenticated', async () => {
    expect(
      await exec('authenticated', `select current_offer_floor_paise(gen_random_uuid())`)
    ).toMatch(/permission denied for function current_offer_floor_paise/i);
  });

  it('handle_new_user (a trigger function) has no API-role grant left', async () => {
    const { rows } = await db.query<{ anon: boolean; authenticated: boolean }>(`
      select has_function_privilege('anon', 'public.handle_new_user()', 'EXECUTE') as anon,
             has_function_privilege('authenticated', 'public.handle_new_user()', 'EXECUTE') as authenticated
    `);
    expect(rows[0]).toEqual({ anon: false, authenticated: false });
  });

  it('the owner keeps EXECUTE, so the SECURITY DEFINER callers still work', async () => {
    // Not a permission error: the batch table is simply empty, so the planner
    // reports the shortfall it would report to reserve_order_stock().
    const floor = await db.query<{ current_offer_floor_paise: string | null }>(
      `select current_offer_floor_paise(gen_random_uuid())`
    );
    expect(floor.rows[0]?.current_offer_floor_paise ?? null).toBeNull();
    await expect(
      db.query(`select * from fefo_plan_for_product(gen_random_uuid(), gen_random_uuid(), 1)`)
    ).rejects.toThrow(/INSUFFICIENT_STOCK/);
  });

  it('granted-to-service_role helpers stay callable for trusted server code', async () => {
    const { rows } = await db.query<{ service_role: boolean }>(`
      select has_function_privilege('service_role', 'public.fefo_plan_for_product(uuid, uuid, integer)', 'EXECUTE') as service_role
    `);
    expect(rows[0]?.service_role).toBe(true);
  });
});

describe('0078 aligns banner artwork writes with the banners.manage permission', () => {
  it('storage insert/update on the banners bucket require admin, not staff', async () => {
    const { rows } = await db.query<{ policyname: string; cmd: string; qual: string | null; with_check: string | null }>(`
      select policyname, cmd, qual, with_check
        from pg_policies
       where schemaname = 'storage' and tablename = 'objects'
         and policyname in ('staff_write_banners', 'staff_update_banners', 'staff_delete_banners')
       order by policyname
    `);
    expect(rows).toHaveLength(3);
    for (const policy of rows) {
      const expression = `${policy.qual ?? ''}${policy.with_check ?? ''}`;
      expect(expression, policy.policyname).toContain('is_admin_or_above');
      expect(expression, policy.policyname).not.toContain('is_staff_or_above');
    }
  });

  it('the public read policy on the banners bucket is untouched', async () => {
    const { rows } = await db.query<{ qual: string }>(`
      select qual from pg_policies
       where schemaname = 'storage' and tablename = 'objects' and policyname = 'public_read_banners'
    `);
    expect(rows[0]?.qual).toContain("bucket_id = 'banners'");
  });
});

describe('0078 is forward-only and re-runnable', () => {
  it('re-applies cleanly on top of itself', async () => {
    const sql = readFileSync(join(ROOT, 'supabase/migrations/0078_privilege_hardening.sql'), 'utf8');
    await expect(db.exec(sql)).resolves.toBeInstanceOf(Array);
  });

  it('contains no destructive statement', () => {
    const sql = readFileSync(join(ROOT, 'supabase/migrations/0078_privilege_hardening.sql'), 'utf8');
    const body = sql
      .split('\n')
      .filter((line) => !line.trimStart().startsWith('--'))
      .join('\n')
      .toLowerCase();
    expect(body).not.toMatch(/drop table\b/);
    expect(body).not.toMatch(/truncate\b/);
    expect(body).not.toMatch(/drop column\b/);
    expect(body).not.toMatch(/\bdelete from\b/);
    expect(body).not.toMatch(/\binsert into\b/);
    expect(body).not.toMatch(/disable row level security/);
    // Only the two named storage policies may be dropped, and only with a guard.
    expect(body.match(/drop policy/g)?.length).toBe(2);
    expect(body.match(/drop policy if exists/g)?.length).toBe(2);
  });

  it('every revoke is guarded on the object existing', () => {
    const sql = readFileSync(join(ROOT, 'supabase/migrations/0078_privilege_hardening.sql'), 'utf8');
    const revokes = sql.match(/^\s*revoke /gm) ?? [];
    const guards = sql.match(/to_regprocedure\(/g) ?? [];
    expect(revokes.length).toBeGreaterThan(0);
    expect(guards.length).toBeGreaterThanOrEqual(revokes.length);
  });
});

describe('0078 rollback restores the previous posture', () => {
  it('rollback restores staff write on the banners bucket and the API grants', async () => {
    const sql = readFileSync(join(ROOT, 'supabase/rollbacks/0078_privilege_hardening.sql'), 'utf8');
    await db.exec(sql);
    try {
      const { rows } = await db.query<{ qual: string | null; with_check: string | null }>(`
        select qual, with_check from pg_policies
         where schemaname = 'storage' and tablename = 'objects' and policyname = 'staff_write_banners'
      `);
      expect(rows[0]?.with_check ?? '').toContain('is_staff_or_above');
      const grants = await db.query<{ authenticated: boolean }>(`
        select has_function_privilege('authenticated', 'public.current_offer_floor_paise(uuid)', 'EXECUTE') as authenticated
      `);
      expect(grants.rows[0]?.authenticated).toBe(true);
    } finally {
      // Leave the database in the post-0078 (hardened) state for any later case.
      await db.exec(readFileSync(join(ROOT, 'supabase/migrations/0078_privilege_hardening.sql'), 'utf8'));
    }
  });
});

// Keep the harness type import meaningful for readers: `as()` is the supported
// way to run a statement as a role, and is exported for other DB tests.
void as;
