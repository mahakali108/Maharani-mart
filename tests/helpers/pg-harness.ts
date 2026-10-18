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
  created_at timestamptz default now(), updated_at timestamptz default now()
);
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

export async function createPack(
  db: Db,
  { gstPercent = 18, moq = 1, unitsPerCase = 10, active = true } = {}
): Promise<PackFixture> {
  const tag = randomUUID().slice(0, 8);
  const { rows: cat } = await db.query<{ id: string }>(`insert into categories (name) values ($1) returning id`, [`Cat ${tag}`]);
  const { rows: brand } = await db.query<{ id: string }>(`insert into brands (name) values ($1) returning id`, [`Brand ${tag}`]);
  const { rows: product } = await db.query<{ id: string }>(
    `insert into products (sku_code, name, unit, base_price, gst_percent, category_id, brand_id, is_active)
     values ($1, $2, 'pcs', 100, $3, $4, $5, true) returning id`,
    [`SKU-${tag}`, `Product ${tag}`, gstPercent, cat[0]!.id, brand[0]!.id]
  );
  const { rows: pack } = await db.query<{ id: string }>(
    `insert into product_packs (product_id, pack_name, pack_sku_code, units_per_case, case_price, base_price, moq, is_active)
     values ($1, '1 pc', $2, $3, 1000, 100, $4, $5) returning id`,
    [product[0]!.id, `PK-${tag}`, unitsPerCase, moq, active]
  );
  return { packId: pack[0]!.id, productId: product[0]!.id, gstPercent, categoryId: cat[0]!.id, brandId: brand[0]!.id };
}
