/**
 * Migration catalog invariants — the executable form of the SQL audit.
 *
 * `createMigratedDb()` applies EVERY file in supabase/migrations in order to
 * PGlite (PostgreSQL 16, WASM) over a stub of the Supabase platform surface.
 * These cases therefore assert the schema the migrations actually produce,
 * not the text they contain.
 *
 * Run: `corepack pnpm exec vitest run tests/migration-catalog-invariants.test.ts`
 *
 * Scope limits (stated, not hidden): PGlite is a single-connection Postgres
 * with stubbed `auth`/`storage` schemas. It proves DDL, policies, grants and
 * function definitions; it does not prove PostgREST or GoTrue behaviour, and
 * it says nothing about the state of the hosted project, which must be
 * verified with supabase/audits/migration_and_security_verification_readonly.sql.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { createMigratedDb, migrationFiles, type Db } from './helpers/pg-harness';

const ROOT = join(__dirname, '..');
let db: Db;

beforeAll(async () => {
  db = await createMigratedDb();
}, 180_000);

const q = async <T>(sql: string, params?: unknown[]) =>
  (await db.query<T>(sql, params as never)).rows;

// ---------------------------------------------------------------------------
// 1. Row-level security
// ---------------------------------------------------------------------------
describe('RLS coverage', () => {
  it('every public table has RLS enabled', async () => {
    const rows = await q<{ table_name: string }>(`
      select c.relname as table_name
        from pg_class c join pg_namespace n on n.oid = c.relnamespace
       where c.relkind = 'r' and n.nspname = 'public' and not c.relrowsecurity
       order by 1`);
    expect(rows).toEqual([]);
  });

  it('only the documented service-role-only tables have no policy', async () => {
    const rows = await q<{ table_name: string }>(`
      select c.relname as table_name
        from pg_class c join pg_namespace n on n.oid = c.relnamespace
       where c.relkind = 'r' and n.nspname = 'public' and c.relrowsecurity
         and not exists (select 1 from pg_policies p
                          where p.schemaname = 'public' and p.tablename = c.relname)
       order by 1`);
    // cleanup_runs + data_retention_rules (0055, general retention engine) and
    // ai_cleanup_runs + ai_retention_rules (0084, AI-only 14-day retention) are
    // server-scheduler-only: no client policy exists by design. The supplier
    // rate-limit table is the same shape.
    expect(rows.map((r) => r.table_name)).toEqual([
      'ai_cleanup_runs',
      'ai_retention_rules',
      'cleanup_runs',
      'data_retention_rules',
      'supplier_application_rate_limits',
    ]);
  });
});

// ---------------------------------------------------------------------------
// 2. SECURITY DEFINER hygiene
// ---------------------------------------------------------------------------
describe('SECURITY DEFINER hygiene', () => {
  it('every definer function pins search_path (no hijackable unqualified names)', async () => {
    const rows = await q<{ proname: string }>(`
      select p.proname
        from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public' and p.prosecdef
         and not exists (select 1 from unnest(coalesce(p.proconfig, '{}'::text[])) cfg
                          where cfg like 'search_path=%')
       order by 1`);
    expect(rows).toEqual([]);
  });

  it('no unguarded definer RPC is reachable by anon or authenticated', async () => {
    // A definer RPC that (a) is not a trigger, (b) is EXECUTE-able by an API
    // role, and (c) contains no caller check is either a public endpoint by
    // design or an exposure. The allow-list below is the reviewed set; add to
    // it only with a written justification.
    const allowedPublicEndpoints = new Set([
      'is_phone_registered',        // public registration phone pre-check (0057 decision)
      'submit_supplier_application', // public supplier form; rate-limited server-side
      'can_current_staff_read_profile', // boolean predicate evaluated INSIDE a policy
    ]);
    const guardTokens = [
      'auth.uid()', 'auth.jwt()', 'auth.role()', 'is_staff_or_above', 'is_admin_or_above',
      'is_super_admin', 'current_user_role', 'is_active_account', 'require_', '_can_',
      'is_retailer_assigned', 'is_area_assigned', 'is_order_assigned', 'is_warehouse_assigned',
      'is_transfer_', 'is_grn_', 'can_current', 'has_permission',
    ];
    const rows = await q<{ proname: string; args: string; src: string; anon: boolean; authn: boolean; is_trigger: boolean }>(`
      select p.proname,
             pg_get_function_identity_arguments(p.oid) as args,
             p.prosrc as src,
             has_function_privilege('anon', p.oid, 'EXECUTE') as anon,
             has_function_privilege('authenticated', p.oid, 'EXECUTE') as authn,
             exists (select 1 from pg_trigger t where t.tgfoid = p.oid and not t.tgisinternal) as is_trigger
        from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public' and p.prosecdef
       order by 1`);
    const exposed = rows
      .filter((r) => !r.is_trigger && (r.anon || r.authn))
      .filter((r) => !guardTokens.some((token) => r.src.includes(token)))
      .filter((r) => !allowedPublicEndpoints.has(r.proname))
      .map((r) => `${r.proname}(${r.args}) anon=${r.anon} authenticated=${r.authn}`);
    expect(exposed).toEqual([]);
  });

  it('0078 keeps the inventory plan and seller price floor off the API roles', async () => {
    const rows = await q<{ proname: string; anon: boolean; authn: boolean }>(`
      select p.proname,
             has_function_privilege('anon', p.oid, 'EXECUTE') as anon,
             has_function_privilege('authenticated', p.oid, 'EXECUTE') as authn
        from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public'
         and p.proname in ('fefo_plan_for_product', 'current_offer_floor_paise')`);
    expect(rows).toHaveLength(2);
    for (const row of rows) {
      expect(row.anon, `${row.proname} anon`).toBe(false);
      expect(row.authn, `${row.proname} authenticated`).toBe(false);
    }
  });
});

// ---------------------------------------------------------------------------
// 3. Storage
// ---------------------------------------------------------------------------
describe('storage buckets and object policies', () => {
  it('creates the expected buckets with the intended visibility', async () => {
    const rows = await q<{ id: string; public: boolean }>(`
      select id, public from storage.buckets order by id`);
    const map = Object.fromEntries(rows.map((r) => [r.id, r.public]));
    expect(map).toEqual({
      avatars: true,
      'banner-drafts': false,
      banners: true,
      'brand-logos': true,
      'category-images': true,
      'delivery-proofs': false,
      'payment-proofs': false,
      'product-images': true,
      'retailer-documents': false,
      'supplier-documents': false,
    });
  });

  it('never grants a private bucket a bare public read', async () => {
    const rows = await q<{ policyname: string; qual: string }>(`
      select policyname, qual from pg_policies
       where schemaname = 'storage' and tablename = 'objects' and cmd = 'SELECT'`);
    const privateBuckets = ['banner-drafts', 'delivery-proofs', 'payment-proofs', 'retailer-documents', 'supplier-documents'];
    const bare = rows.filter((row) =>
      privateBuckets.some((bucket) => row.qual === `(bucket_id = '${bucket}'::text)`)
    );
    expect(bare).toEqual([]);
  });

  it('banner artwork writes require admin, not staff (0078)', async () => {
    const rows = await q<{ policyname: string; qual: string | null; with_check: string | null }>(`
      select policyname, qual, with_check from pg_policies
       where schemaname = 'storage' and tablename = 'objects'
         and policyname like '%banners%' and cmd <> 'SELECT'`);
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      const expression = `${row.qual ?? ''}${row.with_check ?? ''}`;
      expect(expression, row.policyname).toContain('is_admin_or_above');
      expect(expression, row.policyname).not.toContain('is_staff_or_above');
    }
  });
});

// ---------------------------------------------------------------------------
// 4. Schema sanity
// ---------------------------------------------------------------------------
describe('schema sanity', () => {
  it('has no duplicate index definitions on the same table', async () => {
    const rows = await q<{ table_name: string; idx1: string; idx2: string }>(`
      select t.relname as table_name, i1.relname as idx1, i2.relname as idx2
        from pg_index x1
        join pg_index x2 on x1.indrelid = x2.indrelid and x1.indexrelid < x2.indexrelid
        join pg_class i1 on i1.oid = x1.indexrelid
        join pg_class i2 on i2.oid = x2.indexrelid
        join pg_class t on t.oid = x1.indrelid
        join pg_namespace n on n.oid = t.relnamespace
       where n.nspname = 'public'
         and pg_get_indexdef(x1.indexrelid) = pg_get_indexdef(x2.indexrelid)`);
    expect(rows).toEqual([]);
  });

  it('every foreign key publishes a validated constraint', async () => {
    const rows = await q<{ child: string; conname: string }>(`
      select conrelid::regclass::text as child, conname
        from pg_constraint
       where contype = 'f' and connamespace = 'public'::regnamespace and not convalidated`);
    expect(rows).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// 5. Application ↔ schema contract
// ---------------------------------------------------------------------------
describe('application references resolve against the schema', () => {
  function sourceFiles(dir: string, out: string[] = []): string[] {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) sourceFiles(full, out);
      else if (/\.(ts|tsx)$/.test(entry) && !/\.test\./.test(entry)) out.push(full);
    }
    return out;
  }

  const files = ['app', 'lib', 'components'].flatMap((dir) => sourceFiles(join(ROOT, dir)));

  it('every table, view and RPC the app calls exists', async () => {
    const tables = new Set((await q<{ relname: string }>(`
      select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
       where n.nspname = 'public' and c.relkind in ('r','v','m')`)).map((r) => r.relname));
    const functions = new Set((await q<{ proname: string }>(`
      select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public'`)).map((r) => r.proname));

    const missingTables = new Set<string>();
    const missingRpc = new Set<string>();
    for (const file of files) {
      const source = readFileSync(file, 'utf8');
      for (const match of source.matchAll(/\.from\(\s*'([a-z0-9_]+)'/g)) {
        if (!tables.has(match[1]!)) missingTables.add(`${match[1]} @ ${relative(ROOT, file)}`);
      }
      for (const match of source.matchAll(/\.rpc\(\s*'([a-z0-9_]+)'/g)) {
        if (!functions.has(match[1]!)) missingRpc.add(`${match[1]} @ ${relative(ROOT, file)}`);
      }
    }
    expect({ missingTables: [...missingTables], missingRpc: [...missingRpc] }).toEqual({
      missingTables: [],
      missingRpc: [],
    });
  }, 60_000);

  it('the migration set is contiguous apart from the documented gaps', () => {
    const versions = migrationFiles().map((file) => file.slice(0, 4));
    const numeric = versions.map((v) => Number(v));
    const gaps: string[] = [];
    for (let i = 1; i < numeric.length; i += 1) {
      if (numeric[i]! - numeric[i - 1]! > 1) {
        for (let missing = numeric[i - 1]! + 1; missing < numeric[i]!; missing += 1) {
          gaps.push(String(missing).padStart(4, '0'));
        }
      }
    }
    // 0061 was never committed; 0075 is the on-hold retention archive and 0076
    // the deferred banner alt_text. Anything else appearing here is a numbering
    // accident that must be reviewed before it is applied.
    expect(gaps).toEqual(['0061', '0075', '0076']);
  });

  it('never ships two migrations with the same version', () => {
    const versions = migrationFiles().map((file) => file.slice(0, 4));
    expect(new Set(versions).size).toBe(versions.length);
  });
});
