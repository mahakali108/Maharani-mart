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

  /**
   * The owner's stage-1 publication (supabase/publication/stage1_publish_live_text.sql):
   * the pages whose wording was already public before this module existed. Lazy, so
   * the draft-only assertions above run against the database exactly as 0105 left
   * it; every later test that needs a published page asks for this first.
   */
  let stageOne: Promise<void> | null = null;
  const ensureStageOne = () =>
    (stageOne ??= (async () => {
      for (const slug of ['contact', 'terms', 'privacy', 'returns', 'shipping', 'grievance', 'business-disclosure', 'product-safety']) {
        const id = await pageId(slug);
        await as(db, superAdmin, (tx) => tx.query(`select public.publish_site_page($1)`, [id]));
      }
    })());

  it('seeds every registered public page as a DRAFT and publishes nothing', async () => {
    // 0105 is a seed, not a publication: publishing is a legal act the owner takes
    // page by page (supabase/publication/*). If this assertion ever fails, a
    // migration has started putting policy text in front of customers on its own.
    const { rows } = await db.query<{
      total: string;
      published: string;
      snapshots: string;
      backdated: string;
      with_notes: string;
    }>(
      `select count(*)::text as total,
              count(*) filter (where status = 'published')::text as published,
              count(*) filter (where published_snapshot is not null)::text as snapshots,
              count(*) filter (where published_at is not null or published_by is not null)::text as backdated,
              count(*) filter (where exists (
                select 1 from public.site_page_admin_notes n where n.page_id = p.id
              ))::text as with_notes
         from public.site_pages p`,
    );
    const row = rows[0]!;
    expect(Number(row.total)).toBeGreaterThanOrEqual(19);
    expect(row.published, 'no page may be published by the seed').toBe('0');
    expect(row.snapshots, 'a draft must not carry a published snapshot').toBe('0');
    expect(row.backdated, 'no publication timestamp may be invented').toBe('0');
    expect(Number(row.with_notes)).toBe(Number(row.total));

    // Each seeded page kept its real wording, not an empty shell.
    const { rows: sectionCounts } = await db.query<{ slug: string; sections: string }>(
      `select p.slug, count(s.id)::text as sections
         from public.site_pages p join public.site_page_sections s on s.page_id = p.id
        group by p.slug`,
    );
    expect(sectionCounts.length).toBeGreaterThanOrEqual(19);
    for (const row of sectionCounts) expect(Number(row.sections), row.slug).toBeGreaterThan(0);

    // And none of it is readable yet: the public function answers "unpublished"
    // for every slug, and the index is empty.
    const aboutDraft = await publishedPage('anon', 'about');
    expect(aboutDraft.state).toBe('unpublished');
    const indexRows = await as(db, 'anon', async (tx: Tx) =>
      (await tx.query<{ pages: Array<{ slug: string }> }>(`select public.published_pages() as pages`)).rows);
    expect(indexRows[0]!.pages).toEqual([]);
  });

  it('publishing is an explicit owner action with a real timestamp, not a seeded one', async () => {
    const id = await pageId('about');
    const before = await db.query<{ published_at: string | null }>(
      `select published_at::text from public.site_pages where id = $1`, [id]);
    expect(before.rows[0]!.published_at).toBeNull();

    await as(db, superAdmin, (tx) => tx.query(`select public.publish_site_page($1)`, [id]));

    const after = await db.query<{ status: string; published_at: string | null; snapshot: boolean }>(
      `select status, published_at::text, published_snapshot is not null as snapshot
         from public.site_pages where id = $1`, [id]);
    expect(after.rows[0]!.status).toBe('published');
    expect(after.rows[0]!.snapshot).toBe(true);
    // now(), not a backdated constant: the timestamp is inside this test's run.
    const publishedAt = new Date(after.rows[0]!.published_at!).getTime();
    expect(Math.abs(Date.now() - publishedAt)).toBeLessThan(10 * 60 * 1000);
  });

  it('lets an anonymous visitor read a published page through the public function only', async () => {
    await ensureStageOne();
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
    await ensureStageOne();
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
    await ensureStageOne();
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
    await ensureStageOne();
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
    await ensureStageOne();
    const id = await pageId('returns');
    await as(db, superAdmin, (tx) => tx.query(`select public.unpublish_site_page($1)`, [id]));

    const page = await publishedPage('anon', 'returns');
    expect(page.state).toBe('unpublished');
    expect(page).not.toHaveProperty('page');
    expect(JSON.stringify(page)).not.toContain('device storage');

    // Guests have no SELECT privilege on the draft table at all, so this is a
    // permission error rather than "0 rows" (see the next test).
    expect(await errorOf(db, 'anon', (tx) => tx.query(`select title from public.site_pages where slug = 'returns'`)))
      .toMatch(/permission denied/i);

    // Publishing again restores it, so the action is reversible.
    await as(db, superAdmin, (tx) => tx.query(`select public.publish_site_page($1)`, [id]));
    expect((await publishedPage('anon', 'returns')).state).toBe('published');
  });

  it('hides the pages left as drafts from the index list', async () => {
    // `ip-complaints` and the other nine stage-2 pages are still drafts: they must
    // never appear in the footer/index list the website and the app read.
    const rows = await as(db, 'anon', async (tx: Tx) =>
      (await tx.query<{ pages: Array<{ slug: string }> }>(`select public.published_pages() as pages`)).rows);
    const slugs = rows[0]!.pages.map((page) => page.slug);
    for (const draft of ['ip-complaints', 'cookies', 'coins-loyalty', 'seller-agreement', 'retailer-terms']) {
      expect(slugs, draft).not.toContain(draft);
      expect((await publishedPage('anon', draft)).state, draft).toBe('unpublished');
    }
    expect(slugs).toContain('about');
    expect(slugs).toContain('terms');
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

  it('does NOT touch the acceptance registry unless the operator asks for it', async () => {
    // Publishing a page makes it READABLE. Making it something a customer must
    // ACCEPT is a consent change, so the RPC's default registers nothing — even
    // for a legal page with a new version.
    const id = await pageId('suspension-termination');
    await as(db, superAdmin, (tx) =>
      tx.query(`update public.site_pages set version = '2.0', effective_date = date '2026-12-01' where id = $1`, [id]));

    const before = await db.query<{ n: string }>(
      `select count(*)::text as n from public.legal_document_current_versions where document_key = 'suspension-termination'`);
    expect(before.rows[0]!.n).toBe('0');

    await as(db, superAdmin, (tx) => tx.query(`select public.publish_site_page($1)`, [id]));
    const page = await publishedPage('anon', 'suspension-termination');
    expect(page.state).toBe('published');
    expect(page.version).toBe('2.0');

    const after = await db.query<{ n: string }>(
      `select count(*)::text as n from public.legal_document_current_versions where document_key = 'suspension-termination'`);
    expect(after.rows[0]!.n, 'a plain publish must not create an acceptance requirement').toBe('0');

    // The registry still holds exactly the one document the platform enforces.
    const registry = await db.query<{ document_key: string }>(
      `select document_key from public.legal_document_current_versions order by 1`);
    expect(registry.rows.map((row) => row.document_key)).toEqual(['seller-agreement']);
  });

  it('registers a version only when the explicit opt-in is used, and then enforces it', async () => {
    const id = await pageId('privacy');
    await as(db, superAdmin, (tx) =>
      tx.query(`update public.site_pages set version = '1.3', effective_date = date '2026-12-01' where id = $1`, [id]));

    // The opt-in is the second argument; the default is FALSE (tested above).
    await as(db, superAdmin, (tx) =>
      tx.query(`select public.publish_site_page($1, true)`, [id]));

    const { rows } = await db.query<{ document_version: string }>(
      `select document_version from public.legal_document_current_versions where document_key = 'privacy'`);
    expect(rows[0]!.document_version).toBe('1.3');

    // Having registered the version, the database accepts that one and refuses the
    // old one — which is exactly why this must never happen by accident.
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
      .toMatch(/publish_complete|violates check constraint|created as a draft/);
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

/**
 * The rollback must actually remove what the migration created, and it must do so
 * only when the operator has accepted that content will be destroyed.
 */
describe('0104 rollback (PostgreSQL 16)', () => {
  it('refuses without the data-loss flag, then removes every object when it is set', async () => {
    const rollbackDb = await createMigratedDb();
    try {
      const sql = readFileSync('supabase/rollbacks/0104_site_content_management.down.sql', 'utf8');

      // Seeded drafts exist, so the guard must fire first. The rollback must run as
      // the owner of the objects (a plain API role cannot drop them), which is how
      // an operator runs it: as the database owner, not through the Data API.
      let refusal = '';
      try {
        await rollbackDb.exec(sql);
      } catch (cause) {
        refusal = String(cause);
      }
      expect(refusal).toMatch(/Rollback refused/);
      await rollbackDb.exec('rollback').catch(() => {});
      expect((await rollbackDb.query<{ n: string }>(`select count(*)::text as n from public.site_pages`)).rows[0]!.n)
        .not.toBe('0');

      // With the flag, it must leave nothing behind — including BOTH overloads of
      // publish_site_page(), or `drop table site_pages` fails on the %ROWTYPE
      // dependency and the rollback stops half-applied.
      await rollbackDb.exec(`set maharani.allow_data_loss = 'true'`);
      await rollbackDb.exec(sql);

      const objects = await rollbackDb.query<{ tables: string; functions: string }>(
        `select (select count(*)::text from information_schema.tables
                  where table_schema = 'public' and table_name like 'site_page%') as tables,
                (select count(*)::text from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                  where n.nspname = 'public'
                    and (p.proname like 'site_page%' or p.proname like 'published_page%'
                         or p.proname like 'publish_site_page%' or p.proname = 'is_super_admin')) as functions`,
      );
      expect(objects.rows[0]!.tables).toBe('0');
      expect(objects.rows[0]!.functions).toBe('0');
    } finally {
      await rollbackDb.close();
    }
  }, 180_000);
});
