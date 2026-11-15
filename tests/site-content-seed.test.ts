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
    expect(sql).toContain('public.site_page_snapshot');
    expect(sql).toContain('published_at = timestamptz');
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

describe('generator drift', () => {
  it('regenerating produces byte-identical files (the seed matches the page sources)', () => {
    const jsonPath = join(root, 'content/site-pages.seed.json');
    const sqlPath = join(root, 'supabase/migrations/0105_seed_site_content.sql');
    const beforeJson = readFileSync(jsonPath, 'utf8');
    const beforeSql = readFileSync(sqlPath, 'utf8');
    expect(existsSync(join(root, 'scripts/generate-site-content-seed.mjs'))).toBe(true);

    try {
      execFileSync(process.execPath, ['--experimental-strip-types', join(root, 'scripts/generate-site-content-seed.mjs')], {
        cwd: root,
        stdio: 'pipe',
      });
      expect(readFileSync(jsonPath, 'utf8')).toBe(beforeJson);
      expect(readFileSync(sqlPath, 'utf8')).toBe(beforeSql);
    } finally {
      writeFileSync(jsonPath, beforeJson);
      writeFileSync(sqlPath, beforeSql);
    }
  }, 60_000);
});
