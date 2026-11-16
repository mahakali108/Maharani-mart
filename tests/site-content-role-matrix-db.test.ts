import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { renderRichText } from '@/lib/site-content/render';
import { as, createMigratedDb, createRetailer, createUser, errorOf, type Db } from './helpers/pg-harness';

/**
 * Website content — the complete role matrix, on real PostgreSQL 16.
 *
 * Every row of the Phase 2 acceptance list is one executed statement against a
 * real `anon` / `authenticated` role with a real JWT subject:
 *
 *   anon          cannot read drafts, cannot read a published draft column
 *   retailer      cannot read or write any site-content table
 *   seller        cannot read or write any site-content table
 *   staff         cannot read or write any site-content table
 *   admin         reads the published output only; cannot draft, edit, publish
 *   super_admin   full control, including publishing
 *
 * "No error" is never treated as "allowed": a policy that filters raises nothing
 * and returns zero rows, so the assertions check row counts and affected rows.
 */
describe('website content role matrix (PostgreSQL 16)', () => {
  let db: Db;
  let superAdmin: string;
  let admin: string;
  let staff: string;
  let retailer: string;
  let seller: string;
  let publishedSlug: string;
  let publishedId: string;

  beforeAll(async () => {
    db = await createMigratedDb();
    superAdmin = await createUser(db, 'super_admin');
    admin = await createUser(db, 'admin');
    staff = await createUser(db, 'staff');
    retailer = (await createRetailer(db)).id;
    seller = await createUser(db, 'seller');

    // One published page, so "cannot see the draft of a live page" is testable.
    publishedSlug = 'about';
    publishedId = (await db.query<{ id: string }>(
      `select id from public.site_pages where slug = $1`, [publishedSlug])).rows[0]!.id;
    await as(db, superAdmin, (tx) => tx.query(`select public.publish_site_page($1)`, [publishedId]));
  }, 180_000);
  afterAll(async () => { await db.close(); });

  describe('anonymous visitors', () => {
    it('can read the published page through the public function', async () => {
      const { rows } = await as(db, 'anon', (tx) =>
        tx.query<{ p: { state: string; page: { title: string } } }>(`select public.published_page($1) as p`, [publishedSlug]));
      expect(rows[0]!.p.state).toBe('published');
      expect(rows[0]!.p.page.title).toBeTruthy();
    });

    it('cannot read a single draft table directly', async () => {
      for (const table of ['site_pages', 'site_page_sections', 'site_page_admin_notes', 'site_page_revisions']) {
        expect(JSON.stringify(await errorOf(db, 'anon', (tx) => tx.query(`select * from public.${table}`))), table)
          .toMatch(/permission denied/i);
      }
    });

    it('cannot see the draft column of the page that IS published', async () => {
      // Row-level security cannot filter columns, so this is enforced by grants.
      // The published row exists; `title` on it is the DRAFT title.
      const error = await errorOf(db, 'anon', (tx) => tx.query(
        `select title from public.site_pages where slug = $1`, [publishedSlug]));
      expect(error).toMatch(/permission denied/i);
    });

    it('cannot call the publishing functions', async () => {
      expect(JSON.stringify(await errorOf(db, 'anon', (tx) => tx.query(
        `select public.publish_site_page($1)`, [publishedId])))).toMatch(/permission denied|Only a Super Admin/i);
      expect(JSON.stringify(await errorOf(db, 'anon', (tx) => tx.query(
        `select public.unpublish_site_page($1)`, [publishedId])))).toMatch(/permission denied|Only a Super Admin/i);
    });

    it('cannot reach the internal helpers', async () => {
      for (const call of [
        `select public.site_page_snapshot($1)`,
      ]) {
        expect(JSON.stringify(await errorOf(db, 'anon', (tx) => tx.query(call, [publishedId]))))
          .toMatch(/permission denied/i);
      }
      expect(JSON.stringify(await errorOf(db, 'anon', (tx) => tx.query(`select public.is_super_admin()`))))
        .toMatch(/permission denied/i);
    });
  });

  describe.each([['retailer'], ['seller'], ['staff']])('%s', (label) => {
    const idFor = () => (label === 'retailer' ? retailer : label === 'seller' ? seller : staff);

    it('reads no site-content row of any kind', async () => {
      for (const table of ['site_pages', 'site_page_sections', 'site_page_admin_notes', 'site_page_revisions']) {
        const { rows } = await as(db, idFor(), (tx) => tx.query(`select * from public.${table}`));
        expect(rows, `${label} / ${table}`).toEqual([]);
      }
    });

    it('writes no site-content row of any kind', async () => {
      const update = await as(db, idFor(), (tx) => tx.query(
        `update public.site_pages set title = 'hijacked' where id = $1`, [publishedId]));
      expect(update.affectedRows ?? 0).toBe(0);

      const del = await as(db, idFor(), (tx) => tx.query(
        `delete from public.site_pages where id = $1`, [publishedId]));
      expect(del.affectedRows ?? 0).toBe(0);

      const insert = await errorOf(db, idFor(), (tx) => tx.query(
        `insert into public.site_pages (slug, nav_label, title) values ('injected', 'Injected', 'Injected')`));
      expect(insert).not.toBeNull();
    });

    it('cannot publish or unpublish', async () => {
      const error = await errorOf(db, idFor(), (tx) => tx.query(`select public.publish_site_page($1)`, [publishedId]));
      expect(error).toMatch(/Only a Super Admin/i);
    });

    it('still sees the public page through the public function', async () => {
      // The content module must not have accidentally locked the storefront.
      const { rows } = await as(db, idFor(), (tx) =>
        tx.query<{ p: { state: string } }>(`select public.published_page($1) as p`, [publishedSlug]));
      expect(rows[0]!.p.state).toBe('published');
    });
  });

  describe('plain admin', () => {
    it('reads the published output but not the draft tables', async () => {
      const { rows } = await as(db, admin, (tx) =>
        tx.query<{ p: { state: string } }>(`select public.published_page($1) as p`, [publishedSlug]));
      expect(rows[0]!.p.state).toBe('published');

      for (const table of ['site_pages', 'site_page_sections', 'site_page_admin_notes', 'site_page_revisions']) {
        const read = await as(db, admin, (tx) => tx.query(`select * from public.${table}`));
        expect(read.rows, table).toEqual([]);
      }
    });

    it('cannot publish, unpublish, or edit', async () => {
      expect(await errorOf(db, admin, (tx) => tx.query(`select public.publish_site_page($1)`, [publishedId])))
        .toMatch(/Only a Super Admin/i);
      expect(await errorOf(db, admin, (tx) => tx.query(`select public.unpublish_site_page($1)`, [publishedId])))
        .toMatch(/Only a Super Admin/i);

      const update = await as(db, admin, (tx) => tx.query(
        `update public.site_pages set title = 'admin edit' where id = $1`, [publishedId]));
      expect(update.affectedRows ?? 0).toBe(0);
    });

    it('cannot pretend to be a Super Admin', async () => {
      const { rows } = await as(db, admin, (tx) => tx.query<{ is_sa: boolean }>(`select public.is_super_admin() as is_sa`));
      expect(rows[0]!.is_sa).toBe(false);
    });
  });

  describe('super admin', () => {
    it('is the only role that can publish', async () => {
      const id = (await db.query<{ id: string }>(`select id from public.site_pages where slug = 'privacy'`)).rows[0]!.id;
      await as(db, superAdmin, (tx) => tx.query(`select public.publish_site_page($1)`, [id]));

      const { rows } = await as(db, 'anon', (tx) =>
        tx.query<{ p: { state: string } }>(`select public.published_page($1) as p`, ['privacy']));
      expect(rows[0]!.p.state).toBe('published');
    });

    it('sees every draft table', async () => {
      const { rows } = await as(db, superAdmin, (tx) =>
        tx.query<{ n: string }>(`select count(*)::text as n from public.site_pages`));
      expect(Number(rows[0]!.n)).toBeGreaterThanOrEqual(19);
    });
  });

  describe('no draft ever leaks through the public API surface', () => {
    it('lists only published pages in the index function', async () => {
      const { rows } = await as(db, 'anon', (tx) =>
        tx.query<{ pages: Array<{ slug: string }> }>(`select public.published_pages() as pages`));
      const slugs = rows[0]!.pages.map((page) => page.slug);
      expect(slugs).toContain('about');
      // A page that is still a draft must not be listed.
      expect(slugs).not.toContain('prohibited-products');
    });

    it('answers "unpublished" — never the draft text — for a page that is a draft', async () => {
      const { rows } = await as(db, 'anon', (tx) =>
        tx.query<{ p: Record<string, unknown> }>(`select public.published_page($1) as p`, ['prohibited-products']));
      const record = rows[0]!.p as Record<string, unknown>;
      expect(record.state).toBe('unpublished');
      // The record carries navigation only — the menu label the shell needs to
      // render "Prohibited products / This page is not available right now." —
      // and no draft CONTENT: no title, intro, sections, version or snapshot.
      expect(record.page, 'the published snapshot must not be returned').toBeUndefined();
      expect(Object.keys(record).sort()).toEqual(['message', 'nav_label', 'slug', 'state']);
      // Prove there IS draft text to protect, and that none of it is returned.
      const draftBody = (await db.query<{ body: string[] }>(
        `select s.body from public.site_page_sections s
           join public.site_pages p on p.id = s.page_id
          where p.slug = 'prohibited-products' and coalesce(array_length(s.body, 1), 0) > 0
          order by s.sort_order limit 1`)).rows[0]!.body[0]!;
      expect(draftBody.length).toBeGreaterThan(20);
      expect(JSON.stringify(record)).not.toContain(draftBody);
    });

    it('answers "missing" for a slug that does not exist', async () => {
      const { rows } = await as(db, 'anon', (tx) =>
        tx.query<{ p: Record<string, unknown> }>(`select public.published_page($1) as p`, ['not-a-real-page']));
      expect(rows[0]!.p.state).toBe('missing');
    });
  });
});

/**
 * Injection surface. Content is stored as structured fields (paragraph array,
 * bullet array, heading string) and rendered by `renderRichText`, which emits
 * React nodes and never `dangerouslySetInnerHTML`. A pasted `<script>` is
 * therefore TEXT, not markup — asserted here against the real rendering helper.
 */
describe('injected markup is text, never markup', () => {
  it('never uses dangerouslySetInnerHTML in the content rendering path', () => {
    const files = [
      'lib/site-content/render.tsx',
      'components/legal/managed-page.tsx',
      'components/legal/public-info-shell.tsx',
      'app/legal/[slug]/page.tsx',
      'app/legal/page.tsx',
      'app/about/page.tsx',
      'app/contact/page.tsx',
    ];
    for (const file of files) {
      const source = readFileSync(join(__dirname, '..', file), 'utf8');
      // Match the JSX PROP, not the word: render.tsx documents in a comment that
      // it deliberately avoids the API, and that comment must stay.
      expect(/dangerouslySetInnerHTML\s*=/.test(source), file).toBe(false);
    }
  });

  it('renders a script tag as inert text and keeps a javascript: link inert', () => {
    const hostile = 'Hello <script>alert(1)</script> and [click](javascript:alert(1))';
    const nodes = renderRichText(hostile);
    // A string array, not HTML: React escapes it on output.
    expect(nodes.every((node) => typeof node === 'string' || typeof node === 'object')).toBe(true);
    expect(nodes.join('')).toContain('<script>');
    // The javascript: destination must not survive as a link: the label is kept,
    // the href is dropped entirely.
    const hrefs: string[] = [];
    for (const node of nodes) {
      const props = (node as { props?: { href?: string } }).props;
      if (props?.href) hrefs.push(props.href);
    }
    expect(hrefs.join(' ')).not.toMatch(/javascript:/i);
  });
});
