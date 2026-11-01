/**
 * Regression suite for the three reported Supabase migration failures:
 *
 *   1. `0077_banner_draft_artwork.sql`
 *      `ERROR: 42501: must be owner of table buckets`
 *   2. `0086_catalog_seller_compliance_enforcement.sql`
 *      `ERROR: 42883: function public.is_active_seller_member(uuid) does not exist`
 *   3. `0087_phase_2d1_compliance_security_and_evidence_storage.sql`
 *      `ERROR: 42P01: relation public.product_compliance_reviews does not exist`
 *
 * Scope boundary (explicitly stated, not overclaimed):
 *   PGlite runs embedded PostgreSQL 16 (WASM) with a local stub of `auth` and
 *   `storage`. By default `createMigratedDb()` runs as PGlite's bootstrap
 *   superuser (`rolsuper = true`), which masks table-ownership errors such as
 *   `42501: must be owner of table buckets`. Below we explicitly construct a
 *   non-superuser `migration_runner` (`rolsuper = false`) and transfer
 *   `storage.buckets` ownership to `supabase_storage_admin` (`NOINHERIT`) to
 *   prove PostgreSQL's exact ownership checks on `storage.buckets`. This does
 *   NOT claim equivalence with hosted Supabase's live role graph on
 *   `fhrmsrumsraprvutrpeo` (in particular, whether the live SQL runner inherits
 *   ownership of `storage.objects` must still be verified via read-only catalog
 *   inspection before production rollout).
 */
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  as,
  createMigratedDb,
  createRetailer,
  createUser,
  migrationFiles,
  type Db,
} from './helpers/pg-harness';

const ROOT = join(__dirname, '..');
const readMigration = (file: string) =>
  readFileSync(join(ROOT, 'supabase', 'migrations', file), 'utf8');

function adaptMigration(sql: string): string {
  return sql.replace(/create extension if not exists "(pg_net|pg_cron)";/g, '');
}

async function applyMigration(db: Db, file: string): Promise<void> {
  await db.exec(adaptMigration(readMigration(file)));
}

/**
 * Migrate up to `lastMigration` while skipping specific files in between, using
 * `createMigratedDb` up to the file immediately preceding the first skipped file.
 */
async function createMigratedDbSkipping(
  lastMigration: string,
  skipFiles: string[],
): Promise<Db> {
  const skipSet = new Set(skipFiles);
  const all = migrationFiles().filter((file) => file <= lastMigration);
  const firstSkippedIdx = all.findIndex((file) => skipSet.has(file));
  if (firstSkippedIdx <= 0) {
    throw new Error(`Invalid skip list for createMigratedDbSkipping: ${skipFiles.join(', ')}`);
  }
  const db = await createMigratedDb({ lastMigration: all[firstSkippedIdx - 1] });
  for (const file of all.slice(firstSkippedIdx)) {
    if (skipSet.has(file)) continue;
    await applyMigration(db, file);
  }
  return db;
}

/**
 * Configure a realistic non-superuser execution boundary in PGlite where:
 *   - `supabase_storage_admin` (`NOLOGIN NOINHERIT`) owns `storage.buckets`.
 *   - `migration_runner` (`NOSUPERUSER`) owns `public` objects and (by default)
 *     `storage.objects`, and holds DML-only (`SELECT, INSERT, UPDATE, DELETE`)
 *     privileges on `storage.buckets` — NOT ownership.
 */
async function configureNonOwnerBucketsRole(
  db: Db,
  options: { storageObjectsOwnedByStorageAdmin?: boolean } = {},
): Promise<void> {
  await db.exec(`
    do $$
    declare
      r record;
    begin
      if not exists (select 1 from pg_roles where rolname = 'supabase_storage_admin') then
        create role supabase_storage_admin nologin noinherit;
      end if;
      if not exists (select 1 from pg_roles where rolname = 'migration_runner') then
        create role migration_runner nologin nosuperuser nocreatedb nocreaterole inherit;
      end if;

      grant usage, create on schema public to migration_runner;
      grant usage on schema auth, storage to migration_runner;
      grant anon, authenticated, service_role to migration_runner with admin option;

      for r in
        select tablename from pg_tables where schemaname = 'public'
      loop
        execute format('alter table public.%I owner to migration_runner', r.tablename);
      end loop;

      for r in
        select sequencename from pg_sequences where schemaname = 'public'
      loop
        execute format('alter sequence public.%I owner to migration_runner', r.sequencename);
      end loop;

      for r in
        select viewname from pg_views where schemaname = 'public'
      loop
        execute format('alter view public.%I owner to migration_runner', r.viewname);
      end loop;

      for r in
        select p.oid::regprocedure as sig
          from pg_proc p
          join pg_namespace n on n.oid = p.pronamespace
         where n.nspname = 'public'
      loop
        execute format('alter function %s owner to migration_runner', r.sig);
      end loop;

      alter table storage.buckets owner to supabase_storage_admin;
      revoke all on table storage.buckets from migration_runner;
      grant select, insert, update, delete on table storage.buckets to migration_runner;
    end;
    $$;
  `);

  if (options.storageObjectsOwnedByStorageAdmin) {
    await db.exec(`
      alter table storage.objects owner to supabase_storage_admin;
      grant select, insert, update, delete on table storage.objects to migration_runner;
    `);
  } else {
    await db.exec(`alter table storage.objects owner to migration_runner;`);
  }
}

async function execAsMigrationRunner(db: Db, sql: string): Promise<void> {
  await db.exec(`begin;\nset local role migration_runner;\n${sql}\ncommit;`);
}

// ---------------------------------------------------------------------------
// 1. Error 1 — 0077_banner_draft_artwork.sql (42501: must be owner of table buckets)
// ---------------------------------------------------------------------------
describe('0077_banner_draft_artwork.sql — storage.buckets ownership regression', () => {
  it('removes COMMENT ON TABLE storage.buckets from 0077 while keeping private bucket safeguards', () => {
    const sql = readMigration('0077_banner_draft_artwork.sql');
    const stripped = sql
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/--[^\n]*/g, '');

    expect(stripped).not.toMatch(/\bcomment\s+on\s+table\s+storage\.buckets\b/i);
    expect(stripped).toMatch(/\binsert\s+into\s+storage\.buckets\b/i);
    expect(stripped).toContain("'banner-drafts'");
  });

  it('reproduces 42501 on COMMENT ON TABLE storage.buckets as non-owner and passes patched 0077 idempotently', async () => {
    const db = await createMigratedDb({ lastMigration: '0074_banner_lifecycle_and_variants.sql' });
    try {
      await configureNonOwnerBucketsRole(db);

      // Verify our test harness actually enforces rolsuper = false and non-ownership.
      const roleCheck = await db.query<{ rolsuper: boolean; buckets_owner: string }>(`
        select r.rolsuper,
               (select tableowner from pg_tables where schemaname = 'storage' and tablename = 'buckets') as buckets_owner
          from pg_roles r
         where r.rolname = 'migration_runner'
      `);
      expect(roleCheck.rows[0]).toEqual({
        rolsuper: false,
        buckets_owner: 'supabase_storage_admin',
      });

      // Exact historical root cause: COMMENT ON TABLE storage.buckets fails with 42501.
      await expect(
        execAsMigrationRunner(
          db,
          `comment on table storage.buckets is 'Supabase-managed. banner-drafts (0077) is private.';`,
        ),
      ).rejects.toThrow(/must be owner of table buckets/i);
      await db.exec('rollback;');

      // Patched 0077 succeeds as non-superuser migration_runner on initial apply AND replay.
      const sql0077 = readMigration('0077_banner_draft_artwork.sql');
      await execAsMigrationRunner(db, sql0077);
      await execAsMigrationRunner(db, sql0077);

      const bucket = await db.query<{
        id: string;
        public: boolean;
        file_size_limit: number;
        allowed_mime_types: string[];
      }>(`
        select id, public, file_size_limit::int as file_size_limit, allowed_mime_types
          from storage.buckets
         where id = 'banner-drafts'
      `);
      expect(bucket.rows).toEqual([
        {
          id: 'banner-drafts',
          public: false,
          file_size_limit: 5_242_880,
          allowed_mime_types: ['image/png', 'image/jpeg', 'image/webp'],
        },
      ]);

      const policies = await db.query<{ policyname: string }>(`
        select policyname
          from pg_policies
         where schemaname = 'storage'
           and tablename = 'objects'
           and policyname like 'admin_%_banner_drafts'
         order by policyname
      `);
      expect(policies.rows.map((r) => r.policyname)).toEqual([
        'admin_delete_banner_drafts',
        'admin_read_banner_drafts',
        'admin_update_banner_drafts',
        'admin_write_banner_drafts',
      ]);
    } finally {
      await db.close();
    }
  }, 60_000);

  it('accepts a pre-created private banner-drafts bucket and fails closed on misconfigured pre-existing buckets', async () => {
    const db = await createMigratedDb({ lastMigration: '0074_banner_lifecycle_and_variants.sql' });
    try {
      await configureNonOwnerBucketsRole(db);
      const sql0077 = readMigration('0077_banner_draft_artwork.sql');

      // 1. Pre-create a misconfigured PUBLIC banner-drafts bucket (e.g. operator mistake in Dashboard).
      await db.exec(`
        insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
        values ('banner-drafts', 'banner-drafts', true, 5242880, array['image/png', 'image/jpeg', 'image/webp']);
      `);

      await expect(execAsMigrationRunner(db, sql0077)).rejects.toThrow(
        /banner-drafts bucket is missing or does not match the required private 5 MiB PNG\/JPEG\/WebP configuration/i,
      );
      await db.exec('rollback;');

      // Transaction rolled back: no partial draft columns were added to public.banners.
      const leakedCols = await db.query<{ column_name: string }>(`
        select column_name
          from information_schema.columns
         where table_schema = 'public'
           and table_name = 'banners'
           and column_name in ('draft_image_path', 'draft_image_mobile_path')
      `);
      expect(leakedCols.rows).toEqual([]);

      // 2. Fix bucket via owner/Storage API configuration -> 0077 succeeds cleanly.
      await db.exec(`
        update storage.buckets
           set public = false
         where id = 'banner-drafts';
      `);
      await execAsMigrationRunner(db, sql0077);

      const colsAfter = await db.query<{ column_name: string }>(`
        select column_name
          from information_schema.columns
         where table_schema = 'public'
           and table_name = 'banners'
           and column_name in ('draft_image_path', 'draft_image_mobile_path')
         order by column_name
      `);
      expect(colsAfter.rows.map((r) => r.column_name)).toEqual([
        'draft_image_mobile_path',
        'draft_image_path',
      ]);
    } finally {
      await db.close();
    }
  }, 60_000);

  it('documents and demonstrates that non-owner storage.objects still rejects CREATE POLICY without role inheritance', async () => {
    const db = await createMigratedDb({ lastMigration: '0074_banner_lifecycle_and_variants.sql' });
    try {
      await configureNonOwnerBucketsRole(db, { storageObjectsOwnedByStorageAdmin: true });
      const sql0077 = readMigration('0077_banner_draft_artwork.sql');

      // Bucket INSERT + DO verification pass, and PostgreSQL stops at
      // storage.objects policy DDL ("must be owner of relation objects") if the
      // executing role does not own/inherit storage.objects.
      await expect(execAsMigrationRunner(db, sql0077)).rejects.toThrow(
        /must be owner of (?:table|relation) objects/i,
      );
      await db.exec('rollback;');
    } finally {
      await db.close();
    }
  }, 60_000);

  it('fails fast in Statement #1 before inserting banner-drafts when 0074 banners.status is missing', async () => {
    const db = await createMigratedDb({
      lastMigration: '0073_seller_invitations_lifecycle_repair.sql',
    });
    try {
      await expect(applyMigration(db, '0077_banner_draft_artwork.sql')).rejects.toThrow(
        /MIGRATION ORDER VIOLATION: 0077 requires public\.banners\.status from 0074_banner_lifecycle_and_variants\.sql/i,
      );

      const bucket = await db.query<{ id: string }>(
        `select id from storage.buckets where id = 'banner-drafts'`,
      );
      expect(bucket.rows).toEqual([]);
    } finally {
      await db.close();
    }
  }, 60_000);
});

// ---------------------------------------------------------------------------
// 2. Error 2 — 0086_catalog_seller_compliance_enforcement.sql
//    (42883: function public.is_active_seller_member(uuid) does not exist)
// ---------------------------------------------------------------------------
describe('0086_catalog_seller_compliance_enforcement.sql — 0072 prerequisite & policy idempotency', () => {
  it('verifies 0072 defines public.is_active_seller_member(uuid) with hardened SECURITY DEFINER ACLs and active-only semantics', async () => {
    const db = await createMigratedDb({ lastMigration: '0072_super_admin_seller_invitations.sql' });
    try {
      const fn = await db.query<{
        args: string;
        rettype: string;
        prosecdef: boolean;
        provolatile: string;
        proconfig: string[] | null;
        anon_exec: boolean;
        authn_exec: boolean;
      }>(`
        select pg_get_function_identity_arguments(p.oid) as args,
               pg_get_function_result(p.oid) as rettype,
               p.prosecdef,
               p.provolatile,
               p.proconfig,
               has_function_privilege('anon', p.oid, 'EXECUTE') as anon_exec,
               has_function_privilege('authenticated', p.oid, 'EXECUTE') as authn_exec
          from pg_proc p
          join pg_namespace n on n.oid = p.pronamespace
         where n.nspname = 'public'
           and p.proname = 'is_active_seller_member'
      `);

      expect(fn.rows).toEqual([
        {
          args: 'p_seller_id uuid',
          rettype: 'boolean',
          prosecdef: true,
          provolatile: 's',
          proconfig: ['search_path=public, pg_temp'],
          anon_exec: false,
          authn_exec: true,
        },
      ]);

      // Behavioral verification: returns false when seller is pending/suspended, true when active.
      const superAdminId = await createUser(db, 'super_admin', 'Super Admin');
      const sellerUserId = await createUser(db, 'seller', 'Seller Owner');
      const { rows: sellerRows } = await db.query<{ id: string }>(
        `insert into public.sellers (business_name, status, created_by)
         values ('Patna Test Seller', 'pending', $1)
         returning id`,
        [superAdminId],
      );
      const sellerId = sellerRows[0]!.id;
      await db.query(
        `insert into public.seller_members (seller_id, profile_id, member_role, created_by)
         values ($1, $2, 'owner', $3)`,
        [sellerId, sellerUserId, superAdminId],
      );

      const pendingCheck = await as(db, sellerUserId, (tx) =>
        tx.query<{ ok: boolean }>(`select public.is_active_seller_member($1) as ok`, [sellerId]),
      );
      expect(pendingCheck.rows[0]!.ok).toBe(false);

      await as(db, superAdminId, (tx) =>
        tx.query(`update public.sellers set status = 'active' where id = $1`, [sellerId]),
      );
      const activeCheck = await as(db, sellerUserId, (tx) =>
        tx.query<{ ok: boolean }>(`select public.is_active_seller_member($1) as ok`, [sellerId]),
      );
      expect(activeCheck.rows[0]!.ok).toBe(true);

      await as(db, superAdminId, (tx) =>
        tx.query(
          `update public.sellers set status = 'suspended', suspension_reason = 'Audit hold' where id = $1`,
          [sellerId],
        ),
      );
      const suspendedCheck = await as(db, sellerUserId, (tx) =>
        tx.query<{ ok: boolean }>(`select public.is_active_seller_member($1) as ok`, [sellerId]),
      );
      expect(suspendedCheck.rows[0]!.ok).toBe(false);
    } finally {
      await db.close();
    }
  }, 60_000);

  it('fails fast in Statement #1 with zero partial DDL or policy drops when 0072 was skipped', async () => {
    const db = await createMigratedDbSkipping('0085_ordering_launch_readiness_atomic.sql', [
      '0072_super_admin_seller_invitations.sql',
    ]);
    try {
      // Confirm 0063's seller_offers_trading_select exists before attempting 0086.
      const beforePolicy = await db.query<{ qual: string }>(`
        select qual
          from pg_policies
         where schemaname = 'public'
           and tablename = 'seller_offers'
           and policyname = 'seller_offers_trading_select'
      `);
      expect(beforePolicy.rows).toHaveLength(1);

      await expect(
        applyMigration(db, '0086_catalog_seller_compliance_enforcement.sql'),
      ).rejects.toThrow(
        /MIGRATION ORDER VIOLATION: 0086 requires public\.is_active_seller_member\(uuid\) from 0072_super_admin_seller_invitations\.sql/i,
      );

      // Even without an explicit outer BEGIN/COMMIT in applyMigration, Statement #1
      // aborted BEFORE any table creation, column addition, or DROP POLICY IF EXISTS.
      const leakedState = await db.query<{
        compliance_scope_col: boolean;
        reviews_table: string | null;
        offer_policy_count: number;
      }>(`
        select exists (
                 select 1 from information_schema.columns
                  where table_schema = 'public'
                    and table_name = 'categories'
                    and column_name = 'compliance_scope'
               ) as compliance_scope_col,
               to_regclass('public.product_compliance_reviews')::text as reviews_table,
               (
                 select count(*)::int from pg_policies
                  where schemaname = 'public'
                    and tablename = 'seller_offers'
                    and policyname = 'seller_offers_trading_select'
               ) as offer_policy_count
      `);
      expect(leakedState.rows[0]).toEqual({
        compliance_scope_col: false,
        reviews_table: null,
        offer_policy_count: 1,
      });
    } finally {
      await db.close();
    }
  }, 90_000);

  it('applies cleanly after 0072–0085 and replays idempotently with byte-identical compliance policies', async () => {
    const db = await createMigratedDb({
      lastMigration: '0086_catalog_seller_compliance_enforcement.sql',
    });
    try {
      const snapshotPolicies = async () =>
        (
          await db.query<{
            tablename: string;
            policyname: string;
            permissive: string;
            roles: string[];
            cmd: string;
            qual: string | null;
            with_check: string | null;
          }>(`
            select tablename, policyname, permissive, roles, cmd, qual, with_check
              from pg_policies
             where schemaname = 'public'
               and tablename in (
                 'categories',
                 'products',
                 'product_packs',
                 'seller_offers',
                 'product_compliance_reviews',
                 'product_compliance_evidence',
                 'product_compliance_review_audit',
                 'seller_compliance_reviews',
                 'seller_compliance_evidence',
                 'seller_compliance_review_audit'
               )
             order by tablename, policyname
          `)
        ).rows;

      const beforeReplay = await snapshotPolicies();
      expect(beforeReplay.length).toBeGreaterThanOrEqual(15);

      // Re-apply 0086 on an already-migrated schema: exercises all 11 added
      // DROP POLICY IF EXISTS statements on the compliance tables.
      await applyMigration(db, '0086_catalog_seller_compliance_enforcement.sql');

      const afterReplay = await snapshotPolicies();
      expect(afterReplay).toEqual(beforeReplay);
    } finally {
      await db.close();
    }
  }, 90_000);
});

// ---------------------------------------------------------------------------
// 3. Error 3 — 0087_phase_2d1_compliance_security_and_evidence_storage.sql
//    (42P01: relation public.product_compliance_reviews does not exist)
// ---------------------------------------------------------------------------
describe('0087_phase_2d1_compliance_security_and_evidence_storage.sql — 0085/0086 prerequisites & idempotency', () => {
  it('fails fast in Statement #1 before altering products or sellers when 0086 has not succeeded', async () => {
    const db = await createMigratedDb({
      lastMigration: '0085_ordering_launch_readiness_atomic.sql',
    });
    try {
      await expect(
        applyMigration(db, '0087_phase_2d1_compliance_security_and_evidence_storage.sql'),
      ).rejects.toThrow(
        /MIGRATION ORDER VIOLATION: 0087 requires public\.product_compliance_reviews and companion Phase 2D tables from 0086_catalog_seller_compliance_enforcement\.sql/i,
      );

      // Verify zero partial mutations on products, sellers, or storage.buckets.
      const leaked = await db.query<{
        product_cols: string[];
        seller_cols: string[];
        evidence_bucket: boolean;
      }>(`
        select coalesce(
                 (select array_agg(column_name order by column_name)
                    from information_schema.columns
                   where table_schema = 'public'
                     and table_name = 'products'
                     and column_name in (
                       'regulatory_classification',
                       'regulatory_classification_reason',
                       'compliance_revision'
                     )),
                 '{}'::text[]
               ) as product_cols,
               coalesce(
                 (select array_agg(column_name order by column_name)
                    from information_schema.columns
                   where table_schema = 'public'
                     and table_name = 'sellers'
                     and column_name in ('compliance_revision')),
                 '{}'::text[]
               ) as seller_cols,
               exists (
                 select 1 from storage.buckets where id = 'compliance-evidence'
               ) as evidence_bucket
      `);

      expect(leaked.rows[0]).toEqual({
        product_cols: [],
        seller_cols: [],
        evidence_bucket: false,
      });
    } finally {
      await db.close();
    }
  }, 90_000);

  it('fails fast in Statement #1 when 0085 record_ordering_launch_readiness(jsonb, text) is absent', async () => {
    const db = await createMigratedDbSkipping('0086_catalog_seller_compliance_enforcement.sql', [
      '0085_ordering_launch_readiness_atomic.sql',
    ]);
    try {
      await expect(
        applyMigration(db, '0087_phase_2d1_compliance_security_and_evidence_storage.sql'),
      ).rejects.toThrow(
        /MIGRATION ORDER VIOLATION: 0087 requires public\.record_ordering_launch_readiness\(jsonb, text\) from 0085_ordering_launch_readiness_atomic\.sql/i,
      );

      const productCols = await db.query<{ column_name: string }>(`
        select column_name
          from information_schema.columns
         where table_schema = 'public'
           and table_name = 'products'
           and column_name = 'regulatory_classification'
      `);
      expect(productCols.rows).toEqual([]);
    } finally {
      await db.close();
    }
  }, 90_000);

  it('applies cleanly after 0085 + 0086 under non-owner storage.buckets and replays idempotently', async () => {
    const db = await createMigratedDb({
      lastMigration: '0086_catalog_seller_compliance_enforcement.sql',
    });
    try {
      await configureNonOwnerBucketsRole(db);
      const sql0087 = readMigration('0087_phase_2d1_compliance_security_and_evidence_storage.sql');

      await execAsMigrationRunner(db, sql0087);
      await execAsMigrationRunner(db, sql0087);

      const bucket = await db.query<{
        id: string;
        public: boolean;
        file_size_limit: number;
        allowed_mime_types: string[];
      }>(`
        select id, public, file_size_limit::int as file_size_limit, allowed_mime_types
          from storage.buckets
         where id = 'compliance-evidence'
      `);
      expect(bucket.rows).toEqual([
        {
          id: 'compliance-evidence',
          public: false,
          file_size_limit: 10_485_760,
          allowed_mime_types: ['image/png', 'image/jpeg', 'image/webp', 'application/pdf'],
        },
      ]);

      const reviewCols = await db.query<{ column_name: string }>(`
        select column_name
          from information_schema.columns
         where table_schema = 'public'
           and table_name = 'product_compliance_reviews'
           and column_name in ('approved_product_revision', 'approved_review_fingerprint')
         order by column_name
      `);
      expect(reviewCols.rows.map((r) => r.column_name)).toEqual([
        'approved_product_revision',
        'approved_review_fingerprint',
      ]);
    } finally {
      await db.close();
    }
  }, 120_000);

  it('enforces fail-closed catalogue/offer visibility on pre-existing rows after 0086+0087 until Super Admin completes the 4-step approval sequence', async () => {
    const db = await createMigratedDb({
      lastMigration: '0085_ordering_launch_readiness_atomic.sql',
    });
    try {
      const superAdminId = await createUser(db, 'super_admin', 'Compliance Super Admin');
      const retailer = await createRetailer(db);
      const suffix = randomUUID().slice(0, 8);

      // 1. Seed pre-existing live catalogue & marketplace rows BEFORE 0086/0087 run
      //    (models fhrmsrumsraprvutrpeo's existing pre-0086 rows).
      const { rows: catRows } = await db.query<{ id: string }>(
        `insert into public.categories (name, is_active)
         values ($1, true)
         returning id`,
        [`Household Surface Care ${suffix}`],
      );
      const categoryId = catRows[0]!.id;

      const { rows: prodRows } = await db.query<{ id: string }>(
        `insert into public.products (sku_code, name, unit, base_price, gst_percent, category_id, is_active)
         values ($1, $2, 'pcs', 100, 18, $3, true)
         returning id`,
        [`COMP-${suffix}`, `Surface Cleaner ${suffix}`, categoryId],
      );
      const productId = prodRows[0]!.id;

      const { rows: packRows } = await db.query<{ id: string }>(
        `insert into public.product_packs (product_id, pack_name, pack_sku_code, units_per_case, base_price, case_price, mrp, is_active)
         values ($1, '1 bottle', $2, 1, 100, 100, 125, true)
         returning id`,
        [productId, `COMP-PK-${suffix}`],
      );
      const packId = packRows[0]!.id;

      const { sellerId, offerId } = await as(db, superAdminId, async (tx) => {
        const { rows: sRows } = await tx.query<{ id: string }>(
          `insert into public.sellers (business_name, contact_name, phone, email, address_line, status, created_by)
           values ($1, 'Compliance Lead', '9876543210', $2, 'Exhibition Road, Patna', 'pending', $3)
           returning id`,
          [`Approved Seller ${suffix}`, `approved-${suffix}@test.local`, superAdminId],
        );
        const sid = sRows[0]!.id;
        await tx.query(`update public.sellers set status = 'active' where id = $1`, [sid]);
        const { rows: offRows } = await tx.query<{ id: string }>(
          `insert into public.seller_offers
             (seller_id, product_id, pack_id, fulfilment_type, unit_price_paise, moq, stock_quantity,
              is_active, moderation_status, moderation_by, moderated_at, created_by)
           values ($1, $2, $3, 'seller', 10000, 1, 25, true, 'approved', $4, now(), $4)
           returning id`,
          [sid, productId, packId, superAdminId],
        );
        return { sellerId: sid, offerId: offRows[0]!.id };
      });

      const readRetailerView = () =>
        as(db, retailer.id, async (tx) => {
          const c = await tx.query(`select id from public.categories where id = $1`, [categoryId]);
          const p = await tx.query(`select id from public.products where id = $1`, [productId]);
          const pk = await tx.query(`select id from public.product_packs where id = $1`, [packId]);
          const o = await tx.query(
            `select offer_id from public.marketplace_offers_for_product($1) where offer_id = $2`,
            [productId, offerId],
          );
          return {
            categories: c.rows.length,
            products: p.rows.length,
            packs: pk.rows.length,
            offers: o.rows.length,
          };
        });

      // Before 0086/0087: active retailer sees all 4 active rows.
      expect(await readRetailerView()).toEqual({
        categories: 1,
        products: 1,
        packs: 1,
        offers: 1,
      });

      // 2. Apply 0086 + 0087: existing unreviewed rows immediately fail closed for retailers.
      await applyMigration(db, '0086_catalog_seller_compliance_enforcement.sql');
      await applyMigration(db, '0087_phase_2d1_compliance_security_and_evidence_storage.sql');

      expect(await readRetailerView()).toEqual({
        categories: 0,
        products: 0,
        packs: 0,
        offers: 0,
      });

      // Super Admin diagnostic RPC enumerates the blocked items.
      const reportBefore = await as(db, superAdminId, (tx) =>
        tx.query(`select * from public.get_catalog_compliance_review_report()`),
      );
      expect(reportBefore.rows.length).toBeGreaterThan(0);

      // Step 1: Super Admin classifies category compliance_scope ('fmcg' or 'cosmetics') with reason.
      await as(db, superAdminId, (tx) =>
        tx.query(
          `update public.categories
              set compliance_scope = 'fmcg',
                  compliance_scope_reason = 'Super Admin verified household cleaning category'
            where id = $1`,
          [categoryId],
        ),
      );

      // Step 2: Super Admin sets product regulatory_classification aligned with category scope.
      await as(db, superAdminId, (tx) =>
        tx.query(
          `update public.products
              set regulatory_classification = 'non_food_fmcg',
                  regulatory_classification_reason = 'Packaged household cleaner verified under Legal Metrology'
            where id = $1`,
          [productId],
        ),
      );

      // Step 3: Record canonical private evidence in compliance-evidence and approve product review.
      await as(db, superAdminId, async (tx) => {
        await tx.query(
          `insert into public.product_compliance_evidence
             (product_id, seller_id, evidence_type, storage_bucket_id, storage_object_key, file_name, content_type, uploaded_by)
           values ($1, null, 'label_photo', 'compliance-evidence', $2, 'label.png', 'image/png', $3)`,
          [productId, `products/${productId}/central/label_photo/${randomUUID()}.png`, superAdminId],
        );
        const { rows: rev } = await tx.query<{ id: string }>(
          `insert into public.product_compliance_reviews
             (product_id, category_scope, review_status, applicability, applicability_reason,
              mrp, selling_price, net_quantity, uqc, pack_size, manufacturer_or_importer, consumer_care_details, created_by)
           values ($1, 'fmcg', 'submitted', '{"country_of_origin_required":false}'::jsonb,
                   'Domestic packaged household cleaner.', 125, 100, '500 ml', 'ml', '500 ml',
                   'Maharani Household Pvt Ltd, Patna', 'care@maharani.example / 1800-000-000', $2)
           returning id`,
          [productId, superAdminId],
        );
        await tx.query(
          `update public.product_compliance_reviews set review_status = 'approved' where id = $1`,
          [rev[0]!.id],
        );
      });

      // Category, product, and pack are now visible, while seller offer remains blocked until seller approval!
      expect(await readRetailerView()).toEqual({
        categories: 1,
        products: 1,
        packs: 1,
        offers: 0,
      });

      // Step 4: Upload all 7 seller evidence documents and approve seller_compliance_reviews.
      const sellerEvidenceTypes = [
        'business_identity',
        'business_address',
        'business_contact',
        'seller_agreement',
        'settlement_verification',
        'compliance_declaration',
        'product_source_evidence',
      ] as const;

      await as(db, superAdminId, async (tx) => {
        for (const evType of sellerEvidenceTypes) {
          await tx.query(
            `insert into public.seller_compliance_evidence
               (seller_id, evidence_type, storage_bucket_id, storage_object_key, file_name, content_type, uploaded_by)
             values ($1, $2, 'compliance-evidence', $3, 'doc.pdf', 'application/pdf', $4)`,
            [sellerId, evType, `sellers/${sellerId}/${evType}/${randomUUID()}.pdf`, superAdminId],
          );
        }

        const { rows: sRev } = await tx.query<{ id: string }>(
          `insert into public.seller_compliance_reviews
             (seller_id, review_status, business_identity_verified, business_address_verified,
              business_contact_verified, product_source_evidence_verified, settlement_verified,
              seller_agreement_version, seller_agreement_accepted_at,
              compliance_declaration_version, compliance_declaration_accepted_at, created_by)
           values ($1, 'submitted', true, true, true, true, true, 'v1', now(), 'v1', now(), $2)
           returning id`,
          [sellerId, superAdminId],
        );
        await tx.query(
          `update public.seller_compliance_reviews set review_status = 'approved' where id = $1`,
          [sRev[0]!.id],
        );
      });

      // Active retailer can now read the approved category, product, pack, AND marketplace offer!
      expect(await readRetailerView()).toEqual({
        categories: 1,
        products: 1,
        packs: 1,
        offers: 1,
      });
    } finally {
      await db.close();
    }
  }, 120_000);
});
