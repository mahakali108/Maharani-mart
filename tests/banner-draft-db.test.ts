import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { as, createMigratedDb, createUser, errorOf, type Db } from './helpers/pg-harness';
import { DRAFT_BANNER_PATH_RE } from '@/lib/media/refs';

/**
 * 0077 — private storage for unpublished banner artwork.
 *
 * Executed against real PostgreSQL (PGlite), not asserted as source text:
 * the bucket must be private, the policies must be admin-only, and the path
 * constraints must reject anything that is not a private object path belonging
 * to the banner's own directory.
 *
 * The migration is REVIEW ONLY — this test proves it applies cleanly and is
 * safe to re-run. It is NOT evidence that anything was applied to Supabase.
 */

let db: Db;

beforeAll(async () => {
  db = await createMigratedDb({ lastMigration: '0077_banner_draft_artwork.sql' });
}, 240_000);

afterAll(async () => {
  await db?.close();
});

const BANNER_ID = '8f14e45f-ceea-4a67-9a0f-1e2b3c4d5e6f';
const OTHER_BANNER_ID = '0b7c1d2e-3f40-4a5b-8c9d-0e1f2a3b4c5d';
const FILE_ID = '1c2d3e4f-5a6b-4c7d-8e9f-0a1b2c3d4e5f';

async function insertBanner(id: string, extra: Record<string, unknown> = {}): Promise<void> {
  const row: Record<string, unknown> = {
    id,
    title: `Banner ${id.slice(0, 4)}`,
    image_url: `/banners/${id}.webp`,
    ...extra,
  };
  const columns = Object.keys(row);
  const placeholders = columns.map((_, index) => `$${index + 1}`).join(', ');
  await db.query(`insert into banners (${columns.join(', ')}) values (${placeholders})`, Object.values(row));
}

describe('0077 banner-drafts bucket', () => {
  it('creates a PRIVATE 5 MB image-only bucket', async () => {
    const { rows } = await db.query<{
      id: string;
      public: boolean;
      file_size_limit: string | number;
      allowed_mime_types: string[];
    }>('select id, public, file_size_limit, allowed_mime_types from storage.buckets where id = $1', ['banner-drafts']);

    expect(rows).toHaveLength(1);
    expect(rows[0]!.public).toBe(false);
    expect(Number(rows[0]!.file_size_limit)).toBe(5 * 1024 * 1024);
    expect(rows[0]!.allowed_mime_types).toEqual(['image/png', 'image/jpeg', 'image/webp']);
  });

  it('leaves the existing public banners bucket exactly as 0003 created it', async () => {
    const { rows } = await db.query<{ public: boolean; file_size_limit: string | number }>(
      'select public, file_size_limit from storage.buckets where id = $1',
      ['banners'],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]!.public).toBe(true);
    expect(Number(rows[0]!.file_size_limit)).toBe(5 * 1024 * 1024);
  });

  it('adds four admin-only policies and never a public/anon read', async () => {
    const { rows } = await db.query<{ policyname: string; cmd: string; qual: string | null; with_check: string | null }>(
      `select polname as policyname, polcmd as cmd, pg_get_expr(polqual, polrelid) as qual,
              pg_get_expr(polwithcheck, polrelid) as with_check
         from pg_policy
        where polrelid = 'storage.objects'::regclass
          and polname like '%banner_drafts%'
        order by polname`,
    );

    expect(rows.map((row) => row.policyname)).toEqual([
      'admin_delete_banner_drafts',
      'admin_read_banner_drafts',
      'admin_update_banner_drafts',
      'admin_write_banner_drafts',
    ]);
    for (const row of rows) {
      const expression = `${row.qual ?? ''} ${row.with_check ?? ''}`;
      expect(expression).toContain('banner-drafts');
      expect(expression).toContain('is_admin_or_above');
    }
  });

  it('is re-runnable — a second application changes nothing', async () => {
    const { readFileSync } = await import('node:fs');
    const path = await import('node:path');
    const sql = readFileSync(
      path.join(__dirname, '..', 'supabase', 'migrations', '0077_banner_draft_artwork.sql'),
      'utf8',
    );
    // PGlite's exec() resolves with a result array, so only the effect matters.
    await db.exec(sql);

    const { rows } = await db.query<{ count: number | string }>(
      `select count(*) as count from storage.buckets where id = 'banner-drafts'`,
    );
    expect(Number(rows[0]!.count)).toBe(1);
  });
});

describe('0077 draft columns', () => {
  it('starts empty for every existing banner, so published rows render unchanged', async () => {
    await insertBanner(BANNER_ID);
    const { rows } = await db.query<{ draft_image_path: string | null; draft_image_mobile_path: string | null }>(
      'select draft_image_path, draft_image_mobile_path from banners where id = $1',
      [BANNER_ID],
    );
    expect(rows[0]).toEqual({ draft_image_path: null, draft_image_mobile_path: null });
  });

  it('accepts its own private paths and the pre-insert `_draft` folder', async () => {
    await insertBanner(OTHER_BANNER_ID, {
      draft_image_path: `banners/_draft/${FILE_ID}.webp`,
      draft_image_mobile_path: `banners/${OTHER_BANNER_ID}/${FILE_ID}.jpg`,
    });
    const { rows } = await db.query<{ draft_image_path: string; draft_image_mobile_path: string }>(
      'select draft_image_path, draft_image_mobile_path from banners where id = $1',
      [OTHER_BANNER_ID],
    );
    expect(rows[0]!.draft_image_path).toBe(`banners/_draft/${FILE_ID}.webp`);
    expect(rows[0]!.draft_image_mobile_path).toBe(`banners/${OTHER_BANNER_ID}/${FILE_ID}.jpg`);
  });

  it('REJECTS a public or signed URL — private artwork can never be stored as a link', async () => {
    const urlMessage = await errorOf(db, 'service', (tx) =>
      tx.query(`update banners set draft_image_path = $1 where id = $2`, [
        `https://proj.supabase.co/storage/v1/object/public/banner-drafts/banners/_draft/${FILE_ID}.webp`,
        BANNER_ID,
      ]),
    );
    expect(urlMessage).toContain('banners_draft_image_path_check');

    const signedMessage = await errorOf(db, 'service', (tx) =>
      tx.query(`update banners set draft_image_mobile_path = $1 where id = $2`, [
        `https://proj.supabase.co/storage/v1/object/sign/banner-drafts/banners/_draft/${FILE_ID}.webp?token=secret`,
        BANNER_ID,
      ]),
    );
    expect(signedMessage).toContain('banners_draft_image_mobile_path_check');
  });

  it('rejects a path belonging to a DIFFERENT banner', async () => {
    const message = await errorOf(db, 'service', (tx) =>
      tx.query(`update banners set draft_image_path = $1 where id = $2`, [
        `banners/${OTHER_BANNER_ID}/${FILE_ID}.webp`,
        BANNER_ID,
      ]),
    );
    expect(message).toContain('banners_draft_image_path_check');
  });

  it('rejects unsafe, non-image and traversal paths', async () => {
    for (const bad of [
      `banners/_draft/../../etc/passwd.webp`,
      `banners/_draft/${FILE_ID}.svg`,
      `banners/_draft/${FILE_ID}`,
      `banners/_draft/${FILE_ID}.webp/extra`,
      `product-images/_draft/${FILE_ID}.webp`,
      `banners/${FILE_ID.toUpperCase()}/${FILE_ID}.webp`,
    ]) {
      const message = await errorOf(db, 'service', (tx) =>
        tx.query(`update banners set draft_image_path = $1 where id = $2`, [bad, BANNER_ID]),
      );
      expect(message, bad).toContain('banners_draft_image_path_check');
    }
  });

  it('agrees with the TypeScript validator for the same set of paths', async () => {
    const candidates = [
      `banners/_draft/${FILE_ID}.webp`,
      `banners/${BANNER_ID}/${FILE_ID}.jpg`,
      `banners/${OTHER_BANNER_ID}/${FILE_ID}.png`,
      `banners/_draft/${FILE_ID}.gif`,
      `banners/_draft/${FILE_ID}.webp `,
      `banners//${FILE_ID}.webp`,
    ];

    for (const candidate of candidates) {
      const allowed = DRAFT_BANNER_PATH_RE.test(candidate);
      const id = candidate.includes(OTHER_BANNER_ID) ? OTHER_BANNER_ID : BANNER_ID;
      if (allowed && candidate.includes(OTHER_BANNER_ID)) continue;

      if (allowed) {
        await db.query(`update banners set draft_image_path = $1 where id = $2`, [candidate, id]);
      } else {
        const message = await errorOf(db, 'service', (tx) =>
          tx.query(`update banners set draft_image_path = $1 where id = $2`, [candidate, id]),
        );
        expect(message, candidate).not.toBeNull();
      }
    }
  });
});

describe('0077 storage policies enforce admin-only access', () => {
  /**
   * The PGlite harness stubs `storage.objects` with RLS enabled but without
   * Supabase's default table grants, so an API role would be refused at the
   * privilege layer before any policy ran. Grant what Supabase grants, then the
   * behaviour under test is the POLICY — which is the actual security boundary.
   */
  async function grantStorageApiAccess() {
    await db.exec(`
      grant select, insert, update, delete on storage.objects to anon, authenticated;
    `);
  }

  it('hides draft objects from a retailer and from anon, and shows them to an admin', async () => {
    await grantStorageApiAccess();

    const retailer = await createUser(db, 'retailer');
    const admin = await createUser(db, 'admin');
    const objectPath = `banners/${BANNER_ID}/${FILE_ID}.webp`;

    await db.query(`insert into storage.objects (bucket_id, name) values ('banner-drafts', $1)`, [objectPath]);

    const visibleTo = async (who: string) => {
      const { rows } = await as(db, who, (tx) =>
        tx.query<{ name: string }>('select name from storage.objects where bucket_id = $1', ['banner-drafts']),
      );
      return rows.map((row) => row.name);
    };

    expect(await visibleTo(retailer)).toEqual([]);
    expect(await visibleTo('anon')).toEqual([]);
    expect(await visibleTo(admin)).toEqual([objectPath]);
  });

  it('refuses an insert from a retailer and from anon', async () => {
    await grantStorageApiAccess();

    const retailer = await createUser(db, 'retailer');
    for (const who of [retailer, 'anon']) {
      const message = await errorOf(db, who, (tx) =>
        tx.query(`insert into storage.objects (bucket_id, name) values ('banner-drafts', $1)`, [
          `banners/_draft/${FILE_ID}.webp`,
        ]),
      );
      expect(message, who).not.toBeNull();
    }
  });

  it('refuses a delete from a retailer, so draft art cannot be destroyed by a lower role', async () => {
    await grantStorageApiAccess();

    const retailer = await createUser(db, 'retailer');
    const admin = await createUser(db, 'admin');
    const objectPath = `banners/${BANNER_ID}/${FILE_ID}.jpg`;
    await db.query(`insert into storage.objects (bucket_id, name) values ('banner-drafts', $1)`, [objectPath]);

    // RLS filters the row out, so a retailer's delete affects zero rows.
    const result = await as(db, retailer, (tx) =>
      tx.query(`delete from storage.objects where bucket_id = 'banner-drafts' and name = $1`, [objectPath]),
    );
    expect(result.affectedRows ?? 0).toBe(0);

    const { rows } = await db.query<{ n: number | string }>(
      `select count(*) as n from storage.objects where bucket_id = 'banner-drafts' and name = $1`,
      [objectPath],
    );
    expect(Number(rows[0]!.n)).toBe(1);

    // An admin may remove it.
    await as(db, admin, (tx) =>
      tx.query(`delete from storage.objects where bucket_id = 'banner-drafts' and name = $1`, [objectPath]),
    );
    const after = await db.query<{ n: number | string }>(
      `select count(*) as n from storage.objects where bucket_id = 'banner-drafts' and name = $1`,
      [objectPath],
    );
    expect(Number(after.rows[0]!.n)).toBe(0);
  });
});

describe('rollback 0077 is non-destructive', () => {
  it('keeps the bucket, the policies, the columns and every object', async () => {
    const { readFileSync } = await import('node:fs');
    const path = await import('node:path');
    const sql = readFileSync(
      path.join(__dirname, '..', 'supabase', 'rollbacks', '0077_banner_draft_artwork.sql'),
      'utf8',
    );

    const before = await db.query<{ count: number | string }>(
      `select count(*) as count from storage.objects where bucket_id = 'banner-drafts'`,
    );

    await db.exec(sql);

    const bucket = await db.query<{ public: boolean }>(
      `select public from storage.buckets where id = 'banner-drafts'`,
    );
    expect(bucket.rows).toHaveLength(1);
    expect(bucket.rows[0]!.public).toBe(false);

    const policies = await db.query<{ count: number | string }>(
      `select count(*) as count from pg_policy
        where polrelid = 'storage.objects'::regclass and polname like '%banner_drafts%'`,
    );
    expect(Number(policies.rows[0]!.count)).toBe(4);

    const columns = await db.query<{ column_name: string }>(
      `select column_name from information_schema.columns
        where table_schema = 'public' and table_name = 'banners'
          and column_name in ('draft_image_path', 'draft_image_mobile_path')
        order by column_name`,
    );
    expect(columns.rows.map((row) => row.column_name)).toEqual([
      'draft_image_mobile_path',
      'draft_image_path',
    ]);

    const after = await db.query<{ count: number | string }>(
      `select count(*) as count from storage.objects where bucket_id = 'banner-drafts'`,
    );
    expect(Number(after.rows[0]!.count)).toBe(Number(before.rows[0]!.count));
  });

  it('declares no destructive statement at all', async () => {
    const { readFileSync } = await import('node:fs');
    const path = await import('node:path');
    const sql = readFileSync(
      path.join(__dirname, '..', 'supabase', 'rollbacks', '0077_banner_draft_artwork.sql'),
      'utf8',
    );
    // Comments explain the manual procedure; no statement may match.
    const statements = sql.replace(/--[^\n]*/g, '').toLowerCase();
    expect(statements).not.toMatch(/\bdrop\s+(table|column|policy|bucket|schema)\b/);
    expect(statements).not.toMatch(/\bdelete\s+from\b/);
    expect(statements).not.toMatch(/\btruncate\b/);
    expect(statements).not.toMatch(/\bupdate\s+storage\./);
  });
});
