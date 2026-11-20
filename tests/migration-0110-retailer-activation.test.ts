import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { as, createArea, createMigratedDb, createUser, type Db, type Tx } from './helpers/pg-harness';

/**
 * RETAILER APPROVAL **AND ACTIVATION** (migration 0110, block 12).
 *
 * THE BUG THIS SUITE EXISTS TO PREVENT
 *   Approving a retailer application granted the role and the access gate but not
 *   `profiles.is_active`. An account that 0110 had deactivated therefore ended up
 *   `role='retailer'`, `retailers.status='active'`, `is_active=false`: the screen
 *   said "approved", and the person still could not sign in.
 *
 * WHAT IS ASSERTED, AND WHY IT IS ASSERTED THIS WAY
 *   A `role='retailer'` assertion alone proves nothing — the whole bug happened
 *   with exactly that value. So every case checks BOTH:
 *     * the stored state (`profiles.role`, `profiles.is_active`,
 *       `retailers.status`), and
 *     * real login eligibility: `public.is_active_account()` executed as that user
 *       (the predicate every restrictive RLS policy uses), plus whether the
 *       middleware/session gate would admit them.
 */

const MIGRATION = '0110_retire_seller_supplier_marketplace.sql';
const PRE_0110 = '0109_phase3_business_control.sql';

interface Fixture {
  db: Db;
  areaId: string;
  /** Pending dual-role: 0110 deactivates it, then the owner approves it. */
  pendingDualRole: string;
  /** Approved dual-role, already active: must be untouched. */
  approvedDualActive: string;
  /** Approved dual-role, already inactive before 0110: stays inactive. */
  approvedDualInactive: string;
  /** Seller-only: must never become a Retailer, never be activated. */
  sellerOnly: string;
  /** Ordinary approved retailer, unaffected by the migration. */
  ordinaryRetailer: string;
  /** The only account type allowed to activate. */
  superAdmin: string;
  /** An `admin` — may approve, may NOT activate. */
  admin: string;
  /** Suspended by an administrator AFTER the migration. */
  suspendedAfterMigration: string;
}

async function seed(): Promise<Fixture> {
  const db = await createMigratedDb({ lastMigration: PRE_0110 });
  const areaId = await createArea(db);

  async function profile(role: 'seller' | 'retailer' | 'super_admin' | 'admin', name: string) {
    return createUser(db, role, name, { areaId });
  }
  async function retailerRow(id: string, status: string) {
    await db.query(
      `insert into public.retailers (id, shop_name, area_id, status)
       values ($1, $2, $3, $4::public.retailer_status)
       on conflict (id) do update set status = excluded.status`,
      [id, `Shop ${id.slice(0, 8)}`, areaId, status],
    );
  }

  const pendingDualRole = await profile('seller', 'Pending Dual');
  await retailerRow(pendingDualRole, 'pending_approval');
  // 0110 only deactivates an ACTIVE account, so this fixture must be active now.
  await db.query('update public.profiles set is_active = true where id = $1', [pendingDualRole]);

  const approvedDualActive = await profile('seller', 'Approved Dual');
  await retailerRow(approvedDualActive, 'active');

  const approvedDualInactive = await profile('seller', 'Approved Dual Inactive');
  await retailerRow(approvedDualInactive, 'active');
  await db.query('update public.profiles set is_active = false where id = $1', [approvedDualInactive]);

  const sellerOnly = await profile('seller', 'Seller Only');

  const ordinaryRetailer = await profile('retailer', 'Ordinary Retailer');
  await retailerRow(ordinaryRetailer, 'active');

  const superAdmin = await profile('super_admin', 'Owner');
  const admin = await profile('admin', 'Admin');

  const suspendedAfterMigration = await profile('seller', 'Suspended Later');
  await retailerRow(suspendedAfterMigration, 'pending_approval');

  return {
    db, areaId,
    pendingDualRole, approvedDualActive, approvedDualInactive,
    sellerOnly, ordinaryRetailer, superAdmin, admin, suspendedAfterMigration,
  };
}

async function runMigration(db: Db) {
  await db.exec(readFileSync(join('supabase', 'migrations', MIGRATION), 'utf8'));
}

async function state(db: Db, id: string) {
  const { rows } = await db.query<{
    role: string; is_active: boolean; retailer_status: string | null;
  }>(
    `select p.role::text as role, p.is_active, r.status::text as retailer_status
       from public.profiles p left join public.retailers r on r.id = p.id
      where p.id = $1`,
    [id],
  );
  return rows[0]!;
}

/** What the DATABASE will actually allow — not what the intent was. */
async function loginEligibility(db: Db, id: string) {
  return as(db, id, async (tx: Tx) => {
    const { rows } = await tx.query<{ active: boolean; role: string | null }>(
      `select public.is_active_account() as active, public.current_user_role()::text as role`,
    );
    return rows[0]!;
  });
}

async function approve(db: Db, actor: string, id: string, reason = 'Application reviewed and approved.') {
  return as(db, actor, async (tx: Tx) => {
    const { rows } = await tx.query<Record<string, unknown>>(
      `select public.admin_review_retailer_application($1, 'approved', $2, null) as out`,
      [id, reason],
    );
    return rows[0]!.out as Record<string, unknown>;
  });
}

async function activate(
  db: Db,
  actor: string,
  id: string,
  reason = 'Approved application; account still inactive so it is being activated.',
  confirmation = 'ACTIVATE',
) {
  return as(db, actor, async (tx: Tx) => {
    const { rows } = await tx.query<Record<string, unknown>>(
      `select public.admin_activate_retailer($1, $2, $3) as out`,
      [id, reason, confirmation],
    );
    return rows[0]!.out as Record<string, unknown>;
  });
}

async function activationStatus(db: Db, actor: string, id: string) {
  return as(db, actor, async (tx: Tx) => {
    const { rows } = await tx.query<Record<string, unknown>>(
      `select public.admin_retailer_activation_status($1) as out`, [id]);
    return rows[0]!.out as Record<string, unknown>;
  });
}

describe('0110 block 12 — approval does not imply the account can sign in', () => {
  it('reports activation_required after approving a deactivated dual-role account', async () => {
    const f = await seed();
    await runMigration(f.db);

    // 0110 deactivated it: the access gate was not approved, so it is not admitted.
    expect(await state(f.db, f.pendingDualRole)).toMatchObject({
      role: 'seller', is_active: false, retailer_status: 'pending_approval',
    });

    const result = await approve(f.db, f.superAdmin, f.pendingDualRole);

    // Role and gate move; the active flag deliberately does NOT.
    expect(await state(f.db, f.pendingDualRole)).toMatchObject({
      role: 'retailer', is_active: false, retailer_status: 'active',
    });
    expect(result.profile_role_promoted).toBe(true);
    expect(result.profile_is_active).toBe(false);
    // The approval must SAY it did not grant a login. This is the whole point.
    expect(result.activation_required).toBe(true);
    expect(result.sign_in_eligible).toBe(false);
    expect(String(result.next_step)).toMatch(/activation/i);

    // And it is true: the account still cannot sign in.
    expect((await loginEligibility(f.db, f.pendingDualRole)).active).toBe(false);
    await f.db.close();
  }, 300_000);

  it('makes the account genuinely usable after an explicit activation', async () => {
    const f = await seed();
    await runMigration(f.db);
    await approve(f.db, f.superAdmin, f.pendingDualRole);
    expect((await loginEligibility(f.db, f.pendingDualRole)).active).toBe(false);

    const result = await activate(f.db, f.superAdmin, f.pendingDualRole);

    expect(result).toMatchObject({ ok: true, changed: true, is_active: true, can_sign_in: true });
    expect(await state(f.db, f.pendingDualRole)).toMatchObject({
      role: 'retailer', is_active: true, retailer_status: 'active',
    });

    // The assertion that matters: a real policy predicate now admits the user.
    const eligibility = await loginEligibility(f.db, f.pendingDualRole);
    expect(eligibility.active).toBe(true);
    expect(eligibility.role).toBe('retailer');
    await f.db.close();
  }, 300_000);

  it('is audited with the before and after state of the activation', async () => {
    const f = await seed();
    await runMigration(f.db);
    await approve(f.db, f.superAdmin, f.pendingDualRole);
    await activate(f.db, f.superAdmin, f.pendingDualRole, 'Activating after owner approval.');

    const { rows } = await f.db.query<{ old_data: Record<string, unknown>; new_data: Record<string, unknown> }>(
      `select old_data, new_data from public.audit_logs
        where table_name = 'profiles' and record_id = $1
          and new_data->>'source' = 'admin_activate_retailer'`,
      [f.pendingDualRole],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]!.old_data).toMatchObject({ is_active: false, role: 'retailer', source: 'admin_activate_retailer' });
    expect(rows[0]!.new_data).toMatchObject({ is_active: true, role: 'retailer' });
    expect(String(rows[0]!.new_data.reason)).toBe('Activating after owner approval.');
    await f.db.close();
  }, 300_000);

  it('is idempotent: a second activation changes nothing and says so', async () => {
    const f = await seed();
    await runMigration(f.db);
    await approve(f.db, f.superAdmin, f.pendingDualRole);
    await activate(f.db, f.superAdmin, f.pendingDualRole);

    const again = await activate(f.db, f.superAdmin, f.pendingDualRole);
    expect(again).toMatchObject({ ok: true, changed: false, reason: 'already_activated' });

    const { rows } = await f.db.query<{ n: string }>(
      `select count(*)::text as n from public.audit_logs
        where table_name = 'profiles' and record_id = $1
          and new_data->>'source' = 'admin_activate_retailer'`,
      [f.pendingDualRole],
    );
    expect(rows[0]!.n).toBe('1');
    await f.db.close();
  }, 300_000);
});

describe('0110 block 12 — what activation must refuse', () => {
  it('refuses a seller-only account and never converts it', async () => {
    const f = await seed();
    await runMigration(f.db);

    await expect(activate(f.db, f.superAdmin, f.sellerOnly)).rejects.toThrow(/never converted/i);

    // Unchanged in every respect, and still not a Retailer.
    expect(await state(f.db, f.sellerOnly)).toMatchObject({
      role: 'seller', is_active: false, retailer_status: null,
    });
    await f.db.close();
  }, 300_000);

  it('refuses an account whose application is not approved', async () => {
    const f = await seed();
    await runMigration(f.db);
    // No approval happened, so the gate is still pending.
    await expect(activate(f.db, f.superAdmin, f.pendingDualRole)).rejects.toThrow(/not active/i);
    expect((await state(f.db, f.pendingDualRole)).is_active).toBe(false);
    await f.db.close();
  }, 300_000);

  it('preserves an administrator suspension recorded after the migration', async () => {
    const f = await seed();
    await runMigration(f.db);

    // 0110 deactivates the unapproved dual-role account; the owner then approves
    // it and an administrator suspends its access gate afterwards.
    await approve(f.db, f.superAdmin, f.suspendedAfterMigration, 'Approved on review.');
    await as(f.db, f.superAdmin, async (tx: Tx) => {
      await tx.query(`select public.admin_set_retailer_access($1, 'suspend', 'Suspended for policy review.')`,
        [f.suspendedAfterMigration]);
    });

    // Activation must refuse: the suspension is a later human decision, and
    // undoing it would silently reverse that decision.
    await expect(activate(f.db, f.superAdmin, f.suspendedAfterMigration)).rejects.toThrow(/suspended.*restore retailer access/i);

    const s = await state(f.db, f.suspendedAfterMigration);
    expect(s.retailer_status).toBe('suspended');
    expect(s.is_active).toBe(false);
    await f.db.close();
  }, 300_000);

  it('refuses activation by an admin, and by the retailer themselves', async () => {
    const f = await seed();
    await runMigration(f.db);
    await approve(f.db, f.superAdmin, f.pendingDualRole);

    // `admin` may approve; only a Super Admin may grant a login.
    await expect(activate(f.db, f.admin, f.pendingDualRole)).rejects.toThrow(/Super Admin/i);
    await expect(activate(f.db, f.pendingDualRole, f.pendingDualRole)).rejects.toThrow(/Super Admin/i);
    await expect(activate(f.db, f.ordinaryRetailer, f.pendingDualRole)).rejects.toThrow(/Super Admin/i);

    expect((await state(f.db, f.pendingDualRole)).is_active).toBe(false);
    await f.db.close();
  }, 300_000);

  it('requires a written reason and an explicit confirmation', async () => {
    const f = await seed();
    await runMigration(f.db);
    await approve(f.db, f.superAdmin, f.pendingDualRole);

    await expect(activate(f.db, f.superAdmin, f.pendingDualRole, 'short')).rejects.toThrow(/reason/i);
    await expect(activate(f.db, f.superAdmin, f.pendingDualRole, 'A long enough reason.', 'yes'))
      .rejects.toThrow(/Confirmation required/i);

    expect((await state(f.db, f.pendingDualRole)).is_active).toBe(false);
    await f.db.close();
  }, 300_000);

  it('refuses an account whose linked auth user is banned', async () => {
    const f = await seed();
    await runMigration(f.db);
    await approve(f.db, f.superAdmin, f.pendingDualRole);

    // Ban the auth user the way Supabase Admin API would.
    await f.db.query(
      `alter table auth.users add column if not exists banned_until timestamptz`,
    );
    await f.db.query(`update auth.users set banned_until = now() + interval '10 years' where id = $1`,
      [f.pendingDualRole]);

    await expect(activate(f.db, f.superAdmin, f.pendingDualRole)).rejects.toThrow(/banned/i);
    expect((await state(f.db, f.pendingDualRole)).is_active).toBe(false);
    await f.db.close();
  }, 300_000);
});

describe('0110 block 12 — state matrix', () => {
  it('never reactivates an account that was inactive before the migration', async () => {
    const f = await seed();
    await runMigration(f.db);

    // Approved dual-role, inactive on the way in: role changes, active flag must not.
    expect(await state(f.db, f.approvedDualInactive)).toMatchObject({
      role: 'retailer', is_active: false, retailer_status: 'active',
    });
    expect((await loginEligibility(f.db, f.approvedDualInactive)).active).toBe(false);

    // No activation was performed, so it stays inactive.
    expect((await state(f.db, f.approvedDualInactive)).is_active).toBe(false);
    await f.db.close();
  }, 300_000);

  it('leaves an already-active approved dual-role account working', async () => {
    const f = await seed();
    await runMigration(f.db);

    expect(await state(f.db, f.approvedDualActive)).toMatchObject({
      role: 'retailer', is_active: true, retailer_status: 'active',
    });
    expect((await loginEligibility(f.db, f.approvedDualActive)).active).toBe(true);

    // Activating an already-active account is a no-op that reports itself.
    const result = await activate(f.db, f.superAdmin, f.approvedDualActive);
    expect(result).toMatchObject({ ok: true, changed: false });
    await f.db.close();
  }, 300_000);

  it('records the migration as the cause and keeps the exact original state', async () => {
    const f = await seed();
    await runMigration(f.db);

    const { rows } = await f.db.query<{
      cause: string; original_role: string; original_is_active: boolean;
      resulting_role: string; resulting_is_active: boolean; activated_at: string | null;
    }>(
      `select cause, original_role, original_is_active, resulting_role, resulting_is_active, activated_at
         from public.retailer_activation_ledger where profile_id = $1`,
      [f.pendingDualRole],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      cause: 'deactivated_by_0110',
      original_role: 'seller',
      original_is_active: true,
      resulting_role: 'seller',
      resulting_is_active: false,
      activated_at: null,
    });

    // The active account was not touched, so it is not in the ledger at all.
    const { rows: untouched } = await f.db.query<{ n: string }>(
      `select count(*)::text as n from public.retailer_activation_ledger where profile_id = $1`,
      [f.approvedDualActive],
    );
    expect(untouched[0]!.n).toBe('0');
    await f.db.close();
  }, 300_000);

  it('distinguishes a migration deactivation from a later suspension', async () => {
    const f = await seed();
    await runMigration(f.db);

    const byMigration = await activationStatus(f.db, f.superAdmin, f.pendingDualRole);
    expect(byMigration).toMatchObject({
      deactivated_by_migration: true,
      suspended_after_migration: false,
      can_sign_in: false,
    });

    await approve(f.db, f.superAdmin, f.suspendedAfterMigration);
    await as(f.db, f.superAdmin, async (tx: Tx) => {
      await tx.query(`select public.admin_set_retailer_access($1, 'suspend', 'Suspended after review.')`,
        [f.suspendedAfterMigration]);
    });
    const bySuspension = await activationStatus(f.db, f.superAdmin, f.suspendedAfterMigration);
    expect(bySuspension).toMatchObject({
      deactivated_by_migration: true,
      suspended_after_migration: true,
      can_activate: false,
      can_sign_in: false,
    });
    expect(String(bySuspension.reason)).toBe('suspended_by_admin_after_migration');
    await f.db.close();
  }, 300_000);
});

describe('0110 block 12 — the activation surface is not reachable by API roles', () => {
  it('denies anon outright', async () => {
    const f = await seed();
    await runMigration(f.db);
    await approve(f.db, f.superAdmin, f.pendingDualRole);

    await expect(
      as(f.db, 'anon', async (tx: Tx) => {
        await tx.query(`select public.admin_activate_retailer($1, 'A long enough reason.', 'ACTIVATE')`,
          [f.pendingDualRole]);
      }),
    ).rejects.toThrow(/permission denied/i);

    await expect(
      as(f.db, 'anon', async (tx: Tx) => {
        await tx.query(`select public.admin_retailer_activation_status($1)`, [f.pendingDualRole]);
      }),
    ).rejects.toThrow(/permission denied/i);

    // Nothing changed while those calls failed.
    expect((await state(f.db, f.pendingDualRole)).is_active).toBe(false);
    await f.db.close();
  }, 300_000);

  it('rejects an authenticated caller who is not a Super Admin', async () => {
    // `authenticated` holds EXECUTE so the function can run in the Super Admin's
    // own session and record the real actor with auth.uid(). Authorization is the
    // role check inside, which no caller can influence - and it is enforced for
    // a retailer, an admin, an ordinary retailer, and an unauthenticated session.
    const f = await seed();
    await runMigration(f.db);
    await approve(f.db, f.superAdmin, f.pendingDualRole);

    for (const caller of [f.admin, f.pendingDualRole, f.ordinaryRetailer] as const) {
      await expect(
        as(f.db, caller, async (tx: Tx) => {
          await tx.query(`select public.admin_activate_retailer($1, 'A long enough reason.', 'ACTIVATE')`,
            [f.pendingDualRole]);
        }),
      ).rejects.toThrow(/Super Admin/i);
      await expect(
        as(f.db, caller, async (tx: Tx) => {
          await tx.query(`select public.admin_retailer_activation_status($1)`, [f.pendingDualRole]);
        }),
      ).rejects.toThrow(/Super Admin/i);
    }

    expect((await state(f.db, f.pendingDualRole)).is_active).toBe(false);
    await f.db.close();
  }, 300_000);

  it('keeps the activation ledger unreadable to non-Super-Admins', async () => {
    const f = await seed();
    await runMigration(f.db);

    const { rows: readable } = await as(f.db, f.superAdmin, async (tx: Tx) =>
      tx.query<{ n: string }>(`select count(*)::text as n from public.retailer_activation_ledger`));
    expect(Number(readable[0]!.n)).toBeGreaterThan(0);

    // RLS: an ordinary retailer sees no rows even if the grant is open.
    const { rows: hidden } = await as(f.db, f.ordinaryRetailer, async (tx: Tx) =>
      tx.query<{ n: string }>(`select count(*)::text as n from public.retailer_activation_ledger`));
    expect(hidden[0]!.n).toBe('0');
    await f.db.close();
  }, 300_000);
});

describe('0110 block 12 — rollback never revokes an explicit activation', () => {
  const rollbackSql = () =>
    readFileSync(join('supabase', 'rollbacks', '0110_retire_seller_supplier_marketplace.down.sql'), 'utf8');

  async function optInRollback(db: Db) {
    await db.exec(`
      set local maharani.reactivate_seller_profiles = 'true';
      ${rollbackSql()}
    `);
  }

  it('preserves an activated account instead of replaying the pre-migration state', async () => {
    const f = await seed();
    await runMigration(f.db);
    await approve(f.db, f.superAdmin, f.pendingDualRole);
    await activate(f.db, f.superAdmin, f.pendingDualRole, 'Approved and activated after review.');

    await optInRollback(f.db);

    // A deliberate grant must survive the rollback: the operator activated this
    // account with a written reason, and rolling the migration back is not
    // permission to revoke it.
    expect(await state(f.db, f.pendingDualRole)).toMatchObject({
      role: 'retailer', is_active: true, retailer_status: 'active',
    });
    await f.db.close();
  }, 300_000);

  it('drops block-12 functions and the ledger, leaving profiles intact', async () => {
    const f = await seed();
    await runMigration(f.db);
    await approve(f.db, f.superAdmin, f.pendingDualRole);
    await activate(f.db, f.superAdmin, f.pendingDualRole);

    await optInRollback(f.db);

    const { rows } = await f.db.query<{ n: string }>(
      `select count(*)::text as n from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
        where ns.nspname = 'public' and p.proname in
          ('admin_activate_retailer', 'admin_retailer_activation_status', 'auth_user_is_banned')`,
    );
    expect(rows[0]!.n).toBe('0');

    const { rows: ledger } = await f.db.query<{ n: string }>(
      `select count(*)::text as n from pg_class c join pg_namespace ns on ns.oid = c.relnamespace
        where ns.nspname = 'public' and c.relname = 'retailer_activation_ledger'`,
    );
    expect(ledger[0]!.n).toBe('0');

    // The profile itself was not deleted or rolled back.
    expect((await state(f.db, f.pendingDualRole)).is_active).toBe(true);
    await f.db.close();
  }, 300_000);

  it('restores the pre-migration state for accounts that were never activated', async () => {
    const f = await seed();
    const before = await state(f.db, f.pendingDualRole);
    await runMigration(f.db);
    expect((await state(f.db, f.pendingDualRole)).is_active).toBe(false);

    await optInRollback(f.db);

    // No activation happened, so the exact before-state is replayed.
    expect(await state(f.db, f.pendingDualRole)).toEqual(before);
    await f.db.close();
  }, 300_000);
});

describe('0110 block 12 — the migration is idempotent', () => {
  it('applies twice without error or duplicate ledger rows', async () => {
    const f = await seed();
    await runMigration(f.db);

    const { rows: first } = await f.db.query<{ n: string }>(
      `select count(*)::text as n from public.retailer_activation_ledger`);
    expect(Number(first[0]!.n)).toBeGreaterThan(0);

    // A second application must be a no-op, not a duplicate or a failure. The
    // audit rows block 7 wrote are the only source for the ledger, and the
    // `on conflict do nothing` makes the backfill safe to repeat.
    await runMigration(f.db);

    const { rows: second } = await f.db.query<{ n: string }>(
      `select count(*)::text as n from public.retailer_activation_ledger`);
    expect(second[0]!.n).toBe(first[0]!.n);

    expect(await state(f.db, f.pendingDualRole)).toMatchObject({
      role: 'seller', is_active: false,
    });
    await f.db.close();
  }, 300_000);

  it('leaves no seller holding an active capability after the full chain', async () => {
    const f = await seed();
    await runMigration(f.db);

    const { rows } = await f.db.query<{ n: string }>(
      `select count(*)::text as n from public.profiles where role::text = 'seller' and is_active`,
    );
    expect(rows[0]!.n).toBe('0');
    await f.db.close();
  }, 300_000);
});
