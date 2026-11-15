/**
 * Real-PostgreSQL test harness (PGlite = PostgreSQL 16 compiled to WASM).
 *
 * Applies EVERY file in supabase/migrations in order on top of a minimal stub
 * of the Supabase platform objects the migrations reference (auth.users,
 * auth.uid(), storage.*, the anon/authenticated/service_role roles and
 * Supabase's default privileges). Nothing in the application depends on this
 * — it exists so RLS policies, triggers and SECURITY DEFINER functions are
 * EXECUTED in tests instead of being asserted as source text.
 *
 * Limits (stated honestly): PGlite is a single connection, so two
 * transactions can never truly interleave here, and the auth/storage schemas
 * are minimal stubs (not GoTrue). Concurrency guarantees must be asserted
 * structurally or by sequential replays; this is not a substitute for a
 * multi-connection test against a real Supabase project.
 */
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { PGlite, type Transaction } from '@electric-sql/pglite';
import { uuid_ossp } from '@electric-sql/pglite/contrib/uuid_ossp';

const MIGRATIONS_DIR = path.join(__dirname, '..', '..', 'supabase', 'migrations');

const PLATFORM_STUB = `
create role anon nologin;
create role authenticated nologin;
create role service_role nologin bypassrls;
create schema auth;
create schema storage;
create schema extensions;
grant usage on schema public, auth, storage to anon, authenticated, service_role;

-- Supabase grants API roles full table privileges by default; migrations then
-- REVOKE where required, so the defaults must exist before they run.
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
alter default privileges in schema public grant all on functions to anon, authenticated, service_role;

create table auth.users (
  id uuid primary key default gen_random_uuid(),
  email text, phone text,
  raw_user_meta_data jsonb default '{}'::jsonb,
  raw_app_meta_data jsonb default '{}'::jsonb,
  email_confirmed_at timestamptz,
  last_sign_in_at timestamptz,
  created_at timestamptz default now()
);
-- Same resolution order as Supabase's auth.uid().
create function auth.uid() returns uuid language sql stable as $$
  select coalesce(
    nullif(current_setting('request.jwt.claim.sub', true), ''),
    (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')
  )::uuid
$$;
create function auth.role() returns text language sql stable as $$
  select coalesce(
    nullif(current_setting('request.jwt.claim.role', true), ''),
    (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role')
  )
$$;
create function auth.jwt() returns jsonb language sql stable as $$
  select coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb
$$;
grant execute on function auth.uid(), auth.role(), auth.jwt() to anon, authenticated, service_role;

create table storage.buckets (
  id text primary key, name text, public boolean default false,
  file_size_limit bigint, allowed_mime_types text[], owner uuid,
  created_at timestamptz default now(), updated_at timestamptz default now()
);
create table storage.objects (
  id uuid primary key default gen_random_uuid(),
  bucket_id text references storage.buckets(id), name text, owner uuid, metadata jsonb,
  created_at timestamptz default now(), updated_at timestamptz default now(),
  -- Columns of the live Supabase Storage table (read from the project on
  -- 15 Nov 2026) that proof verification relies on.
  owner_id text, version text, user_metadata jsonb,
  archived_at timestamptz, is_delete_marker boolean not null default false
);
grant select, insert, update, delete on storage.objects to anon, authenticated, service_role;
alter table storage.objects enable row level security;
create function storage.foldername(name text) returns text[] language sql immutable as $$
  select (string_to_array(name, '/'))[1:array_length(string_to_array(name, '/'), 1) - 1]
$$;
`;

/** Extensions Supabase provides that PGlite cannot load (unused by tests). */
function adaptMigration(sql: string): string {
  return sql.replace(/create extension if not exists "(pg_net|pg_cron)";/g, '');
}

export function migrationFiles(): string[] {
  return readdirSync(MIGRATIONS_DIR).filter((file) => file.endsWith('.sql')).sort();
}

export async function createMigratedDb(options: { lastMigration?: string } = {}): Promise<PGlite> {
  const db = new PGlite({ extensions: { uuid_ossp } });
  await db.exec(PLATFORM_STUB);
  for (const file of migrationFiles()) {
    if (options.lastMigration && file > options.lastMigration) break;
    try {
      await db.exec(adaptMigration(readFileSync(path.join(MIGRATIONS_DIR, file), 'utf8')));
    } catch (error) {
      throw new Error(`Migration ${file} failed: ${(error as Error).message}`);
    }
  }
  return db;
}

export type Db = PGlite;
export type Tx = Transaction;

/**
 * Runs `fn` inside a transaction impersonating an API caller exactly like
 * PostgREST does: `set local role` + request.jwt.claims.
 *   - a uuid   → an `authenticated` user with that sub
 *   - 'service' → the service_role key (no sub, bypasses RLS)
 *   - 'anon'    → the anon key
 * The transaction COMMITS on success and ROLLS BACK when `fn` throws.
 */
export async function as<T>(db: Db, who: string, fn: (tx: Tx) => Promise<T>): Promise<T> {
  return db.transaction(async (tx) => {
    if (who === 'service') {
      await tx.exec(`set local role service_role`);
      await tx.query(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify({ role: 'service_role' })]);
    } else if (who === 'anon') {
      await tx.exec(`set local role anon`);
      await tx.query(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify({ role: 'anon' })]);
    } else {
      await tx.exec(`set local role authenticated`);
      await tx.query(`select set_config('request.jwt.claims', $1, true)`, [
        JSON.stringify({ sub: who, role: 'authenticated' }),
      ]);
    }
    return fn(tx);
  });
}

/** Runs `fn` as the caller and returns the Postgres error message (or null on success). */
export async function errorOf(db: Db, who: string, fn: (tx: Tx) => Promise<unknown>): Promise<string | null> {
  try {
    await as(db, who, fn);
    return null;
  } catch (error) {
    return (error as Error).message;
  }
}

// ---------------------------------------------------------------------------
// Fixture builders — run as the database owner (like a migration/seed would).
// ---------------------------------------------------------------------------

type Role = 'super_admin' | 'admin' | 'staff' | 'salesman' | 'retailer' | 'seller';

/**
 * Creates an auth user the way production does after migration 0052:
 *   - retailer        → public signup metadata (role is NOT read from it) with
 *                       a real area; the trigger creates a pending retailer.
 *   - staff/salesman  → a server-side staff_account_invites row first (what
 *                       lib/admin/team-actions.ts does with the service role).
 *   - admin/super_admin/seller → created as a retailer signup, then promoted
 *                       by the database owner. Admin roles are invitation-only;
 *                       the marketplace's pending seller business/membership
 *                       is created separately by the seller test fixture.
 */
export async function createUser(
  db: Db,
  role: Role,
  name: string = role,
  { areaId }: { areaId?: string } = {}
): Promise<string> {
  const id = randomUUID();
  const email = `${role}-${id}@test.local`;
  const meta: Record<string, unknown> = {
    full_name: name,
    phone: `+91${Math.floor(1e9 + Math.random() * 8e9)}`,
  };
  if (role !== 'staff' && role !== 'salesman') {
    meta.area_id = areaId ?? (await createArea(db));
  }
  if (role === 'staff' || role === 'salesman') {
    await db.query(`insert into staff_account_invites (email, role) values ($1, $2)`, [email, role]);
  }
  await db.query(`insert into auth.users (id, email, raw_user_meta_data) values ($1, $2, $3)`, [
    id,
    email,
    JSON.stringify(meta),
  ]);
  if (role === 'admin' || role === 'super_admin' || role === 'seller') {
    await db.query(`delete from retailers where id = $1`, [id]);
    await db.query(`update profiles set role = $2 where id = $1`, [id, role]);
  }
  return id;
}

let areaCounter = 0;
export async function createArea(db: Db): Promise<string> {
  areaCounter += 1;
  const { rows } = await db.query<{ id: string }>(
    `insert into areas (name) values ($1) returning id`,
    [`Test Area ${areaCounter} ${randomUUID().slice(0, 8)}`]
  );
  return rows[0]!.id;
}

export interface RetailerFixture {
  id: string;
  areaId: string;
}

/** An ACTIVE retailer with a credit account of `creditLimitRupees` (0 = none configured). */
export async function createRetailer(
  db: Db,
  { creditLimitRupees = 10000, status = 'active', salesmanId = null as string | null, areaId = null as string | null } = {}
): Promise<RetailerFixture> {
  const area = areaId ?? (await createArea(db));
  const id = await createUser(db, 'retailer', 'retailer', { areaId: area });
  // handle_new_user created a pending row in `area`; promote it for the fixture.
  await db.query(
    `insert into retailers (id, shop_name, area_id, status, assigned_salesman_id)
     values ($1, 'Test Kirana', $2, $3, $4)
     on conflict (id) do update set area_id = excluded.area_id, status = excluded.status,
       assigned_salesman_id = excluded.assigned_salesman_id`,
    [id, area, status, salesmanId]
  );
  await db.query(
    `insert into retailer_credit_accounts (retailer_id, credit_limit_paise) values ($1, $2)`,
    [id, Math.round(creditLimitRupees * 100)]
  );
  return { id, areaId: area };
}

export interface PackFixture {
  packId: string;
  productId: string;
  gstPercent: number;
  categoryId: string | null;
  brandId: string | null;
}

const fixtureSuperAdmins = new WeakMap<Db, string>();
/** One Super Admin per database, used by fixtures that need an owner decision recorded. */
async function fixtureSuperAdmin(db: Db): Promise<string> {
  let id = fixtureSuperAdmins.get(db);
  if (!id) {
    id = await createUser(db, 'super_admin', 'Fixture Super Admin');
    fixtureSuperAdmins.set(db, id);
  }
  return id;
}

/**
 * A product that may be sold, with one pack, created the way the catalogue
 * rules require since 0086 / 0087 — nothing is bypassed:
 *   1. the category is created unclassified, then a Super Admin classifies it
 *      as FMCG with a reason;
 *   2. the product is created INACTIVE with its pack;
 *   3. a Super Admin classifies the product (non-food FMCG) with a reason;
 *   4. label evidence is recorded, a compliance review is submitted and
 *      approved by the Super Admin;
 *   5. only then is the product activated.
 * `active: false` leaves the PACK inactive (the product is still approved).
 * `publish: false` stops after step 2: a draft product that is not on sale,
 *   whose facts can still be edited.
 */
export async function createPack(
  db: Db,
  { gstPercent = 18, moq = 1, unitsPerCase = 10, active = true, publish = true } = {}
): Promise<PackFixture> {
  const tag = randomUUID().slice(0, 8);
  const reviewer = await fixtureSuperAdmin(db);
  const { rows: cat } = await db.query<{ id: string }>(`insert into categories (name) values ($1) returning id`, [`Cat ${tag}`]);
  const { rows: brand } = await db.query<{ id: string }>(`insert into brands (name) values ($1) returning id`, [`Brand ${tag}`]);
  await as(db, reviewer, (tx) => tx.query(
    `update categories set compliance_scope = 'fmcg', compliance_scope_reason = 'Fixture: owner-reviewed FMCG category' where id = $1`,
    [cat[0]!.id]
  ));
  const { rows: product } = await db.query<{ id: string }>(
    `insert into products (sku_code, name, unit, base_price, gst_percent, category_id, brand_id, is_active)
     values ($1, $2, 'pcs', 100, $3, $4, $5, false) returning id`,
    [`SKU-${tag}`, `Product ${tag}`, gstPercent, cat[0]!.id, brand[0]!.id]
  );
  const productId = product[0]!.id;
  const { rows: pack } = await db.query<{ id: string }>(
    `insert into product_packs (product_id, pack_name, pack_sku_code, units_per_case, case_price, base_price, moq, is_active)
     values ($1, '1 pc', $2, $3, 1000, 100, $4, $5) returning id`,
    [productId, `PK-${tag}`, unitsPerCase, moq, active]
  );
  const fixture = { packId: pack[0]!.id, productId, gstPercent, categoryId: cat[0]!.id, brandId: brand[0]!.id };
  if (!publish) return fixture;
  await publishProduct(db, productId);
  return fixture;
}

/**
 * Steps 3-5 of createPack for an INACTIVE product: classification, label
 * evidence, a fresh compliance review approved by a Super Admin, activation.
 * Also the way to put a product back on sale after its facts were edited
 * (0086 / 0087 require deactivate -> edit -> review -> activate).
 */
export async function publishProduct(db: Db, productId: string): Promise<void> {
  const reviewer = await fixtureSuperAdmin(db);
  await as(db, reviewer, async (tx) => {
    await tx.query(
      `update products set regulatory_classification = 'non_food_fmcg',
              regulatory_classification_reason = 'Fixture: owner-reviewed non-food FMCG classification'
        where id = $1`, [productId]);
    await tx.query(
      `insert into product_compliance_evidence
         (product_id, seller_id, evidence_type, storage_bucket_id, storage_object_key, file_name, content_type, uploaded_by)
       values ($1, null, 'label_photo', 'compliance-evidence', $2, 'label.png', 'image/png', $3)`,
      [productId, `products/${productId}/central/label_photo/${randomUUID()}.png`, reviewer]);
    // One review row per product: a re-review resubmits the existing row.
    const { rows: existing } = await tx.query<{ id: string }>(
      `update product_compliance_reviews set review_status = 'submitted' where product_id = $1 returning id`, [productId]);
    const { rows: review } = existing.length > 0 ? { rows: existing } : await tx.query<{ id: string }>(
      `insert into product_compliance_reviews
         (product_id, category_scope, review_status, applicability, applicability_reason,
          mrp, selling_price, net_quantity, uqc, pack_size, manufacturer_or_importer, consumer_care_details, created_by)
       values ($1, 'fmcg', 'submitted', '{"country_of_origin_required":false}'::jsonb,
          'Fixture: reviewer recorded the country-of-origin applicability decision.',
          120, 100, '1 piece', 'pcs', '1 piece', 'Fixture manufacturer', 'Fixture consumer care', $2)
       returning id`, [productId, reviewer]);
    await tx.query(`update product_compliance_reviews set review_status = 'approved' where id = $1`, [review[0]!.id]);
    await tx.query(`update products set is_active = true where id = $1`, [productId]);
  });
}

/**
 * The only way the database lets the sale-relevant facts of a published
 * product change (0086 / 0087): take it off sale, edit, submit and approve a
 * fresh compliance review, put it back on sale. `edit` runs as the owner.
 */
export async function reviseProduct(db: Db, productId: string, edit: () => Promise<unknown>): Promise<void> {
  await db.query(`update products set is_active = false where id = $1`, [productId]);
  await edit();
  await publishProduct(db, productId);
}

/** A category an owner has classified as FMCG, so products may be placed in it. */
export async function createClassifiedCategory(db: Db, name: string): Promise<string> {
  const reviewer = await fixtureSuperAdmin(db);
  const { rows } = await db.query<{ id: string }>(`insert into categories (name) values ($1) returning id`, [name]);
  await as(db, reviewer, (tx) => tx.query(
    `update categories set compliance_scope = 'fmcg', compliance_scope_reason = 'Fixture: owner-reviewed FMCG category' where id = $1`,
    [rows[0]!.id]
  ));
  return rows[0]!.id;
}

const SELLER_EVIDENCE_TYPES = [
  'business_identity', 'business_address', 'business_contact', 'seller_agreement',
  'settlement_verification', 'compliance_declaration', 'product_source_evidence',
] as const;

/**
 * Takes an existing PENDING seller through the review the database requires
 * before it may trade (0086 / 0087): seven evidence records, a submitted
 * review, approval by a Super Admin, then activation. Nothing is bypassed.
 */
export async function approveAndActivateSeller(db: Db, sellerId: string, reviewerId?: string): Promise<void> {
  const reviewer = reviewerId ?? (await fixtureSuperAdmin(db));
  await as(db, reviewer, async (tx) => {
    for (const evidenceType of SELLER_EVIDENCE_TYPES) {
      await tx.query(
        `insert into seller_compliance_evidence
           (seller_id, evidence_type, storage_bucket_id, storage_object_key, file_name, content_type, uploaded_by)
         values ($1, $2, 'compliance-evidence', $3, 'evidence.pdf', 'application/pdf', $4)`,
        [sellerId, evidenceType, `sellers/${sellerId}/${evidenceType}/${randomUUID()}.pdf`, reviewer]);
    }
    const { rows } = await tx.query<{ id: string }>(
      `insert into seller_compliance_reviews
         (seller_id, review_status, business_identity_verified, business_address_verified,
          business_contact_verified, product_source_evidence_verified, settlement_verified,
          seller_agreement_version, seller_agreement_accepted_at,
          compliance_declaration_version, compliance_declaration_accepted_at, created_by)
       values ($1, 'submitted', true, true, true, true, true, 'test-v1', now(), 'test-v1', now(), $2)
       returning id`, [sellerId, reviewer]);
    await tx.query(`update seller_compliance_reviews set review_status = 'approved' where id = $1`, [rows[0]!.id]);
    await tx.query(`update sellers set status = 'active' where id = $1`, [sellerId]);
  });
}

/**
 * Third-party offers are OFF by default (0098). This records, as a Super
 * Admin and through the real function, that both approvals exist — with
 * references that are plainly test data.
 */
export async function openMarketplaceForTest(db: Db): Promise<void> {
  const reviewer = await fixtureSuperAdmin(db);
  await as(db, reviewer, (tx) => tx.query(
    `select public.record_marketplace_launch_approval(true, 'TEST-FIXTURE-OWNER-APPROVAL', 'TEST-FIXTURE-CA-APPROVAL', 'test fixture')`));
}

/** The seller's OWNER accepts the current Seller Agreement through the real function (0095 / 0098). */
export async function acceptSellerAgreementAs(db: Db, ownerProfileId: string): Promise<void> {
  const { rows } = await db.query<{ v: string }>(
    `select document_version v from public.legal_document_current_versions where document_key = 'seller-agreement'`);
  if (!rows[0]) throw new Error('No current Seller Agreement version is registered.');
  await as(db, ownerProfileId, (tx) => tx.query(
    `select public.record_legal_acceptance('seller-agreement', $1, 'seller_onboarding')`, [rows[0]!.v]));
}

/**
 * Runs `fn` as the DATABASE OWNER while the request still carries `userId` as
 * the signed-in user. This is what an internal function sees when a trusted
 * SECURITY DEFINER function calls it: no API role, but auth.uid() is set.
 * Use it only to exercise functions that are deliberately closed to every API
 * role; a test that needs it must also assert that the API roles are refused.
 */
export async function asOwnerOnBehalfOf<T>(db: Db, userId: string, fn: (tx: Tx) => Promise<T>): Promise<T> {
  return db.transaction(async (tx) => {
    await tx.query(`select set_config('request.jwt.claims', $1, true), set_config('request.jwt.claim.sub', $2, true)`, [
      JSON.stringify({ sub: userId, role: 'authenticated' }), userId,
    ]);
    return fn(tx);
  });
}
