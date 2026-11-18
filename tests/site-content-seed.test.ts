import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { LEGAL_DOCUMENTS } from '@/lib/legal/documents';

const root = join(__dirname, '..');
const read = (path: string) => readFileSync(join(root, path), 'utf8');

type SeedPage = {
  slug: string;
  kind: string;
  audience: string;
  nav_label: string;
  title: string;
  intro: string;
  version: string;
  effective_date: string;
  sections: { heading: string; body: string[]; bullets: string[] }[];
  owner_decisions: string[];
  internal_notes: string;
};

const seed = JSON.parse(read('content/site-pages.seed.json')) as { pages: SeedPage[] };
const bySlug = new Map(seed.pages.map((page) => [page.slug, page]));

describe('starter content for the website content module', () => {
  it('covers every page in the legal registry, plus About and Contact', () => {
    for (const doc of LEGAL_DOCUMENTS) expect(bySlug.has(doc.key), doc.key).toBe(true);
    expect(bySlug.has('about')).toBe(true);
    expect(bySlug.has('contact')).toBe(true);
    expect(seed.pages).toHaveLength(LEGAL_DOCUMENTS.length + 2);
    expect(new Set(seed.pages.map((page) => page.slug)).size).toBe(seed.pages.length);
  });

  it('carries real, substantial wording — not a placeholder that would empty a published page', () => {
    for (const page of seed.pages) {
      expect(page.intro.length, page.slug).toBeGreaterThan(40);
      expect(page.sections.length, page.slug).toBeGreaterThan(0);
      const words = page.sections.flatMap((section) => [...section.body, ...section.bullets]).join(' ').split(/\s+/).length;
      expect(words, page.slug).toBeGreaterThan(80);
      expect(page.version).toMatch(/^\d+\.\d+$/);
      expect(page.effective_date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      for (const section of page.sections) {
        expect(section.heading.trim().length, page.slug).toBeGreaterThan(0);
        expect(section.body.length + section.bullets.length, `${page.slug} / ${section.heading}`).toBeGreaterThan(0);
      }
    }
  });

  it('keeps every operator notice out of the published wording', () => {
    const published = JSON.stringify(seed.pages.map((page) => ({ ...page, internal_notes: undefined, owner_decisions: undefined })));
    for (const forbidden of [
      'Publication review required',
      'Indian legal/tax review',
      'awaiting the owner',
      'reconcile and verify before publication',
      'TODO',
      'TBD',
      'lorem ipsum',
      '[insert',
      'example.com',
    ]) {
      expect(published, forbidden).not.toContain(forbidden);
    }
    // No unresolved JSX or template expression survived extraction.
    expect(published).not.toMatch(/\{[^}]{0,80}\}/);
    expect(published).not.toMatch(/<[a-z/][^>]*>/i);
  });

  it('keeps the owner decisions in the internal notes instead', () => {
    const withDecisions = seed.pages.filter((page) => page.owner_decisions.length > 0);
    expect(withDecisions.length).toBeGreaterThan(0);
    for (const page of withDecisions) {
      const publishedText = JSON.stringify(page.sections);
      for (const decision of page.owner_decisions) {
        expect(publishedText, `${page.slug} must not publish its open decisions`).not.toContain(decision);
      }
    }
    for (const page of seed.pages) expect(page.internal_notes.length, page.slug).toBeGreaterThan(20);
  });

  it('preserves the owner-provided contact details as editable page content', () => {
    const contact = bySlug.get('contact')!;
    const text = JSON.stringify(contact.sections);
    for (const value of ['AJAY KUMAR', 'AJAY GENERAL', 'MAHARANI TRADERS', 'Plot No. 231', '804403', '8987023959', 'adinathsahu8987@gmail.com']) {
      expect(text, value).toContain(value);
    }
    expect(text).toContain('[8987023959](tel:8987023959)');
    expect(text).toContain('[adinathsahu8987@gmail.com](mailto:adinathsahu8987@gmail.com)');
  });
});

describe('the seed migration', () => {
  const sql = read('supabase/migrations/0105_seed_site_content.sql');

  it('seeds exactly the pages in the reviewed JSON', () => {
    for (const page of seed.pages) expect(sql, page.slug).toContain(`$seed$${page.slug}$seed$`);
    expect(sql).toContain("'draft'");
  });

  it('publishes NOTHING: no status change, no snapshot, no invented timestamp', () => {
    // Publication is a legal act the owner takes page by page, not a side effect
    // of a seed. These four assertions are the guard rail: if any of them starts
    // failing, a migration has begun putting policy text in front of customers.
    expect(sql).not.toMatch(/status\s*=\s*'published'/);
    expect(sql).not.toContain('published_at =');
    expect(sql).not.toMatch(/published_snapshot\s*=/);
    expect(sql).not.toMatch(/timestamptz '20/);
    // The migration proves the same thing at run time, in the same transaction.
    expect(sql).toContain('0105 must not publish');
  });

  it('is idempotent and never overwrites an edit made in the admin screen', () => {
    expect(sql).toMatch(/if v_page is not null then\s+return;\s+end if;/);
    expect(sql).not.toMatch(/on conflict \(slug\) do update/i);
    expect(sql).not.toMatch(/delete from|drop table|truncate/i);
  });

  it('records no approval and leaves every page in the review queue', () => {
    expect(sql).toContain("'owner_review_pending'");
    expect(sql).not.toContain("'owner_approved'");
    expect(sql).not.toContain("'legal_reviewed'");
    // It seeds page content only: no business/GST approval and no readiness flag.
    expect(sql).not.toMatch(/insert into public\.platform_settings/i);
    expect(sql).not.toMatch(/verification_status|is_configured|ordering_launch_readiness/i);
  });

  it('has a rollback that removes only the seeded pages', () => {
    const rollback = read('supabase/rollbacks/0105_seed_site_content.down.sql');
    expect(rollback).toContain('delete from public.site_pages');
    expect(rollback).toContain('is_system = true');
  });
});

describe('the staged publication scripts', () => {
  const stage1 = read('supabase/publication/stage1_publish_live_text.sql');
  const stage2 = read('supabase/publication/stage2_publish_reviewed_additions.sql');
  const verify = read('supabase/publication/verify_publication.sql');
  const readme = read('supabase/publication/README.md');

  /** The slugs a stage publishes, read from its own `v_slugs` array. */
  const slugsOf = (sql: string): string[] => {
    const block = /v_slugs text\[\] := array\[([\s\S]*?)\]/.exec(sql)?.[1] ?? '';
    return [...block.matchAll(/'([a-z][a-z0-9-]*)'/g)].map((match) => match[1]!);
  };

  it('publishes the seeded pages in two stages, holding back the retired seller agreement', () => {
    const stageOne = slugsOf(stage1);
    const stageTwo = slugsOf(stage2);
    const seeded = seed.pages.map((page) => page.slug);
    expect(new Set([...stageOne, ...stageTwo]).size).toBe(stageOne.length + stageTwo.length);
    // `seller-agreement` is the ONE seeded page neither stage publishes. The
    // marketplace it governed was discontinued (migration 0110), so publishing it
    // would put a live contract for a seller class that no longer exists in front
    // of customers. The page itself is preserved, unpublished.
    expect([...stageOne, ...stageTwo].sort()).toEqual([...seeded].filter((slug) => slug !== 'seller-agreement').sort());
    expect([...stageOne, ...stageTwo]).not.toContain('seller-agreement');
    // Stage 1 carries only wording that was already public before the module.
    for (const slug of stageOne) expect(stageOne.length, slug).toBeGreaterThan(0);
    expect(stageOne).toHaveLength(9);
    expect(stageTwo).toHaveLength(9);
  });

  it('publishes both stages before the deploy (deferring stage 2 would darken nine live URLs)', () => {
    // All nineteen pages are served by the deployed app today, so a deploy that
    // lands after stage 1 only takes ten live URLs offline until stage 2 runs.
    // This pins the corrected order and the fact it depends on.
    const order = readme.slice(readme.indexOf('## Order of operations'), readme.indexOf('## What a stage does'));
    const stageTwo = order.search(/stage2_publish_reviewed_additions\.sql/);
    const deploy = order.search(/DEPLOY the application/);
    expect(stageTwo).toBeGreaterThan(-1);
    expect(deploy).toBeGreaterThan(-1);
    expect(stageTwo).toBeLessThan(deploy);
    expect(order).toMatch(/must both happen before step 8/i);
    expect(readme).not.toMatch(/Step 7 is deliberately not urgent/);
    // The seller agreement is deliberately NOT published by any stage, and the
    // README must say so rather than claiming its acceptance gate still matters.
    expect(readme).toMatch(/seller-agreement[\s\S]*NOT published by either/);
    expect(readme).not.toMatch(/acceptance is already enforced/);
    for (const slug of slugsOf(stage2)) expect(readme, slug).toContain(`/legal/${slug}`);
  });

  it('records the real publication time and never a backdated one', () => {
    for (const [name, sql] of [['stage 1', stage1], ['stage 2', stage2]] as const) {
      expect(sql, name).toContain('published_at = now()');
      expect(sql, name).not.toMatch(/published_at\s*=\s*timestamptz/);
      expect(sql, name).not.toMatch(/timestamptz '20\d\d-\d\d-\d\d/);
      expect(sql, name).not.toMatch(/published_at\s*=\s*'(20\d\d)/);
    }
    // 0105 is also clean; the seed may not fabricate a date either.
    expect(read('supabase/migrations/0105_seed_site_content.sql')).not.toMatch(/timestamptz '20\d\d-\d\d-\d\d/);
  });

  it('does not touch the acceptance registry', () => {
    for (const [name, sql] of [['stage 1', stage1], ['stage 2', stage2]] as const) {
      // Publishing a page is not a consent decision (see migration 0104's opt-in
      // flag); the scripts must never register a version on their own.
      expect(sql, name).not.toMatch(/^\s*select\s+public\.publish_legal_document_version/m);
      expect(sql, name).not.toMatch(/insert into public\.legal_document_current_versions/i);
    }
  });

  it('is explicitly not a migration and is never picked up by db push', () => {
    // The whole safety argument depends on these files not being auto-applied.
    expect(existsSync(join(root, 'supabase/publication'))).toBe(true);
    for (const sql of [stage1, stage2]) expect(sql).toMatch(/NOT a migration/i);
    expect(readme).toMatch(/NOT migrations/i);
  });

  it('ships a read-only verification file', () => {
    expect(verify).not.toMatch(/^\s*(insert|update|delete|alter|drop|create)\b/m);
    expect(verify).toContain('published_pages()');
    expect(verify).toContain('legal_document_current_versions');
  });
});

describe('generator drift', () => {
  it('regenerating produces byte-identical files (the seed matches the page sources)', () => {
    const jsonPath = join(root, 'content/site-pages.seed.json');
    const sqlPath = join(root, 'supabase/migrations/0105_seed_site_content.sql');
    // The generator writes three files. The rollback used to be left out of this
    // snapshot, so running the suite silently reverted a hand-edit to it — which is
    // exactly what happened when the seed rollback was given its data-loss guard.
    const rollbackPath = join(root, 'supabase/rollbacks/0105_seed_site_content.down.sql');
    const beforeJson = readFileSync(jsonPath, 'utf8');
    const beforeSql = readFileSync(sqlPath, 'utf8');
    const beforeRollback = readFileSync(rollbackPath, 'utf8');
    expect(existsSync(join(root, 'scripts/generate-site-content-seed.mjs'))).toBe(true);

    try {
      execFileSync(process.execPath, ['--experimental-strip-types', join(root, 'scripts/generate-site-content-seed.mjs')], {
        cwd: root,
        stdio: 'pipe',
      });
      expect(readFileSync(jsonPath, 'utf8')).toBe(beforeJson);
      expect(readFileSync(sqlPath, 'utf8')).toBe(beforeSql);
      expect(readFileSync(rollbackPath, 'utf8')).toBe(beforeRollback);
    } finally {
      writeFileSync(jsonPath, beforeJson);
      writeFileSync(sqlPath, beforeSql);
      writeFileSync(rollbackPath, beforeRollback);
    }
  }, 60_000);
});
