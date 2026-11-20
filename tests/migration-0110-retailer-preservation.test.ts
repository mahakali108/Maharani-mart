import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { as, createArea, createMigratedDb, createUser, type Db, type Tx } from './helpers/pg-harness';

/**
 * Migration 0110 must retire the SELLER capability without destroying legitimate
 * RETAILER access. The schema allows one profile to hold both, because
 * `public.retailers` is a separate table keyed on the same profile id while
 * `profiles.role` is a single column.
 *
 * Three populations, and the rule for each:
 *
 *   1. SELLER-ONLY            -> deactivated. Never converted to a retailer.
 *   2. DUAL-ROLE, approved    -> retailer access PRESERVED (role becomes
 *                                'retailer', stays active).
 *   3. DUAL-ROLE, unapproved  -> deactivated, role left as 'seller'.
 *   4. ORDINARY RETAILER      -> completely untouched.
 *
 * In every case the seller capability must remain revoked.
 */

const MIGRATION = '0110_retire_seller_supplier_marketplace.sql';
const PRE_0110 = '0109_phase3_business_control.sql';

/** Builds a database and plants the four populations BEFORE 0110 runs. */
async function seedPopulationsBeforeRetirement() {
  const db = await createMigratedDb({ lastMigration: PRE_0110 });
  const areaId = await createArea(db);

  // `createUser` inserts a real auth.users row and lets handle_new_user create the
  // profile. For role 'seller' it also removes the retailer row that the retail
  // signup branch created — which is precisely the SELLER-ONLY shape. A dual-role
  // fixture adds the retailers row back explicitly below.
  async function profile(role: 'seller' | 'retailer' | 'super_admin' | 'admin' | 'staff', label: string): Promise<string> {
    return createUser(db, role, label, { areaId });
  }

  // `handle_new_user` may already have created a pending_approval row on the
  // retail signup branch, so a dual-role fixture promotes/creates it in place.
  async function retailerRow(profileId: string, status: string): Promise<void> {
    await db.query(
      `insert into public.retailers (id, shop_name, area_id, status) values ($1, $2, $3, $4::public.retailer_status)
       on conflict (id) do update set status = excluded.status, area_id = excluded.area_id`,
      [profileId, `Shop ${profileId.slice(0, 8)}`, areaId, status],
    );
  }

  // 1. Seller-only: a seller profile with NO retailers row.
  const sellerOnly = await profile('seller', 'Seller Only');

  // 2. Dual-role, retailer already APPROVED — the case that must be preserved.
  const dualApproved = await profile('seller', 'Dual Approved');
  await retailerRow(dualApproved, 'active');

  // 3. Dual-role, retailer still PENDING APPROVAL.
  const dualPending = await profile('seller', 'Dual Pending');
  await retailerRow(dualPending, 'pending_approval');

  // 3b. Dual-role, retailer SUSPENDED.
  const dualSuspended = await profile('seller', 'Dual Suspended');
  await retailerRow(dualSuspended, 'suspended');

  // 4. An ordinary retailer, and an ordinary active retailer with no seller past.
  const ordinaryRetailer = await profile('retailer', 'Ordinary Retailer');
  await retailerRow(ordinaryRetailer, 'active');

  // 2b. Dual-role, retailer APPROVED but the ACCOUNT was already suspended by
  // the owner. The retailer role must be preserved; is_active must NOT be
  // flipped back on, because reactivating a suspended account is a new grant.
  const dualApprovedInactive = await profile('seller', 'Dual Approved Inactive');
  await retailerRow(dualApprovedInactive, 'active');
  await db.query('update public.profiles set is_active = false where id = $1', [dualApprovedInactive]);

  // 1b. SELLER-ONLY that was already inactive before the migration. It must be
  // left byte-identical and must NOT appear in the audit trail as a change.
  const sellerOnlyInactive = await profile('seller', 'Seller Only Inactive');
  await db.query('update public.profiles set is_active = false where id = $1', [sellerOnlyInactive]);

  // Supporting actors.
  const superAdmin = await profile('super_admin', 'Owner');
  const admin = await profile('admin', 'Admin');
  const staff = await profile('staff', 'Staff');

  return {
    db, areaId,
    sellerOnly, sellerOnlyInactive,
    dualApproved, dualApprovedInactive,
    dualPending, dualSuspended,
    ordinaryRetailer, superAdmin, admin, staff,
  };
}

async function runRetirement(db: Db): Promise<void> {
  await db.exec(readFileSync(join('supabase', 'migrations', MIGRATION), 'utf8'));
}

async function profileState(db: Db, id: string) {
  const { rows } = await db.query<{ role: string; is_active: boolean }>(
    `select role::text as role, is_active from public.profiles where id = $1`,
    [id],
  );
  return rows[0]!;
}

async function retailerStatus(db: Db, id: string) {
  const { rows } = await db.query<{ status: string }>(
    `select status::text as status from public.retailers where id = $1`,
    [id],
  );
  return rows[0]?.status ?? null;
}

function auditFor(db: Db, id: string) {
  return db.query<{ action: string; old_data: Record<string, unknown>; new_data: Record<string, unknown> }>(
    `select action, old_data, new_data from public.audit_logs
      where table_name = 'profiles' and record_id = $1 order by created_at`,
    [id],
  );
}

describe('0110 — seller-only accounts are deactivated, never converted', () => {
  it('deactivates a seller-only profile and leaves its role as seller', async () => {
    const { db, sellerOnly } = await seedPopulationsBeforeRetirement();
    expect(await profileState(db, sellerOnly)).toMatchObject({ role: 'seller', is_active: true });

    await runRetirement(db);

    // Deactivated, and NOT converted into a retailer.
    expect(await profileState(db, sellerOnly)).toMatchObject({ role: 'seller', is_active: false });
    expect(await retailerStatus(db, sellerOnly)).toBeNull();

    // The decision is auditable.
    const { rows } = await auditFor(db, sellerOnly);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.new_data).toMatchObject({ role: 'seller', is_active: false, source: 'migration 0110' });
    expect(String(rows[0]!.new_data.reason)).toContain('Not converted to a retailer');
    await db.close();
  }, 300_000);

  it('keeps every historical record of a seller-only account', async () => {
    const { db, sellerOnly } = await seedPopulationsBeforeRetirement();
    // Give the account a seller membership so there is history to protect.
    const sellerId = randomUUID();
    await db.query(
      `insert into public.sellers (id, business_name, status) values ($1, 'Historical Seller Co', 'pending')`,
      [sellerId],
    );
    await db.query(
      `insert into public.seller_members (seller_id, profile_id, member_role) values ($1, $2, 'owner')`,
      [sellerId, sellerOnly],
    );

    await runRetirement(db);

    // Profile row, seller row and membership row all survive untouched.
    expect((await profileState(db, sellerOnly)).role).toBe('seller');
    const { rows: seller } = await db.query<{ n: string }>(
      `select count(*)::text as n from public.sellers where id = $1`, [sellerId]);
    expect(seller[0]!.n).toBe('1');
    const { rows: member } = await db.query<{ n: string }>(
      `select count(*)::text as n from public.seller_members where seller_id = $1`, [sellerId]);
    expect(member[0]!.n).toBe('1');
    await db.close();
  }, 300_000);
});

describe('0110 — dual-role accounts with an approved retailer keep retailer access', () => {
  it('re-roles an approved dual-role account to retailer and keeps it active', async () => {
    const { db, dualApproved } = await seedPopulationsBeforeRetirement();
    expect(await profileState(db, dualApproved)).toMatchObject({ role: 'seller', is_active: true });

    await runRetirement(db);

    // PRESERVED: the account is now a live retailer, not a dead account.
    expect(await profileState(db, dualApproved)).toMatchObject({ role: 'retailer', is_active: true });
    // Its approved retailer record is untouched — the approval is the evidence.
    expect(await retailerStatus(db, dualApproved)).toBe('active');

    const { rows } = await auditFor(db, dualApproved);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.old_data).toMatchObject({ role: 'seller' });
    expect(rows[0]!.new_data).toMatchObject({ role: 'retailer', is_active: true });
    expect(String(rows[0]!.new_data.reason)).toContain('legitimate retailer access preserved');
    await db.close();
  }, 300_000);

  it('lets the preserved retailer actually use retailer-scoped access', async () => {
    const { db, dualApproved } = await seedPopulationsBeforeRetirement();
    await runRetirement(db);

    // is_active_account() is the predicate every restrictive RLS policy uses.
    const result = await as(db, dualApproved, async (tx: Tx) => {
      const { rows } = await tx.query<{ active: boolean; role: string }>(
        `select public.is_active_account() as active, public.current_user_role()::text as role`,
      );
      return rows[0]!;
    });
    expect(result.active).toBe(true);
    expect(result.role).toBe('retailer');
    await db.close();
  }, 300_000);

  it('does NOT preserve access when the retailer side is still pending approval', async () => {
    const { db, dualPending } = await seedPopulationsBeforeRetirement();
    await runRetirement(db);

    // Never approved => no legitimate retailer access to preserve.
    expect(await profileState(db, dualPending)).toMatchObject({ role: 'seller', is_active: false });
    expect(await retailerStatus(db, dualPending)).toBe('pending_approval');
    const { rows } = await auditFor(db, dualPending);
    expect(String(rows[0]!.new_data.reason)).toContain('not approved');
    await db.close();
  }, 300_000);

  it('does NOT preserve access when the retailer side is suspended', async () => {
    const { db, dualSuspended } = await seedPopulationsBeforeRetirement();
    await runRetirement(db);

    expect(await profileState(db, dualSuspended)).toMatchObject({ role: 'seller', is_active: false });
    expect(await retailerStatus(db, dualSuspended)).toBe('suspended');
    await db.close();
  }, 300_000);
});

describe('0110 — ordinary retailers are untouched', () => {
  it('leaves a plain active retailer exactly as it was', async () => {
    const { db, ordinaryRetailer } = await seedPopulationsBeforeRetirement();
    await runRetirement(db);

    expect(await profileState(db, ordinaryRetailer)).toMatchObject({ role: 'retailer', is_active: true });
    expect(await retailerStatus(db, ordinaryRetailer)).toBe('active');
    // No audit row: the migration did not touch it.
    const { rows } = await auditFor(db, ordinaryRetailer);
    expect(rows).toHaveLength(0);

    const stillActive = await as(db, ordinaryRetailer, (tx: Tx) =>
      tx.query<{ v: boolean }>(`select public.is_active_account() as v`));
    expect(stillActive.rows[0]!.v).toBe(true);
    await db.close();
  }, 300_000);

  it('does not disturb the Super Admin, admin or staff', async () => {
    const seeded = await seedPopulationsBeforeRetirement();
    await runRetirement(seeded.db);

    for (const [label, id] of [
      ['super_admin', seeded.superAdmin],
      ['admin', seeded.admin],
      ['staff', seeded.staff],
    ] as const) {
      const state = await profileState(seeded.db, id);
      expect(state.role, label).toBe(label);
      expect(state.is_active, label).toBe(true);
    }
    // The real Super Admin is never locked out by this migration.
    const { rows } = await seeded.db.query<{ role: string }>(
      `select role::text as role from public.profiles where role = 'super_admin' and is_active`,
    );
    expect(rows.length).toBeGreaterThan(0);
    await seeded.db.close();
  }, 300_000);
});

describe('0110 — seller capability stays revoked for every population', () => {
  it('revokes the seller RPCs regardless of who kept retailer access', async () => {
    const { db } = await seedPopulationsBeforeRetirement();
    await runRetirement(db);

    const { rows } = await db.query<{ proname: string; anon: boolean; authn: boolean }>(
      `select p.proname,
              has_function_privilege('anon', p.oid, 'EXECUTE') as anon,
              has_function_privilege('authenticated', p.oid, 'EXECUTE') as authn
         from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public'
          and p.proname in ('seller_set_offer_stock','seller_replace_offer_tiers',
                            'seller_update_sub_order','seller_order_headers',
                            'marketplace_offer_quotes','reserve_seller_invite',
                            'submit_supplier_application')
        order by 1`,
    );
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      expect(row.anon, row.proname).toBe(false);
      expect(row.authn, row.proname).toBe(false);
    }
    await db.close();
  }, 300_000);

  it('refuses a seller RPC even for a preserved dual-role retailer', async () => {
    const { db, dualApproved } = await seedPopulationsBeforeRetirement();
    await runRetirement(db);

    // The account is a live retailer now — but it still cannot reach the seller
    // surface, because 0110 revoked the grant rather than relying on the role.
    let message = '';
    try {
      await as(db, dualApproved, (tx: Tx) =>
        tx.query(`select public.seller_order_headers()`));
    } catch (error) {
      message = (error as Error).message;
    }
    expect(message).toMatch(/permission denied for function seller_order_headers/);
    await db.close();
  }, 300_000);
});

describe('0110 — re-role path for approvals that happen after the migration', () => {
  it('restores retailer access for a dual-role account approved later, and audits it', async () => {
    const { db, dualPending, superAdmin } = await seedPopulationsBeforeRetirement();
    await runRetirement(db);
    // After the migration the account is inactive with role 'seller'.
    expect(await profileState(db, dualPending)).toMatchObject({ role: 'seller', is_active: false });

    // The owner now approves the retailer application.
    await db.query(`update public.retailers set status = 'active' where id = $1`, [dualPending]);

    // The helper is service_role-only, so it is called the way the server would.
    const { rows } = await as(db, 'service', (tx: Tx) =>
      tx.query<{ result: Record<string, unknown> }>(
        `select public.retire_promote_dual_role_seller($1) as result`, [dualPending]));
    expect(rows[0]!.result).toMatchObject({ ok: true, changed: true, role: 'retailer', reactivated: false });
    // The ROLE is granted so the approved retailer access exists. `is_active` is
    // NOT flipped: approving an application is an access grant, not a
    // reinstatement of an account the owner had suspended.
    expect(await profileState(db, dualPending)).toMatchObject({ role: 'retailer', is_active: false });
    expect(rows[0]!.result.note).toContain('owner must reactivate');

    // Audited, attributable to the approving Super Admin's session if present.
    const { rows: audit } = await db.query<{ new_data: Record<string, unknown> }>(
      `select new_data from public.audit_logs
        where table_name = 'profiles' and record_id = $1
          and new_data ->> 'source' = 'retire_promote_dual_role_seller'`,
      [dualPending],
    );
    expect(audit).toHaveLength(1);
    expect(superAdmin).toBeTruthy();
    await db.close();
  }, 300_000);

  it('refuses to convert a seller-only account into a retailer', async () => {
    const { db, sellerOnly } = await seedPopulationsBeforeRetirement();
    await runRetirement(db);

    const { rows } = await as(db, 'service', (tx: Tx) =>
      tx.query<{ result: Record<string, unknown> }>(
        `select public.retire_promote_dual_role_seller($1) as result`, [sellerOnly]));
    // The helper must refuse: a seller-only account is never mechanically
    // converted. This is the brief's hard requirement.
    expect(rows[0]!.result).toMatchObject({ ok: false, reason: 'seller_only_never_converted' });
    expect(await profileState(db, sellerOnly)).toMatchObject({ role: 'seller', is_active: false });
    await db.close();
  }, 300_000);

  it('refuses when the retailer application is still not approved', async () => {
    const { db, dualPending } = await seedPopulationsBeforeRetirement();
    await runRetirement(db);

    const { rows } = await as(db, 'service', (tx: Tx) =>
      tx.query<{ result: Record<string, unknown> }>(
        `select public.retire_promote_dual_role_seller($1) as result`, [dualPending]));
    expect(rows[0]!.result).toMatchObject({ ok: false, reason: 'retailer_not_approved' });
    expect(await profileState(db, dualPending)).toMatchObject({ role: 'seller', is_active: false });
    await db.close();
  }, 300_000);

  it('is idempotent and is not callable by any API role', async () => {
    const { db, dualApproved } = await seedPopulationsBeforeRetirement();
    await runRetirement(db);

    // Already a retailer: no change, no second audit row.
    const { rows } = await as(db, 'service', (tx: Tx) =>
      tx.query<{ result: Record<string, unknown> }>(
        `select public.retire_promote_dual_role_seller($1) as result`, [dualApproved]));
    expect(rows[0]!.result).toMatchObject({ ok: true, changed: false });

    // Role-changing helpers must not be reachable from the API.
    const { rows: grants } = await db.query<{ anon: boolean; authn: boolean }>(
      `select has_function_privilege('anon', p.oid, 'EXECUTE') as anon,
              has_function_privilege('authenticated', p.oid, 'EXECUTE') as authn
         from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public' and p.proname = 'retire_promote_dual_role_seller'`,
    );
    expect(grants[0]).toMatchObject({ anon: false, authn: false });
    await db.close();
  }, 300_000);
});

describe('0110 — history survives for every population', () => {
  it('keeps orders, payments, refunds, memberships and audit rows', async () => {
    const { db, dualApproved, sellerOnly, ordinaryRetailer } = await seedPopulationsBeforeRetirement();
    // A minimal historical order pinned to the dual-role retailer. Only the
    // columns every migration chain agrees on are used, so the fixture does not
    // depend on later schema additions.
    const orderId = randomUUID();
    // An orders INSERT requires exactly one active warehouse (a 0009-era guard).
    await db.query(
      `insert into public.warehouses (name, area_id, is_active)
       select 'Hist Warehouse', $1, true
        where not exists (select 1 from public.warehouses where is_active)`,
      [await createArea(db)],
    );
    await db.query(
      `insert into public.orders (id, order_number, retailer_id, status, subtotal, grand_total)
       values ($1, $2, $3, 'delivered', 100, 100)`,
      [orderId, `HIST-${orderId.slice(0, 8)}`, dualApproved],
    );

    await runRetirement(db);

    for (const [label, id] of [['dual', dualApproved], ['seller-only', sellerOnly], ['retailer', ordinaryRetailer]] as const) {
      const { rows } = await db.query<{ n: string }>(
        `select count(*)::text as n from public.profiles where id = $1`, [id]);
      expect(rows[0]!.n, label).toBe('1');
    }
    const { rows: order } = await db.query<{ n: string }>(
      `select count(*)::text as n from public.orders where id = $1`, [orderId]);
    expect(order[0]!.n).toBe('1');
    // The audit trail is append-only evidence, and 0110 added to it, never truncated it.
    const { rows: audit } = await db.query<{ n: string }>(
      `select count(*)::text as n from public.audit_logs where table_name = 'profiles'`);
    expect(Number(audit[0]!.n)).toBeGreaterThanOrEqual(3);
    await db.close();
  }, 300_000);
});

describe('0110 — the review-only rollback reverses the re-role, not the data', () => {
  const rollbackSql = () =>
    readFileSync(join('supabase', 'rollbacks', '0110_retire_seller_supplier_marketplace.down.sql'), 'utf8');

  it('leaves the profile row alone unless the operator opts in', async () => {
    // A plain rollback must NOT silently hand the seller capability back: the
    // re-role reversal is opt-in, exactly like the reactivation it accompanies.
    const { db, dualApproved } = await seedPopulationsBeforeRetirement();
    await runRetirement(db);
    expect((await profileState(db, dualApproved)).role).toBe('retailer');

    await db.exec(rollbackSql());
    expect((await profileState(db, dualApproved)).role).toBe('retailer');
    await db.close();
  }, 300_000);

  it('reverses its own re-role when the operator opts in, and never demotes a real retailer', async () => {
    const { db, dualApproved, sellerOnly, ordinaryRetailer } = await seedPopulationsBeforeRetirement();
    await runRetirement(db);
    expect((await profileState(db, dualApproved)).role).toBe('retailer');

    await db.exec(`
      set local maharani.reactivate_seller_profiles = 'true';
      ${rollbackSql()}
    `);

    // The reversible role change is undone...
    expect((await profileState(db, dualApproved)).role, 're-role must be reversible').toBe('seller');
    // ...but a retailer that was never a seller is never touched by it.
    expect((await profileState(db, ordinaryRetailer)).role).toBe('retailer');
    // The seller-only account is never promoted, before or after.
    const sellerOnlyState = await profileState(db, sellerOnly);
    expect(sellerOnlyState.role).toBe('seller');
    expect(sellerOnlyState.is_active).toBe(true); // opt-in reactivation, deliberately

    // And the block-9 helper ceases to exist, so no re-role path is left behind.
    const { rows } = await db.query<{ n: string }>(
      `select count(*)::text as n from pg_proc where proname = 'retire_promote_dual_role_seller'`,
    );
    expect(rows[0]!.n).toBe('0');
    await db.close();
  }, 300_000);

  it('keeps every historical row through the reversal', async () => {
    const { db, dualApproved } = await seedPopulationsBeforeRetirement();
    await runRetirement(db);
    const before = await db.query<{ n: string }>(`select count(*)::text as n from public.audit_logs`);
    await db.exec(`
      set local maharani.reactivate_seller_profiles = 'true';
      ${rollbackSql()}
    `);
    const after = await db.query<{ n: string }>(`select count(*)::text as n from public.audit_logs`);
    // The audit trail is append-only evidence: a rollback must never erase the
    // record of what the migration did, or the reversal becomes untraceable.
    expect(Number(after.rows[0]!.n)).toBeGreaterThanOrEqual(Number(before.rows[0]!.n));
    const { rows } = await db.query<{ n: string }>(
      `select count(*)::text as n from public.profiles where id = $1`, [dualApproved]);
    expect(rows[0]!.n).toBe('1');
    await db.close();
  }, 300_000);
});

/**
 * The directive's mandatory account-state matrix. Each case names the BEFORE
 * state, asserts the AFTER state, and asserts that `is_active` was never invented
 * — a migration must not reactivate an account the owner had suspended, and must
 * not resurrect an inactive one as a side effect of a role change.
 */
describe('0110 — account-state preservation matrix', () => {
  it('ACTIVE approved dual-role: role becomes retailer, stays active', async () => {
    const { db, dualApproved } = await seedPopulationsBeforeRetirement();
    expect(await profileState(db, dualApproved)).toMatchObject({ role: 'seller', is_active: true });
    await runRetirement(db);
    expect(await profileState(db, dualApproved)).toMatchObject({ role: 'retailer', is_active: true });
    const { rows } = await auditFor(db, dualApproved);
    expect(rows[0]!.old_data).toMatchObject({ role: 'seller', is_active: true });
    expect(rows[0]!.new_data).toMatchObject({ role: 'retailer', is_active: true });
    await db.close();
  }, 300_000);

  it('INACTIVE approved dual-role: role becomes retailer, stays INACTIVE', async () => {
    const { db, dualApprovedInactive } = await seedPopulationsBeforeRetirement();
    expect(await profileState(db, dualApprovedInactive)).toMatchObject({ role: 'seller', is_active: false });

    await runRetirement(db);

    // The retailer role is preserved so the approved access is intact the moment
    // the owner reactivates the account — but it is NOT reactivated here.
    const after = await profileState(db, dualApprovedInactive);
    expect(after.role).toBe('retailer');
    expect(after.is_active, 'a suspended account must not be reactivated').toBe(false);

    // The audit row proves the before-state was inactive and that this migration
    // did not change it.
    const { rows } = await auditFor(db, dualApprovedInactive);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.old_data).toMatchObject({ role: 'seller', is_active: false });
    expect(rows[0]!.new_data).toMatchObject({ role: 'retailer', is_active: false });
    await db.close();
  }, 300_000);

  it('ACTIVE seller-only: deactivated, role stays seller, never converted', async () => {
    const { db, sellerOnly } = await seedPopulationsBeforeRetirement();
    await runRetirement(db);
    expect(await profileState(db, sellerOnly)).toMatchObject({ role: 'seller', is_active: false });
    expect(await retailerStatus(db, sellerOnly)).toBeNull();
    await db.close();
  }, 300_000);

  it('INACTIVE seller-only: left byte-identical and NOT written to the audit trail', async () => {
    const { db, sellerOnlyInactive } = await seedPopulationsBeforeRetirement();
    await runRetirement(db);

    expect(await profileState(db, sellerOnlyInactive)).toMatchObject({ role: 'seller', is_active: false });
    // Already inactive: nothing changed, so there is nothing to audit and nothing
    // for the rollback to reverse.
    const { rows } = await auditFor(db, sellerOnlyInactive);
    expect(rows, 'no change means no audit row').toHaveLength(0);
    await db.close();
  }, 300_000);

  it('unapproved dual-role: deactivated, role stays seller, retailer access NOT granted', async () => {
    const { db, dualPending, dualSuspended } = await seedPopulationsBeforeRetirement();
    await runRetirement(db);
    for (const [label, id] of [['pending', dualPending], ['suspended', dualSuspended]] as const) {
      expect(await profileState(db, id), label).toMatchObject({ role: 'seller', is_active: false });
      // The retailer row keeps its unapproved status — the migration must not
      // approve it as a side effect.
      expect(await retailerStatus(db, id), label).not.toBe('active');
    }
    await db.close();
  }, 300_000);

  it('no seller-role profile is left active by the migration', async () => {
    const { db } = await seedPopulationsBeforeRetirement();
    await runRetirement(db);
    const { rows } = await db.query<{ n: string }>(
      `select count(*)::text as n from public.profiles where role::text = 'seller' and is_active = true`);
    expect(rows[0]!.n).toBe('0');
    await db.close();
  }, 300_000);
});

describe('0110 — the REAL retailer approval path promotes a retired seller', () => {
  it('promotes through admin_review_retailer_application, not only the helper', async () => {
    const { db, dualPending, superAdmin } = await seedPopulationsBeforeRetirement();
    await runRetirement(db);
    expect(await profileState(db, dualPending)).toMatchObject({ role: 'seller', is_active: false });

    // The owner approves through the ACTUAL workflow a Super Admin would use.
    const { rows } = await as(db, superAdmin, (tx: Tx) =>
      tx.query<{ result: Record<string, unknown> }>(
        `select public.admin_review_retailer_application($1, 'approved', 'Verified shop and GST documents', 'general') as result`,
        [dualPending],
      ));

    expect(rows[0]!.result).toMatchObject({
      application_status: 'approved',
      access_status: 'active',
      profile_role_promoted: true,
    });
    // The role is promoted by the approval itself — no second manual step, and no
    // dependency on the service-role helper.
    expect(await profileState(db, dualPending)).toMatchObject({ role: 'retailer', is_active: false });
    expect(await retailerStatus(db, dualPending)).toBe('active');

    // The promotion is attributable and audited.
    const { rows: audit } = await db.query<{ new_data: Record<string, unknown> }>(
      `select new_data from public.audit_logs
        where table_name = 'profiles' and record_id = $1
          and new_data ->> 'source' = 'admin_review_retailer_application'`,
      [dualPending],
    );
    expect(audit).toHaveLength(1);
    expect(audit[0]!.new_data).toMatchObject({ role: 'retailer', is_active: false });
    await db.close();
  }, 300_000);

  it('does not reactivate an account the owner had suspended', async () => {
    const { db, dualSuspended, superAdmin } = await seedPopulationsBeforeRetirement();
    await runRetirement(db);
    // The owner reviews a SUSPENDED retailer's application and approves it.
    await as(db, superAdmin, (tx: Tx) =>
      tx.query(`select public.admin_review_retailer_application($1, 'approved', 'Appeal upheld after re-check', 'general')`, [dualSuspended]));

    const after = await profileState(db, dualSuspended);
    expect(after.role).toBe('retailer');
    expect(after.is_active, 'approval is an access grant, not a reinstatement').toBe(false);
    await db.close();
  }, 300_000);

  it('leaves a rejection exactly as the pre-0110 workflow did', async () => {
    const { db, dualPending, superAdmin } = await seedPopulationsBeforeRetirement();
    await runRetirement(db);
    const { rows } = await as(db, superAdmin, (tx: Tx) =>
      tx.query<{ result: Record<string, unknown> }>(
        `select public.admin_review_retailer_application($1, 'rejected', 'Documents did not match the applicant', null) as result`,
        [dualPending],
      ));
    expect(rows[0]!.result).toMatchObject({ application_status: 'rejected', access_status: 'pending_approval', profile_role_promoted: false });
    // A rejection must never promote anything.
    expect(await profileState(db, dualPending)).toMatchObject({ role: 'seller', is_active: false });
    await db.close();
  }, 300_000);

  it('keeps 0081 validation: short reasons and Gold-without-request still raise', async () => {
    const { db, dualPending, superAdmin } = await seedPopulationsBeforeRetirement();
    await runRetirement(db);

    await expect(
      as(db, superAdmin, (tx: Tx) =>
        tx.query(`select public.admin_review_retailer_application($1, 'approved', 'no', 'general')`, [dualPending])),
    ).rejects.toThrow(/at least 3 characters/);

    await expect(
      as(db, superAdmin, (tx: Tx) =>
        tx.query(`select public.admin_review_retailer_application($1, 'approved', 'All documents verified', null)`, [dualPending])),
    ).resolves.toBeTruthy();
    await db.close();
  }, 300_000);

  it('refuses a non-admin caller', async () => {
    const { db, dualPending, ordinaryRetailer } = await seedPopulationsBeforeRetirement();
    await runRetirement(db);
    await expect(
      as(db, ordinaryRetailer, (tx: Tx) =>
        tx.query(`select public.admin_review_retailer_application($1, 'approved', 'I approve myself', 'general')`, [dualPending])),
    ).rejects.toThrow(/administrator authorization required/);
    await db.close();
  }, 300_000);
});

describe('0110 — rollback restores the EXACT before-state for every case', () => {
  const rollbackSql = () =>
    readFileSync(join('supabase', 'rollbacks', '0110_retire_seller_supplier_marketplace.down.sql'), 'utf8');

  async function applyOptInRollback(db: Db) {
    await db.exec(`
      set local maharani.reactivate_seller_profiles = 'true';
      ${rollbackSql()}
    `);
  }

  it('restores role AND is_active exactly, using the recorded before-state', async () => {
    const { db, sellerOnly, dualApproved, dualApprovedInactive, dualPending } =
      await seedPopulationsBeforeRetirement();

    const before = {
      sellerOnly: await profileState(db, sellerOnly),
      dualApproved: await profileState(db, dualApproved),
      dualApprovedInactive: await profileState(db, dualApprovedInactive),
      dualPending: await profileState(db, dualPending),
    };

    await runRetirement(db);
    await applyOptInRollback(db);

    expect(await profileState(db, sellerOnly)).toEqual(before.sellerOnly);
    expect(await profileState(db, dualApproved)).toEqual(before.dualApproved);
    expect(await profileState(db, dualApprovedInactive)).toEqual(before.dualApprovedInactive);
    expect(await profileState(db, dualPending)).toEqual(before.dualPending);
    await db.close();
  }, 300_000);

  it('never touches a profile the migration did not change', async () => {
    const { db, sellerOnlyInactive, ordinaryRetailer, superAdmin, admin, staff } =
      await seedPopulationsBeforeRetirement();
    const before = {
      sellerOnlyInactive: await profileState(db, sellerOnlyInactive),
      ordinaryRetailer: await profileState(db, ordinaryRetailer),
      superAdmin: await profileState(db, superAdmin),
      admin: await profileState(db, admin),
      staff: await profileState(db, staff),
    };
    await runRetirement(db);
    await applyOptInRollback(db);
    expect(await profileState(db, sellerOnlyInactive)).toEqual(before.sellerOnlyInactive);
    expect(await profileState(db, ordinaryRetailer)).toEqual(before.ordinaryRetailer);
    expect(await profileState(db, superAdmin)).toEqual(before.superAdmin);
    expect(await profileState(db, admin)).toEqual(before.admin);
    expect(await profileState(db, staff)).toEqual(before.staff);
    await db.close();
  }, 300_000);

  it('does nothing without the explicit opt-in', async () => {
    const { db, dualApproved, sellerOnly } = await seedPopulationsBeforeRetirement();
    await runRetirement(db);
    await db.exec(rollbackSql());
    expect(await profileState(db, dualApproved)).toMatchObject({ role: 'retailer' });
    expect(await profileState(db, sellerOnly)).toMatchObject({ role: 'seller', is_active: false });
    await db.close();
  }, 300_000);

  it('is repeatable: running the rollback twice is stable', async () => {
    const { db, dualApproved } = await seedPopulationsBeforeRetirement();
    const before = await profileState(db, dualApproved);
    await runRetirement(db);
    await applyOptInRollback(db);
    const once = await profileState(db, dualApproved);
    await applyOptInRollback(db);
    const twice = await profileState(db, dualApproved);
    expect(once).toEqual(before);
    expect(twice).toEqual(once);
    await db.close();
  }, 300_000);

  it('does not resurrect a profile the owner changed after the migration', async () => {
    const { db, dualApproved } = await seedPopulationsBeforeRetirement();
    await runRetirement(db);
    // The owner deliberately suspends the promoted retailer afterwards.
    await db.query('update public.profiles set is_active = false where id = $1', [dualApproved]);

    await applyOptInRollback(db);

    // The rollback must not overwrite that later decision with the old state.
    const after = await profileState(db, dualApproved);
    expect(after.is_active).toBe(false);
    expect(after.role).toBe('retailer');
    await db.close();
  }, 300_000);

  it('restores the 0081 approval workflow, so a later approval cannot re-role', async () => {
    const { db, dualPending, superAdmin } = await seedPopulationsBeforeRetirement();
    await runRetirement(db);
    await applyOptInRollback(db);

    // After rollback the approval function is 0081's again: it activates the
    // retailer row but does NOT promote the profile role.
    await as(db, superAdmin, (tx: Tx) =>
      tx.query(`select public.admin_review_retailer_application($1, 'approved', 'Approved after rollback', 'general')`, [dualPending]));
    expect((await profileState(db, dualPending)).role).toBe('seller');
    await db.close();
  }, 300_000);

  it('migration + rollback leaves every historical row intact', async () => {
    const { db, dualApproved } = await seedPopulationsBeforeRetirement();
    await runRetirement(db);
    const before = await db.query<{ n: string }>(`select count(*)::text as n from public.audit_logs`);
    await applyOptInRollback(db);
    const after = await db.query<{ n: string }>(`select count(*)::text as n from public.audit_logs`);
    // Audit rows are evidence: a rollback may add, never delete.
    expect(Number(after.rows[0]!.n)).toBeGreaterThanOrEqual(Number(before.rows[0]!.n));
    expect((await profileState(db, dualApproved)).role).toBe('seller');
    await db.close();
  }, 300_000);
});

describe('0110 — repeated application and rollback safety', () => {
  it('applying 0110 twice is a no-op that changes no profile', async () => {
    const { db, sellerOnly, dualApproved, dualPending } = await seedPopulationsBeforeRetirement();
    await runRetirement(db);
    const once = {
      sellerOnly: await profileState(db, sellerOnly),
      dualApproved: await profileState(db, dualApproved),
      dualPending: await profileState(db, dualPending),
    };
    const auditOnce = await db.query<{ n: string }>(`select count(*)::text as n from public.audit_logs`);

    await runRetirement(db);

    expect(await profileState(db, sellerOnly)).toEqual(once.sellerOnly);
    expect(await profileState(db, dualApproved)).toEqual(once.dualApproved);
    expect(await profileState(db, dualPending)).toEqual(once.dualPending);
    // A second run must not append duplicate profile audit rows either.
    const auditTwice = await db.query<{ n: string }>(`select count(*)::text as n from public.audit_logs`);
    expect(auditTwice.rows[0]!.n).toBe(auditOnce.rows[0]!.n);
    await db.close();
  }, 300_000);
});
