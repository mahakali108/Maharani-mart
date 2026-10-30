import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { as, createMigratedDb, createUser, errorOf, type Db } from './helpers/pg-harness';

let db: Db;
let authenticatedUserId: string;

type AclRow = {
  proname: string;
  proacl: string[] | null;
  anon_execute: boolean;
  authenticated_execute: boolean;
  service_execute: boolean;
};

beforeAll(async () => {
  db = await createMigratedDb();
  authenticatedUserId = await createUser(db, 'retailer', 'ACL retailer');
}, 180_000);

afterAll(async () => {
  await db?.close();
});

describe('0087 SECURITY DEFINER function ACLs', () => {
  it('records explicit pg_proc.proacl entries and denies internal evidence helpers to every API role', async () => {
    const { rows } = await db.query<AclRow>(`
      select p.proname, p.proacl,
             has_function_privilege('anon', p.oid, 'EXECUTE') as anon_execute,
             has_function_privilege('authenticated', p.oid, 'EXECUTE') as authenticated_execute,
             has_function_privilege('service_role', p.oid, 'EXECUTE') as service_execute
        from pg_proc p
        join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public'
         and p.proname in (
           'product_compliance_has_evidence',
           'seller_compliance_has_evidence',
           'assert_product_compliance_approvable',
           'assert_seller_compliance_approvable',
           'enforce_seller_offer_compliance',
           'enforce_order_item_compliance'
         )
       order by p.proname
    `);
    expect(rows).toHaveLength(6);
    for (const row of rows) {
      expect(row.proacl, row.proname).not.toBeNull();
      expect(row.anon_execute, row.proname).toBe(false);
      expect(row.authenticated_execute, row.proname).toBe(false);
      expect(row.service_execute, row.proname).toBe(false);
    }
  });

  it('denies direct anon/authenticated RPC-style helper calls but retains the caller-scoped eligibility accessor', async () => {
    const anonHelper = await errorOf(db, 'anon', (tx) => tx.query(
      `select public.seller_compliance_has_evidence(gen_random_uuid(), 'business_identity')`
    ));
    const authenticatedHelper = await errorOf(db, authenticatedUserId, (tx) => tx.query(
      `select public.product_compliance_has_evidence(gen_random_uuid(), 'label_photo')`
    ));
    expect(anonHelper).toMatch(/permission denied for function seller_compliance_has_evidence/i);
    expect(authenticatedHelper).toMatch(/permission denied for function product_compliance_has_evidence/i);

    const callerScoped = await as(db, authenticatedUserId, (tx) => tx.query<{ eligible: boolean }>(
      `select public.product_is_sale_eligible(gen_random_uuid()) as eligible`
    ));
    expect(callerScoped.rows).toEqual([{ eligible: false }]);
  });
});
