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

  it('keeps the narrowed policy in place under the original name', async () => {
    const { rows } = await db.query<{ polname: string }>(
      `select polname from pg_policy where polrelid = 'public.banners'::regclass order by polname`,
    );
    expect(rows.map((row) => row.polname)).toContain('banners_read');
  });
});
