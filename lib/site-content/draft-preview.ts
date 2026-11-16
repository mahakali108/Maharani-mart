import type {
  PublishedPageRecord,
  SitePageAdminNotes,
  SitePageRow,
  SitePageSectionRow,
} from './types';

/**
 * Pure helpers shared by the Super Admin editor and its preview.
 *
 * Kept out of the page components so the two things that matter can be tested
 * without a database or a browser:
 *   - the preview is EXACTLY what publishing would produce (same ordering, same
 *     visibility rule, same section shape);
 *   - the operator warnings are computed from the row itself, not typed by hand.
 */

export function visibleSections(sections: readonly SitePageSectionRow[]): SitePageSectionRow[] {
  return [...sections]
    .filter((section) => section.is_visible)
    .sort((a, b) => (a.sort_order === b.sort_order ? a.id.localeCompare(b.id) : a.sort_order - b.sort_order));
}

/** The record the public renderer would receive if this draft were published now. */
export function draftToPublishedRecord(
  page: SitePageRow,
  sections: readonly SitePageSectionRow[],
): PublishedPageRecord {
  const ordered = visibleSections(sections);
  return {
    state: 'published',
    slug: page.slug,
    kind: page.kind,
    audience: page.audience,
    nav_label: page.nav_label,
    short_label: page.short_label,
    show_contact_details: page.show_contact_details,
    related_slugs: page.related_slugs ?? [],
    version: page.version,
    effective_date: page.effective_date ?? '',
    published_at: new Date().toISOString(),
    page: {
      title: page.title,
      nav_label: page.nav_label,
      short_label: page.short_label,
      eyebrow: page.eyebrow,
      intro: page.intro ?? '',
      meta_description: page.meta_description,
      hero_image_url: page.hero_image_url,
      version: page.version,
      effective_date: page.effective_date ?? '',
      sections: ordered.map((section) => ({
        heading: section.heading,
        body: section.body ?? [],
        bullets: section.bullets ?? [],
        tone: section.tone,
        image_url: section.image_url,
        link_label: section.link_label,
        link_href: section.link_href,
        sort_order: section.sort_order,
      })),
    },
  };
}

/** A draft differs from what is live: the page needs (re)publishing. */
export function hasUnpublishedChanges(
  page: SitePageRow,
  sections: readonly SitePageSectionRow[],
): boolean {
  if (page.status !== 'published' || !page.published_snapshot) return true;
  const candidate = draftToPublishedRecord(page, sections).page;
  const live = page.published_snapshot;
  // `published_at` is not part of the snapshot, so a direct comparison is exact.
  return JSON.stringify(candidate) !== JSON.stringify(live);
}

export type DraftIssue = {
  /** `blocking` issues stop publishing (the database refuses them too). */
  severity: 'blocking' | 'review';
  message: string;
};

/**
 * What the Super Admin needs to see and a customer must never see. Every message
 * here is rendered ONLY inside /admin/content.
 */
export function draftIssues(
  page: SitePageRow,
  sections: readonly SitePageSectionRow[],
  notes: SitePageAdminNotes | null,
): DraftIssue[] {
  const issues: DraftIssue[] = [];
  const visible = visibleSections(sections);

  if (!page.intro || page.intro.trim().length < 10) {
    issues.push({ severity: 'blocking', message: 'The introduction is missing or too short. Publishing needs an introduction.' });
  }
  if (!page.effective_date) {
    issues.push({ severity: 'blocking', message: 'No effective date is set. Publishing needs one.' });
  }
  if (visible.length === 0) {
    issues.push({ severity: 'blocking', message: 'No visible sections. Publishing needs at least one.' });
  }
  if (sections.length > 0 && visible.length === 0) {
    issues.push({ severity: 'review', message: 'Every section is hidden, so the page would publish empty.' });
  }
  if (page.status !== 'published') {
    issues.push({ severity: 'review', message: 'This page is not published. Customers see a short "not available" message.' });
  } else if (hasUnpublishedChanges(page, sections)) {
    issues.push({ severity: 'review', message: 'The draft differs from the published page. Publish to make these changes live.' });
  }
  if (notes?.review_status === 'owner_review_pending') {
    issues.push({ severity: 'review', message: 'Owner review is still pending for this wording.' });
  }
  if ((notes?.owner_decisions?.length ?? 0) > 0) {
    issues.push({
      severity: 'review',
      message: `${notes?.owner_decisions.length} open owner decision(s) are listed below. They are not shown on the public page.`,
    });
  }
  return issues;
}

/* -------------------------------------------------------------------------- */
/* Revision restore                                                            */
/* -------------------------------------------------------------------------- */

/**
 * The shape `site_pages_record_revision()` (0104) stores for each event:
 * `{ page: <the row minus published_snapshot>, sections: [...], published_snapshot }`.
 * Everything is re-validated on the way back in — a history row is data from the
 * database, not a trusted literal, and a rollback must not be able to write a
 * field the editor form would have rejected.
 */
export type RevisionSnapshot = {
  page?: {
    title?: unknown;
    nav_label?: unknown;
    short_label?: unknown;
    eyebrow?: unknown;
    intro?: unknown;
    meta_description?: unknown;
    hero_image_url?: unknown;
    version?: unknown;
    effective_date?: unknown;
    show_in_footer?: unknown;
    show_in_index?: unknown;
    show_contact_details?: unknown;
    related_slugs?: unknown;
  };
  sections?: Array<{
    heading?: unknown;
    body?: unknown;
    bullets?: unknown;
    tone?: unknown;
    image_url?: unknown;
    link_label?: unknown;
    link_href?: unknown;
    sort_order?: unknown;
  }>;
};

export type RestoredDraft = {
  page: {
    title: string;
    nav_label: string;
    short_label: string | null;
    eyebrow: string | null;
    intro: string;
    meta_description: string | null;
    hero_image_url: string | null;
    version: string;
    effective_date: string | null;
    show_in_footer: boolean;
    show_in_index: boolean;
    show_contact_details: boolean;
    related_slugs: string[];
  };
  sections: Array<{
    heading: string;
    body: string[];
    bullets: string[];
    tone: SitePageSectionRow['tone'];
    image_url: string | null;
    link_label: string | null;
    link_href: string | null;
    sort_order: number;
  }>;
};

const str = (value: unknown, fallback = ''): string => (typeof value === 'string' ? value : fallback);
const strArray = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === 'string' && entry.length > 0) : [];
const nullableStr = (value: unknown): string | null => {
  const text = str(value).trim();
  return text.length > 0 ? text : null;
};

/**
 * Turns a stored revision into the exact draft payload to write back.
 *
 * Returns `null` when the snapshot cannot produce a valid draft (no title, no
 * intro, no sections, or a heading-less section) rather than restoring a
 * half-page. Restoring is a DRAFT operation on purpose: it never publishes, so a
 * rollback cannot become an unreviewed publication of old legal wording.
 */
export function revisionToDraft(snapshot: unknown): RestoredDraft | null {
  if (!snapshot || typeof snapshot !== 'object') return null;
  const raw = snapshot as RevisionSnapshot;
  const page = raw.page ?? {};

  const title = str(page.title).trim();
  const intro = str(page.intro).trim();
  const navLabel = str(page.nav_label).trim() || title;
  if (title.length < 2 || intro.length < 10) return null;

  const version = str(page.version).trim();
  if (!/^\d+\.\d+$/.test(version)) return null;

  const effectiveDate = nullableStr(page.effective_date);
  // The column is a `date`; anything else would fail at write time.
  if (effectiveDate && !/^\d{4}-\d{2}-\d{2}$/.test(effectiveDate)) return null;

  const sections = (Array.isArray(raw.sections) ? raw.sections : [])
    .map((section) => {
      const heading = str(section.heading).trim();
      const body = strArray(section.body);
      const bullets = strArray(section.bullets);
      return {
        heading,
        body,
        bullets,
        tone: (section.tone === 'highlight' ? 'highlight' : 'standard') as SitePageSectionRow['tone'],
        image_url: nullableStr(section.image_url),
        link_label: nullableStr(section.link_label),
        link_href: nullableStr(section.link_href),
        sort_order: typeof section.sort_order === 'number' && Number.isFinite(section.sort_order) ? section.sort_order : 0,
      };
    })
    .filter((section) => section.heading.length > 0 && (section.body.length > 0 || section.bullets.length > 0));

  if (sections.length === 0) return null;

  return {
    page: {
      title,
      nav_label: navLabel,
      short_label: nullableStr(page.short_label),
      eyebrow: nullableStr(page.eyebrow),
      intro,
      meta_description: nullableStr(page.meta_description),
      hero_image_url: nullableStr(page.hero_image_url),
      version,
      effective_date: effectiveDate,
      show_in_footer: page.show_in_footer === true,
      show_in_index: page.show_in_index === true,
      show_contact_details: page.show_contact_details === true,
      related_slugs: strArray(page.related_slugs),
    },
    sections,
  };
}

/** A short, human summary of a revision, for the history list. */
export function revisionSummary(snapshot: unknown): { title: string; sectionCount: number } | null {
  if (!snapshot || typeof snapshot !== 'object') return null;
  const raw = snapshot as RevisionSnapshot;
  const title = str(raw.page?.title).trim();
  if (!title) return null;
  return {
    title,
    sectionCount: (Array.isArray(raw.sections) ? raw.sections : []).filter((s) => str(s.heading).trim().length > 0).length,
  };
}
