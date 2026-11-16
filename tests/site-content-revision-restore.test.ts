import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { revisionSummary, revisionToDraft } from '@/lib/site-content/draft-preview';

/**
 * Revision rollback helpers.
 *
 * `site_pages_record_revision()` (0104) stores
 * `{ page: <row>, sections: [...], published_snapshot }` for every publication
 * event. Restoring a revision means turning that JSON back into a DRAFT — never
 * into a publication, or a rollback would put old legal wording live with no
 * operator reading it.
 *
 * The helpers re-validate everything: a history row is data, not a trusted
 * literal, and a restore must not write a field the editor form would reject.
 */
const read = (path: string) => readFileSync(join(__dirname, '..', path), 'utf8');

const snapshot = (overrides: Record<string, unknown> = {}) => ({
  page: {
    title: 'Delivery and shipping',
    nav_label: 'Delivery',
    short_label: 'Delivery',
    eyebrow: 'Policies',
    intro: 'How an order reaches you, and what to expect.',
    meta_description: null,
    hero_image_url: null,
    version: '1.2',
    effective_date: '2026-11-01',
    show_in_footer: true,
    show_in_index: true,
    show_contact_details: false,
    related_slugs: ['returns'],
    ...overrides,
  },
  sections: [
    {
      heading: 'Where we deliver',
      body: ['Only to serviceable PINs.'],
      bullets: ['Gaya', 'Saran'],
      tone: 'standard',
      image_url: null,
      link_label: null,
      link_href: null,
      sort_order: 10,
    },
  ],
  published_snapshot: { title: 'Delivery and shipping' },
});

describe('revisionToDraft', () => {
  it('rebuilds a complete draft from a stored revision', () => {
    const draft = revisionToDraft(snapshot());
    expect(draft).not.toBeNull();
    expect(draft!.page).toMatchObject({
      title: 'Delivery and shipping',
      nav_label: 'Delivery',
      version: '1.2',
      effective_date: '2026-11-01',
      show_in_footer: true,
      show_in_index: true,
      show_contact_details: false,
      related_slugs: ['returns'],
    });
    expect(draft!.sections).toHaveLength(1);
    expect(draft!.sections[0]).toMatchObject({
      heading: 'Where we deliver',
      body: ['Only to serviceable PINs.'],
      bullets: ['Gaya', 'Saran'],
      tone: 'standard',
      sort_order: 10,
    });
  });

  it('refuses anything that would not pass the editor’s own validation', () => {
    // No title.
    expect(revisionToDraft(snapshot({ title: '' }))).toBeNull();
    // Short introduction (the publish function needs one too).
    expect(revisionToDraft(snapshot({ intro: 'too short' }))).toBeNull();
    // Version the database constraint would reject.
    expect(revisionToDraft(snapshot({ version: 'v1' }))).toBeNull();
    // Effective date in the wrong shape for a `date` column.
    expect(revisionToDraft(snapshot({ effective_date: '1 November 2026' }))).toBeNull();
    expect(revisionToDraft(snapshot({ effective_date: null }))).not.toBeNull();
  });

  it('drops sections that carry no heading or no text', () => {
    const draft = revisionToDraft({
      page: { title: 'About us', nav_label: 'About', intro: 'A complete introduction.', version: '1.0', effective_date: '2026-11-01' },
      sections: [
        { heading: 'Real', body: ['Text.'] },
        { heading: '', body: ['No heading.'] },
        { heading: 'Empty', body: [], bullets: [] },
        { heading: 'Bullets only', body: [], bullets: ['One'] },
      ],
    });
    expect(draft!.sections.map((section) => section.heading)).toEqual(['Real', 'Bullets only']);
  });

  it('refuses a revision with no usable section at all', () => {
    // Publishing needs at least one visible section, so restoring this would
    // leave a draft that cannot be published.
    expect(
      revisionToDraft({
        page: { title: 'About us', nav_label: 'About', intro: 'A complete introduction.', version: '1.0', effective_date: '2026-11-01' },
        sections: [],
      }),
    ).toBeNull();
  });

  it('copes with an "unpublished" revision that has no page wording', () => {
    expect(revisionToDraft({ published_snapshot: null })).toBeNull();
    expect(revisionToDraft(null)).toBeNull();
    expect(revisionToDraft('not json')).toBeNull();
  });

  it('coerces a hostile or malformed entry into a safe shape', () => {
    const draft = revisionToDraft({
      page: {
        title: 'About us',
        intro: 'A complete introduction.',
        version: '1.0',
        effective_date: '2026-11-01',
        related_slugs: ['ok', 42, null, ''],
        show_in_footer: 'yes',
        show_in_index: 1,
      },
      sections: [{ heading: 'H', body: ['x', 7, null], bullets: 'not-an-array', tone: 'evil' }],
    });
    expect(draft!.page.related_slugs).toEqual(['ok']);
    // Only a literal `true` enables a flag; "yes" and 1 do not.
    expect(draft!.page.show_in_footer).toBe(false);
    expect(draft!.page.show_in_index).toBe(false);
    expect(draft!.sections[0]!.body).toEqual(['x']);
    expect(draft!.sections[0]!.bullets).toEqual([]);
    expect(draft!.sections[0]!.tone).toBe('standard');
  });
});

describe('revisionSummary', () => {
  it('describes a revision without exposing its body text', () => {
    expect(revisionSummary(snapshot())).toEqual({ title: 'Delivery and shipping', sectionCount: 1 });
  });

  it('returns null when there is nothing to describe', () => {
    expect(revisionSummary(null)).toBeNull();
    expect(revisionSummary({})).toBeNull();
  });
});

describe('restoring never publishes', () => {
  const actions = read('lib/admin/site-content-actions.ts');
  const body = (() => {
    const start = actions.indexOf('export async function restoreRevisionAction');
    expect(start).toBeGreaterThan(-1);
    return actions.slice(start);
  })();

  it('is guarded by the Super Admin check like every other action', () => {
    expect(body).toMatch(/await requireSuperAdmin\(\)/);
  });

  it('writes the draft and never calls the publish RPC', () => {
    expect(body).not.toMatch(/publish_site_page/);
    expect(body).not.toMatch(/status:\s*'published'/);
  });

  it('does not write to the append-only history table', () => {
    expect(body).not.toMatch(/from\('site_page_revisions'[^)]*\)\s*\.(insert|update|delete)/);
    expect(body).toMatch(/\.select\('id, version, event, snapshot, page_id'\)/);
  });

  it('scopes the revision to the page it belongs to', () => {
    expect(body).toMatch(/\.eq\('page_id', pageId\)/);
  });

  it('records the restore in the audit log', () => {
    expect(body).toMatch(/audit\('site_page_revision_restored'/);
  });
});
