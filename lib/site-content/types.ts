/**
 * Types and validation for Super Admin managed website content (migration 0104).
 *
 * Two shapes are deliberately kept apart:
 *
 *  - `SitePageDraft`   what an editor works on in /admin/content (mutable).
 *  - `PublishedPage`   an immutable snapshot stored in `site_pages.published_snapshot`
 *                      and rendered to customers. Editing a draft can never
 *                      change a live page, so nothing half-finished is visible.
 *
 * The snapshot JSON is produced by `public.site_page_snapshot()` and read through
 * `public.published_page()`, so the field names below are the database's.
 */
import { z } from 'zod';

/** A footer/navigation entry. Navigation only — never page content. */
export type FooterLink = { href: string; label: string };

export type SitePageKind = 'page' | 'legal';
/**
 * Who a published page is aimed at. `sellers` is RETIRED: the third-party
 * seller marketplace was removed, so no new page may be published to that
 * audience. The value is still accepted when READING historical rows (a
 * published seller-audience page must remain parseable and removable), but it
 * is no longer offered in the editor and no longer listed publicly.
 */
export type SitePageAudience = 'everyone' | 'buyers' | 'sellers';
/** Audiences an editor may still choose for NEW or updated content. */
export type EditableSitePageAudience = Exclude<SitePageAudience, 'sellers'>;
export type SitePageStatus = 'draft' | 'published';
export type SiteSectionTone = 'standard' | 'highlight';
export type SitePageReviewStatus = 'owner_review_pending' | 'owner_approved' | 'legal_reviewed' | 'not_required';

/** A content block as stored in the published snapshot. */
export type PublishedSection = {
  heading: string;
  body: string[];
  bullets: string[];
  tone: SiteSectionTone;
  image_url: string | null;
  link_label: string | null;
  link_href: string | null;
  sort_order: number;
};

export type PublishedPageDocument = {
  title: string;
  nav_label: string;
  short_label: string | null;
  eyebrow: string | null;
  intro: string;
  meta_description: string | null;
  hero_image_url: string | null;
  version: string;
  effective_date: string;
  sections: PublishedSection[];
};

export type PublishedPageRecord = {
  state: 'published';
  slug: string;
  kind: SitePageKind;
  audience: SitePageAudience;
  nav_label: string;
  short_label: string | null;
  show_contact_details: boolean;
  related_slugs: string[];
  version: string;
  effective_date: string;
  published_at: string;
  page: PublishedPageDocument;
};

export type UnpublishedPageRecord = {
  state: 'unpublished';
  slug: string;
  nav_label: string;
  message: string;
};

export type MissingPageRecord = { state: 'missing' };

/** A read failure. Deliberately distinct from "does not exist". */
export type UnavailablePageRecord = { state: 'unavailable' };

export type PublishedPageResult =
  | PublishedPageRecord
  | UnpublishedPageRecord
  | MissingPageRecord
  | UnavailablePageRecord;

export type PublishedPageSummary = {
  slug: string;
  kind: SitePageKind;
  audience: SitePageAudience;
  nav_label: string;
  short_label: string | null;
  title: string;
  summary: string | null;
  version: string;
  effective_date: string;
  sort_order: number;
  show_in_footer: boolean;
  show_in_index: boolean;
};

/** An editable section row (`site_page_sections`). */
export type SitePageSectionRow = {
  id: string;
  page_id: string;
  heading: string;
  body: string[];
  bullets: string[];
  tone: SiteSectionTone;
  image_url: string | null;
  link_label: string | null;
  link_href: string | null;
  sort_order: number;
  is_visible: boolean;
};

/** An editable page row (`site_pages`), drafts only. */
export type SitePageRow = {
  id: string;
  slug: string;
  kind: SitePageKind;
  audience: SitePageAudience;
  nav_label: string;
  short_label: string | null;
  eyebrow: string | null;
  title: string;
  intro: string | null;
  meta_description: string | null;
  hero_image_url: string | null;
  status: SitePageStatus;
  version: string;
  effective_date: string | null;
  published_at: string | null;
  published_snapshot: PublishedPageDocument | null;
  sort_order: number;
  show_in_footer: boolean;
  show_in_index: boolean;
  show_contact_details: boolean;
  related_slugs: string[];
  is_system: boolean;
  updated_at: string;
  /** Who last saved the draft. Needed for the "last modified by" line. */
  updated_by: string | null;
  /** Who published the current live snapshot, if any. */
  published_by: string | null;
};

export type SitePageAdminNotes = {
  page_id: string;
  internal_notes: string | null;
  owner_decisions: string[];
  review_status: SitePageReviewStatus;
  /** Who recorded the approval. NULL until a review is recorded. */
  reviewed_by: string | null;
  reviewed_at: string | null;
  updated_at: string;
};

export type SitePageRevision = {
  id: string;
  version: string;
  event: 'published' | 'unpublished' | 'version_changed';
  snapshot: unknown;
  created_at: string;
};

/* -------------------------------------------------------------------------- */
/* Validation                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * A public address. Kept identical to the database check
 * (`^[a-z][a-z0-9]*(-[a-z0-9]+)*$`) so a value accepted here can never be
 * rejected by the constraint after the form has been submitted.
 */
export const SLUG_PATTERN = /^[a-z][a-z0-9]*(-[a-z0-9]+)*$/;

/** Only these schemes/paths may be turned into a link on a public page. */
export const SAFE_LINK_PATTERN = /^(?:\/[a-z0-9\-._~/?#[\]@!$&'()*+,;=%]*|https?:\/\/[^\s]+|mailto:[^\s]+|tel:[+0-9][0-9\-\s]*)$/i;

export function isSafePublicLink(href: string): boolean {
  return SAFE_LINK_PATTERN.test(href) && !/^\s*javascript:/i.test(href);
}

const dateOnly = z
  .string()
  .trim()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Use a date in YYYY-MM-DD form.');

export const pageSettingsSchema = z.object({
  nav_label: z.string().trim().min(1, 'Enter the menu label.').max(60, 'Keep the menu label under 60 characters.'),
  short_label: z.string().trim().max(60, 'Keep the short label under 60 characters.').optional(),
  eyebrow: z.string().trim().max(80, 'Keep the eyebrow under 80 characters.').optional(),
  title: z.string().trim().min(2, 'Enter a page title.').max(160, 'Keep the title under 160 characters.'),
  intro: z.string().trim().min(10, 'Write an introduction of at least 10 characters.').max(1200, 'Keep the introduction under 1200 characters.'),
  meta_description: z.string().trim().max(320, 'Keep the search description under 320 characters.').optional(),
  hero_image_url: z.string().trim().max(2048).optional(),
  kind: z.enum(['page', 'legal']),
  audience: z.enum(['everyone', 'buyers']),
  version: z.string().trim().regex(/^\d+\.\d+$/, 'Use a version such as 1.0 or 2.1.'),
  effective_date: dateOnly,
  sort_order: z.coerce.number().int().min(0).max(10000),
  show_in_footer: z.coerce.boolean().default(false),
  show_in_index: z.coerce.boolean().default(false),
  show_contact_details: z.coerce.boolean().default(false),
  related_slugs: z
    .array(z.string().trim().regex(SLUG_PATTERN, 'Use page addresses only, one per line.'))
    .max(12, 'Keep related pages to 12 or fewer.')
    .default([]),
});

export const newPageSchema = z.object({
  slug: z.string().trim().regex(SLUG_PATTERN, 'Use lowercase letters, numbers and single hyphens (for example about-us).').min(2).max(64),
  nav_label: z.string().trim().min(1, 'Enter the menu label.').max(60),
  title: z.string().trim().min(2, 'Enter a page title.').max(160),
  kind: z.enum(['page', 'legal']),
  audience: z.enum(['everyone', 'buyers']),
});

export const sectionSchema = z
  .object({
    heading: z.string().trim().min(1, 'Enter a heading.').max(200, 'Keep the heading under 200 characters.'),
    body: z.string().max(20000, 'This section is too long.').optional(),
    bullets: z.string().max(20000, 'This section is too long.').optional(),
    tone: z.enum(['standard', 'highlight']).default('standard'),
    image_url: z.string().trim().max(2048).optional(),
    link_label: z.string().trim().max(80).optional(),
    link_href: z.string().trim().max(2048).optional(),
    is_visible: z.coerce.boolean().default(false),
  })
  .superRefine((data, context) => {
    if (Boolean(data.link_label) !== Boolean(data.link_href)) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ['link_href'], message: 'A button needs both a label and a destination.' });
    }
    if (data.link_href && !isSafePublicLink(data.link_href)) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ['link_href'], message: 'Use a site path (/legal/returns), https://…, mailto:… or tel:…' });
    }
  });

export const adminNotesSchema = z.object({
  internal_notes: z.string().max(8000, 'Keep notes under 8000 characters.').optional(),
  owner_decisions: z.string().max(8000, 'Keep this list under 8000 characters.').optional(),
  review_status: z.enum(['owner_review_pending', 'owner_approved', 'legal_reviewed', 'not_required']),
});

/** Blank-line separated textarea -> paragraphs (trimmed, empty removed). */
export function toParagraphs(value: string | undefined | null): string[] {
  return (value ?? '')
    .split(/\r?\n\s*\r?\n/)
    .map((paragraph) => paragraph.replace(/\s+/g, ' ').trim())
    .filter(Boolean);
}

/** One line = one bullet. */
export function toLines(value: string | undefined | null): string[] {
  return (value ?? '')
    .split(/\r?\n/)
    .map((line) => line.replace(/\s+/g, ' ').trim())
    .filter(Boolean);
}

export const REVIEW_STATUS_LABEL: Record<SitePageReviewStatus, string> = {
  owner_review_pending: 'Owner review pending',
  owner_approved: 'Owner approved',
  legal_reviewed: 'Legal review recorded',
  not_required: 'No review required',
};

export const AUDIENCE_LABEL: Record<SitePageAudience, string> = {
  everyone: 'Everyone',
  buyers: 'Retailers and wholesale buyers',
  /** Historical only — no new content can be published to this audience. */
  sellers: 'Sellers (retired)',
};
