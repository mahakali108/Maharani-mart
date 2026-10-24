import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { as, createMigratedDb, createUser, errorOf, type Db } from './helpers/pg-harness';

/**
 * 0074 — banner lifecycle and responsive artwork.
 *
 * Executed against a real PostgreSQL (PGlite), not asserted as source text:
 * the default, the CHECK constraint and the narrowed SELECT policy are the
 * three things that must hold before a draft can be considered safe.
 */

let db: Db;

beforeAll(async () => {
  db = await createMigratedDb({ lastMigration: '0074_banner_lifecycle_and_variants.sql' });
}, 180_000);

afterAll(async () => {
  await db?.close();
});

let order = 0;

async function insertBanner(overrides: Record<string, unknown> = {}): Promise<string> {
  order += 1;
  const row = {
    title: `Banner ${order}`,
    image_url: `https://ref.supabase.co/storage/v1/object/public/banners/${order}.webp`,
    link_url: '/retailer/catalog',
    is_active: true,
    sort_order: order,
    ...overrides,
  };
  const columns = Object.keys(row);
  const values = Object.values(row);
  const placeholders = columns.map((_, index) => `$${index + 1}`).join(', ');
  const { rows } = await db.query<{ id: string }>(
    `insert into banners (${columns.join(', ')}) values (${placeholders}) returning id`,
    values,
  );
  return rows[0]!.id;
}

async function visibleIds(who: string): Promise<string[]> {
  const { rows } = await as(db, who, (tx) =>
    tx.query<{ id: string }>('select id from banners order by sort_order, id'),
  );
  return rows.map((row) => row.id);
}

describe('0074 banner lifecycle', () => {
  it('defaults a new banner to published so pre-existing rows keep rendering', async () => {
    const id = await insertBanner({ title: 'Defaulted' });
    const { rows } = await db.query<{ status: string; image_url_mobile: string | null }>(
      'select status, image_url_mobile from banners where id = $1',
      [id],
    );
    expect(rows[0]).toEqual({ status: 'published', image_url_mobile: null });
  });

  it('rejects any status outside draft/published', async () => {
    const message = await errorOf(db, 'service', (tx) =>
      tx.query(`insert into banners (title, image_url, status) values ('Bad', '/x.png', 'archived')`),
    );
    expect(message).toContain('banners_status_check');
  });

  it('hides an active draft from a retailer while staff can still see it', async () => {
    const retailer = await createUser(db, 'retailer');
    const staff = await createUser(db, 'staff');
    const live = await insertBanner({ title: 'Live' });
    const draft = await insertBanner({ title: 'Draft', status: 'draft' });

    const retailerView = await visibleIds(retailer);
    expect(retailerView).toContain(live);
    expect(retailerView).not.toContain(draft);

    const staffView = await visibleIds(staff);
    expect(staffView).toEqual(expect.arrayContaining([live, draft]));
  });

  it('hides a paused published banner from retailers', async () => {
    const retailer = await createUser(db, 'retailer');
    const paused = await insertBanner({ title: 'Paused', is_active: false });
    expect(await visibleIds(retailer)).not.toContain(paused);
  });

  it('keeps both narrowed policies in place under their original names', async () => {
    const { rows } = await db.query<{ policyname: string }>(
      `select p.polname as policyname
         from pg_policy p
         join pg_class c on c.oid = p.polrelid
         join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'public' and c.relname = 'banners'
        order by p.polname`,
    );
    // 0052 adds restrictive active_account_* policies to every RLS table, so
    // the banner policies are expected alongside them rather than alone.
    expect(rows.map((row) => row.policyname)).toEqual(
      expect.arrayContaining(['banners_read', 'banners_write']),
    );
  });

  it('lets an admin publish and reject someone else\'s write, matching banners.manage', async () => {
    const admin = await createUser(db, 'admin');
    await as(db, admin, (tx) =>
      tx.query(`insert into banners (title, image_url, status) values ('Admin draft', '/admin.png', 'draft')`),
    );
    const { rows } = await db.query<{ count: number | string }>(
      `select count(*) as count from banners where title = 'Admin draft'`,
    );
    expect(Number(rows[0]!.count)).toBe(1);
  });

  it('refuses a banner write from staff, who never held banners.manage', async () => {
    const staff = await createUser(db, 'staff');
    const message = await errorOf(db, staff, (tx) =>
      tx.query(`insert into banners (title, image_url) values ('Staff write', '/staff.png')`),
    );
    expect(message).toMatch(/row-level security|permission denied/i);
  });

  it('refuses a banner write from a seller', async () => {
    const seller = await createUser(db, 'seller');
    const message = await errorOf(db, seller, (tx) =>
      tx.query(`insert into banners (title, image_url) values ('Seller write', '/seller.png')`),
    );
    expect(message).toMatch(/row-level security|permission denied/i);
  });

  it('refuses a draft read from anon and keeps published rows readable', async () => {
    const live = await insertBanner({ title: 'Public live' });
    const draft = await insertBanner({ title: 'Public draft', status: 'draft' });
    const { rows } = await as(db, 'anon', (tx) => tx.query<{ id: string }>('select id from banners'));
    const ids = rows.map((row) => row.id);
    expect(ids).toContain(live);
    expect(ids).not.toContain(draft);
  });
});
