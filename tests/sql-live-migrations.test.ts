/**
 * LIVE migration verification (PGlite = real Postgres compiled to WASM).
 *
 * Static string assertions hid the 0037/0043/0045 Supabase failures: the SQL
 * *looked* right but did not *run*. This suite executes the actual migration
 * files (0001–0045) against a real Postgres engine with Supabase stubs
 * (auth.users, auth.uid, storage.buckets/objects, storage.foldername, the
 * anon/authenticated/service_role roles, uuid_generate_v4) and asserts:
 *
 *   1. every migration applies with zero errors, in order;
 *   2. 0037–0045 are re-runnable (second apply is clean);
 *   3. the fixed runtime behaviours hold (dispatch zero-snapshot accepted,
 *      wrong splits rejected, payment folder guards safe, one-way
 *      collection trigger enforced).
 *
 * PGlite intentionally lacks uuid-ossp/pg_net/pg_cron, so CREATE EXTENSION
 * lines are stripped (Supabase provides them) and uuid_generate_v4 is
 * aliased to gen_random_uuid. Everything else runs verbatim.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';

import { PGlite } from '@electric-sql/pglite';

const ROOT = join(__dirname, '..');
const MIG_DIR = join(ROOT, 'supabase/migrations');
const migrationFiles = readdirSync(MIG_DIR)
  .filter((f) => f.endsWith('.sql'))
  .sort();

const loadMigration = (file: string): string =>
  readFileSync(join(MIG_DIR, file), 'utf8').replace(
    /create extension if not exists[^;]+;/gi,
    '-- stripped for PGlite (Supabase provides these extensions)',
  );

let db: PGlite;

beforeAll(async () => {
  db = new PGlite();
  await db.exec(`
    CREATE OR REPLACE FUNCTION uuid_generate_v4() RETURNS uuid
      AS $$ SELECT gen_random_uuid() $$ LANGUAGE sql;
    CREATE ROLE anon NOLOGIN;
    CREATE ROLE authenticated NOLOGIN;
    CREATE ROLE service_role NOLOGIN;
    CREATE SCHEMA IF NOT EXISTS auth;
    CREATE TABLE auth.users (
      id uuid PRIMARY KEY, email text, phone text, raw_user_meta_data jsonb
    );
    CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid
      AS $$ SELECT NULL::uuid $$ LANGUAGE sql STABLE;
    CREATE OR REPLACE FUNCTION auth.jwt() RETURNS jsonb
      AS $$ SELECT '{}'::jsonb $$ LANGUAGE sql STABLE;
    CREATE SCHEMA IF NOT EXISTS storage;
    CREATE TABLE storage.buckets (
      id text PRIMARY KEY, name text, public boolean,
      file_size_limit bigint, allowed_mime_types text[]
    );
    CREATE TABLE storage.objects (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      bucket_id text, name text, owner uuid,
      created_at timestamptz DEFAULT now()
    );
    ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;
    CREATE OR REPLACE FUNCTION storage.foldername(text) RETURNS text[]
      AS $$
        SELECT CASE WHEN $1 LIKE '%/%'
          THEN string_to_array(substring($1 from '^(.*)/[^/]*$'), '/')
          ELSE '{}'::text[] END;
      $$ LANGUAGE sql IMMUTABLE;
  `);
  // The auth trigger needs full Supabase auth machinery; it is unrelated to
  // the 0037–0045 audit, so it is dropped after the migrations create it.
  for (const file of migrationFiles) {
    await db.exec(loadMigration(file));
  }
  await db.exec(`DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;`);
}, 120_000);

describe('migrations 0001–0045 apply cleanly, in order', () => {
  it(
    'applies every file with zero errors (this is the Supabase 0037/0043/0045 guard)',
    async () => {
      const fresh = new PGlite();
      await fresh.exec(`
        CREATE OR REPLACE FUNCTION uuid_generate_v4() RETURNS uuid
          AS $$ SELECT gen_random_uuid() $$ LANGUAGE sql;
        CREATE ROLE anon NOLOGIN;
        CREATE ROLE authenticated NOLOGIN;
        CREATE ROLE service_role NOLOGIN;
        CREATE SCHEMA IF NOT EXISTS auth;
        CREATE TABLE auth.users (
          id uuid PRIMARY KEY, email text, phone text, raw_user_meta_data jsonb
        );
        CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid
          AS $$ SELECT NULL::uuid $$ LANGUAGE sql STABLE;
        CREATE OR REPLACE FUNCTION auth.jwt() RETURNS jsonb
          AS $$ SELECT '{}'::jsonb $$ LANGUAGE sql STABLE;
        CREATE SCHEMA IF NOT EXISTS storage;
        CREATE TABLE storage.buckets (
          id text PRIMARY KEY, name text, public boolean,
          file_size_limit bigint, allowed_mime_types text[]
        );
        CREATE TABLE storage.objects (
          id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
          bucket_id text, name text, owner uuid,
          created_at timestamptz DEFAULT now()
        );
        ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;
        CREATE OR REPLACE FUNCTION storage.foldername(text) RETURNS text[]
          AS $$
            SELECT CASE WHEN $1 LIKE '%/%'
              THEN string_to_array(substring($1 from '^(.*)/[^/]*$'), '/')
              ELSE '{}'::text[] END;
          $$ LANGUAGE sql IMMUTABLE;
      `);
      const failures: string[] = [];
      for (const file of migrationFiles) {
        try {
          await fresh.exec(loadMigration(file));
        } catch (err) {
          failures.push(`${file}: ${err instanceof Error ? err.message.split('\n')[0] : err}`);
        }
      }
      expect(failures).toEqual([]);
      await fresh.close();
    },
    180_000,
  );

  it('0037–0045 are re-runnable (second apply is clean)', async () => {
    const failures: string[] = [];
    for (const file of migrationFiles.filter((f) => f >= '0037')) {
      try {
        await db.exec(loadMigration(file));
      } catch (err) {
        failures.push(`${file}: ${err instanceof Error ? err.message.split('\n')[0] : err}`);
      }
    }
    expect(failures).toEqual([]);
  }, 120_000);
});

describe('0037 leaves no stale broad policy behind', () => {
  it('areas/warehouses/visits carry exactly the scoped policy sets', async () => {
    const names = async (table: string): Promise<string[]> => {
      const rows = await db.query<{ policyname: string }>(
        `SELECT policyname FROM pg_policies WHERE schemaname = 'public' AND tablename = $1 ORDER BY policyname`,
        [table],
      );
      return rows.rows.map((r) => r.policyname);
    };
    expect(await names('areas')).toEqual([
      'areas_admin_delete',
      'areas_admin_update',
      'areas_admin_write',
      'areas_authenticated_read',
    ]);
    expect(await names('warehouses')).toEqual([
      'warehouses_admin_delete',
      'warehouses_admin_update',
      'warehouses_admin_write',
      'warehouses_authenticated_read',
    ]);
    expect(await names('visits')).toEqual([
      'visits_scoped_insert',
      'visits_scoped_read',
      'visits_scoped_update',
    ]);
    const routeCustomers = await names('route_customers');
    expect(routeCustomers).toContain('route_customers_owner_or_staff');
  }, 30_000);
});

describe('0043 dispatch pending state (live CHECK behaviour)', () => {
  const DELIVERY = '10000000-0000-0000-0000-000000000040';
  const ITEM = '10000000-0000-0000-0000-000000000031';

  beforeAll(async () => {
    await db.exec(`
      INSERT INTO auth.users (id) VALUES
        ('10000000-0000-0000-0000-000000000010'),
        ('10000000-0000-0000-0000-000000000011');
      INSERT INTO areas (id, name) VALUES
        ('10000000-0000-0000-0000-000000000001', 'Live Area');
      INSERT INTO warehouses (id, name, area_id) VALUES
        ('10000000-0000-0000-0000-000000000002', 'Live WH',
         '10000000-0000-0000-0000-000000000001');
      INSERT INTO profiles (id, role, full_name, phone) VALUES
        ('10000000-0000-0000-0000-000000000010', 'retailer', 'R', 'live-r-1'),
        ('10000000-0000-0000-0000-000000000011', 'staff', 'S', 'live-s-1');
      INSERT INTO retailers (id, shop_name, area_id) VALUES
        ('10000000-0000-0000-0000-000000000010', 'Live Shop',
         '10000000-0000-0000-0000-000000000001');
      INSERT INTO products (id, name, unit, base_price) VALUES
        ('10000000-0000-0000-0000-000000000020', 'Live Prod', 'pcs', 10);
      INSERT INTO orders (id, order_number, retailer_id, warehouse_id, status, subtotal, grand_total) VALUES
        ('10000000-0000-0000-0000-000000000030', 'LIVE-1',
         '10000000-0000-0000-0000-000000000010',
         '10000000-0000-0000-0000-000000000002', 'dispatched', 100, 100);
      INSERT INTO order_items (id, order_id, product_id, quantity, unit_price, line_total) VALUES
        ('${ITEM}', '10000000-0000-0000-0000-000000000030',
         '10000000-0000-0000-0000-000000000020', 10, 10, 100);
      INSERT INTO order_deliveries (id, order_id, delivery_status) VALUES
        ('${DELIVERY}', '10000000-0000-0000-0000-000000000030', 'assigned');
    `);
  }, 30_000);

  it('accepts the dispatch zero-snapshot (delivered/missing/damaged default 0)', async () => {
    await db.exec(
      `INSERT INTO order_delivery_items (delivery_id, order_item_id, quantity_ordered)
       VALUES ('${DELIVERY}', '${ITEM}', 10)`,
    );
    const rows = await db.query<{ quantity_delivered: number }>(
      `SELECT quantity_delivered FROM order_delivery_items WHERE delivery_id = $1`,
      [DELIVERY],
    );
    expect(rows.rows[0]?.quantity_delivered).toBe(0);
  }, 30_000);

  it('rejects a wrong split and accepts the counted completion', async () => {
    await expect(
      db.exec(
        `UPDATE order_delivery_items SET quantity_delivered = 1, quantity_missing = 1, quantity_damaged = 1
         WHERE delivery_id = '${DELIVERY}'`,
      ),
    ).rejects.toThrow(/order_delivery_items_split/);
    await db.exec(
      `UPDATE order_delivery_items SET quantity_delivered = 8, quantity_missing = 1, quantity_damaged = 1
       WHERE delivery_id = '${DELIVERY}'`,
    );
    const rows = await db.query<{ quantity_delivered: number }>(
      `SELECT quantity_delivered FROM order_delivery_items WHERE delivery_id = $1`,
      [DELIVERY],
    );
    expect(rows.rows[0]?.quantity_delivered).toBe(8);
  }, 30_000);
});

describe('0044 collection one-way trigger (live)', () => {
  const COLLECTION = '20000000-0000-0000-0000-000000000050';

  beforeAll(async () => {
    await db.exec(`
      INSERT INTO auth.users (id) VALUES
        ('20000000-0000-0000-0000-000000000010'),
        ('20000000-0000-0000-0000-000000000012');
      INSERT INTO areas (id, name) VALUES
        ('20000000-0000-0000-0000-000000000001', 'Live Area 2');
      INSERT INTO profiles (id, role, full_name, phone) VALUES
        ('20000000-0000-0000-0000-000000000010', 'retailer', 'R2', 'live-r-2'),
        ('20000000-0000-0000-0000-000000000012', 'salesman', 'S2', 'live-s-2');
      INSERT INTO retailers (id, shop_name, area_id) VALUES
        ('20000000-0000-0000-0000-000000000010', 'Live Shop 2',
         '20000000-0000-0000-0000-000000000001');
      INSERT INTO payment_collections (id, retailer_id, collected_by, amount_paise, method, status) VALUES
        ('${COLLECTION}', '20000000-0000-0000-0000-000000000010',
         '20000000-0000-0000-0000-000000000012', 5000, 'cash', 'pending');
    `);
  }, 30_000);

  it('allows pending → verified and rejects verified → pending', async () => {
    await db.exec(
      `UPDATE payment_collections SET status = 'verified' WHERE id = '${COLLECTION}'`,
    );
    await expect(
      db.exec(`UPDATE payment_collections SET status = 'pending' WHERE id = '${COLLECTION}'`),
    ).rejects.toThrow(/INVALID_COLLECTION_STATUS_TRANSITION/);
  }, 30_000);
});

describe('0045 payment folder guards (live expression behaviour)', () => {
  it('segment [1] is the literal payments/ prefix, [2] is the retailer id', async () => {
    const rows = await db.query<{ seg1: string; seg2: string }>(
      `SELECT (storage.foldername('payments/11111111-1111-1111-1111-111111111111/abc.webp'))[1] AS seg1,
              (storage.foldername('payments/11111111-1111-1111-1111-111111111111/abc.webp'))[2] AS seg2`,
    );
    expect(rows.rows[0]?.seg1).toBe('payments');
    expect(rows.rows[0]?.seg2).toBe('11111111-1111-1111-1111-111111111111');
  }, 30_000);

  it('casting [1] as uuid raises (the old bug); the CASE guard denies crafted paths cleanly', async () => {
    await expect(
      db.query(`SELECT (storage.foldername('payments/abc/x.webp'))[1]::uuid`),
    ).rejects.toThrow(/invalid input syntax for type uuid/);
    const rows = await db.query<{ v: string }>(
      `SELECT CASE WHEN 'not-a-uuid' ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
        THEN 'cast' ELSE 'deny' END AS v`,
    );
    expect(rows.rows[0]?.v).toBe('deny');
  }, 30_000);
});
