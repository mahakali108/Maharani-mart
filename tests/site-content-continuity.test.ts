import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { createMigratedDb, type Db } from './helpers/pg-harness';

/**
 * Public page continuity, executed: 19 URLs are live before this change, stage 1
 * publishes nine of them, stage 2 the other ten, and this suite proves the
 * state at each step instead of asserting it in prose.
 *
 * It also executes `supabase/publication/stage2_publish_reviewed_additions.sql`,
 * which nothing else in CI runs — a publication script that is never executed is
 * a claim, not a procedure.
 */
const stage1 = readFileSync('supabase/publication/stage1_publish_live_text.sql', 'utf8');
const stage2 = readFileSync('supabase/publication/stage2_publish_reviewed_additions.sql', 'utf8');
const continuity = readFileSync('supabase/publication/verify_continuity.sql', 'utf8');

const NINE = ['about', 'contact', 'terms', 'privacy', 'returns', 'shipping', 'grievance', 'business-disclosure', 'product-safety'];

describe('public page continuity (PostgreSQL 16)', () => {
  let db: Db;
  beforeAll(async () => { db = await createMigratedDb(); }, 180_000);
  afterAll(async () => { await db.close(); });

  /**
   * Runs the file exactly as the operator does (all three statements), and reads
   * the first result set. `query()` cannot be used: it prepares a single
   * statement, and this file is three read-only checks.
   */
  const summary = async () => {
    const results = await db.exec(continuity);
    const rows = (results[0]!.rows ?? []) as {
      check: string; published: string; missing: string;
      published_without_snapshot: string; expected_total: string;
    }[];
    const row = rows.find((r) => r.check === 'summary')!;
    return { published: Number(row.published), missing: Number(row.missing), withoutSnapshot: Number(row.published_without_snapshot), total: Number(row.expected_total), missingRows: rows.filter((r) => r.check.startsWith('MISSING')).map((r) => r.check) };
  };

  it('reports every publishable page as missing before any publication', async () => {
    const s = await summary();
    // 19 pages are seeded; 18 are in the publication plan. `seller-agreement` is
    // excluded from that plan because the marketplace it governed was
    // discontinued (0110) — it is never published, so it is not "missing".
    expect(s).toMatchObject({ published: 0, missing: 18, total: 18 });
    expect(s.missingRows).toHaveLength(18);
  });

  it('after stage 1 exactly nine live pages are missing — the deploy gap, made visible', async () => {
    await db.exec(stage1);
    const s = await summary();
    expect(s).toMatchObject({ published: 9, missing: 9, withoutSnapshot: 0 });
    expect(s.missingRows).toEqual(expect.arrayContaining(['MISSING: cookies (stage 2)', 'MISSING: retailer-terms (stage 2)']));
    // The retirement is visible here too: the seller agreement is never in the plan.
    expect(s.missingRows).not.toContain('MISSING: seller-agreement (stage 2)');

    // The four legacy redirect targets (/terms, /privacy, /returns, /shipping)
    // are published, so those redirects never land on an unavailable page.
    const legacy = await db.query<{ slug: string; published: boolean }>(
      `select e.slug as slug, coalesce(p.status = 'published', false) as published
         from (values ('terms'),('privacy'),('returns'),('shipping')) as e(slug)
         left join public.site_pages p on p.slug = e.slug order by 1`,
    );
    expect(legacy.rows.every((r) => r.published)).toBe(true);
    expect(legacy.rows.map((r) => r.slug)).toEqual(['privacy', 'returns', 'shipping', 'terms']);
  });

  it('stage 2 restores eighteen and is idempotent, holding back the retired seller agreement', async () => {
    await db.exec(stage2);
    const s = await summary();
    // 19 seeded pages, of which 18 are published: `seller-agreement` is held back
    // because the marketplace it governed was discontinued (migration 0110). It is
    // still present as a seeded page — `total` is unchanged — it is simply never
    // made public.
    expect(s).toMatchObject({ published: 18, missing: 0, withoutSnapshot: 0, total: 18 });

    // every URL answers an anonymous caller, and the footer/app index is complete
    const states = await db.query<{ slug: string; state: string }>(
      `select slug, (public.published_page(slug) ->> 'state') as state from public.site_pages order by slug`,
    );
    expect(states.rows).toHaveLength(19);
    const live = states.rows.filter((r) => r.state === 'published');
    expect(live).toHaveLength(18);
    expect(live.map((r) => r.slug)).not.toContain('seller-agreement');
    const index = await db.query<{ n: number }>(`select jsonb_array_length(public.published_pages())::int as n`);
    expect(index.rows[0]!.n).toBe(18);

    // A second run changes nothing: the script skips pages that are already live
    // (their timestamp and snapshot are preserved).
    const before = await db.query<{ slug: string; at: string }>(`select slug, published_at::text as at from public.site_pages order by slug`);
    await db.exec(stage2);
    const after = await db.query<{ slug: string; at: string }>(`select slug, published_at::text as at from public.site_pages order by slug`);
    expect(after.rows).toEqual(before.rows);
  });

  it('the nine published by stage 1 are exactly the nine that were static pages', async () => {
    const { rows } = await db.query<{ slug: string }>(
      `select slug from public.site_pages where published_snapshot -> 'sections' is not null order by slug`,
    );
    expect(rows).toHaveLength(18);
    const stageOne = await db.query<{ slug: string }>(
      `select slug from public.site_pages where slug = any($1::text[]) order by slug`,
      [NINE],
    );
    expect(stageOne.rows.map((r) => r.slug)).toEqual([...NINE].sort());
  });
});
