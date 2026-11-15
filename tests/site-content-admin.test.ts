import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import {
  draftIssues,
  draftToPublishedRecord,
  hasUnpublishedChanges,
  visibleSections,
} from '@/lib/site-content/draft-preview';
import {
  adminNotesSchema,
  isSafePublicLink,
  newPageSchema,
  pageSettingsSchema,
  sectionSchema,
  toLines,
  toParagraphs,
  type SitePageAdminNotes,
  type SitePageRow,
  type SitePageSectionRow,
} from '@/lib/site-content/types';

const page: SitePageRow = {
  id: '11111111-1111-4111-8111-111111111111',
  slug: 'about',
  kind: 'page',
  audience: 'everyone',
  nav_label: 'About',
  short_label: 'About',
  eyebrow: 'What we do',
  title: 'About us',
  intro: 'A complete introduction for the page.',
  meta_description: null,
  hero_image_url: null,
  status: 'draft',
  version: '1.0',
  effective_date: '2026-11-14',
  published_at: null,
  published_snapshot: null,
  sort_order: 1,
  show_in_footer: true,
  show_in_index: false,
  show_contact_details: true,
  related_slugs: [],
  is_system: true,
  updated_at: '2026-11-14T00:00:00Z',
};

const section = (overrides: Partial<SitePageSectionRow>): SitePageSectionRow => ({
  id: '22222222-2222-4222-8222-222222222222',
  page_id: page.id,
  heading: 'How ordering works',
  body: ['Paragraph one.'],
  bullets: [],
  tone: 'standard',
  image_url: null,
  link_label: null,
  link_href: null,
  sort_order: 10,
  is_visible: true,
  ...overrides,
});

const notes: SitePageAdminNotes = {
  page_id: page.id,
  internal_notes: 'Owner verification pending.',
  owner_decisions: [],
  review_status: 'owner_review_pending',
  reviewed_at: null,
  updated_at: '2026-11-14T00:00:00Z',
};

describe('draft → published preview', () => {
  it('includes only visible sections, in sort_order then id order', () => {
    const sections = [
      section({ id: 'bbbbbbbb-1111-4111-8111-111111111111', heading: 'Second', sort_order: 20 }),
      section({ id: 'aaaaaaaa-1111-4111-8111-111111111111', heading: 'First', sort_order: 10 }),
      section({ id: 'cccccccc-1111-4111-8111-111111111111', heading: 'Hidden', sort_order: 15, is_visible: false }),
    ];
    expect(visibleSections(sections).map((item) => item.heading)).toEqual(['First', 'Second']);
    const record = draftToPublishedRecord(page, sections);
    expect(record.page.sections.map((item) => item.heading)).toEqual(['First', 'Second']);
    expect(record.state).toBe('published');
  });

  it('treats a draft that was never published as having unpublished changes', () => {
    expect(hasUnpublishedChanges(page, [section({})])).toBe(true);
  });

  it('detects an edit to a published page, and stops once it is published', () => {
    const sections = [section({})];
    const record = draftToPublishedRecord(page, sections);
    const published: SitePageRow = { ...page, status: 'published', published_snapshot: record.page };
    expect(hasUnpublishedChanges(published, sections)).toBe(false);
    expect(hasUnpublishedChanges(published, [section({ heading: 'Changed' })])).toBe(true);
  });
});

describe('operator warnings (Super Admin only)', () => {
  it('blocks publishing when required content is missing', () => {
    const messages = draftIssues({ ...page, intro: '', effective_date: null }, [], notes).map((issue) => issue.message);
    expect(messages.join(' ')).toMatch(/introduction/i);
    expect(messages.join(' ')).toMatch(/effective date/i);
    expect(messages.join(' ')).toMatch(/no visible sections/i);
  });

  it('reports an unpublished page and a pending owner review as review items, not blockers', () => {
    const issues = draftIssues(page, [section({})], notes);
    expect(issues.some((issue) => issue.severity === 'blocking')).toBe(false);
    expect(issues.map((issue) => issue.message).join(' ')).toMatch(/not published/i);
    expect(issues.map((issue) => issue.message).join(' ')).toMatch(/Owner review is still pending/i);
  });

  it('counts open owner decisions without printing them on a public page', () => {
    const issues = draftIssues(page, [section({})], { ...notes, owner_decisions: ['Return window', 'Refund method'] });
    expect(issues.map((issue) => issue.message).join(' ')).toMatch(/2 open owner decision/i);
  });

  it('reports stale content when a published page has draft edits', () => {
    const sections = [section({})];
    const published: SitePageRow = {
      ...page,
      status: 'published',
      published_snapshot: draftToPublishedRecord(page, sections).page,
    };
    const issues = draftIssues(published, [section({ heading: 'Reworded' })], { ...notes, review_status: 'not_required' });
    expect(issues.map((issue) => issue.message).join(' ')).toMatch(/draft differs from the published page/i);
  });
});

describe('input validation', () => {
  it('accepts the same slug grammar as the database, and rejects everything else', () => {
    expect(newPageSchema.safeParse({ slug: 'about-us', nav_label: 'About', title: 'About us', kind: 'page', audience: 'everyone' }).success).toBe(true);
    for (const slug of ['About', 'about_us', '-about', 'about-', 'a', 'about--us', "about'--"]) {
      expect(newPageSchema.safeParse({ slug, nav_label: 'About', title: 'About us', kind: 'page', audience: 'everyone' }).success, slug).toBe(false);
    }
  });

  it('rejects a version that the database would refuse', () => {
    const base = {
      nav_label: 'About', short_label: '', eyebrow: '', title: 'About us', intro: 'A complete introduction.', meta_description: '',
      hero_image_url: '', kind: 'legal' as const, audience: 'everyone' as const, version: '1.0', effective_date: '2026-11-14',
      sort_order: '1', show_in_footer: true, show_in_index: true, show_contact_details: true, related_slugs: [],
    };
    expect(pageSettingsSchema.safeParse(base).success).toBe(true);
    expect(pageSettingsSchema.safeParse({ ...base, version: 'v1' }).success).toBe(false);
    expect(pageSettingsSchema.safeParse({ ...base, effective_date: '14/11/2026' }).success).toBe(false);
  });

  it('only allows safe link destinations, and requires a label with a destination', () => {
    for (const href of ['/legal/terms', 'https://example.org/policy', 'mailto:a@b.test', 'tel:8987023959']) {
      expect(isSafePublicLink(href), href).toBe(true);
    }
    for (const href of ['javascript:alert(1)', 'data:text/html,<script>', ' //evil.example', 'ftp://example.org']) {
      expect(isSafePublicLink(href), href).toBe(false);
    }

    const form = { heading: 'Contact', body: 'Text', bullets: '', tone: 'standard' as const, image_url: '', link_label: 'Call', link_href: '', is_visible: true };
    expect(sectionSchema.safeParse(form).success).toBe(false);
    expect(sectionSchema.safeParse({ ...form, link_href: 'javascript:alert(1)' }).success).toBe(false);
    expect(sectionSchema.safeParse({ ...form, link_href: '/contact' }).success).toBe(true);
  });

  it('normalises textareas the way the editor documents them', () => {
    expect(toParagraphs('One.\n\nTwo.\n\n\nThree.')).toEqual(['One.', 'Two.', 'Three.']);
    expect(toLines('a\n\n b \nc')).toEqual(['a', 'b', 'c']);
  });

  it('refuses an approval without a reviewer at the schema level only via the database', () => {
    // The database stores reviewed_by/reviewed_at itself; the action always sets
    // them together. Here we pin the accepted status values.
    expect(adminNotesSchema.safeParse({ internal_notes: '', owner_decisions: '', review_status: 'owner_approved' }).success).toBe(true);
    expect(adminNotesSchema.safeParse({ internal_notes: '', owner_decisions: '', review_status: 'approved' }).success).toBe(false);
  });
});

/* -------------------------------------------------------------------------- */
/* Source guarantees                                                          */
/* -------------------------------------------------------------------------- */

const root = join(__dirname, '..');
const read = (path: string) => readFileSync(join(root, path), 'utf8');

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(join(root, dir))) {
    const relative = `${dir}/${entry}`;
    const full = join(root, relative);
    if (statSync(full).isDirectory()) walk(relative, out);
    else if (/\.(ts|tsx)$/.test(entry)) out.push(relative);
  }
  return out;
}

describe('admin-only boundaries in the source', () => {
  it('guards every content action with the super-admin check', () => {
    const actions = read('lib/admin/site-content-actions.ts');
    const exported = [...actions.matchAll(/export async function (\w+)/g)].map((match) => match[1]);
    expect(exported.length).toBeGreaterThanOrEqual(9);
    for (const name of exported) {
      const body = actions.slice(actions.indexOf(`export async function ${name}`));
      const nextExport = body.indexOf('\nexport async function', 10);
      const block = nextExport === -1 ? body : body.slice(0, nextExport);
      expect(block, `${name} must require a super admin`).toMatch(/requireSuperAdmin\(\)/);
    }
  });

  it('guards the content screens with the super-admin page check', () => {
    for (const path of ['app/admin/content/page.tsx', 'app/admin/content/[id]/page.tsx', 'app/admin/content/[id]/preview/page.tsx', 'app/admin/content/business/page.tsx']) {
      expect(read(path), path).toContain('requireSuperAdminPage()');
    }
  });

  it('never imports the internal business settings or admin notes on a public page', () => {
    for (const path of ['app/about/page.tsx', 'app/contact/page.tsx', 'app/legal/page.tsx', 'app/legal/[slug]/page.tsx', 'components/legal/managed-page.tsx', 'components/legal/public-info-shell.tsx']) {
      const source = read(path);
      expect(source, path).not.toContain('site_page_admin_notes');
      expect(source, path).not.toContain('business-settings');
    }
  });

  it('keeps the operator warning out of every public route and component', () => {
    const publicFiles = [
      ...walk('app/legal'),
      'app/about/page.tsx',
      'app/contact/page.tsx',
      'components/legal/public-info-shell.tsx',
      'components/legal/managed-page.tsx',
      'components/legal/policy-links.tsx',
    ];
    for (const file of publicFiles) {
      const source = read(file);
      expect(source, file).not.toContain('Publication review required');
      expect(source, file).not.toContain('Indian legal/tax review');
    }
  });

  it('renders the operator warning where an operator will see it', () => {
    expect(read('lib/site-content/draft-preview.ts')).toMatch(/never seen|only in \/admin\/content|Super Admin/i);
    expect(read('app/admin/content/page.tsx')).toContain('This notice is internal');
  });

  it('links the module from the admin navigation for super admins only', () => {
    const shell = read('components/layout/admin-shell.tsx');
    const line = shell.split('\n').find((entry) => entry.includes("'/admin/content'"));
    expect(line).toBeDefined();
    expect(line).toContain("roles: ['super_admin']");
  });
});
