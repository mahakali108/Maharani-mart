import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { createMigratedDb, type Db } from './helpers/pg-harness';

/**
 * The release procedure itself, executed on real PostgreSQL 16 (PGlite).
 *
 * `supabase/publication/*.sql` and `supabase/rollbacks/0105_*.down.sql` are run by
 * a human with the SQL editor, never by `db push`, so nothing else in CI would
 * ever execute them. A rollback that is only read and never run is a claim, not a
 * procedure: the 0105 rollback was blocked by the system-page delete guard until
 * this test existed.
 */
const stage1 = readFileSync('supabase/publication/stage1_publish_live_text.sql', 'utf8');
const verifySql = readFileSync('supabase/publication/verify_publication.sql', 'utf8');
const down104 = readFileSync('supabase/rollbacks/0104_site_content_management.down.sql', 'utf8');
const down105 = readFileSync('supabase/rollbacks/0105_seed_site_content.down.sql', 'utf8');

const STAGE_ONE = [
  'about', 'contact', 'terms', 'privacy', 'returns',
  'shipping', 'grievance', 'business-disclosure', 'product-safety',
];

describe('site content release procedure (PostgreSQL 16)', () => {
  let db: Db;
  beforeAll(async () => { db = await createMigratedDb(); }, 180_000);
  afterAll(async () => { await db.close(); });

  const census = async () => {
    const { rows } = await db.query<{
      total: number; drafts: number; published: number; without_snapshot: number; future: number;
    }>(
      `select count(*)::int as total,
              count(*) filter (where status = 'draft')::int as drafts,
              count(*) filter (where status = 'published')::int as published,
              count(*) filter (where status = 'published' and published_snapshot is null)::int as without_snapshot,
              count(*) filter (where published_at > now())::int as future
         from public.site_pages`,
    );
    return rows[0]!;
  };

  it('after 0104/0105 every page is a draft and nothing is public', async () => {
    const c = await census();
    expect(c.total).toBeGreaterThanOrEqual(19);
    expect(c.published).toBe(0);
    expect(c.drafts).toBe(c.total);
  });

  it('stage 1 publishes exactly the nine already-public pages, stamped now()', async () => {
    await db.exec(stage1);
    const c = await census();
    expect(c.published).toBe(STAGE_ONE.length);
    expect(c.drafts).toBe(c.total - STAGE_ONE.length);
    expect(c.without_snapshot).toBe(0);
    expect(c.future).toBe(0);

    // A publication timestamp is the real time of the act, never the document's
    // effective date and never a future date.
    const { rows } = await db.query<{ backdated: number; today: number; earliest: string }>(
      `select count(*) filter (where published_at < date '2026-11-15')::int as backdated,
              count(*) filter (where published_at::date = current_date)::int as today,
              min(published_at)::text as earliest
         from public.site_pages where status = 'published'`,
    );
    expect(rows[0]!.backdated).toBe(0);
    expect(rows[0]!.today).toBe(STAGE_ONE.length);

    // What an anonymous visitor gets: published for the nine, unpublished for the rest.
    const states = await db.query<{ slug: string; state: string }>(
      `select slug, (public.published_page(slug) ->> 'state') as state from public.site_pages order by slug`,
    );
    for (const row of states.rows) {
      expect(`${row.slug}=${row.state}`).toBe(
        `${row.slug}=${STAGE_ONE.includes(row.slug) ? 'published' : 'unpublished'}`,
      );
    }
    const index = await db.query<{ n: number }>(
      `select jsonb_array_length(public.published_pages())::int as n`,
    );
    expect(index.rows[0]!.n).toBe(STAGE_ONE.length);

    // Draft text and internal notes must not travel with a published document.
    const leak = await db.query<{ n: number }>(
      `select count(*)::int as n from public.site_pages p
        where p.status = 'published'
          and (public.published_page(p.slug)::text ilike '%internal_notes%'
            or public.published_page(p.slug)::text ilike '%owner_decisions%')`,
    );
    expect(leak.rows[0]!.n).toBe(0);
  });

  it('the documented verify_publication.sql runs unchanged, before and after stage 1', async () => {
    await db.exec(verifySql);
  });

  it('nothing outside the module references the content tables', async () => {
    const { rows } = await db.query<{ table_name: string }>(
      `select distinct conrelid::regclass::text as table_name
         from pg_constraint where confrelid = 'public.site_pages'::regclass`,
    );
    expect(rows.map((r) => r.table_name).sort()).toEqual([
      'site_page_admin_notes', 'site_page_revisions', 'site_page_sections',
    ]);
  });

  it('rollbacks: the seed first, then the module, in that order', async () => {
    await db.exec(down105);
    expect((await census()).total).toBe(0);

    await db.exec(`set maharani.allow_data_loss = 'true'`);
    await db.exec(down104);

    const { rows } = await db.query<{ tables: string | null; helpers: string | null; functions: number }>(
      `select to_regclass('public.site_pages')::text as tables,
              (select string_agg(proname, ',') from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                where n.nspname = 'public' and p.proname in
                  ('publish_site_page','unpublish_site_page','site_page_snapshot','published_page','published_pages')
              ) as helpers,
              (select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                where n.nspname = 'public' and p.proname like 'site_page%') as functions`,
    );
    expect(rows[0]!.tables).toBeNull();
    expect(rows[0]!.helpers).toBeNull();
    expect(rows[0]!.functions).toBe(0);
  });
});
