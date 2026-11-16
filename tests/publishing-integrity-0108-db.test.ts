import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  as,
  createMigratedDb,
  createRetailer,
  createUser,
  errorOf,
  type Db,
  type Tx,
} from './helpers/pg-harness';

/**
 * Migration 0108 — evidence integrity for website content (real PostgreSQL 16).
 *
 * Two defects were reproduced on the 0104/0105 schema and are each asserted
 * here as an executed statement that must now fail:
 *
 *   1. a legal/owner approval could be attributed to an account that never
 *      recorded it (`reviewed_by` was caller-supplied);
 *   2. `status = 'published'` could be set by a plain UPDATE, producing a
 *      published row with no snapshot and no publishing-history entry.
 *
 * The tests also prove the guard did NOT break the legitimate paths: the
 * publish/unpublish RPCs, the documented owner-run stage-1 publication script,
 * and ordinary draft saves all still work.
 */
describe('0108 publishing integrity (PostgreSQL 16)', () => {
  let db: Db;
  let superAdmin: string;
  let otherSuperAdmin: string;
  let admin: string;
  let retailer: string;

  beforeAll(async () => {
    db = await createMigratedDb();
    superAdmin = await createUser(db, 'super_admin');
    otherSuperAdmin = await createUser(db, 'super_admin');
    admin = await createUser(db, 'admin');
    retailer = (await createRetailer(db)).id;
  }, 180_000);
  afterAll(async () => { await db.close(); });

  const pageId = async (slug: string): Promise<string> =>
    (await db.query<{ id: string }>(`select id from public.site_pages where slug = $1`, [slug])).rows[0]!.id;

  /** Publishes a seeded page through the authorised RPC. */
  const publish = async (slug: string, actor = superAdmin) => {
    const id = await pageId(slug);
    await as(db, actor, (tx) => tx.query(`select public.publish_site_page($1)`, [id]));
    return id;
  };

  /* ---------------------------------------------------------------------- */
  /* Defect 1 — forged approval attribution                                 */
  /* ---------------------------------------------------------------------- */

  describe('approval attribution', () => {
    it('refuses to attribute an approval to an account that did not record it', async () => {
      const id = await pageId('terms');
      // Before 0108 this statement SUCCEEDED and left a record saying
      // `otherSuperAdmin` had approved the legal wording. It is now rejected
      // outright rather than silently re-attributed: a forged approval is an
      // attack, and rewriting it quietly would hide that it was attempted.
      const error = await errorOf(db, superAdmin, (tx) => tx.query(
        `update public.site_page_admin_notes
            set review_status = 'owner_approved', reviewed_by = $2, reviewed_at = now()
          where page_id = $1`, [id, otherSuperAdmin]));
      expect(error).toMatch(/signed-in Super Admin, not another account/);

      // Nothing was written: the page is still awaiting review.
      const row = (await db.query<{ review_status: string; reviewed_by: string | null }>(
        `select review_status, reviewed_by from public.site_page_admin_notes where page_id = $1`, [id])).rows[0]!;
      expect(row.reviewed_by).toBeNull();
      expect(row.review_status).not.toBe('owner_approved');
    });

    it('accepts the approval the application actually sends (reviewed_by = auth.uid())', async () => {
      const id = await pageId('terms');
      await as(db, superAdmin, (tx) => tx.query(
        `update public.site_page_admin_notes
            set review_status = 'owner_approved', reviewed_by = $2, reviewed_at = now()
          where page_id = $1`, [id, superAdmin]));
      const row = (await db.query<{ reviewed_by: string; reviewed_at: string }>(
        `select reviewed_by, reviewed_at from public.site_page_admin_notes where page_id = $1`, [id])).rows[0]!;
      expect(row.reviewed_by).toBe(superAdmin);
      expect(row.reviewed_at).toBeTruthy();
    });

    it('stamps the approval time itself, so a review cannot be back-dated', async () => {
      const id = await pageId('privacy');
      const before = Date.now();
      await as(db, superAdmin, (tx) => tx.query(
        `update public.site_page_admin_notes
            set review_status = 'legal_reviewed', reviewed_by = $2, reviewed_at = timestamptz '2000-01-01 00:00:00+00'
          where page_id = $1`, [id, superAdmin]));
      const row = (await db.query<{ reviewed_at: string }>(
        `select reviewed_at from public.site_page_admin_notes where page_id = $1`, [id])).rows[0]!;
      expect(new Date(row.reviewed_at).getTime()).toBeGreaterThan(before - 60_000);
      expect(new Date(row.reviewed_at).getUTCFullYear()).toBeGreaterThan(2000);
    });

    it('keeps the original approval time when the notes are re-saved', async () => {
      const id = await pageId('returns');
      await as(db, superAdmin, (tx) => tx.query(
        `update public.site_page_admin_notes
            set review_status = 'owner_approved', reviewed_by = $2, reviewed_at = now()
          where page_id = $1`, [id, superAdmin]));
      const first = (await db.query<{ reviewed_at: string }>(
        `select reviewed_at from public.site_page_admin_notes where page_id = $1`, [id])).rows[0]!.reviewed_at;

      await new Promise((resolve) => setTimeout(resolve, 15));
      // Re-save the same approval state (an operator editing the internal note).
      await as(db, superAdmin, (tx) => tx.query(
        `update public.site_page_admin_notes
            set internal_notes = 'Reviewed with the owner on the call.'
          where page_id = $1`, [id]));
      const second = (await db.query<{ reviewed_at: string }>(
        `select reviewed_at from public.site_page_admin_notes where page_id = $1`, [id])).rows[0]!.reviewed_at;
      expect(new Date(second).getTime()).toBe(new Date(first).getTime());
    });

    it('refuses an approval inserted from scratch against another account', async () => {
      // A page with no notes row yet, so the INSERT path is exercised.
      const id = await as(db, superAdmin, async (tx: Tx) =>
        (await tx.query<{ id: string }>(
          `insert into public.site_pages (slug, nav_label, title, intro, kind, effective_date)
           values ('attribution-probe', 'Probe', 'Attribution probe', 'A page used to probe attribution.', 'page', date '2026-11-16')
           returning id`,
        )).rows[0]!.id);

      const error = await errorOf(db, superAdmin, (tx) => tx.query(
        `insert into public.site_page_admin_notes (page_id, review_status, reviewed_by, reviewed_at)
         values ($1, 'owner_approved', $2, now())`, [id, otherSuperAdmin]));
      expect(error).toMatch(/signed-in Super Admin, not another account/);

      const { rows } = await db.query<{ n: string }>(
        `select count(*)::text as n from public.site_page_admin_notes where page_id = $1`, [id]);
      expect(rows[0]!.n, 'no notes row may be created by the refused statement').toBe('0');
    });

    it('still shows a plain admin and a retailer nothing, and lets them change nothing', async () => {
      const id = await pageId('terms');
      // RLS filters rather than raises: the statement affects zero rows and the
      // read returns zero rows. Both are asserted, because "no error" is not
      // the same as "was allowed".
      const adminUpdate = await as(db, admin, (tx) => tx.query(
        `update public.site_page_admin_notes set internal_notes = 'admin was here'
          where page_id = $1`, [id]));
      expect(adminUpdate.affectedRows ?? 0).toBe(0);

      for (const who of [admin, retailer]) {
        const seen = await as(db, who, (tx) => tx.query(`select page_id from public.site_page_admin_notes`));
        expect(seen.rows, who).toEqual([]);
      }
    });
  });

  /* ---------------------------------------------------------------------- */
  /* Defect 2 — silent publication                                          */
  /* ---------------------------------------------------------------------- */

  describe('publication cannot bypass the snapshot', () => {
    it('refuses `status = published` by a direct UPDATE with no snapshot', async () => {
      const id = await pageId('shipping');
      const error = await errorOf(db, superAdmin, (tx) => tx.query(
        `update public.site_pages set status = 'published' where id = $1`, [id]));
      expect(JSON.stringify(error)).toMatch(/published snapshot|publish_site_page/i);

      const row = (await db.query<{ status: string; published_snapshot: string | null }>(
        `select status, published_snapshot from public.site_pages where id = $1`, [id])).rows[0]!;
      expect(row.status, 'the refused update must not have applied').toBe('draft');
      expect(row.published_snapshot).toBeNull();
    });

    it('refuses a snapshot that does not match the current draft', async () => {
      const id = await pageId('grievance');
      // Hand-written JSON is not the page's content; publishing it would put
      // text live that exists in no draft and no history row.
      const error = await errorOf(db, superAdmin, (tx) => tx.query(
        `update public.site_pages
            set status = 'published',
                published_at = now(),
                published_snapshot = '{"title":"Forged","intro":"Forged","version":"1.0","effective_date":"2026-11-16","sections":[]}'::jsonb
          where id = $1`, [id]));
      expect(JSON.stringify(error)).toMatch(/does not match this draft|published snapshot/i);
    });

    it('refuses to unpublish by a direct UPDATE that keeps the snapshot', async () => {
      const id = await publish('terms');
      const error = await errorOf(db, superAdmin, (tx) => tx.query(
        `update public.site_pages set status = 'draft' where id = $1`, [id]));
      expect(JSON.stringify(error)).toMatch(/unpublish_site_page|snapshot must be cleared/i);
    });

    it('still publishes through the RPC, with snapshot, timestamp and history', async () => {
      const id = await publish('about');
      const row = (await db.query<{
        status: string; published_at: string | null; published_by: string | null; snapshot: string | null;
      }>(`select status, published_at, published_by, published_snapshot::text as snapshot
            from public.site_pages where id = $1`, [id])).rows[0]!;
      expect(row.status).toBe('published');
      expect(row.published_at).toBeTruthy();
      expect(row.published_by).toBe(superAdmin);
      expect(row.snapshot).toBeTruthy();

      const revision = (await db.query<{ n: string }>(
        `select count(*)::text as n from public.site_page_revisions where page_id = $1 and event = 'published'`, [id])).rows[0]!;
      expect(revision.n).toBe('1');
    });

    it('still unpublishes through the RPC', async () => {
      const id = await publish('returns');
      await as(db, superAdmin, (tx) => tx.query(`select public.unpublish_site_page($1)`, [id]));
      const row = (await db.query<{ status: string; snapshot: string | null }>(
        `select status, published_snapshot::text as snapshot from public.site_pages where id = $1`, [id])).rows[0]!;
      expect(row.status).toBe('draft');
      expect(row.snapshot).toBeNull();
    });

    it('leaves ordinary draft editing untouched', async () => {
      const id = await publish('privacy');
      await as(db, superAdmin, (tx) => tx.query(
        `update public.site_pages set title = 'Privacy Policy (draft edit)' where id = $1`, [id]));
      const row = (await db.query<{ status: string; title: string }>(
        `select status, title from public.site_pages where id = $1`, [id])).rows[0]!;
      expect(row.status, 'a draft save must not change the publication state').toBe('published');
      expect(row.title).toContain('draft edit');
    });

    it('accepts the documented owner-run stage-1 publication script', async () => {
      // supabase/publication/stage1_publish_live_text.sql writes a real snapshot
      // with a direct UPDATE by design. 0108 must not break it, or the owner
      // could no longer publish the wording that was already public.
      const stageOne = readFileSync(
        join(__dirname, '..', 'supabase', 'publication', 'stage1_publish_live_text.sql'), 'utf8',
      );
      await db.exec(stageOne);
      const { rows } = await db.query<{ n: string }>(
        `select count(*)::text as n from public.site_pages where status = 'published' and published_snapshot is not null`,
      );
      expect(Number(rows[0]!.n)).toBeGreaterThan(0);
    });
  });

  /* ---------------------------------------------------------------------- */
  /* Rollback                                                               */
  /* ---------------------------------------------------------------------- */

  describe('rollback', () => {
    it('drops both guards and leaves the published content readable', async () => {
      const rollback = readFileSync(
        join(__dirname, '..', 'supabase', 'rollbacks', '0108_publishing_integrity.down.sql'), 'utf8',
      );
      const before = (await db.query<{ n: string }>(
        `select count(*)::text as n from public.site_pages where status = 'published'`)).rows[0]!.n;

      await db.exec(rollback);

      const triggers = (await db.query<{ tgname: string }>(
        `select tgname from pg_trigger
          where tgrelid = 'public.site_pages'::regclass and not tgisinternal
            and tgname = 'trg_guard_site_pages_publish_path'`)).rows;
      expect(triggers).toEqual([]);
      const functions = (await db.query<{ n: string }>(
        `select count(*)::text as n from pg_proc where proname in
           ('guard_site_pages_publish_path', 'guard_site_page_admin_notes_author')`)).rows[0]!;
      expect(functions.n).toBe('0');

      const after = (await db.query<{ n: string }>(
        `select count(*)::text as n from public.site_pages where status = 'published'`)).rows[0]!.n;
      expect(after, 'a rollback must never unpublish a page').toBe(before);
    });
  });
});
