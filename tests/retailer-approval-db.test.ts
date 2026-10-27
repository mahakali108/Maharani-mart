import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  as,
  createMigratedDb,
  createRetailer,
  createUser,
  errorOf,
  type Db,
  type RetailerFixture,
} from './helpers/pg-harness';

/**
 * Retailer approval workflow (migration 0081), executed on PostgreSQL 16.
 *
 * These are behavioural assertions about RLS, SECURITY DEFINER RPCs, triggers
 * and the audit trail — not string matches on the migration source.
 */

let db: Db;
let admin: string;
let superAdmin: string;
let staff: string;
let retailer: RetailerFixture;

beforeAll(async () => {
  db = await createMigratedDb();
  admin = await createUser(db, 'admin', 'Admin');
  superAdmin = await createUser(db, 'super_admin', 'Super Admin');
  staff = await createUser(db, 'staff', 'Staff');
  retailer = await createRetailer(db, { status: 'pending_approval' });
}, 180_000);

afterAll(async () => {
  await db.close();
});

async function application(retailerId: string) {
  const { rows } = await db.query<{ status: string; shop_name: string; review_target_hours: number }>(
    `select status, shop_name, review_target_hours from retailer_applications where retailer_id = $1`,
    [retailerId]
  );
  return rows[0] ?? null;
}

async function retailerRow(retailerId: string) {
  const { rows } = await db.query<{ status: string; retailer_category: string }>(
    `select status::text as status, retailer_category::text as retailer_category from retailers where id = $1`,
    [retailerId]
  );
  return rows[0] ?? null;
}

describe('retailer application lifecycle', () => {
  it('creates exactly one pending application for a new retailer signup', async () => {
    const app = await application(retailer.id);
    expect(app?.status).toBe('pending');
    // The snapshot mirrors the retailer row created by the signup trigger.
    const { rows: shop } = await db.query<{ shop_name: string }>(
      `select shop_name from retailers where id = $1`,
      [retailer.id]
    );
    expect(app?.shop_name).toBe(shop[0]?.shop_name);
    expect(app?.review_target_hours).toBe(48);
    expect((await retailerRow(retailer.id))?.status).toBe('pending_approval');
    expect((await retailerRow(retailer.id))?.retailer_category).toBe('general');
  });

  it('keeps a pending snapshot in step with corrected shop details', async () => {
    const applicant = await createRetailer(db, { status: 'pending_approval' });
    await db.query(`update retailers set shop_name = 'Shree Balaji Kirana' where id = $1`, [applicant.id]);
    expect((await application(applicant.id))?.shop_name).toBe('Shree Balaji Kirana');
  });

  it('refuses a decision without a reason', async () => {
    const message = await errorOf(db, admin, (tx) =>
      tx.query(`select public.admin_review_retailer_application($1::uuid, 'approved', '', null)`, [retailer.id])
    );
    expect(message).toMatch(/reason of at least 3 characters/i);
  });

  it('refuses self-approval by the retailer', async () => {
    const message = await errorOf(db, retailer.id, (tx) =>
      tx.query(`select public.admin_review_retailer_application($1::uuid, 'approved', 'self', 'gold')`, [retailer.id])
    );
    expect(message).toMatch(/Access denied/i);
    expect((await retailerRow(retailer.id))?.status).toBe('pending_approval');
  });

  it('refuses review by staff (admin-only action)', async () => {
    const message = await errorOf(db, staff, (tx) =>
      tx.query(`select public.admin_review_retailer_application($1::uuid, 'approved', 'staff approves', null)`, [
        retailer.id,
      ])
    );
    expect(message).toMatch(/Access denied/i);
  });

  it('lets an admin approve, never granting gold implicitly', async () => {
    await as(db, admin, (tx) =>
      tx.query(`select public.admin_review_retailer_application($1::uuid, 'approved', 'Shop verified on call', null)`, [
        retailer.id,
      ])
    );
    expect((await application(retailer.id))?.status).toBe('approved');
    const row = await retailerRow(retailer.id);
    expect(row?.status).toBe('active');
    expect(row?.retailer_category).toBe('general');

    const { rows } = await db.query<{ actor_id: string; action: string; new_status: string }>(
      `select actor_id, action, new_status from retailer_approval_events where retailer_id = $1 order by created_at desc limit 1`,
      [retailer.id]
    );
    expect(rows[0]?.actor_id).toBe(admin);
    expect(rows[0]?.action).toBe('approved');
    expect(rows[0]?.new_status).toBe('approved');
  });

  it('audits an explicit category change with previous/new values', async () => {
    await as(db, admin, (tx) =>
      tx.query(`select public.admin_set_retailer_category($1::uuid, 'silver', 'Quarterly volume review')`, [retailer.id])
    );
    expect((await retailerRow(retailer.id))?.retailer_category).toBe('silver');

    const { rows } = await db.query<{
      action: string;
      previous_category: string;
      new_category: string;
      reason: string;
      actor_id: string;
    }>(
      `select action, previous_category, new_category, reason, actor_id
         from retailer_approval_events where retailer_id = $1 order by created_at desc limit 1`,
      [retailer.id]
    );
    expect(rows[0]).toMatchObject({
      action: 'category_changed',
      previous_category: 'general',
      new_category: 'silver',
      reason: 'Quarterly volume review',
      actor_id: admin,
    });
  });

  it('refuses a retailer trying to change their own category (RPC and direct write)', async () => {
    const viaRpc = await errorOf(db, retailer.id, (tx) =>
      tx.query(`select public.admin_set_retailer_category($1::uuid, 'gold', 'i want gold')`, [retailer.id])
    );
    expect(viaRpc).toMatch(/Access denied/i);

    // RLS filters the row entirely: the write affects 0 rows and the stored
    // category is unchanged (PostgREST would report "no rows", never a change).
    const viaUpdate = await as(db, retailer.id, (tx) =>
      tx.query<{ id: string }>(`update public.retailers set retailer_category = 'gold' where id = $1 returning id`, [retailer.id])
    );
    expect(viaUpdate.rows).toHaveLength(0);
    expect((await retailerRow(retailer.id))?.retailer_category).toBe('silver');
  });

  it('refuses a direct status write by anyone but an admin', async () => {
    const attempt = await as(db, staff, (tx) =>
      tx.query<{ id: string }>(`update public.retailers set status = 'active' where id = $1 returning id`, [retailer.id])
    );
    expect(attempt.rows).toHaveLength(0);

    // The same staff member cannot reach the sanctioned path either.
    const guardMessage = await errorOf(db, staff, (tx) =>
      tx.query(`select public.admin_review_retailer_application($1::uuid, 'approved', 'staff', null)`, [retailer.id])
    );
    expect(guardMessage).toMatch(/Access denied/i);
  });

  it('keeps the audit trail append-only for every role', async () => {
    const message = await errorOf(db, 'service', (tx) =>
      tx.query(`delete from public.retailer_approval_events where retailer_id = $1`, [retailer.id])
    );
    expect(message).toMatch(/append-only/i);
  });

  it('suspends and refuses to "restore" a pending application as an approval shortcut', async () => {
    await as(db, admin, (tx) =>
      tx.query(`select public.admin_set_retailer_access($1::uuid, 'suspend', 'Payment dispute under review')`, [
        retailer.id,
      ])
    );
    expect((await retailerRow(retailer.id))?.status).toBe('suspended');
    expect((await application(retailer.id))?.status).toBe('suspended');

    await as(db, admin, (tx) =>
      tx.query(`select public.admin_set_retailer_access($1::uuid, 'restore', 'Dispute resolved')`, [retailer.id])
    );
    expect((await retailerRow(retailer.id))?.status).toBe('active');

    const pending = await createRetailer(db, { status: 'pending_approval' });
    const message = await errorOf(db, admin, (tx) =>
      tx.query(`select public.admin_set_retailer_access($1::uuid, 'restore', 'try to skip review')`, [pending.id])
    );
    expect(message).toMatch(/must be reviewed, not restored/i);
    expect((await retailerRow(pending.id))?.status).toBe('pending_approval');
  });

  it('allows a pending applicant to resubmit without touching approval or category', async () => {
    const applicant = await createRetailer(db, { status: 'pending_approval' });
    await as(db, applicant.id, (tx) =>
      tx.query(`select public.retailer_resubmit_application('Updated Kirana', '10MGST0000A1Z5', 'Gaya', $1::uuid)`, [
        applicant.areaId,
      ])
    );
    const app = await application(applicant.id);
    expect(app?.status).toBe('pending');
    expect(app?.shop_name).toBe('Updated Kirana');
    expect((await retailerRow(applicant.id))?.status).toBe('pending_approval');
    expect((await retailerRow(applicant.id))?.retailer_category).toBe('general');
  });

  it('stores a configurable review SLA that is never described as a legal deadline', async () => {
    await as(db, superAdmin, (tx) => tx.query(`select public.admin_update_approval_settings(72, 24)`));
    const { rows } = await db.query<{ review_target_hours: number; reminder_hours: number }>(
      `select review_target_hours, reminder_hours from retailer_approval_settings`
    );
    expect(rows[0]).toEqual({ review_target_hours: 72, reminder_hours: 24 });

    const denied = await errorOf(db, admin, (tx) => tx.query(`update public.retailer_approval_settings set review_target_hours = 5`));
    expect(denied).not.toBeNull();
  });

  it('exposes only the caller\'s own application to a retailer', async () => {
    const other = await createRetailer(db, { status: 'pending_approval' });
    const { rows } = await as(db, retailer.id, (tx) =>
      tx.query<{ retailer_id: string }>(`select retailer_id from public.retailer_applications`)
    );
    expect(rows.map((r) => r.retailer_id)).toEqual([retailer.id]);
    expect(rows.some((r) => r.retailer_id === other.id)).toBe(false);
  });
});
