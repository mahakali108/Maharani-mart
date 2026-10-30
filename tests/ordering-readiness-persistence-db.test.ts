import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { as, createMigratedDb, createRetailer, createUser, errorOf, type Db } from './helpers/pg-harness';

let db: Db;
let superAdminId: string;
let retailerId: string;
let adminId: string;
let sellerId: string;
let staffId: string;
let profilelessAuthenticatedId: string;

function approvals(validUntil = '2099-01-01T00:00:00.000Z') {
  return {
    businessIdentity: { status: 'approved', approvalReference: 'TEST-OWNER-001' },
    publicContacts: { status: 'approved', approvalReference: 'TEST-OWNER-002' },
    legalPolicies: { status: 'approved', approvalReference: 'TEST-OWNER-003' },
    gstInvoice: { status: 'approved', approvalReference: 'TEST-OWNER-004' },
    marketplaceTaxTcsSettlement: { status: 'approved', approvalReference: 'TEST-OWNER-005' },
    deliveryCodCancellationsRefunds: { status: 'approved', approvalReference: 'TEST-OWNER-006' },
    privacyReadiness: { status: 'approved', approvalReference: 'TEST-OWNER-007' },
    approvalValidityPolicy: {
      status: 'configured',
      validUntil,
      approvalReference: 'TEST-OWNER-POLICY-001',
    },
  };
}

async function record(actor: string, payload = approvals()) {
  return as(db, actor, (tx) => tx.query(
    `select public.record_ordering_launch_readiness($1::jsonb, $2::text)`,
    [JSON.stringify(payload), 'Test owner-recorded readiness review']
  ));
}

beforeAll(async () => {
  db = await createMigratedDb();
  superAdminId = await createUser(db, 'super_admin', 'Readiness Super Admin');
  retailerId = (await createRetailer(db)).id;
  adminId = await createUser(db, 'admin', 'Readiness Admin');
  sellerId = await createUser(db, 'seller', 'Readiness Seller');
  staffId = await createUser(db, 'staff', 'Readiness Staff');

  // Model a valid authenticated identity whose profile was removed by an
  // operational inconsistency. The production profiles.role column is NOT
  // NULL, so a missing profile row is the representable null-role equivalent.
  profilelessAuthenticatedId = await createUser(db, 'super_admin', 'Profileless Authenticated User');
  await db.query(`delete from profiles where id = $1`, [profilelessAuthenticatedId]);
}, 180_000);

afterAll(async () => {
  await db?.close();
});

describe('0085 ordering launch-readiness persistence', () => {
  it('permits only the authenticated Super Admin RPC and atomically records setting plus audit data', async () => {
    await record(superAdminId);

    const { rows: settingRows } = await db.query<{ value: Record<string, unknown>; updated_by: string }>(
      `select value, updated_by from platform_settings where key = 'ordering_launch_readiness'`
    );
    expect(settingRows).toHaveLength(1);
    const value = settingRows[0]!.value;
    expect(value.recordedBy).toBe(superAdminId);
    expect(value.recordedAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
    expect(value.schemaVersion).toBe(1);
    expect(value).not.toHaveProperty('clientActorId');
    expect(settingRows[0]!.updated_by).toBe(superAdminId);

    const { rows: auditRows } = await db.query<{ actor_id: string; after_data: Record<string, unknown> }>(
      `select actor_id, after_data from super_admin_audit_logs
       where action = 'SETTING_CHANGED' and after_data ->> 'schemaVersion' = '1'`
    );
    expect(auditRows).toHaveLength(1);
    expect(auditRows[0]!.actor_id).toBe(superAdminId);
    expect(auditRows[0]!.after_data.recordedBy).toBe(superAdminId);
  });

  it('rejects anonymous, non-Super-Admin, and authenticated profileless callers', async () => {
    const anonymous = await errorOf(db, 'anon', (tx) => tx.query(
      `select public.record_ordering_launch_readiness($1::jsonb, null)`,
      [JSON.stringify(approvals())]
    ));
    expect(anonymous).toMatch(/permission denied for function record_ordering_launch_readiness/);

    for (const [role, userId] of [
      ['retailer', retailerId],
      ['admin', adminId],
      ['seller', sellerId],
      ['staff', staffId],
      ['profileless authenticated user', profilelessAuthenticatedId],
    ]) {
      const denial = await errorOf(db, userId, (tx) => tx.query(
        `select public.record_ordering_launch_readiness($1::jsonb, null)`,
        [JSON.stringify(approvals())]
      ));
      expect(denial, role).toMatch(/Only an authenticated Super Admin/);
    }
  });

  it('blocks direct Super Admin INSERT, UPDATE, and DELETE of readiness while preserving unrelated setting CRUD', async () => {
    const directReadinessInsert = await errorOf(db, superAdminId, (tx) => tx.query(
      `insert into platform_settings (key, value) values ('ordering_launch_readiness', '{}'::jsonb)`
    ));
    expect(directReadinessInsert).toMatch(/row-level security|permission denied/i);

    // PostgreSQL RLS can deny UPDATE/DELETE by making the protected row affect
    // zero rows rather than by throwing. Assert both no returned row and no
    // changed/deleted readiness state.
    const directReadinessUpdate = await as(db, superAdminId, (tx) => tx.query<{ key: string }>(
      `update platform_settings
       set value = '{"tampered":true}'::jsonb
       where key = 'ordering_launch_readiness'
       returning key`
    ));
    expect(directReadinessUpdate.rows).toHaveLength(0);

    const directReadinessDelete = await as(db, superAdminId, (tx) => tx.query<{ key: string }>(
      `delete from platform_settings
       where key = 'ordering_launch_readiness'
       returning key`
    ));
    expect(directReadinessDelete.rows).toHaveLength(0);

    const { rows: readinessRows } = await db.query<{ value: Record<string, unknown> }>(
      `select value from platform_settings where key = 'ordering_launch_readiness'`
    );
    expect(readinessRows).toHaveLength(1);
    expect(readinessRows[0]!.value.schemaVersion).toBe(1);

    await as(db, superAdminId, (tx) => tx.query(
      `insert into platform_settings (key, value) values ('unrelated_test_setting', '{"enabled":true}'::jsonb)`
    ));
    const unrelatedUpdate = await as(db, superAdminId, (tx) => tx.query<{ value: { enabled: boolean } }>(
      `update platform_settings
       set value = '{"enabled":false}'::jsonb
       where key = 'unrelated_test_setting'
       returning value`
    ));
    expect(unrelatedUpdate.rows).toEqual([{ value: { enabled: false } }]);

    const unrelatedDelete = await as(db, superAdminId, (tx) => tx.query<{ key: string }>(
      `delete from platform_settings
       where key = 'unrelated_test_setting'
       returning key`
    ));
    expect(unrelatedDelete.rows).toEqual([{ key: 'unrelated_test_setting' }]);
  });

  it('rolls back a readiness update when the audit insertion fails', async () => {
    const { rows: beforeRows } = await db.query<{ value: Record<string, unknown> }>(
      `select value from platform_settings where key = 'ordering_launch_readiness'`
    );
    const before = beforeRows[0]!.value;

    await db.exec(`
      create function public.test_fail_ordering_readiness_audit() returns trigger
      language plpgsql as $$
      begin
        raise exception 'test audit insertion failure';
      end;
      $$;
      create trigger test_fail_ordering_readiness_audit
      before insert on public.super_admin_audit_logs
      for each row execute function public.test_fail_ordering_readiness_audit();
    `);

    const failed = await errorOf(db, superAdminId, (tx) => tx.query(
      `select public.record_ordering_launch_readiness($1::jsonb, null)`,
      [JSON.stringify(approvals('2099-02-01T00:00:00.000Z'))]
    ));
    expect(failed).toMatch(/test audit insertion failure/);

    await db.exec(`
      drop trigger test_fail_ordering_readiness_audit on public.super_admin_audit_logs;
      drop function public.test_fail_ordering_readiness_audit();
    `);

    const { rows: afterRows } = await db.query<{ value: Record<string, unknown> }>(
      `select value from platform_settings where key = 'ordering_launch_readiness'`
    );
    expect(afterRows[0]!.value).toEqual(before);
  });

  it('rejects malformed, calendar-invalid, or already-expired approval-validity policies before persistence', async () => {
    const malformed = approvals();
    malformed.approvalValidityPolicy.validUntil = 'tomorrow';
    const malformedError = await errorOf(db, superAdminId, (tx) => tx.query(
      `select public.record_ordering_launch_readiness($1::jsonb, null)`,
      [JSON.stringify(malformed)]
    ));
    expect(malformedError).toMatch(/ISO UTC expiry/);

    for (const invalidExpiry of [
      '2099-02-30T00:00:00Z',
      '2099-04-31T00:00:00Z',
      '2099-12-30T24:00:00Z',
    ]) {
      const invalidCalendarError = await errorOf(db, superAdminId, (tx) => tx.query(
        `select public.record_ordering_launch_readiness($1::jsonb, null)`,
        [JSON.stringify(approvals(invalidExpiry))]
      ));
      expect(invalidCalendarError, invalidExpiry).toMatch(/invalid expiry/);
    }

    const expiredError = await errorOf(db, superAdminId, (tx) => tx.query(
      `select public.record_ordering_launch_readiness($1::jsonb, null)`,
      [JSON.stringify(approvals('2000-01-01T00:00:00.000Z'))]
    ));
    expect(expiredError).toMatch(/must expire in the future/);
  });
});
