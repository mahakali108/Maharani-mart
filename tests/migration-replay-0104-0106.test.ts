import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { createMigratedDb, type Db } from './helpers/pg-harness';

/**
 * Re-running the release migrations must be safe.
 *
 * The Supabase CLI runs each file in a transaction, but the SQL editor does not:
 * if a migration stops halfway there, the operator's only sane options are "fix
 * and re-run" or "roll back". A file that cannot be re-run turns a five-minute
 * incident into a hand-repair of half a schema, so each file is replayed here
 * against a database where it has already been applied.
 *
 * 0105 is the exception and is asserted as such: once pages are published it
 * REFUSES to re-run, because re-seeding published content is not a no-op.
 */
const files = {
  '0104': readFileSync('supabase/migrations/0104_site_content_management.sql', 'utf8'),
  '0105': readFileSync('supabase/migrations/0105_seed_site_content.sql', 'utf8'),
  '0106': readFileSync('supabase/migrations/0106_first_super_admin_bootstrap.sql', 'utf8'),
} as const;
const stage1 = readFileSync('supabase/publication/stage1_publish_live_text.sql', 'utf8');

describe('release migrations are re-runnable (PostgreSQL 16)', () => {
  let db: Db;
  beforeAll(async () => { db = await createMigratedDb(); }, 180_000);
  afterAll(async () => { await db.close(); });

  const counts = async () =>
    (await db.query<{ pages: number; sections: number; notes: number; published: number }>(
      `select (select count(*)::int from public.site_pages) as pages,
              (select count(*)::int from public.site_page_sections) as sections,
              (select count(*)::int from public.site_page_admin_notes) as notes,
              (select count(*)::int from public.site_pages where status = 'published') as published`,
    )).rows[0]!;

  it('replays 0104, 0105 and 0106 without changing a row', async () => {
    const before = await counts();
    expect(before).toMatchObject({ pages: 19, sections: 70, notes: 19, published: 0 });
    for (const [name, sql] of Object.entries(files)) {
      await expect(db.exec(sql), `${name} must be re-runnable`).resolves.toBeDefined();
    }
    expect(await counts()).toEqual(before);
  });

  it('0105 refuses to re-run once pages are published, and changes nothing', async () => {
    await db.exec(stage1);
    const before = await counts();
    expect(before.published).toBe(9);
    await expect(db.exec(files['0105'])).rejects.toThrow(/0105 must not publish/);
    expect(await counts()).toEqual(before);
  });
});
