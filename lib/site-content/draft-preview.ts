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
