import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { as, createMigratedDb, createRetailer, createUser, errorOf, type Db, type Tx } from './helpers/pg-harness';

/**
 * Migration 0104/0105 on real PostgreSQL 16 (PGlite): the website content module.
 *
 * These assertions are about what the DATABASE allows, not what a page happens to
 * render. Every "cannot" below is an executed statement that must fail, and every
 * "sees only" is a row count returned to a real `anon` / `authenticated` role.
 */
describe('0104/0105 website content management (PostgreSQL 16)', () => {
  let db: Db;
  let superAdmin: string;
  let admin: string;
  let retailer: string;

  beforeAll(async () => {
    db = await createMigratedDb();
    superAdmin = await createUser(db, 'super_admin');
    admin = await createUser(db, 'admin');
    retailer = (await createRetailer(db)).id;
  }, 180_000);
  afterAll(async () => { await db.close(); });

  const pageId = async (slug: string): Promise<string> =>
    (await db.query<{ id: string }>(`select id from public.site_pages where slug = $1`, [slug])).rows[0]!.id;

  const publishedPage = (who: string, slug: string) =>
    as(db, who, async (tx: Tx) =>
      (await tx.query<{ p: Record<string, unknown> }>(`select public.published_page($1) as p`, [slug])).rows[0]!.p);

  it('seeds every registered public page as published, with a snapshot', async () => {
    const { rows } = await db.query<{ total: string; published: string; snapshots: string }>(
      `select count(*)::text as total,
              count(*) filter (where status = 'published')::text as published,
              count(*) filter (where published_snapshot is not null)::text as snapshots
         from public.site_pages`,
    );
    expect(Number(rows[0]!.total)).toBeGreaterThanOrEqual(19);
    expect(rows[0]!.published).toBe(rows[0]!.total);
    expect(rows[0]!.snapshots).toBe(rows[0]!.total);

    // Each seeded page kept its real wording, not an empty shell.
    const { rows: sectionCounts } = await db.query<{ slug: string; sections: string }>(
      `select p.slug, count(s.id)::text as sections
         from public.site_pages p join public.site_page_sections s on s.page_id = p.id
        group by p.slug`,
    );
    expect(sectionCounts.length).toBeGreaterThanOrEqual(19);
    for (const row of sectionCounts) expect(Number(row.sections), row.slug).toBeGreaterThan(0);
  });

  it('lets an anonymous visitor read a published page through the public function only', async () => {
    const page = await publishedPage('anon', 'about');
    expect(page.state).toBe('published');
    expect(typeof page.version).toBe('string');
    expect(JSON.stringify(page)).not.toMatch(/internal_notes|owner_decisions|review_status/);
    // The published body really is page content, not metadata.
    expect(JSON.stringify(page)).toContain('Maharani Traders');
  });

  it('never exposes a draft, the internal notes or the publishing history to a customer', async () => {
    // Anonymous callers have no table privilege at all on the internal tables.
    expect(await errorOf(db, 'anon', (tx) => tx.query(`select internal_notes from public.site_page_admin_notes`)))
      .toMatch(/permission denied/);
    expect(await errorOf(db, 'anon', (tx) => tx.query(`select snapshot from public.site_page_revisions`)))
      .toMatch(/permission denied/);

    // A signed-in customer holds the privilege, so RLS must return zero rows.
    for (const [who, table] of [[retailer, 'site_page_admin_notes'], [retailer, 'site_page_revisions']] as const) {
      const rows = await as(db, who, async (tx: Tx) =>
        (await tx.query<{ n: string }>(`select count(*)::text as n from public.${table}`)).rows);
      expect(rows[0]!.n, table).toBe('0');
    }

    // No customer can create or edit a page, even with the API privilege.
    expect(await errorOf(db, 'anon', (tx) => tx.query(`insert into public.site_pages (slug, nav_label, title) values ('hack', 'Hack', 'Owned')`)))
      .toMatch(/permission denied/);
    expect(await errorOf(db, retailer, (tx) => tx.query(`insert into public.site_pages (slug, nav_label, title) values ('hack', 'Hack', 'Owned')`)))
      .toMatch(/row-level security/);

    const draftCount = await as(db, retailer, async (tx: Tx) =>
      (await tx.query<{ n: string }>(`select count(*)::text as n from public.site_pages where status = 'draft'`)).rows);
    expect(draftCount[0]!.n).toBe('0');
  });

  it('lets a plain admin read the published output but not the draft table, and never edit', async () => {
    // A plain admin reads exactly what a customer reads (the SECURITY DEFINER
    // snapshot functions) — not the draft columns, which are super-admin only.
    expect((await publishedPage('admin', 'about')).state).toBe('published');
    const indexRows = await as(db, admin, async (tx: Tx) =>
      (await tx.query<{ pages: Array<{ slug: string }> }>(`select public.published_pages() as pages`)).rows);
    expect(indexRows[0]!.pages.length).toBeGreaterThan(0);

    const visible = await as(db, admin, async (tx: Tx) =>
      (await tx.query<{ n: string }>(`select count(*)::text as n from public.site_pages`)).rows);
    expect(visible[0]!.n).toBe('0');

    // RLS filters the row out of the UPDATE: nothing changes, and nothing errors.
    await as(db, admin, (tx) => tx.query(`update public.site_pages set title = 'Admin edit' where slug = 'about'`));
    const after = await db.query<{ title: string }>(`select title from public.site_pages where slug = 'about'`);
    expect(after.rows[0]!.title).not.toBe('Admin edit');

    expect(await errorOf(db, admin, (tx) =>
      tx.query(`insert into public.site_pages (slug, nav_label, title) values ('admin-made', 'Admin', 'Admin')`)))
      .toMatch(/row-level security/);
  });

  it('keeps a draft invisible until it is published, and records the publishing history', async () => {
    const id = await pageId('about');

    // A super admin edits the draft. The public output must not change.
    await as(db, superAdmin, (tx) =>
      tx.query(`update public.site_pages set title = 'About Maharani Traders (draft edit)' where id = $1`, [id]));
    const before = await publishedPage('anon', 'about');
    expect(JSON.stringify(before)).not.toContain('draft edit');

    const draftRows = await as(db, superAdmin, async (tx: Tx) =>
      (await tx.query<{ title: string }>(`select title from public.site_pages where id = $1`, [id])).rows);
    expect(draftRows[0]!.title).toBe('About Maharani Traders (draft edit)');

    await as(db, superAdmin, (tx) => tx.query(`select public.publish_site_page($1)`, [id]));
    const after = await publishedPage('anon', 'about');
    expect(JSON.stringify(after)).toContain('draft edit');

    const { rows: history } = await db.query<{ event: string }>(
      `select event from public.site_page_revisions where page_id = $1 order by created_at desc`, [id]);
    expect(history[0]!.event).toBe('version_changed');
    expect(history.some((row) => row.event === 'published')).toBe(true);
  });

  it('no API role can read a draft column of a published page', async () => {
    // The page is PUBLISHED, so a row-level policy would say "yes". The draft
    // columns must still be unreachable: a column grant cannot be made
    // row-conditional, which is why anon has no grant at all and authenticated
    // reads are super-admin only. A regression here means unpublished legal text
    // is readable through the Data API before the operator publishes it.
    const id = await pageId('shipping');
    await as(db, superAdmin, (tx) =>
      tx.query(`update public.site_pages set intro = 'UNPUBLISHED DRAFT SENTENCE' where id = $1`, [id]));
    await as(db, superAdmin, (tx) =>
      tx.query(
        `insert into public.site_page_sections (page_id, heading, body, is_visible) values ($1, 'Draft heading', array['DRAFT BODY TEXT'], false)`,
        [id],
      ));

    for (const role of ['anon'] as const) {
      expect(await errorOf(db, role, (tx) => tx.query(`select intro from public.site_pages where id = $1`, [id])), role)
        .toMatch(/permission denied/i);
      expect(await errorOf(db, role, (tx) => tx.query(`select body from public.site_page_sections where page_id = $1`, [id])), role)
        .toMatch(/permission denied/i);
    }

    // An authenticated non-super-admin gets the table but no rows.
    const retailerRows = await as(db, retailer, async (tx: Tx) =>
      (await tx.query<{ n: string }>(`select count(*)::text as n from public.site_pages where id = $1`, [id])).rows);
    expect(retailerRows[0]!.n).toBe('0');
    const sectionRows = await as(db, retailer, async (tx: Tx) =>
      (await tx.query<{ n: string }>(`select count(*)::text as n from public.site_page_sections where page_id = $1`, [id])).rows);
    expect(sectionRows[0]!.n).toBe('0');

    // The published output still carries the last PUBLISHED text, not the draft.
    expect(JSON.stringify(await publishedPage('anon', 'shipping'))).not.toContain('UNPUBLISHED DRAFT SENTENCE');
    expect(JSON.stringify(await publishedPage('anon', 'shipping'))).not.toContain('DRAFT BODY TEXT');
  });

  it('unpublishes without leaving any content readable, and answers "not published" instead of 404', async () => {
    const id = await pageId('cookies');
    await as(db, superAdmin, (tx) => tx.query(`select public.unpublish_site_page($1)`, [id]));

    const page = await publishedPage('anon', 'cookies');
    expect(page.state).toBe('unpublished');
    expect(page).not.toHaveProperty('page');
    expect(JSON.stringify(page)).not.toContain('device storage');

    // Guests have no SELECT privilege on the draft table at all, so this is a
    // permission error rather than "0 rows" (see the next test).
    expect(await errorOf(db, 'anon', (tx) => tx.query(`select title from public.site_pages where slug = 'cookies'`)))
      .toMatch(/permission denied/i);

    // Publishing again restores it, so the action is reversible.
    await as(db, superAdmin, (tx) => tx.query(`select public.publish_site_page($1)`, [id]));
    expect((await publishedPage('anon', 'cookies')).state).toBe('published');
  });

  it('hides unpublished pages from the index list', async () => {
    const id = await pageId('ip-complaints');
    await as(db, superAdmin, (tx) => tx.query(`select public.unpublish_site_page($1)`, [id]));
    const rows = await as(db, 'anon', async (tx: Tx) =>
      (await tx.query<{ pages: Array<{ slug: string }> }>(`select public.published_pages() as pages`)).rows);
    const slugs = rows[0]!.pages.map((page) => page.slug);
    expect(slugs).not.toContain('ip-complaints');
    expect(slugs).toContain('about');
  });

  it('refuses to publish an incomplete page, for every caller including service', async () => {
    const id = await as(db, superAdmin, async (tx: Tx) => {
      const { rows } = await tx.query<{ id: string }>(
        `insert into public.site_pages (slug, nav_label, title, intro) values ('half-built', 'Half', 'Half built', '') returning id`);
      return rows[0]!.id;
    });

    expect(await errorOf(db, superAdmin, (tx) => tx.query(`select public.publish_site_page($1)`, [id])))
      .toMatch(/introduction|effective date|section/i);
  });

  it('only a super admin can publish or unpublish', async () => {
    const id = await pageId('terms');
    expect(await errorOf(db, retailer, (tx) => tx.query(`select public.publish_site_page($1)`, [id]))).toMatch(/Super Admin|permission denied/);
    expect(await errorOf(db, admin, (tx) => tx.query(`select public.unpublish_site_page($1)`, [id]))).toMatch(/Super Admin|permission denied/);
    expect(await errorOf(db, 'anon', (tx) => tx.query(`select public.publish_site_page($1)`, [id]))).toMatch(/permission denied/);
  });

  it('keeps the acceptance registry in step when a policy version is published', async () => {
    const id = await pageId('privacy');
    await as(db, superAdmin, (tx) =>
      tx.query(`update public.site_pages set version = '1.3', effective_date = date '2026-12-01' where id = $1`, [id]));
    await as(db, superAdmin, (tx) => tx.query(`select public.publish_site_page($1)`, [id]));

    const { rows } = await db.query<{ document_version: string }>(
      `select document_version from public.legal_document_current_versions where document_key = 'privacy'`);
    expect(rows[0]!.document_version).toBe('1.3');

    // A user can accept the newly published version, and the old one is refused.
    const accepted = await as(db, retailer, (tx: Tx) =>
      tx.query(`select public.record_legal_acceptance('privacy', '1.3', 'account')`));
    expect(accepted.rows).toHaveLength(1);
    expect(await errorOf(db, retailer, (tx) => tx.query(`select public.record_legal_acceptance('privacy', '1.0', 'account')`)))
      .toMatch(/LEGAL_VERSION_NOT_CURRENT/);
  });

  it('protects required pages from deletion and slug changes, and allows deleting an ordinary page', async () => {
    const id = await pageId('about');
    expect(await errorOf(db, superAdmin, (tx) => tx.query(`delete from public.site_pages where id = $1`, [id])))
      .toMatch(/cannot be deleted/);
    expect(await errorOf(db, superAdmin, (tx) => tx.query(`update public.site_pages set slug = 'about-us' where id = $1`, [id])))
      .toMatch(/cannot be changed/);

    const extra = await as(db, superAdmin, async (tx: Tx) =>
      (await tx.query<{ id: string }>(`insert into public.site_pages (slug, nav_label, title, intro) values ('seasonal-note', 'Seasonal', 'Seasonal note', 'A short note that is long enough to read.') returning id`)).rows[0]!.id);
    await as(db, superAdmin, (tx) => tx.query(`delete from public.site_pages where id = $1`, [extra]));
    const { rows } = await db.query<{ n: string }>(`select count(*)::text as n from public.site_pages where slug = 'seasonal-note'`);
    expect(rows[0]!.n).toBe('0');
  });

  it('rejects a page whose published state would be incomplete at the table level', async () => {
    expect(await errorOf(db, superAdmin, (tx) => tx.query(
      `insert into public.site_pages (slug, nav_label, title, intro, status) values ('sneaky', 'Sneaky', 'Sneaky', 'x', 'published')`)))
      .toMatch(/publish_complete|violates check constraint/);
  });

  it('accepts any syntactically valid page the Super Admin creates, including one not in the code', async () => {
    const id = await as(db, superAdmin, async (tx: Tx) =>
      (await tx.query<{ id: string }>(
        `insert into public.site_pages (slug, nav_label, title, intro, kind, effective_date)
         values ('new-launch-note', 'Launch note', 'Launch note', 'A brand new managed page.', 'page', date '2026-11-15') returning id`,
      )).rows[0]!.id);
    await as(db, superAdmin, (tx) => tx.query(
      `insert into public.site_page_sections (page_id, heading, body) values ($1, 'Notice', array['Everything is server managed.'])`, [id]));
    await as(db, superAdmin, (tx) => tx.query(`select public.publish_site_page($1)`, [id]));

    const page = await publishedPage('anon', 'new-launch-note');
    expect(page.state).toBe('published');
    expect(JSON.stringify(page)).toContain('server managed');
  });

  it('has a rollback that refuses to destroy content without an explicit opt-in', async () => {
    const sql = readFileSync('supabase/rollbacks/0104_site_content_management.down.sql', 'utf8');
    expect(sql).toMatch(/maharani\.allow_data_loss/);
    expect(sql).toMatch(/Rollback refused/);
    // Executed against a database with content: must raise, not delete.
    expect(await errorOf(db, 'service', async (tx) => { await tx.exec(sql); })).toMatch(/Rollback refused/);
    const { rows } = await db.query<{ n: string }>(`select count(*)::text as n from public.site_pages`);
    expect(Number(rows[0]!.n)).toBeGreaterThan(0);
  });
});
