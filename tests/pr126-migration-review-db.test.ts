/**
 * Review of migrations 0094–0100 and their rollbacks, as executable checks
 * (PostgreSQL 16 via PGlite, full chain 0001–0100 applied).
 *
 * The function list is read from the migration files, so a function added to
 * any of them later is covered automatically and must be classified below.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';

import { createMigratedDb, type Db } from './helpers/pg-harness';

const FILES = readdirSync('supabase/migrations').filter((f) => /^(009[4-9]|0100)_/.test(f)).sort();
const FUNCTIONS = [...new Set(FILES.flatMap((file) =>
  [...readFileSync(`supabase/migrations/${file}`, 'utf8').matchAll(/create (?:or replace )?function public\.([a-z_0-9]+)/gi)].map((m) => m[1]!)))].sort();

/** The ONLY functions of this PR a signed-in browser session may call. Each checks the caller itself. */
const AUTHENTICATED_MAY_CALL = [
  'cancel_order_coins_atomic',          // owner of the order or Admin (0097)
  'close_sub_order_atomic',             // Admin or the seller's member (0097)
  'is_untrusted_api_caller',            // SECURITY INVOKER; tells a caller its own role class only
  'order_shortfall_coins',              // Admin / assigned delivery person; amount computed by the database (0094)
  'publish_legal_document_version',     // Super Admin (0098)
  'record_legal_acceptance',            // records the caller's own acceptance of the current version (0095/0098)
  'record_loyalty_points',              // Admin only; refuses ORDER_EARN (0094)
  'record_marketplace_launch_approval', // Super Admin; both approvals required (0098)
  'seller_offer_gate_status',           // Admin or member of that seller (0098)
  'set_sub_order_status',               // existing RPC; closing states are atomic (0097)
];
const TABLES = ['delivery_completion_requests', 'legal_document_acceptances', 'legal_document_current_versions', 'marketplace_launch_approvals'];

let db: Db;
beforeAll(async () => { db = await createMigratedDb(); }, 180_000);
afterAll(async () => { await db.close(); });

describe('migrations 0094–0100: catalogue review', () => {
  it('covers seven migrations in unbroken order, each with a rollback script', () => {
    expect(FILES.map((f) => f.slice(0, 4))).toEqual(['0094', '0095', '0096', '0097', '0098', '0099', '0100']);
    for (const file of FILES) {
      expect(() => readFileSync(`supabase/rollbacks/${file.replace(/\.sql$/, '.down.sql')}`, 'utf8')).not.toThrow();
    }
    // 29 in 0094–0099 + 7 in 0100 (three atomic RPCs, one private actor check, three guard triggers).
    expect(FUNCTIONS).toHaveLength(36);
    for (const added of ['dispatch_order_atomic', 'fail_delivery_atomic', 'return_delivery_to_warehouse_atomic', '_fulfilment_actor_role',
      'guard_direct_order_fulfilment_transition', 'guard_direct_delivery_fulfilment_transition', 'guard_settled_delivery_lines']) {
      expect(FUNCTIONS).toContain(added);
    }
  });

  it('every function has a fixed search_path; every SECURITY DEFINER function is closed to PUBLIC and anon', async () => {
    const { rows } = await db.query<{ proname: string; definer: boolean; cfg: string; anon: boolean; pub: boolean }>(
      `select p.proname, p.prosecdef definer, coalesce(array_to_string(p.proconfig, ','), '') cfg,
              has_function_privilege('anon', p.oid, 'execute') anon,
              exists (select 1 from aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a where a.grantee = 0) pub
         from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = any($1)`, [FUNCTIONS]);
    expect(new Set(rows.map((r) => r.proname))).toEqual(new Set(FUNCTIONS));
    for (const row of rows) {
      expect(row.cfg, row.proname).toBe('search_path=public, pg_temp');
      expect(row.pub, `${row.proname} PUBLIC execute`).toBe(false);
      if (row.definer) expect(row.anon, `${row.proname} anon execute`).toBe(false);
    }
    // The single anon-callable function is SECURITY INVOKER and reveals nothing.
    expect(rows.filter((r) => r.anon).map((r) => r.proname)).toEqual(['is_untrusted_api_caller']);
  });

  it('a signed-in session can call exactly the documented functions and nothing else', async () => {
    const { rows } = await db.query<{ proname: string }>(
      `select distinct p.proname from pg_proc p
        where p.pronamespace = 'public'::regnamespace and p.proname = any($1)
          and has_function_privilege('authenticated', p.oid, 'execute') order by 1`, [FUNCTIONS]);
    expect(rows.map((r) => r.proname)).toEqual(AUTHENTICATED_MAY_CALL);
  });

  it('the service role cannot record a marketplace approval or reach the internal helpers', async () => {
    const { rows } = await db.query<{ proname: string }>(
      `select distinct p.proname from pg_proc p
        where p.pronamespace = 'public'::regnamespace and p.proname = any($1)
          and not has_function_privilege('service_role', p.oid, 'execute') order by 1`, [FUNCTIONS]);
    expect(rows.map((r) => r.proname)).toEqual([
      '_close_sub_order_core', '_fulfilment_actor_role', '_order_loyalty_points_due', '_refund_child_share_remaining', '_set_sub_order_status_plain',
      'guard_direct_delivery_fulfilment_transition', 'guard_direct_order_fulfilment_transition', 'guard_settled_delivery_lines',
      'record_marketplace_launch_approval',
    ]);
  });

  it('the atomic delivery and fulfilment functions are SECURITY DEFINER, service-role only, and re-check the role themselves', async () => {
    const names = ['complete_delivery_atomic', 'dispatch_order_atomic', 'fail_delivery_atomic', 'return_delivery_to_warehouse_atomic'];
    const { rows } = await db.query<{ proname: string; definer: boolean; svc: boolean; authn: boolean; anon: boolean; src: string }>(
      `select p.proname, p.prosecdef definer, has_function_privilege('service_role', p.oid, 'execute') svc,
              has_function_privilege('authenticated', p.oid, 'execute') authn, has_function_privilege('anon', p.oid, 'execute') anon, p.prosrc src
         from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = any($1) order by 1`, [names]);
    expect(rows.map((r) => r.proname)).toEqual(names);
    for (const row of rows) {
      expect({ name: row.proname, definer: row.definer, svc: row.svc, authn: row.authn, anon: row.anon })
        .toEqual({ name: row.proname, definer: true, svc: true, authn: false, anon: false });
      expect(row.src, row.proname).toContain("if coalesce(auth.role(), '') <> 'service_role' then");
    }
  });

  it('lock order is parent first in every delivery function: orders, then order_deliveries, then order_delivery_items', async () => {
    const names = ['complete_delivery_atomic', 'dispatch_order_atomic', 'fail_delivery_atomic', 'return_delivery_to_warehouse_atomic'];
    const { rows } = await db.query<{ proname: string; src: string }>(
      `select p.proname, p.prosrc src from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = any($1)`, [names]);
    for (const row of rows) {
      const order = row.src.search(/from public\.orders o where o\.id = p_order_id for update/);
      const delivery = row.src.search(/from public\.order_deliveries d where d\.(?:id = v_delivery_id|order_id = p_order_id) for update/);
      const lines = row.src.search(/from public\.order_delivery_items di where di\.delivery_id = [a-z_.]+ order by di\.id for update/);
      expect(order, `${row.proname} locks the order`).toBeGreaterThan(-1);
      expect(delivery, `${row.proname} locks the delivery after the order`).toBeGreaterThan(order);
      if (lines > -1) expect(lines, `${row.proname} locks lines after the delivery`).toBeGreaterThan(delivery);
      // No function takes a line lock before the delivery lock.
      expect(row.src.slice(0, delivery)).not.toMatch(/order_delivery_items[^;]*for update/);
    }
    // The line guard never WAITS for the parent while a line row is locked.
    const guard = (await db.query<{ src: string }>(`select prosrc src from pg_proc where proname = 'guard_order_delivery_item_snapshot'`)).rows[0]!.src;
    expect(guard).toContain('for share of od nowait');
    expect(guard.match(/for (share|update)/g)).toHaveLength(1);
  });

  it('every new table has RLS on, nothing for anon, and at most SELECT for signed-in users', async () => {
    const { rows } = await db.query<{ relname: string; rls: boolean; grants: string | null }>(
      `select c.relname, c.relrowsecurity rls,
              (select string_agg(tp.grantee || ':' || tp.privilege_type, ',' order by 1)
                 from information_schema.table_privileges tp
                where tp.table_schema = 'public' and tp.table_name = c.relname and tp.grantee in ('anon', 'authenticated', 'PUBLIC')) grants
         from pg_class c where c.relnamespace = 'public'::regnamespace and c.relname = any($1) order by 1`, [TABLES]);
    expect(rows).toEqual([
      { relname: 'delivery_completion_requests', rls: true, grants: null },
      { relname: 'legal_document_acceptances', rls: true, grants: 'authenticated:SELECT' },
      { relname: 'legal_document_current_versions', rls: true, grants: 'authenticated:SELECT' },
      { relname: 'marketplace_launch_approvals', rls: true, grants: 'authenticated:SELECT' },
    ]);
  });
});

describe('rollbacks 0094–0100: no data loss', () => {
  const strip = (sql: string) => sql.replace(/--[^\n]*/g, '');

  it('no rollback truncates, deletes rows or drops a column', () => {
    for (const file of FILES) {
      const down = strip(readFileSync(`supabase/rollbacks/${file.replace(/\.sql$/, '.down.sql')}`, 'utf8'));
      expect(down, file).not.toMatch(/\btruncate\b|\bdelete\s+from\b|\bdrop\s+column\b|\bdrop\s+schema\b/i);
    }
  });

  it('the only tables a rollback removes are archived, row for row, immediately before', () => {
    const dropped: string[] = [];
    for (const file of FILES) {
      const down = strip(readFileSync(`supabase/rollbacks/${file.replace(/\.sql$/, '.down.sql')}`, 'utf8'));
      for (const match of down.matchAll(/drop table (?:if exists )?public\.([a-z_0-9]+)/gi)) {
        const table = match[1]!;
        dropped.push(table);
        const archive = down.indexOf(`insert into public.${table}_rollback_archive`);
        expect(archive, `${table} archived`).toBeGreaterThan(-1);
        expect(archive).toBeLessThan(match.index!);
      }
    }
    expect(dropped.sort()).toEqual(['legal_document_current_versions', 'marketplace_launch_approvals']);
  });

  it('the whole chain rolls back 0100 → 0094 and re-applies 0094 → 0100, twice, on one database', async () => {
    const fresh = await createMigratedDb();
    for (let round = 0; round < 2; round++) {
      for (const file of [...FILES].reverse()) {
        await fresh.exec(readFileSync(`supabase/rollbacks/${file.replace(/\.sql$/, '.down.sql')}`, 'utf8'));
      }
      for (const file of FILES) {
        await fresh.exec(readFileSync(`supabase/migrations/${file}`, 'utf8'));
      }
    }
    const { rows } = await fresh.query<{ n: number }>(
      `select count(distinct proname)::int n from pg_proc where pronamespace = 'public'::regnamespace and proname = any($1)`, [FUNCTIONS]);
    expect(rows[0]!.n).toBe(FUNCTIONS.length);
    expect((await fresh.query<{ v: boolean }>(`select public.third_party_offers_enabled() v`)).rows[0]!.v).toBe(false);
    await fresh.close();
  }, 240_000);
});
