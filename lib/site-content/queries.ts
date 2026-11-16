import 'server-only';

import { createClient } from '@/lib/supabase/server';
import { throwIfReadFailed } from '@/lib/supabase/read-guard';
import type {
  PublishedPageDocument,
  PublishedPageResult,
  PublishedPageSummary,
  SitePageAdminNotes,
  SitePageAudience,
  SitePageKind,
  SitePageRevision,
  SitePageRow,
  SitePageSectionRow,
} from './types';

/**
 * Reads for the managed website content module.
 *
 * Public reads go through the database functions `public.published_page()` and
 * `public.published_pages()` (0104). Those return the *published snapshot* only:
 * a draft, an internal note or an owner decision cannot be reached from a public
 * page even if this module had a bug, because the anonymous role has no grant on
 * the tables those live in.
 */

type JsonRecord = Record<string, unknown>;

function asArray<T>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : [];
}

function asString(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback;
}

function asNullableString(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

/** Defensive normalisation of the snapshot JSON returned by the database. */
function normaliseDocument(raw: unknown): PublishedPageDocument | null {
  if (!raw || typeof raw !== 'object') return null;
  const value = raw as JsonRecord;
  const title = asString(value.title);
  const intro = asString(value.intro);
  const version = asString(value.version, '1.0');
  const effectiveDate = asString(value.effective_date);
  if (!title || !intro || !effectiveDate) return null;

  return {
    title,
    nav_label: asString(value.nav_label, title),
    short_label: asNullableString(value.short_label),
    eyebrow: asNullableString(value.eyebrow),
    intro,
    meta_description: asNullableString(value.meta_description),
    hero_image_url: asNullableString(value.hero_image_url),
    version,
    effective_date: effectiveDate,
    sections: asArray<JsonRecord>(value.sections).map((section) => ({
      heading: asString(section.heading),
      body: asArray<string>(section.body).filter((paragraph) => typeof paragraph === 'string' && paragraph.length > 0),
      bullets: asArray<string>(section.bullets).filter((bullet) => typeof bullet === 'string' && bullet.length > 0),
      tone: section.tone === 'highlight' ? 'highlight' : 'standard',
      image_url: asNullableString(section.image_url),
      link_label: asNullableString(section.link_label),
      link_href: asNullableString(section.link_href),
      sort_order: typeof section.sort_order === 'number' ? section.sort_order : 0,
    })),
  };
}

const SLUG_PATTERN = /^[a-z][a-z0-9]*(-[a-z0-9]+)*$/;

/**
 * One public page by address.
 *
 * `unavailable` is deliberately distinct from `missing`: a database failure must
 * not be rendered as "this policy does not exist".
 */
export async function loadPublishedPage(slug: string): Promise<PublishedPageResult> {
  if (!SLUG_PATTERN.test(slug)) return { state: 'missing' };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc('published_page' as never, { p_slug: slug } as never);
  if (error) {
    console.error('[site-content] published_page failed', { slug, message: error.message });
    return { state: 'unavailable' };
  }
  if (!data || typeof data !== 'object') return { state: 'missing' };
  const record = data as JsonRecord;
  const state = asString(record.state);

  if (state === 'published') {
    const document = normaliseDocument(record.page);
    if (!document) {
      console.error('[site-content] published snapshot did not parse', { slug });
      return { state: 'unavailable' };
    }
    return {
      state: 'published',
      slug: asString(record.slug, slug),
      kind: (record.kind === 'legal' ? 'legal' : 'page') as SitePageKind,
      audience: (['everyone', 'buyers', 'sellers'].includes(asString(record.audience)) ? record.audience : 'everyone') as SitePageAudience,
      nav_label: asString(record.nav_label, document.nav_label),
      short_label: asNullableString(record.short_label),
      show_contact_details: record.show_contact_details === true,
      related_slugs: asArray<string>(record.related_slugs),
      version: asString(record.version, document.version),
      effective_date: asString(record.effective_date, document.effective_date),
      published_at: asString(record.published_at),
      page: document,
    };
  }

  if (state === 'unpublished') {
    return {
      state: 'unpublished',
      slug: asString(record.slug, slug),
      nav_label: asString(record.nav_label, 'This page'),
      message: asString(record.message, 'This page is not available right now.'),
    };
  }

  return { state: 'missing' };
}

/** Every published page, ordered as configured. Used by the index and the footer. */
export async function loadPublishedPages(): Promise<PublishedPageSummary[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc('published_pages' as never);
  if (error) {
    console.error('[site-content] published_pages failed', { message: error.message });
    return [];
  }
  return asArray<JsonRecord>(data).map((row) => ({
    slug: asString(row.slug),
    kind: (row.kind === 'legal' ? 'legal' : 'page') as SitePageKind,
    audience: (['everyone', 'buyers', 'sellers'].includes(asString(row.audience)) ? row.audience : 'everyone') as SitePageAudience,
    nav_label: asString(row.nav_label),
    short_label: asNullableString(row.short_label),
    title: asString(row.title, asString(row.nav_label)),
    summary: asNullableString(row.summary),
    version: asString(row.version, '1.0'),
    effective_date: asString(row.effective_date),
    sort_order: typeof row.sort_order === 'number' ? row.sort_order : 0,
    show_in_footer: row.show_in_footer !== false,
    show_in_index: row.show_in_index !== false,
  }));
}

/* -------------------------------------------------------------------------- */
/* Super Admin reads                                                          */
/* -------------------------------------------------------------------------- */

const PAGE_COLUMNS =
  'id, slug, kind, audience, nav_label, short_label, eyebrow, title, intro, meta_description, hero_image_url, status, version, effective_date, published_at, published_snapshot, sort_order, show_in_footer, show_in_index, show_contact_details, related_slugs, is_system, updated_at, updated_by, published_by';

export async function loadAdminPages(): Promise<SitePageRow[] | null> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('site_pages' as never)
    .select(PAGE_COLUMNS)
    .order('sort_order', { ascending: true })
    .order('slug', { ascending: true })
    .returns<SitePageRow[]>();
  if (error) {
    console.error('[site-content] admin page list failed', { message: error.message });
    return null;
  }
  return data ?? [];
}

export async function loadAdminPage(id: string): Promise<SitePageRow | null> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('site_pages' as never)
    .select(PAGE_COLUMNS)
    .eq('id', id)
    .maybeSingle<SitePageRow>();
  // A failed read is NOT "this page does not exist": throw so the admin error
  // boundary offers a retry, and keep notFound() for a genuinely missing id.
  throwIfReadFailed(error, 'Website page');
  return data ?? null;
}

export async function loadAdminPageBySlug(slug: string): Promise<SitePageRow | null> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('site_pages' as never)
    .select(PAGE_COLUMNS)
    .eq('slug', slug)
    .maybeSingle<SitePageRow>();
  throwIfReadFailed(error, 'Website page');
  return data ?? null;
}

export async function loadAdminSections(pageId: string): Promise<SitePageSectionRow[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('site_page_sections' as never)
    .select('id, page_id, heading, body, bullets, tone, image_url, link_label, link_href, sort_order, is_visible')
    .eq('page_id', pageId)
    .order('sort_order', { ascending: true })
    .order('id', { ascending: true })
    .returns<SitePageSectionRow[]>();
  // Never report "this page has no sections" for an unreadable table: an editor
  // would then add a duplicate section or publish an incomplete page.
  throwIfReadFailed(error, 'Page sections');
  return data ?? [];
}

export async function loadAdminNotes(pageId: string): Promise<SitePageAdminNotes | null> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('site_page_admin_notes' as never)
    .select('page_id, internal_notes, owner_decisions, review_status, reviewed_by, reviewed_at, updated_at')
    .eq('page_id', pageId)
    .maybeSingle<SitePageAdminNotes>();
  // An unreadable notes row must not look like "no review recorded": that would
  // let an operator overwrite the real internal notes and owner decisions.
  throwIfReadFailed(error, 'Internal review notes');
  return data ?? null;
}

export async function loadPageRevisions(pageId: string): Promise<SitePageRevision[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('site_page_revisions' as never)
    .select('id, version, event, snapshot, created_at')
    .eq('page_id', pageId)
    .order('created_at', { ascending: false })
    .limit(20)
    .returns<SitePageRevision[]>();
  // "Nothing has been published yet" must not be shown when the history is
  // merely unreadable — an operator would republish to be safe.
  throwIfReadFailed(error, 'Publishing history');
  return data ?? [];
}

/**
 * Display names for the accounts that touched a page ("last modified by").
 *
 * Read from `profiles` under the caller's own RLS. A name that cannot be read
 * (the account was deleted) yields `null` and the caller renders the id-less
 * fallback rather than inventing an author — attribution must never be guessed.
 */
export async function loadActorNames(ids: ReadonlyArray<string | null>): Promise<Map<string, string>> {
  const wanted = [...new Set(ids.filter((id): id is string => typeof id === 'string' && id.length > 0))];
  const names = new Map<string, string>();
  if (wanted.length === 0) return names;

  const supabase = await createClient();
  const { data, error } = await supabase
    .from('profiles' as never)
    .select('id, full_name')
    .in('id', wanted)
    .returns<Array<{ id: string; full_name: string | null }>>();
  // Attribution is a nicety; an unreadable name must not break the editor.
  if (error) {
    console.error('[site-content] actor names failed', { message: error.message });
    return names;
  }
  for (const row of data ?? []) {
    if (row.full_name && row.full_name.trim().length > 0) names.set(row.id, row.full_name.trim());
  }
  return names;
}

/** Public pages linked from a page ("Related policies"), in configured order. */
export function pickRelatedPages(
  pages: readonly PublishedPageSummary[],
  slugs: readonly string[],
): PublishedPageSummary[] {
  const bySlug = new Map(pages.map((page) => [page.slug, page]));
  return slugs
    .map((slug) => bySlug.get(slug))
    .filter((page): page is PublishedPageSummary => Boolean(page && page.slug));
}
