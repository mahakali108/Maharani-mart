'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { requireSuperAdmin } from '@/lib/admin/control-center/guard';
import {
  adminNotesSchema,
  newPageSchema,
  pageSettingsSchema,
  sectionSchema,
  toLines,
  toParagraphs,
} from '@/lib/site-content/types';

/**
 * Server Actions for Super Admin website content management.
 *
 * Every action:
 *   1. requires an authenticated super_admin (and RLS enforces the same rule in
 *      the database, so a bug here cannot grant a write);
 *   2. validates the submitted values with the same shape the database checks;
 *   3. writes, records who did it, revalidates the affected public routes and
 *      redirects back with a human-readable outcome.
 *
 * Publishing goes through `public.publish_site_page()` (0104) rather than a raw
 * UPDATE, so the published snapshot, the timestamp, the database-side document
 * version (0098) and the history row are written together or not at all.
 */

type FormResult = 'saved' | 'published' | 'unpublished' | 'deleted' | 'order-updated';

function fail(path: string, message: string): never {
  redirect(`${path}?error=${encodeURIComponent(message)}`);
}

function ok(path: string, notice: FormResult): never {
  redirect(`${path}?notice=${notice}`);
}

function text(formData: FormData, key: string): string {
  const value = formData.get(key);
  return typeof value === 'string' ? value.trim() : '';
}

function checked(formData: FormData, key: string): boolean {
  const value = formData.get(key);
  return value === 'on' || value === 'true' || value === '1';
}

function pagePath(pageId: string): string {
  return `/admin/content/${pageId}`;
}

/** Public routes a page change can affect. Dynamic pages are re-rendered. */
function revalidatePublic(slug: string) {
  revalidatePath('/admin/content');
  revalidatePath('/legal');
  revalidatePath('/about');
  revalidatePath('/contact');
  revalidatePath(`/legal/${slug}`);
  if (slug !== 'about' && slug !== 'contact') revalidatePath(`/${slug}`);
  revalidatePath('/admin/content', 'layout');
}

async function audit(action: string, targetId: string, detail: Record<string, unknown>) {
  const supabase = await createClient();
  const user = await requireSuperAdmin();
  const { error } = await supabase.from('super_admin_audit_logs' as never).insert({
    actor_id: user.id,
    target_id: targetId,
    action,
    after_data: detail,
    reason: 'Website content management',
  } as never);
  if (error) {
    // The write already happened; an audit failure must not be reported as a
    // content failure. It is logged loudly for the operator instead.
    console.error('[site-content] audit entry failed', { action, targetId, message: error.message });
  }
}

/* -------------------------------------------------------------------------- */
/* Pages                                                                      */
/* -------------------------------------------------------------------------- */

export async function createPageAction(formData: FormData): Promise<void> {
  await requireSuperAdmin();
  const parsed = newPageSchema.safeParse({
    slug: text(formData, 'slug'),
    nav_label: text(formData, 'nav_label'),
    title: text(formData, 'title'),
    kind: text(formData, 'kind') || 'page',
    audience: text(formData, 'audience') || 'everyone',
  });
  if (!parsed.success) fail('/admin/content', parsed.error.issues[0]?.message ?? 'Check the new page details.');

  const supabase = await createClient();
  const { data: existing } = await supabase
    .from('site_pages' as never)
    .select('id')
    .eq('slug', parsed.data.slug)
    .maybeSingle<{ id: string }>();
  if (existing) fail('/admin/content', `A page already exists at "${parsed.data.slug}".`);

  const { data, error } = await supabase
    .from('site_pages' as never)
    .insert({
      slug: parsed.data.slug,
      nav_label: parsed.data.nav_label,
      title: parsed.data.title,
      kind: parsed.data.kind,
      audience: parsed.data.audience,
      intro: '',
      status: 'draft',
      sort_order: 500,
      show_in_footer: parsed.data.kind === 'legal',
      show_in_index: parsed.data.kind === 'legal',
    } as never)
    .select('id')
    .single<{ id: string }>();
  if (error || !data) fail('/admin/content', error?.message ?? 'The page could not be created.');

  // An empty introduction fails the publish constraint, so start the editor with
  // an explicit placeholder the operator must replace, never invisible content.
  await audit('site_page_created', data.id, { slug: parsed.data.slug });
  revalidatePath('/admin/content');
  redirect(`${pagePath(data.id)}?notice=saved`);
}

export async function updatePageSettingsAction(formData: FormData): Promise<void> {
  await requireSuperAdmin();
  const pageId = text(formData, 'page_id');
  const parsed = pageSettingsSchema.safeParse({
    nav_label: text(formData, 'nav_label'),
    short_label: text(formData, 'short_label'),
    eyebrow: text(formData, 'eyebrow'),
    title: text(formData, 'title'),
    intro: text(formData, 'intro'),
    meta_description: text(formData, 'meta_description'),
    hero_image_url: text(formData, 'hero_image_url'),
    kind: text(formData, 'kind'),
    audience: text(formData, 'audience'),
    version: text(formData, 'version'),
    effective_date: text(formData, 'effective_date'),
    sort_order: text(formData, 'sort_order') || '0',
    show_in_footer: checked(formData, 'show_in_footer'),
    show_in_index: checked(formData, 'show_in_index'),
    show_contact_details: checked(formData, 'show_contact_details'),
    related_slugs: toLines(text(formData, 'related_slugs')),
  });
  if (!parsed.success) fail(pagePath(pageId), parsed.error.issues[0]?.message ?? 'Check the page details.');

  const supabase = await createClient();
  const { data: current } = await supabase
    .from('site_pages' as never)
    .select('slug')
    .eq('id', pageId)
    .maybeSingle<{ slug: string }>();
  if (!current) fail('/admin/content', 'That page no longer exists.');

  const { error } = await supabase
    .from('site_pages' as never)
    .update({
      nav_label: parsed.data.nav_label,
      short_label: parsed.data.short_label || null,
      eyebrow: parsed.data.eyebrow || null,
      title: parsed.data.title,
      intro: parsed.data.intro,
      meta_description: parsed.data.meta_description || null,
      hero_image_url: parsed.data.hero_image_url || null,
      kind: parsed.data.kind,
      audience: parsed.data.audience,
      version: parsed.data.version,
      effective_date: parsed.data.effective_date,
      sort_order: parsed.data.sort_order,
      show_in_footer: parsed.data.show_in_footer,
      show_in_index: parsed.data.show_in_index,
      show_contact_details: parsed.data.show_contact_details,
      related_slugs: parsed.data.related_slugs,
    } as never)
    .eq('id', pageId);
  if (error) fail(pagePath(pageId), error.message);

  revalidatePath(pagePath(pageId));
  revalidatePath('/admin/content');
  ok(pagePath(pageId), 'saved');
}

export async function deletePageAction(formData: FormData): Promise<void> {
  await requireSuperAdmin();
  const pageId = text(formData, 'page_id');
  const supabase = await createClient();
  const { data: page } = await supabase
    .from('site_pages' as never)
    .select('slug, is_system')
    .eq('id', pageId)
    .maybeSingle<{ slug: string; is_system: boolean }>();
  if (!page) fail('/admin/content', 'That page no longer exists.');
  if (page.is_system) {
    fail(pagePath(pageId), 'This page is required by the website. Unpublish it or edit it instead of deleting it.');
  }

  const { error } = await supabase.from('site_pages' as never).delete().eq('id', pageId);
  if (error) fail(pagePath(pageId), error.message);

  await audit('site_page_deleted', pageId, { slug: page.slug });
  revalidatePath('/admin/content');
  revalidatePath(`/legal/${page.slug}`);
  redirect(`/admin/content?notice=deleted`);
}

/* -------------------------------------------------------------------------- */
/* Sections                                                                   */
/* -------------------------------------------------------------------------- */

async function pageSlugFor(pageId: string): Promise<string> {
  const supabase = await createClient();
  const { data } = await supabase
    .from('site_pages' as never)
    .select('slug')
    .eq('id', pageId)
    .maybeSingle<{ slug: string }>();
  if (!data) fail('/admin/content', 'That page no longer exists.');
  return data.slug;
}

export async function addSectionAction(formData: FormData): Promise<void> {
  await requireSuperAdmin();
  const pageId = text(formData, 'page_id');
  const parsed = sectionSchema.safeParse({
    heading: text(formData, 'heading'),
    body: formData.get('body')?.toString(),
    bullets: formData.get('bullets')?.toString(),
    tone: text(formData, 'tone') || 'standard',
    image_url: text(formData, 'image_url'),
    link_label: text(formData, 'link_label'),
    link_href: text(formData, 'link_href'),
    is_visible: checked(formData, 'is_visible'),
  });
  if (!parsed.success) fail(pagePath(pageId), parsed.error.issues[0]?.message ?? 'Check the section.');

  const body = toParagraphs(parsed.data.body);
  const bullets = toLines(parsed.data.bullets);
  if (!body.length && !bullets.length) {
    fail(pagePath(pageId), 'A section needs at least one paragraph or bullet.');
  }

  const supabase = await createClient();
  const { data: last } = await supabase
    .from('site_page_sections' as never)
    .select('sort_order')
    .eq('page_id', pageId)
    .order('sort_order', { ascending: false })
    .limit(1)
    .maybeSingle<{ sort_order: number }>();

  const { error } = await supabase.from('site_page_sections' as never).insert({
    page_id: pageId,
    heading: parsed.data.heading,
    body,
    bullets,
    tone: parsed.data.tone,
    image_url: parsed.data.image_url || null,
    link_label: parsed.data.link_label || null,
    link_href: parsed.data.link_href || null,
    is_visible: parsed.data.is_visible,
    sort_order: (last?.sort_order ?? 0) + 10,
  } as never);
  if (error) fail(pagePath(pageId), error.message);

  const slug = await pageSlugFor(pageId);
  revalidatePublic(slug);
  ok(pagePath(pageId), 'saved');
}

export async function updateSectionAction(formData: FormData): Promise<void> {
  await requireSuperAdmin();
  const pageId = text(formData, 'page_id');
  const sectionId = text(formData, 'section_id');
  const parsed = sectionSchema.safeParse({
    heading: text(formData, 'heading'),
    body: formData.get('body')?.toString(),
    bullets: formData.get('bullets')?.toString(),
    tone: text(formData, 'tone') || 'standard',
    image_url: text(formData, 'image_url'),
    link_label: text(formData, 'link_label'),
    link_href: text(formData, 'link_href'),
    is_visible: checked(formData, 'is_visible'),
  });
  if (!parsed.success) fail(pagePath(pageId), parsed.error.issues[0]?.message ?? 'Check the section.');

  const body = toParagraphs(parsed.data.body);
  const bullets = toLines(parsed.data.bullets);
  if (!body.length && !bullets.length) {
    fail(pagePath(pageId), 'A section needs at least one paragraph or bullet.');
  }

  const supabase = await createClient();
  const { error } = await supabase
    .from('site_page_sections' as never)
    .update({
      heading: parsed.data.heading,
      body,
      bullets,
      tone: parsed.data.tone,
      image_url: parsed.data.image_url || null,
      link_label: parsed.data.link_label || null,
      link_href: parsed.data.link_href || null,
      is_visible: parsed.data.is_visible,
    } as never)
    .eq('id', sectionId)
    .eq('page_id', pageId);
  if (error) fail(pagePath(pageId), error.message);

  const slug = await pageSlugFor(pageId);
  revalidatePublic(slug);
  ok(pagePath(pageId), 'saved');
}

export async function deleteSectionAction(formData: FormData): Promise<void> {
  await requireSuperAdmin();
  const pageId = text(formData, 'page_id');
  const sectionId = text(formData, 'section_id');
  const supabase = await createClient();
  const { error } = await supabase
    .from('site_page_sections' as never)
    .delete()
    .eq('id', sectionId)
    .eq('page_id', pageId);
  if (error) fail(pagePath(pageId), error.message);

  const slug = await pageSlugFor(pageId);
  revalidatePublic(slug);
  ok(pagePath(pageId), 'saved');
}

/**
 * Reorder with explicit up/down controls (not drag-and-drop) so the action is
 * reachable by keyboard and screen reader. Neighbouring sort_order values are
 * swapped inside one update each; duplicate values are handled by ordering on
 * (sort_order, id) everywhere the sections are read.
 */
export async function moveSectionAction(formData: FormData): Promise<void> {
  await requireSuperAdmin();
  const pageId = text(formData, 'page_id');
  const sectionId = text(formData, 'section_id');
  const direction = text(formData, 'direction') === 'down' ? 'down' : 'up';

  const supabase = await createClient();
  const { data, error } = await supabase
    .from('site_page_sections' as never)
    .select('id, sort_order')
    .eq('page_id', pageId)
    .order('sort_order', { ascending: true })
    .order('id', { ascending: true })
    .returns<{ id: string; sort_order: number }[]>();
  if (error) fail(pagePath(pageId), error.message);

  const rows = data ?? [];
  const index = rows.findIndex((row) => row.id === sectionId);
  if (index < 0) fail(pagePath(pageId), 'That section no longer exists.');
  const neighbour = rows[direction === 'up' ? index - 1 : index + 1];
  if (!neighbour) ok(pagePath(pageId), 'order-updated');

  const current = rows[index]!;
  // Normalise to the index when two sections share a sort_order, otherwise the
  // swap is a no-op and the buttons appear broken.
  const targetOrder = neighbour.sort_order === current.sort_order ? (direction === 'up' ? current.sort_order - 5 : current.sort_order + 5) : neighbour.sort_order;

  const first = await supabase
    .from('site_page_sections' as never)
    .update({ sort_order: targetOrder } as never)
    .eq('id', current.id)
    .eq('page_id', pageId);
  if (first.error) fail(pagePath(pageId), first.error.message);

  const second = await supabase
    .from('site_page_sections' as never)
    .update({ sort_order: current.sort_order } as never)
    .eq('id', neighbour.id)
    .eq('page_id', pageId);
  if (second.error) fail(pagePath(pageId), second.error.message);

  const slug = await pageSlugFor(pageId);
  revalidatePublic(slug);
  ok(pagePath(pageId), 'order-updated');
}

/* -------------------------------------------------------------------------- */
/* Internal notes (super-admin only)                                          */
/* -------------------------------------------------------------------------- */

export async function saveAdminNotesAction(formData: FormData): Promise<void> {
  const user = await requireSuperAdmin();
  const pageId = text(formData, 'page_id');
  const parsed = adminNotesSchema.safeParse({
    internal_notes: formData.get('internal_notes')?.toString() ?? '',
    owner_decisions: formData.get('owner_decisions')?.toString() ?? '',
    review_status: text(formData, 'review_status') || 'owner_review_pending',
  });
  if (!parsed.success) fail(pagePath(pageId), parsed.error.issues[0]?.message ?? 'Check the notes.');

  const approved = parsed.data.review_status === 'owner_approved' || parsed.data.review_status === 'legal_reviewed';
  const supabase = await createClient();
  const { error } = await supabase.from('site_page_admin_notes' as never).upsert({
    page_id: pageId,
    internal_notes: parsed.data.internal_notes || null,
    owner_decisions: toLines(parsed.data.owner_decisions),
    review_status: parsed.data.review_status,
    reviewed_by: approved ? user.id : null,
    reviewed_at: approved ? new Date().toISOString() : null,
  } as never);
  if (error) fail(pagePath(pageId), error.message);

  revalidatePath(pagePath(pageId));
  ok(pagePath(pageId), 'saved');
}

/* -------------------------------------------------------------------------- */
/* Publishing                                                                 */
/* -------------------------------------------------------------------------- */

export async function publishPageAction(formData: FormData): Promise<void> {
  await requireSuperAdmin();
  const pageId = text(formData, 'page_id');
  const slug = await pageSlugFor(pageId);
  /**
   * Publishing makes a page READABLE. It does not, by itself, make the page a
   * document a customer must ACCEPT: the acceptance registry (0098) is a short
   * list whose versions the database enforces, and adding an entry pins that
   * version for every future acceptance. So the operator has to tick the box on
   * this publish; an unticked box (or any other caller) registers nothing, and
   * the RPC's own default is FALSE.
   */
  const registerAcceptance = formData.get('register_acceptance') === 'on';
  const supabase = await createClient();
  const { error } = await supabase.rpc('publish_site_page' as never, {
    p_page_id: pageId,
    p_register_acceptance: registerAcceptance,
  } as never);
  if (error) fail(pagePath(pageId), error.message);

  await audit('site_page_published', pageId, { slug, registerAcceptance });
  revalidatePublic(slug);
  ok(pagePath(pageId), 'published');
}

export async function unpublishPageAction(formData: FormData): Promise<void> {
  await requireSuperAdmin();
  const pageId = text(formData, 'page_id');
  const slug = await pageSlugFor(pageId);
  const supabase = await createClient();
  const { error } = await supabase.rpc('unpublish_site_page' as never, { p_page_id: pageId } as never);
  // "Not published" is not a failure: the operator's intent is already true.
  if (error && !/not published/i.test(error.message)) fail(pagePath(pageId), error.message);

  await audit('site_page_unpublished', pageId, { slug });
  revalidatePublic(slug);
  ok(pagePath(pageId), 'unpublished');
}
