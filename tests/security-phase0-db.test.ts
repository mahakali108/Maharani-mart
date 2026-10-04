/**
 * PHASE 0 — emergency security hardening (migration 0052), EXECUTED against
 * real PostgreSQL (PGlite) with every migration applied. Each test impersonates
 * a PostgREST caller (anon / authenticated JWT) exactly like the production API,
 * so these prove behaviour of the live RLS policies, triggers and SECURITY
 * DEFINER functions — not source text.
 *
 * Covers the confirmed audit findings: SEC-1 (signup role), SEC-2 (profile
 * self-promotion), SEC-5 (self-created active retailer), SEC-6 (staff pricing),
 * SEC-8 (OTP readable in notification_logs), SEC-10 (inactive/suspended
 * accounts), SEC-11 (anon revenue view), SEC-12 (targeted coupons).
 */
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  as,
  createArea,
  createPack,
  createRetailer,
  createUser,
  createMigratedDb,
  errorOf,
  type Db,
  type PackFixture,
} from './helpers/pg-harness';

let db: Db;
let superAdmin: string;
let admin: string;
let staff: string;
let salesman: string;
let area: string;
let pack: PackFixture;

/** A public signup exactly as GoTrue performs it (insert into auth.users). */
async function signUp(meta: Record<string, unknown>, email = `x-${randomUUID()}@test.local`) {
  const id = randomUUID();
  await db.query(`insert into auth.users (id, email, raw_user_meta_data) values ($1, $2, $3)`, [
    id,
    email,
    JSON.stringify({ full_name: 'Signup', phone: `9${Math.floor(1e8 + Math.random() * 8e8)}`, ...meta }),
  ]);
  return id;
}

async function one<T>(sql: string, params: unknown[] = []): Promise<T> {
  const { rows } = await db.query<T>(sql, params);
  return rows[0]!;
}

beforeAll(async () => {
  db = await createMigratedDb();
  superAdmin = await createUser(db, 'super_admin');
  admin = await createUser(db, 'admin');
  staff = await createUser(db, 'staff');
  salesman = await createUser(db, 'salesman');
  area = await createArea(db);
  pack = await createPack(db);
}, 120_000);

// ---------------------------------------------------------------------------
// P0-1 / SEC-1 — public signup can never pick a privileged role
// ---------------------------------------------------------------------------
describe('P0-1 signup role (SEC-1)', () => {
  it.each(['super_admin', 'admin', 'staff', 'salesman'])(
    'signUp metadata role=%s still creates a pending RETAILER',
    async (role) => {
      const id = await signUp({ role, area_id: area, shop_name: 'Escalation Attempt' });
      const profile = await one<{ role: string }>(`select role from profiles where id = $1`, [id]);
      expect(profile.role).toBe('retailer');
      const retailer = await one<{ status: string; credit_limit: string }>(
        `select status, credit_limit from retailers where id = $1`,
        [id]
      );
      expect(retailer.status).toBe('pending_approval');
      expect(Number(retailer.credit_limit)).toBe(0);
    }
  );

  it('a staff/salesman role comes only from a live server-side invite, consumed once', async () => {
    const email = `invited-${randomUUID()}@test.local`;
    await db.query(`insert into staff_account_invites (email, role) values ($1, 'salesman')`, [email]);
    const id = await signUp({ role: 'super_admin' }, email);
    expect((await one<{ role: string }>(`select role from profiles where id = $1`, [id])).role).toBe('salesman');
    expect((await one<{ n: number }>(`select count(*)::int n from retailers where id = $1`, [id])).n).toBe(0);
    expect((await one<{ n: number }>(`select count(*)::int n from staff_account_invites where email = $1`, [email])).n).toBe(0);
  });

  it('an expired invite grants nothing', async () => {
    const email = `expired-${randomUUID()}@test.local`;
    await db.query(
      `insert into staff_account_invites (email, role, expires_at) values ($1, 'staff', now() - interval '1 minute')`,
      [email]
    );
    const id = await signUp({ area_id: area }, email);
    expect((await one<{ role: string }>(`select role from profiles where id = $1`, [id])).role).toBe('retailer');
  });

  it('API callers can neither read nor create invites', async () => {
    for (const who of ['anon', admin, superAdmin]) {
      expect(await errorOf(db, who, (tx) => tx.query(`select * from staff_account_invites`))).toMatch(/permission denied/);
      expect(
        await errorOf(db, who, (tx) =>
          tx.query(`insert into staff_account_invites (email, role) values ('evil@test.local', 'staff')`)
        )
      ).toMatch(/permission denied/);
    }
  });

  it('updating user metadata later has no effect on the role', async () => {
    const id = await signUp({ area_id: area });
    await db.query(`update auth.users set raw_user_meta_data = raw_user_meta_data || '{"role":"super_admin"}' where id = $1`, [id]);
    expect((await one<{ role: string }>(`select role from profiles where id = $1`, [id])).role).toBe('retailer');
  });
});

// ---------------------------------------------------------------------------
// P0-1 / SEC-2 — nobody promotes or re-activates themselves
// ---------------------------------------------------------------------------
describe('P0-1 profile privileged columns (SEC-2)', () => {
  it('a retailer cannot promote itself', async () => {
    const r = await createRetailer(db);
    const err = await errorOf(db, r.id, (tx) => tx.query(`update profiles set role = 'super_admin' where id = $1`, [r.id]));
    expect(err).toMatch(/Only a Super Admin can change an account role or active status/);
    expect((await one<{ role: string }>(`select role from profiles where id = $1`, [r.id])).role).toBe('retailer');
  });

  it('a user cannot change its own is_active', async () => {
    const r = await createRetailer(db);
    const err = await errorOf(db, r.id, (tx) => tx.query(`update profiles set is_active = false where id = $1`, [r.id]));
    expect(err).toMatch(/Only a Super Admin/);
  });

  it('an admin cannot promote itself or anyone else, nor toggle is_active', async () => {
    expect(await errorOf(db, admin, (tx) => tx.query(`update profiles set role = 'super_admin' where id = $1`, [admin]))).toMatch(/Only a Super Admin/);
    expect(await errorOf(db, admin, (tx) => tx.query(`update profiles set role = 'admin' where id = $1`, [staff]))).toMatch(/Only a Super Admin/);
    expect(await errorOf(db, admin, (tx) => tx.query(`update profiles set is_active = false where id = $1`, [staff]))).toMatch(/Only a Super Admin/);
  });

  it('staff / salesman cannot promote themselves', async () => {
    expect(await errorOf(db, staff, (tx) => tx.query(`update profiles set role = 'admin' where id = $1`, [staff]))).toMatch(/Only a Super Admin/);
    expect(await errorOf(db, salesman, (tx) => tx.query(`update profiles set role = 'staff' where id = $1`, [salesman]))).toMatch(/Only a Super Admin/);
  });

  it('identity fields are immutable for API callers', async () => {
    const r = await createRetailer(db);
    expect(await errorOf(db, r.id, (tx) => tx.query(`update profiles set created_at = now() - interval '1 year' where id = $1`, [r.id]))).toMatch(/identity fields/);
  });

  it('LEGIT: a user still edits its own name and phone', async () => {
    const r = await createRetailer(db);
    await as(db, r.id, (tx) => tx.query(`update profiles set full_name = 'Renamed Owner' where id = $1`, [r.id]));
    expect((await one<{ full_name: string }>(`select full_name from profiles where id = $1`, [r.id])).full_name).toBe('Renamed Owner');
  });

  it('LEGIT: a Super Admin changes roles and deactivates / reactivates accounts', async () => {
    const target = await createUser(db, 'staff');
    await as(db, superAdmin, (tx) => tx.query(`update profiles set role = 'salesman' where id = $1`, [target]));
    await as(db, superAdmin, (tx) => tx.query(`update profiles set is_active = false where id = $1`, [target]));
    let row = await one<{ role: string; is_active: boolean }>(`select role, is_active from profiles where id = $1`, [target]);
    expect(row).toEqual({ role: 'salesman', is_active: false });
    await as(db, superAdmin, (tx) => tx.query(`update profiles set is_active = true where id = $1`, [target]));
    row = await one(`select role, is_active from profiles where id = $1`, [target]);
    expect(row.is_active).toBe(true);
  });

  it('LEGIT: server-side (service role) paths are unaffected', async () => {
    const target = await createUser(db, 'staff');
    await as(db, 'service', (tx) => tx.query(`update profiles set role = 'salesman' where id = $1`, [target]));
    expect((await one<{ role: string }>(`select role from profiles where id = $1`, [target])).role).toBe('salesman');
  });
});

// ---------------------------------------------------------------------------
// P0-2 / SEC-5 — no self-created active retailer / credit limit
// ---------------------------------------------------------------------------
describe('P0-2 retailer self-creation (SEC-5)', () => {
  it.each([
    ['a missing area', {}],
    ['a malformed area', { area_id: 'not-a-uuid' }],
    ['a non-existent area', { area_id: randomUUID() }],
  ])('signup with %s is rejected instead of leaving a row-less retailer', async (_label, meta) => {
    await expect(signUp({ shop_name: 'No Area', ...meta })).rejects.toThrow(/invalid_area/);
  });

  it('signup into an inactive area is rejected', async () => {
    const inactive = await createArea(db);
    await db.query(`update areas set is_active = false where id = $1`, [inactive]);
    await expect(signUp({ area_id: inactive })).rejects.toThrow(/invalid_area/);
  });

  it('a user without a retailers row cannot insert an ACTIVE row with a credit limit', async () => {
    const id = await signUp({ area_id: area });
    await db.query(`delete from retailers where id = $1`, [id]); // legacy row-less account
    const err = await errorOf(db, id, (tx) =>
      tx.query(
        `insert into retailers (id, shop_name, area_id, status, credit_limit) values ($1, 'Self Approved', $2, 'active', 9999999)`,
        [id, area]
      )
    );
    expect(err).toMatch(/row-level security/);
    expect((await one<{ n: number }>(`select count(*)::int n from retailers where id = $1`, [id])).n).toBe(0);
  });

  it('a pending retailer cannot approve itself or raise its limit', async () => {
    const id = await signUp({ area_id: area });
    await as(db, id, (tx) => tx.query(`update retailers set status = 'active', credit_limit = 500000 where id = $1`, [id]));
    const row = await one<{ status: string; credit_limit: string }>(`select status, credit_limit from retailers where id = $1`, [id]);
    expect(row.status).toBe('pending_approval');
    expect(Number(row.credit_limit)).toBe(0);
    expect(
      await errorOf(db, id, (tx) =>
        tx.query(`insert into retailer_credit_accounts (retailer_id, credit_limit_paise) values ($1, 99999999)`, [id])
      )
    ).toMatch(/row-level security/);
  });

  it('LEGIT: an admin approves a pending retailer', async () => {
    const id = await signUp({ area_id: area });
    await as(db, admin, (tx) => tx.query(`update retailers set status = 'active', approved_by = $2, approved_at = now() where id = $1`, [id, admin]));
    expect((await one<{ status: string }>(`select status from retailers where id = $1`, [id])).status).toBe('active');
  });
});

// ---------------------------------------------------------------------------
// P0-3 / SEC-6 — catalogue pricing is Admin-only
// ---------------------------------------------------------------------------
describe('P0-3 catalogue pricing (SEC-6)', () => {
  it.each([
    ['base_price', `base_price = 1`],
    ['gst_percent', `gst_percent = 0`],
    ['hsn_code', `hsn_code = '0000'`],
    ['sku_code', `sku_code = 'HIJACK'`],
    ['units_per_case', `units_per_case = 99`],
  ])('staff cannot change products.%s', async (column, set) => {
    const err = await errorOf(db, staff, (tx) => tx.query(`update products set ${set} where id = $1`, [pack.productId]));
    expect(err).toContain(`Only an Admin can change ${column} on products`);
  });

  it.each([
    ['case_price', `case_price = 1`],
    ['base_price', `base_price = 1`],
    ['mrp', `mrp = 1`],
    ['ptr', `ptr = 1`],
    ['wholesale_price', `wholesale_price = 1`],
    ['pack_sku_code', `pack_sku_code = 'HIJACK'`],
    ['units_per_case', `units_per_case = 99`],
  ])('staff cannot change product_packs.%s', async (column, set) => {
    const err = await errorOf(db, staff, (tx) => tx.query(`update product_packs set ${set} where id = $1`, [pack.packId]));
    expect(err).toContain(`Only an Admin can change ${column} on product_packs`);
  });

  it('staff cannot create products, packs or pricing tiers', async () => {
    expect(
      await errorOf(db, staff, (tx) =>
        tx.query(`insert into products (sku_code, name, unit, base_price) values ('S-NEW', 'Staff Product', 'pcs', 1)`)
      )
    ).toMatch(/row-level security/);
    expect(
      await errorOf(db, staff, (tx) =>
        tx.query(
          `insert into product_packs (product_id, pack_name, pack_sku_code, base_price, case_price) values ($1, 'x', 'PK-STAFF', 1, 1)`,
          [pack.productId]
        )
      )
    ).toMatch(/row-level security/);
    expect(
      await errorOf(db, staff, (tx) =>
        tx.query(`insert into product_pricing_tiers (product_pack_id, min_quantity, price_per_piece) values ($1, 1, 0.01)`, [pack.packId])
      )
    ).toMatch(/row-level security/);
  });

  it('staff pricing-tier updates change nothing', async () => {
    await db.query(`insert into product_pricing_tiers (product_pack_id, min_quantity, price_per_piece) values ($1, 5, 90)`, [pack.packId]);
    await as(db, staff, (tx) => tx.query(`update product_pricing_tiers set price_per_piece = 0.01 where product_pack_id = $1`, [pack.packId]));
    const row = await one<{ p: string }>(`select min(price_per_piece) p from product_pricing_tiers where product_pack_id = $1`, [pack.packId]);
    expect(Number(row.p)).toBe(90);
  });

  it('LEGIT: staff still edits operational catalogue fields', async () => {
    await as(db, staff, (tx) => tx.query(`update products set name = 'Renamed by staff', reorder_level = 7 where id = $1`, [pack.productId]));
    await as(db, staff, (tx) => tx.query(`update product_packs set moq = 2, barcode = 'BC-STAFF' where id = $1`, [pack.packId]));
    expect((await one<{ name: string }>(`select name from products where id = $1`, [pack.productId])).name).toBe('Renamed by staff');
    expect((await one<{ moq: number }>(`select moq from product_packs where id = $1`, [pack.packId])).moq).toBe(2);
  });

  it('LEGIT: an admin changes prices, GST and HSN and creates tiers', async () => {
    await as(db, admin, (tx) => tx.query(`update products set base_price = 120, gst_percent = 12, hsn_code = '3401' where id = $1`, [pack.productId]));
    await as(db, admin, (tx) => tx.query(`update product_packs set case_price = 1100, mrp = 130 where id = $1`, [pack.packId]));
    await as(db, admin, (tx) =>
      tx.query(`insert into product_pricing_tiers (product_pack_id, min_quantity, price_per_piece) values ($1, 20, 80)`, [pack.packId])
    );
    const product = await one<{ base_price: string; gst_percent: string }>(`select base_price, gst_percent from products where id = $1`, [pack.productId]);
    expect(Number(product.base_price)).toBe(120);
    expect(Number(product.gst_percent)).toBe(12);
  });
});

describe('P0-3 coupon and scheme money rules (SEC-6)', () => {
  let couponId: string;
  beforeAll(async () => {
    couponId = (
      await one<{ id: string }>(
        `insert into coupons (code, title, discount_type, discount_value, starts_at, expires_at, is_active)
         values ('TEN-OFF', 'Ten off', 'percentage', 10, now() - interval '1 day', now() + interval '30 days', true) returning id`
      )
    ).id;
  });

  it('staff cannot raise a coupon value (update affects no row)', async () => {
    await as(db, staff, (tx) => tx.query(`update coupons set discount_value = 100 where id = $1`, [couponId]));
    expect(Number((await one<{ v: string }>(`select discount_value v from coupons where id = $1`, [couponId])).v)).toBe(10);
  });

  it('staff cannot create coupons or schemes', async () => {
    expect(
      await errorOf(db, staff, (tx) =>
        tx.query(
          `insert into coupons (code, title, discount_type, discount_value, expires_at) values ('STAFF-100', 'x', 'percentage', 100, now() + interval '1 day')`
        )
      )
    ).toMatch(/row-level security/);
    expect(
      await errorOf(db, staff, (tx) =>
        tx.query(`insert into schemes (name, starts_at, ends_at) values ('Staff scheme', now(), now() + interval '1 day')`)
      )
    ).toMatch(/row-level security/);
  });

  it('LEGIT: an admin creates and edits coupons and schemes', async () => {
    await as(db, admin, (tx) => tx.query(`update coupons set discount_value = 15 where id = $1`, [couponId]));
    expect(Number((await one<{ v: string }>(`select discount_value v from coupons where id = $1`, [couponId])).v)).toBe(15);
    await as(db, admin, (tx) =>
      tx.query(
        `insert into coupons (code, title, discount_type, discount_value, starts_at, expires_at) values ('ADMIN-5', 'x', 'percentage', 5, now(), now() + interval '1 day')`
      )
    );
    await as(db, admin, (tx) => tx.query(`insert into schemes (name, starts_at, ends_at) values ('Admin scheme', now(), now() + interval '1 day')`));
  });
});

// ---------------------------------------------------------------------------
// P0-4 / SEC-8 — OTP text in notification_logs is not readable by staff
// ---------------------------------------------------------------------------
describe('P0-4 notification_logs privacy (SEC-8)', () => {
  it('staff cannot read a retailer notification log (historical plaintext OTP rows)', async () => {
    const r = await createRetailer(db);
    await db.query(
      `insert into notification_logs (recipient_id, channel, status, payload) values ($1, 'whatsapp', 'queued', $2)`,
      [r.id, JSON.stringify({ body: 'Your delivery OTP is 123456' })]
    );
    const staffRows = await as(db, staff, (tx) => tx.query(`select payload from notification_logs where recipient_id = $1`, [r.id]));
    expect(staffRows.rows).toHaveLength(0);
    const salesmanRows = await as(db, salesman, (tx) => tx.query(`select payload from notification_logs where recipient_id = $1`, [r.id]));
    expect(salesmanRows.rows).toHaveLength(0);
  });

  it('LEGIT: staff can still queue a log; the recipient and admins can read it', async () => {
    const r = await createRetailer(db);
    await as(db, staff, (tx) =>
      tx.query(`insert into notification_logs (recipient_id, channel, status, payload) values ($1, 'whatsapp', 'queued', '{}')`, [r.id])
    );
    expect((await as(db, r.id, (tx) => tx.query(`select id from notification_logs where recipient_id = $1`, [r.id]))).rows).toHaveLength(1);
    expect((await as(db, admin, (tx) => tx.query(`select id from notification_logs where recipient_id = $1`, [r.id]))).rows).toHaveLength(1);
  });

  it('staff can no longer rewrite notification logs', async () => {
    const r = await createRetailer(db);
    await db.query(`insert into notification_logs (recipient_id, channel, status) values ($1, 'whatsapp', 'queued')`, [r.id]);
    await as(db, staff, (tx) => tx.query(`update notification_logs set status = 'delivered' where recipient_id = $1`, [r.id]));
    expect((await one<{ status: string }>(`select status from notification_logs where recipient_id = $1`, [r.id])).status).toBe('queued');
  });
});

// ---------------------------------------------------------------------------
// P0-5 / SEC-10 — inactive, suspended and unapproved accounts
// ---------------------------------------------------------------------------
describe('P0-5 inactive / suspended accounts at the database (SEC-10)', () => {
  const cartInsert = (retailerId: string) => (tx: Parameters<Parameters<typeof as>[2]>[0]) =>
    tx.query(`insert into cart_items (retailer_id, product_id, pack_id, quantity) values ($1, $2, $3, 1)`, [
      retailerId,
      pack.productId,
      pack.packId,
    ]);
  const cartAdd = () => (tx: Parameters<Parameters<typeof as>[2]>[0]) =>
    tx.query(`select public.mutate_retailer_cart_line($1, null, 0, (select moq from product_packs where id = $1))`, [pack.packId]);

  it('LEGIT: an active retailer writes its own cart through the MOQ-checked RPC and can write its address/profile', async () => {
    const r = await createRetailer(db);
    // Direct writes are revoked even for active retailers; the owned RPC is the
    // sole cart mutation path and rechecks active status, pack and MOQ.
    expect(await errorOf(db, r.id, cartInsert(r.id))).toMatch(/permission denied for table cart_items/);
    await as(db, r.id, cartAdd());
    await as(db, r.id, (tx) =>
      tx.query(
        `insert into retailer_addresses (retailer_id, receiver_name, phone, line1, city, pincode) values ($1, 'Owner', '9000000000', 'Main Road', 'Khagaria', '851204')`,
        [r.id]
      )
    );
    expect((await one<{ n: number }>(`select count(*)::int n from cart_items where retailer_id = $1`, [r.id])).n).toBe(1);
  });

  it('a SUSPENDED retailer can no longer write through the API', async () => {
    const r = await createRetailer(db, { status: 'suspended' });
    expect(await errorOf(db, r.id, cartAdd())).toMatch(/active retailer session is required/i);
    expect(await errorOf(db, r.id, cartInsert(r.id))).toMatch(/permission denied for table cart_items/);
    await as(db, r.id, (tx) => tx.query(`update profiles set full_name = 'x' where id = $1`, [r.id]));
    expect((await one<{ full_name: string }>(`select full_name from profiles where id = $1`, [r.id])).full_name).not.toBe('x');
  });

  it('a PENDING (unapproved) retailer cannot write', async () => {
    const id = await signUp({ area_id: area });
    expect(await errorOf(db, id, cartAdd())).toMatch(/active retailer session is required/i);
    expect(await errorOf(db, id, cartInsert(id))).toMatch(/permission denied for table cart_items/);
  });

  it('a deactivated profile loses its role everywhere (RLS helpers + RPC guards)', async () => {
    const s = await createUser(db, 'staff');
    const warehouse = (await one<{ id: string }>(`insert into warehouses (name) values ('WH-${randomUUID().slice(0, 6)}') returning id`)).id;
    await db.query(`insert into staff_assignments (staff_id, warehouse_id) values ($1, $2)`, [s, warehouse]);
    const before = await as(db, s, (tx) => tx.query<{ ok: boolean }>(`select is_staff_or_above() ok`));
    expect(before.rows[0]!.ok).toBe(true);

    await db.query(`update profiles set is_active = false where id = $1`, [s]);
    const after = await as(db, s, (tx) => tx.query<{ ok: boolean; role: string | null }>(`select is_staff_or_above() ok, current_user_role() role`));
    expect(after.rows[0]).toEqual({ ok: false, role: null });
    expect(
      await errorOf(db, s, (tx) => tx.query(`select adjust_product_stock($1, $2, 5, 'test')`, [pack.productId, warehouse]))
    ).toMatch(/permission to manage inventory/);
    expect(await errorOf(db, s, (tx) => tx.query(`update products set name = 'ghost' where id = $1`, [pack.productId]))).toBeNull();
    expect((await one<{ name: string }>(`select name from products where id = $1`, [pack.productId])).name).not.toBe('ghost');
  });

  it('a deactivated admin cannot reach admin-only data', async () => {
    const a = await createUser(db, 'admin');
    await db.query(`update profiles set is_active = false where id = $1`, [a]);
    const rows = await as(db, a, (tx) => tx.query(`select id from retailer_credit_accounts`));
    expect(rows.rows).toHaveLength(0);
    expect(await errorOf(db, a, (tx) => tx.query(`select * from admin_top_products(5)`))).toMatch(/Admin authorization required/);
  });

  it('LEGIT: active staff and admins keep their access', async () => {
    const ok = await as(db, admin, (tx) => tx.query<{ a: boolean; s: boolean }>(`select is_admin_or_above() a, is_staff_or_above() s`));
    expect(ok.rows[0]).toEqual({ a: true, s: true });
  });
});

// ---------------------------------------------------------------------------
// P0-6 / SEC-11 + SEC-12
// ---------------------------------------------------------------------------
describe('P0-6 revenue view and targeted coupons (SEC-11, SEC-12)', () => {
  it('anon and ordinary users cannot read mv_top_products', async () => {
    const r = await createRetailer(db);
    expect(await errorOf(db, 'anon', (tx) => tx.query(`select * from mv_top_products`))).toMatch(/permission denied/);
    expect(await errorOf(db, r.id, (tx) => tx.query(`select * from mv_top_products`))).toMatch(/permission denied/);
    expect(await errorOf(db, r.id, (tx) => tx.query(`select * from admin_top_products(5)`))).toMatch(/Admin authorization required/);
    expect(await errorOf(db, staff, (tx) => tx.query(`select * from admin_top_products(5)`))).toMatch(/Admin authorization required/);
    expect(await errorOf(db, 'anon', (tx) => tx.query(`select * from admin_top_products(5)`))).toMatch(/permission denied/);
  });

  it('LEGIT: an admin reads top products through admin_top_products()', async () => {
    const res = await as(db, admin, (tx) => tx.query(`select * from admin_top_products(5)`));
    expect(Array.isArray(res.rows)).toBe(true);
  });

  it('a retailer cannot see another retailer’s targeted coupon; the owner can', async () => {
    const a = await createRetailer(db);
    const b = await createRetailer(db, { salesmanId: salesman });
    await db.query(
      `insert into coupons (code, title, discount_type, discount_value, starts_at, expires_at, is_active, retailer_id)
       values ('VIP-B', 'VIP only', 'percentage', 25, now() - interval '1 day', now() + interval '10 days', true, $1),
              ('ALL-5', 'Everyone', 'percentage', 5, now() - interval '1 day', now() + interval '10 days', true, null)`,
      [b.id]
    );
    const codes = async (who: string) =>
      (await as(db, who, (tx) => tx.query<{ code: string }>(`select code from coupons where code in ('VIP-B', 'ALL-5') order by code`))).rows.map((r) => r.code);
    expect(await codes(a.id)).toEqual(['ALL-5']);
    expect(await codes(b.id)).toEqual(['ALL-5', 'VIP-B']);
    expect(await codes(salesman)).toEqual(['ALL-5', 'VIP-B']);
    expect(await codes(staff)).toEqual(['ALL-5', 'VIP-B']);
  });
});

describe('read-only privileged-account audit (supabase/audits/phase0_privileged_accounts_readonly.sql)', () => {
  const auditSql = readFileSync(path.join(process.cwd(), 'supabase/audits/phase0_privileged_accounts_readonly.sql'), 'utf8');

  it('contains no data-modifying statement and runs in a rolled-back READ ONLY transaction', () => {
    const code = auditSql.replace(/--.*$/gm, '');
    expect(code).not.toMatch(/\b(insert|update|delete|truncate|alter|drop|grant|revoke|create)\b/i);
    expect(code).toMatch(/begin transaction[^;]*read only;/i);
    expect(code.trim()).toMatch(/rollback;$/i);
  });

  it('flags a legacy forged super admin and a self-activated retailer, and changes nothing', async () => {
    // Reproduce what the pre-0052 holes allowed (seeded as the DB owner — the
    // new migration makes both impossible for an API caller).
    const forged = await signUp({ full_name: 'Mallory', phone: '+919000000001', shop_name: 'Fake Shop', area_id: area });
    await db.query(`update profiles set role = 'super_admin' where id = $1`, [forged]);
    const selfActive = await signUp({ full_name: 'Eve', phone: '+919000000002', shop_name: 'Eve Store', area_id: area });
    await db.query(`update retailers set status = 'active', credit_limit = 9999999 where id = $1`, [selfActive]);
    const before = (await db.query(`select id, role::text, is_active from profiles order by id`)).rows;

    const results = await db.exec(auditSql);
    const [, admins, suspicious, counts, retailers] = results;

    expect(admins!.rows.map((r) => (r as { id: string }).id)).toContain(forged);
    const flagged = suspicious!.rows.find((r) => (r as { id: string }).id === forged) as { evidence: string } | undefined;
    expect(flagged?.evidence).toMatch(/STRONG: non-retailer role on an account created with the public retailer-signup fields/);
    expect(flagged?.evidence).toMatch(/no ROLE_CHANGED audit row/);
    expect(Number((counts!.rows[0] as { super_admins: number }).super_admins)).toBeGreaterThanOrEqual(2);
    const retailerFlag = retailers!.rows.find((r) => (r as { id: string }).id === selfActive) as { evidence: string } | undefined;
    expect(retailerFlag?.evidence).toMatch(/STRONG: active without an approver/);
    expect(retailerFlag?.evidence).toMatch(/legacy credit_limit set without an approver/);

    // Nothing was demoted or modified.
    expect((await db.query(`select id, role::text, is_active from profiles order by id`)).rows).toEqual(before);
    expect((await db.query(`select role::text from profiles where id = $1`, [forged])).rows[0]).toEqual({ role: 'super_admin' });
  });
});
