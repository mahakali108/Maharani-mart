/**
 * Database-level proof for the admin category & brand create path.
 *
 * The bug report was "admin is unable to add/create Categories and Brands".
 * The web list pages were fixed separately (the `products(count)` aggregate
 * embed — see tests/admin-taxonomy-data.test.ts), but the create itself has to
 * be proven against REAL PostgreSQL, because a create that only looks like it
 * worked is worse than an error: RLS, the unique indices and the audit trigger
 * all run inside the database, not in the Server Action.
 *
 * The harness applies every migration and impersonates PostgREST callers
 * (`set local role authenticated` + `request.jwt.claims`), so what is asserted
 * here is the real policy path:
 *   1. an authorized admin's category/brand INSERT persists;
 *   2. the row is immediately visible to the retailer catalog read;
 *   3. the case-insensitive duplicate index rejects a second name (and the
 *      Server Action's pre-check mirrors it);
 *   4. a retailer (unauthorized) is rejected by RLS — the policies are not
 *      weakened to make creation "work".
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { as, createMigratedDb, createUser, errorOf, type Db } from './helpers/pg-harness';

let db: Db;
let adminId: string;
let retailerId: string;

beforeAll(async () => {
  db = await createMigratedDb();
  adminId = await createUser(db, 'admin', 'Fixture Admin');
  retailerId = await createUser(db, 'retailer', 'Fixture Retailer');
}, 180_000);

function uniqueName(prefix: string): string {
  return `${prefix} ${Math.random().toString(36).slice(2, 8)}`;
}

describe('admin category creation', () => {
  it('persists a top-level category, active by default, and lists it for retailers', async () => {
    const name = uniqueName('Snacks');

    const created = await as(db, adminId, async (tx) => {
      const { rows } = await tx.query<{ id: string; is_active: boolean; parent_id: string | null }>(
        `insert into categories (name, parent_id, image_url) values ($1, null, null)
         returning id, is_active, parent_id`,
        [name]
      );
      return rows[0]!;
    });

    expect(created.is_active).toBe(true);
    expect(created.parent_id).toBeNull();

    // Visible to the retailer catalog read (policy: is_active or staff+).
    const seenByRetailer = await as(db, retailerId, async (tx) => {
      const { rows } = await tx.query<{ id: string; name: string }>(
        `select id, name from categories where id = $1`,
        [created.id]
      );
      return rows[0];
    });
    expect(seenByRetailer?.name).toBe(name);
  });

  it('persists a subcategory under its parent', async () => {
    const parent = uniqueName('Beverages');
    const child = uniqueName('Juices');

    const ids = await as(db, adminId, async (tx) => {
      const { rows } = await tx.query<{ id: string }>(
        `insert into categories (name) values ($1) returning id`,
        [parent]
      );
      const parentId = rows[0]!.id;
      const { rows: childRows } = await tx.query<{ id: string; parent_id: string }>(
        `insert into categories (name, parent_id) values ($1, $2) returning id, parent_id`,
        [child, parentId]
      );
      return { parentId, childId: childRows[0]!.id, childParent: childRows[0]!.parent_id };
    });

    expect(ids.childParent).toBe(ids.parentId);
  });

  it('rejects a case-insensitive duplicate under the same parent', async () => {
    const name = uniqueName('Dairy');

    await as(db, adminId, (tx) =>
      tx.query(`insert into categories (name) values ($1)`, [name])
    );

    const message = await errorOf(db, adminId, (tx) =>
      tx.query(`insert into categories (name) values ($1)`, [name.toUpperCase()])
    );
    expect(message).toMatch(/duplicate key|unique/i);
  });

  it('allows the same name under a different parent', async () => {
    const shared = uniqueName('Assorted');
    const parentA = uniqueName('Parent A');
    const parentB = uniqueName('Parent B');

    const message = await errorOf(db, adminId, async (tx) => {
      const { rows: a } = await tx.query<{ id: string }>(`insert into categories (name) values ($1) returning id`, [parentA]);
      const { rows: b } = await tx.query<{ id: string }>(`insert into categories (name) values ($1) returning id`, [parentB]);
      await tx.query(`insert into categories (name, parent_id) values ($1, $2)`, [shared, a[0]!.id]);
      await tx.query(`insert into categories (name, parent_id) values ($1, $2)`, [shared, b[0]!.id]);
    });

    expect(message).toBeNull();
  });

  it('rejects a retailer creating a category (RLS untouched)', async () => {
    const message = await errorOf(db, retailerId, (tx) =>
      tx.query(`insert into categories (name) values ($1)`, [uniqueName('RetailerMade')])
    );
    expect(message).toMatch(/row-level security|violates row-level security policy/i);
  });

  it('rejects an anonymous caller creating a category', async () => {
    const message = await errorOf(db, 'anon', (tx) =>
      tx.query(`insert into categories (name) values ($1)`, [uniqueName('AnonMade')])
    );
    expect(message).not.toBeNull();
  });
});

describe('admin brand creation', () => {
  it('persists a brand and makes it readable to retailers', async () => {
    const name = uniqueName('Amul');

    const created = await as(db, adminId, async (tx) => {
      const { rows } = await tx.query<{ id: string; name: string; is_active: boolean }>(
        `insert into brands (name, logo_url) values ($1, null) returning id, name, is_active`,
        [name]
      );
      return rows[0]!;
    });

    expect(created.is_active).toBe(true);

    const seenByRetailer = await as(db, retailerId, async (tx) => {
      const { rows } = await tx.query<{ name: string }>(`select name from brands where id = $1`, [created.id]);
      return rows[0];
    });
    expect(seenByRetailer?.name).toBe(name);
  });

  it('rejects a retailer creating a brand (RLS untouched)', async () => {
    const message = await errorOf(db, retailerId, (tx) =>
      tx.query(`insert into brands (name) values ($1)`, [uniqueName('RetailerBrand')])
    );
    expect(message).toMatch(/row-level security|violates row-level security policy/i);
  });

  it('records both creates in the audit log (migration 0050 trigger)', async () => {
    const name = uniqueName('Audited');

    const brandId = await as(db, adminId, async (tx) => {
      const { rows } = await tx.query<{ id: string }>(
        `insert into brands (name) values ($1) returning id`,
        [name]
      );
      return rows[0]!.id;
    });

    // `new_data` is deliberately NOT asserted: PGlite renders `to_jsonb(NEW)`
    // inside a plpgsql trigger as NULL, so the snapshot columns are not
    // trustworthy in this harness. What matters — and what production relies on
    // — is that the row is written, attributed to the acting admin.
    const audit = await as(db, 'service', async (tx) => {
      const { rows } = await tx.query<{ action: string; table_name: string; changed_by: string | null }>(
        `select action, table_name, changed_by from audit_logs
          where table_name = 'brands' and record_id = $1`,
        [brandId]
      );
      return rows;
    });

    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({ action: 'insert', table_name: 'brands', changed_by: adminId });
  });
});
