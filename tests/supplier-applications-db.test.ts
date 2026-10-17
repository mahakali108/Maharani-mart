/**
 * Migration 0059 — supplier applications, EXECUTED against PostgreSQL
 * (PGlite, all migrations applied) with PostgREST-style impersonation.
 * Covers: public submission via the definer function only, duplicate
 * protection, CHECK validation, reviewer authorization, approval/rejection
 * audit stamps, and document isolation. Run locally/disposable only —
 * never against a production project.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { as, createMigratedDb, createUser, errorOf, type Db } from './helpers/pg-harness';

let db: Db;
let admin: string;
let superAdmin: string;
let staff: string;
let retailer: string;

const SUBMIT = `select submit_supplier_application($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) as id`;
const args = (phone = '9876543210', gstin: string | null = null) => [
  'Sharma Wholesale', null, 'A Sharma', phone, null, null, null, null, null, gstin, 'FMCG',
];

async function submitAs(who: string, phone?: string): Promise<string> {
  return as(db, who, async (tx) => {
    const { rows } = await tx.query<{ id: string }>(SUBMIT, args(phone));
    return rows[0]!.id;
  });
}

beforeAll(async () => {
  db = await createMigratedDb();
  admin = await createUser(db, 'admin');
  superAdmin = await createUser(db, 'super_admin');
  staff = await createUser(db, 'staff');
  retailer = await createUser(db, 'retailer');
}, 120_000);

describe('0059 submission path', () => {
  it('anon can submit via the function and gets a pending, unverified row', async () => {
    const id = await submitAs('anon');
    const { rows } = await db.query<{ status: string; gstin_verified: boolean }>(
      `select status, gstin_verified from suppliers where id=$1`, [id]
    );
    expect(rows[0]).toEqual({ status: 'pending', gstin_verified: false });
  });
  it('anon and retailer cannot read applications back', async () => {
    // anon has no table privilege at all; authenticated retailer is RLS-filtered to zero rows.
    expect(await errorOf(db, 'anon', (tx) => tx.query(`select id from suppliers`))).toMatch(/permission denied/);
    const retailerRows = await as(db, retailer, async (tx) => (await tx.query(`select id from suppliers`)).rows);
    expect(retailerRows).toEqual([]);
  });
  it('direct table insert is denied to anon and authenticated', async () => {
    const sql = `insert into suppliers (business_name, contact_name, phone) values ('X Co','Y','9812345678')`;
    expect(await errorOf(db, 'anon', (tx) => tx.query(sql))).toMatch(/permission denied/);
    expect(await errorOf(db, retailer, (tx) => tx.query(sql))).toMatch(/permission denied/);
  });
  it('duplicate pending application for the same phone is rejected', async () => {
    expect(await errorOf(db, 'anon', (tx) => tx.query(SUBMIT, args()))).toMatch(/uq_suppliers_pending_phone|duplicate key/);
  });
  it('invalid GSTIN and phone are rejected by CHECK constraints', async () => {
    expect(await errorOf(db, 'anon', (tx) => tx.query(SUBMIT, args('9812345679', 'FAKE123')))).toMatch(/gstin|check/i);
    expect(await errorOf(db, 'anon', (tx) => tx.query(SUBMIT, args('123')))).toMatch(/phone|check/i);
  });
  it('submission cannot smuggle reviewer/verification fields (function has no such params)', async () => {
    const { rows } = await db.query<{ args: number }>(
      `select pronargs::int as args from pg_proc where proname='submit_supplier_application'`
    );
    expect(rows[0]!.args).toBe(11);
  });
});

describe('0059 review authorization', () => {
  it('staff and retailer cannot approve; admin can approve with a stamp', async () => {
    const id = await submitAs('anon', '9812345680');
    // RLS makes staff/retailer updates match zero rows (no error, no change).
    await as(db, staff, (tx) =>
      tx.query(`update suppliers set status='approved', reviewed_by=$1, reviewed_at=now() where id=$2`, [staff, id])
    );
    await as(db, retailer, (tx) => tx.query(`update suppliers set status='approved' where id=$1`, [id]));
    const before = await db.query<{ status: string }>(`select status from suppliers where id=$1`, [id]);
    expect(before.rows[0]!.status).toBe('pending');
    await as(db, admin, (tx) =>
      tx.query(`update suppliers set status='approved', reviewed_by=$1, reviewed_at=now() where id=$2 and status='pending'`, [admin, id])
    );
    const { rows } = await db.query<{ status: string; reviewed_by: string }>(
      `select status, reviewed_by from suppliers where id=$1`, [id]
    );
    expect(rows[0]!.status).toBe('approved');
    expect(rows[0]!.reviewed_by).toBe(admin);
    // audit history exists for the transitions
    const audit = await db.query(`select id from audit_logs where table_name='suppliers' and record_id=$1`, [id]);
    expect(audit.rows.length).toBeGreaterThan(0);
  });
  it('rejection requires a reason (CHECK)', async () => {
    const id = await submitAs('anon', '9812345681');
    expect(
      await errorOf(db, admin, (tx) =>
        tx.query(`update suppliers set status='rejected', reviewed_by=$1, reviewed_at=now() where id=$2`, [admin, id])
      )
    ).toMatch(/rejection_reason|check/i);
  });
});

describe('0059 document isolation', () => {
  it('documents are readable by admin only; bucket is private', async () => {
    const id = await submitAs('anon', '9812345682');
    await as(db, admin, (tx) =>
      tx.query(
        `insert into supplier_documents (supplier_id, doc_type, file_url, file_name, uploaded_by)
         values ($1,'gstin_certificate',$2,'gst.pdf',$3)`,
        [id, `suppliers/${id}/documents/gst.pdf`, admin]
      )
    );
    expect(await as(db, staff, async (tx) => (await tx.query(`select id from supplier_documents`)).rows)).toEqual([]);
    expect(await as(db, retailer, async (tx) => (await tx.query(`select id from supplier_documents`)).rows)).toEqual([]);
    expect((await as(db, admin, async (tx) => (await tx.query(`select id from supplier_documents`)).rows)).length).toBe(1);
    expect(await errorOf(db, staff, (tx) =>
      tx.query(`insert into supplier_documents (supplier_id, doc_type, file_url, file_name) values ($1,'other','x','x')`, [id])
    )).not.toBeNull();
    const { rows } = await db.query<{ public: boolean }>(`select public from storage.buckets where id='supplier-documents'`);
    expect(rows[0]!.public).toBe(false);
  });
  it('definer function has pinned search_path and no PUBLIC execute', async () => {
    const { rows } = await db.query<{ proconfig: string[] | null; pub: boolean }>(
      `select proconfig,
              has_function_privilege('public', oid::regprocedure, 'EXECUTE') as pub
       from pg_proc where proname='submit_supplier_application'`
    );
    // has_function_privilege with 'public' pseudo-role is not supported in
    // all builds; fall back to checking anon grant exists via proacl text.
    expect(rows[0]!.proconfig).toContain('search_path=public, pg_temp');
    const acl = await db.query<{ acl: string | null }>(
      `select proacl::text as acl from pg_proc where proname='submit_supplier_application'`
    );
    // PUBLIC execute would appear as '=X/...' with an empty grantee.
    expect(acl.rows[0]!.acl ?? '').not.toMatch(/(^|[,{])=X\//);
    expect(acl.rows[0]!.acl ?? '').toContain('anon=X/');
    expect(acl.rows[0]!.acl ?? '').toContain('authenticated=X/');
  });
});

describe('0059 review-enforcement trigger (audit Fix 1)', () => {
  const approve = (who: string, id: string, by: string, at = 'now()') =>
    errorOf(db, who, (tx) =>
      tx.query(
        `update suppliers set status='approved', reviewed_by=$1, reviewed_at=${at} where id=$2`,
        [by, id]
      )
    );

  it('direct approval works for admin and super_admin with their own fresh stamp', async () => {
    const a = await submitAs('anon', '9812345690');
    expect(await approve(admin, a, admin)).toBeNull();
    const b = await submitAs('anon', '9812345691');
    expect(await approve(superAdmin, b, superAdmin)).toBeNull();
  });

  it('forged reviewer id and forged timestamp are rejected', async () => {
    const id = await submitAs('anon', '9812345692');
    expect(await approve(admin, id, superAdmin)).toMatch(/reviewed_by must be/);
    expect(
      await errorOf(db, admin, (tx) =>
        tx.query(
          `update suppliers set status='approved', reviewed_by=$1, reviewed_at=now() - interval '1 day' where id=$2`,
          [admin, id]
        )
      )
    ).toMatch(/reviewed_at must be/);
    const { rows } = await db.query<{ status: string }>(`select status from suppliers where id=$1`, [id]);
    expect(rows[0]!.status).toBe('pending');
  });

  it('applicant fields and gstin_verified are immutable via API updates', async () => {
    const id = await submitAs('anon', '9812345693');
    expect(
      await errorOf(db, admin, (tx) => tx.query(`update suppliers set phone='9812345600' where id=$1`, [id]))
    ).toMatch(/immutable/);
    expect(
      await errorOf(db, admin, (tx) => tx.query(`update suppliers set gstin_verified=true where id=$1`, [id]))
    ).toMatch(/GSTIN verification cannot be changed/);
    expect(
      await errorOf(db, admin, (tx) =>
        tx.query(`update suppliers set business_name='Renamed Co' where id=$1`, [id])
      )
    ).toMatch(/immutable/);
  });

  it('non-pending rows cannot be re-reviewed directly; rejected requires reason at trigger level too', async () => {
    const id = await submitAs('anon', '9812345694');
    expect(await approve(admin, id, admin)).toBeNull();
    // approved -> rejected is not a legal transition
    expect(
      await errorOf(db, admin, (tx) =>
        tx.query(
          `update suppliers set status='rejected', rejection_reason='x', reviewed_by=$1, reviewed_at=now() where id=$2`,
          [admin, id]
        )
      )
    ).toMatch(/Invalid supplier status transition/);
    // approved -> suspended is legal for admins, with their own stamp
    await as(db, superAdmin, (tx) =>
      tx.query(
        `update suppliers set status='suspended', reviewed_by=$1, reviewed_at=now() where id=$2`,
        [superAdmin, id]
      )
    );
    // suspended -> approved is not legal
    expect(await approve(admin, id, admin)).toMatch(/Invalid supplier status transition/);
  });

  it('anonymous callers cannot review at all', async () => {
    const id = await submitAs('anon', '9812345695');
    expect(await approve('anon', id, admin)).not.toBeNull();
    const { rows } = await db.query<{ status: string }>(`select status from suppliers where id=$1`, [id]);
    expect(rows[0]!.status).toBe('pending');
  });

  it('duplicate-approved policy: no unique-approved index; rejected may reapply (documented ambiguity)', async () => {
    // Phone is contact data, not a proven business identity, so a second
    // application with the same phone CAN be approved — the app warns the
    // reviewer instead of the DB silently merging businesses. Preventing
    // this needs an owner-confirmed identity key (see proposal doc).
    const phone = '9812345696';
    const first = await submitAs('anon', phone);
    expect(await approve(admin, first, admin)).toBeNull();
    const second = await submitAs('anon', phone);
    expect(second).not.toBe(first);
    // rejected -> reapply is allowed
    await as(db, admin, (tx) =>
      tx.query(
        `update suppliers set status='rejected', rejection_reason='Incomplete details', reviewed_by=$1, reviewed_at=now() where id=$2`,
        [admin, second]
      )
    );
    const third = await submitAs('anon', phone);
    expect(third).not.toBe(second);
  });
});

describe('0059 supplier document storage deletion (audit Fix M-1)', () => {
  it('migration creates SELECT and INSERT storage policies but no DELETE policy', async () => {
    const { readFileSync } = await import('node:fs');
    const sql = readFileSync('supabase/migrations/0059_supplier_applications.sql', 'utf8');
    expect(sql).toContain('create policy "supplier_documents_bucket_read" on storage.objects');
    expect(sql).toContain('create policy "supplier_documents_bucket_write" on storage.objects');
    expect(sql).not.toContain('create policy "supplier_documents_bucket_delete" on storage.objects');
  });

  it('an admin cannot delete a supplier document object through the API role', async () => {
    const supplierId = await submitAs('anon', '9812345697');
    const objectName = `suppliers/${supplierId}/documents/gst.pdf`;
    await db.query(
      `insert into storage.objects (bucket_id, name) values ('supplier-documents', $1)`,
      [objectName]
    );
    // No DELETE policy exists for this bucket: the attempt is either
    // privilege-denied outright or RLS-filters to zero rows.
    const deleteError = await errorOf(db, admin, (tx) =>
      tx.query(`delete from storage.objects where bucket_id='supplier-documents' and name=$1`, [objectName])
    );
    expect(deleteError === null || /permission denied/.test(deleteError)).toBe(true);
    const { rows } = await db.query<{ n: string }>(
      `select count(*)::text as n from storage.objects where bucket_id='supplier-documents' and name=$1`,
      [objectName]
    );
    expect(Number(rows[0]!.n)).toBe(1);
  });
});

describe('0059 rollback guard (disposable PGlite only)', () => {
  it('contains fail-safe guards and never deletes the bucket row', () => {
    const { readFileSync } = require('node:fs') as typeof import('node:fs');
    const sql = readFileSync('supabase/rollbacks/0059_supplier_applications.down.sql', 'utf8');
    expect(sql).toContain('ROLLBACK ABORTED: supplier application/document records exist');
    expect(sql).toContain('ROLLBACK ABORTED: storage objects exist in bucket supplier-documents');
    expect(sql).not.toMatch(/delete from storage\.buckets/);
    expect(sql).not.toMatch(/delete from storage\.objects/);
  });

  it('aborts without dropping tables when data exists', async () => {
    const { readFileSync } = await import('node:fs');
    const sql = readFileSync('supabase/rollbacks/0059_supplier_applications.down.sql', 'utf8');
    // Data exists in this db (previous describes), so the guard must raise
    // and the table must survive.
    await expect(db.exec(sql)).rejects.toThrow(/ROLLBACK ABORTED/);
    const { rows } = await db.query<{ n: string }>(`select count(*)::text as n from suppliers`);
    expect(Number(rows[0]!.n)).toBeGreaterThan(0);
  });
});

describe('0060 durable supplier rate limiter (disposable PGlite only)', () => {
  const CONSUME = `select consume_supplier_application_rate_limit($1,$2,$3,$4) as r`;
  const KEY = 'a'.repeat(64);

  it('the trusted service role can consume atomically; the limit holds and state is hash-keyed', async () => {
    const consume = () =>
      as(db, 'service', async (tx) => {
        const { rows } = await tx.query<{ r: { allowed: boolean } }>(CONSUME, [KEY, 'supplier-app-phone', 3, 600]);
        return rows[0]!.r.allowed;
      });
    expect(await consume()).toBe(true);
    expect(await consume()).toBe(true);
    expect(await consume()).toBe(true);
    expect(await consume()).toBe(false);
    // stored state contains only the hash — never a phone number
    const { rows } = await db.query<{ key_hash: string; request_count: number }>(
      `select key_hash, request_count from supplier_application_rate_limits where bucket='supplier-app-phone'`
    );
    expect(rows).toEqual([{ key_hash: KEY, request_count: 4 }]);
  });

  it('expired windows reset the count', async () => {
    await db.query(
      `update supplier_application_rate_limits set window_started_at = now() - interval '601 seconds' where key_hash=$1`,
      [KEY]
    );
    const allowed = await as(db, 'service', async (tx) => {
      const { rows } = await tx.query<{ r: { allowed: boolean; remaining: number } }>(CONSUME, [
        KEY, 'supplier-app-phone', 3, 600,
      ]);
      return rows[0]!.r;
    });
    expect(allowed).toEqual(expect.objectContaining({ allowed: true, remaining: 2 }));
  });

  it('direct table access is denied to anon and authenticated; raw identifiers are rejected', async () => {
    expect(await errorOf(db, 'anon', (tx) => tx.query(`select * from supplier_application_rate_limits`)))
      .toMatch(/permission denied/);
    expect(await errorOf(db, retailer, (tx) => tx.query(`select * from supplier_application_rate_limits`)))
      .toMatch(/permission denied/);
    // a raw phone number is not a valid key — hashes only
    expect(await errorOf(db, 'service', (tx) => tx.query(CONSUME, ['9812345678', 'supplier-app-phone', 3, 600])))
      .toMatch(/Invalid rate limit/);
    expect(await errorOf(db, 'service', (tx) => tx.query(CONSUME, [KEY, 'bad bucket!', 3, 600])))
      .toMatch(/Invalid rate limit/);
  });

  it('function has pinned search_path and no PUBLIC execute', async () => {
    const { rows } = await db.query<{ proconfig: string[] | null; acl: string | null }>(
      `select proconfig, proacl::text as acl from pg_proc where proname='consume_supplier_application_rate_limit'`
    );
    expect(rows[0]!.proconfig).toContain('search_path=public, pg_temp');
    expect(rows[0]!.acl ?? '').not.toMatch(/(^|[,{])=X\//);
    expect(rows[0]!.acl ?? '').toContain('service_role=X/');
    expect(rows[0]!.acl ?? '').not.toContain('anon=X/');
    expect(rows[0]!.acl ?? '').not.toContain('authenticated=X/');
  });
});

describe('0060 counter cap (F4) and bounded cleanup (F2)', () => {
  const CONSUME = `select consume_supplier_application_rate_limit($1,$2,$3,$4) as r`;

  it('stored counter caps at limit + 1 while decisions stay correct', async () => {
    const key = 'd'.repeat(64);
    for (let i = 0; i < 10; i++) {
      await as(db, 'service', (tx) => tx.query(CONSUME, [key, 'supplier-app-phone', 3, 600]));
    }
    const { rows } = await db.query<{ request_count: number }>(
      `select request_count from supplier_application_rate_limits where key_hash=$1`, [key]
    );
    expect(rows[0]!.request_count).toBe(4); // 3 allowed + capped sentinel, not 10
    const blocked = await as(db, 'service', async (tx) => {
      const { rows: r } = await tx.query<{ r: { allowed: boolean; remaining: number } }>(CONSUME, [
        key, 'supplier-app-phone', 3, 600,
      ]);
      return r[0]!.r;
    });
    expect(blocked).toEqual(expect.objectContaining({ allowed: false, remaining: 0 }));
    // window rollover still resets decisions after the cap
    await db.query(
      `update supplier_application_rate_limits set window_started_at = now() - interval '601 seconds' where key_hash=$1`,
      [key]
    );
    const after = await as(db, 'service', async (tx) => {
      const { rows: r } = await tx.query<{ r: { allowed: boolean } }>(CONSUME, [key, 'supplier-app-phone', 3, 600]);
      return r[0]!.r.allowed;
    });
    expect(after).toBe(true);
  });

  it('opportunistic cleanup removes expired rows in the bucket but preserves live windows', async () => {
    const stale = ['1'.repeat(64), '2'.repeat(64), '3'.repeat(64)];
    for (const k of stale) {
      await db.query(
        `insert into supplier_application_rate_limits (key_hash, bucket, window_started_at, request_count)
         values ($1, 'supplier-app-client', now() - interval '8 days', 1)`, [k]
      );
    }
    // a live row in the same bucket must survive
    await as(db, 'service', (tx) => tx.query(CONSUME, ['4'.repeat(64), 'supplier-app-client', 10, 3600]));
    // any new consume in the bucket triggers the bounded cleanup
    await as(db, 'service', (tx) => tx.query(CONSUME, ['5'.repeat(64), 'supplier-app-client', 10, 3600]));
    const { rows } = await db.query<{ key_hash: string }>(
      `select key_hash from supplier_application_rate_limits where bucket='supplier-app-client' order by key_hash`
    );
    expect(rows.map((r) => r.key_hash)).toEqual(['4'.repeat(64), '5'.repeat(64)]);
  });
});

describe('0060 NULL argument rejection (N5)', () => {
  const KEY = 'e'.repeat(64);
  it.each([
    ['key', [null, 'supplier-app-phone', 3, 600]],
    ['bucket', [KEY, null, 3, 600]],
    ['limit', [KEY, 'supplier-app-phone', null, 600]],
    ['window', [KEY, 'supplier-app-phone', 3, null]],
  ])('rejects NULL %s without mutating the table', async (_name, args) => {
    const before = await db.query<{ n: string }>(
      `select count(*)::text as n from supplier_application_rate_limits where key_hash=$1`, [KEY]
    );
    await expect(
      as(db, 'service', (tx) =>
        tx.query(`select consume_supplier_application_rate_limit($1,$2,$3,$4) as r`, args as never[])
      )
    ).rejects.toThrow(/Invalid rate limit configuration/);
    const after = await db.query<{ n: string }>(
      `select count(*)::text as n from supplier_application_rate_limits where key_hash=$1`, [KEY]
    );
    expect(after.rows[0]!.n).toBe(before.rows[0]!.n);
  });
});

describe('0060 privilege boundary (N1) — server-only RPC', () => {
  const CONSUME = `select consume_supplier_application_rate_limit($1,$2,$3,$4) as r`;
  const KEY = 'f'.repeat(64);

  it('anon and authenticated cannot execute the limiter RPC, and denied calls mutate nothing', async () => {
    const count = async () =>
      (await db.query<{ n: string }>(
        `select count(*)::text as n from supplier_application_rate_limits where key_hash=$1`, [KEY]
      )).rows[0]!.n;
    const before = await count();
    expect(await errorOf(db, 'anon', (tx) => tx.query(CONSUME, [KEY, 'supplier-app-phone', 3, 600])))
      .toMatch(/permission denied/);
    expect(await errorOf(db, retailer, (tx) => tx.query(CONSUME, [KEY, 'supplier-app-phone', 3, 600])))
      .toMatch(/permission denied/);
    expect(await count()).toBe(before);
  });

  it('untrusted roles still cannot read the table directly', async () => {
    expect(await errorOf(db, 'anon', (tx) => tx.query(`select * from supplier_application_rate_limits`)))
      .toMatch(/permission denied/);
    expect(await errorOf(db, retailer, (tx) => tx.query(`select * from supplier_application_rate_limits`)))
      .toMatch(/permission denied/);
  });

  it('the trusted service role can consume both client and phone quotas', async () => {
    const consume = (key: string, bucket: string, limit: number, window: number) =>
      as(db, 'service', async (tx) => {
        const { rows } = await tx.query<{ r: { allowed: boolean } }>(CONSUME, [key, bucket, limit, window]);
        return rows[0]!.r.allowed;
      });
    // phone bucket: 3 allowed then blocked
    expect(await consume(KEY, 'supplier-app-phone', 3, 600)).toBe(true);
    expect(await consume(KEY, 'supplier-app-phone', 3, 600)).toBe(true);
    expect(await consume(KEY, 'supplier-app-phone', 3, 600)).toBe(true);
    expect(await consume(KEY, 'supplier-app-phone', 3, 600)).toBe(false);
    // client bucket is independent
    expect(await consume(KEY, 'supplier-app-client', 10, 3600)).toBe(true);
  });

  it('the public submission RPC remains anon-callable and independent of the limiter', async () => {
    // Supplier applications still submit through 0059 without any
    // limiter privilege — the trust boundary moved, the flow did not.
    const id = await submitAs('anon', '9812345685');
    expect(id).toBeTruthy();
  });
});
