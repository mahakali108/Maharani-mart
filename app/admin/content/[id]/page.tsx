import Link from 'next/link';
import { notFound } from 'next/navigation';
import { AlertTriangle, ArrowDown, ArrowUp, Eye, History, Save, Trash2, Upload, UploadCloud } from 'lucide-react';
import { requireSuperAdminPage } from '@/lib/admin/control-center/guard';
import {
  addSectionAction,
  deletePageAction,
  deleteSectionAction,
  moveSectionAction,
  publishPageAction,
  restoreRevisionAction,
  saveAdminNotesAction,
  unpublishPageAction,
  updatePageSettingsAction,
  updateSectionAction,
} from '@/lib/admin/site-content-actions';
import {
  loadActorNames,
  loadAdminNotes,
  loadAdminPage,
  loadAdminSections,
  loadPageRevisions,
} from '@/lib/site-content/queries';
import {
  draftIssues,
  hasUnpublishedChanges,
  revisionSummary,
  revisionToDraft,
  visibleSections,
} from '@/lib/site-content/draft-preview';
import { formatPolicyDate } from '@/lib/site-content/render';
import { REVIEW_STATUS_LABEL, type SiteSectionTone } from '@/lib/site-content/types';
import { ContentNotice } from '@/components/admin/site-content/content-notice';
import { Card, CardHeader, CardTitle } from '@/components/ui/card';

export const dynamic = 'force-dynamic';

const TONES: Array<{ value: SiteSectionTone; label: string }> = [
  { value: 'standard', label: 'Standard card' },
  { value: 'highlight', label: 'Highlighted card' },
];

export default async function AdminContentEditorPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ notice?: string; error?: string }>;
}) {
  await requireSuperAdminPage();
  const { id } = await params;
  const query = await searchParams;

  const page = await loadAdminPage(id);
  if (!page) notFound();

  const [sections, notes, revisions] = await Promise.all([
    loadAdminSections(page.id),
    loadAdminNotes(page.id),
    loadPageRevisions(page.id),
  ]);
  const actorNames = await loadActorNames([page.updated_by, page.published_by, notes?.reviewed_by ?? null]);

  const issues = draftIssues(page, sections, notes);
  const stale = hasUnpublishedChanges(page, sections);
  const publicHref = page.kind === 'legal' ? `/legal/${page.slug}` : `/${page.slug}`;
  const ordered = [...sections].sort((a, b) =>
    a.sort_order === b.sort_order ? a.id.localeCompare(b.id) : a.sort_order - b.sort_order,
  );

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <Link href="/admin/content" className="text-xs font-semibold text-ink-500 hover:text-ink-800">
            ← All website pages
          </Link>
          <h1 className="mt-1 text-2xl font-semibold text-ink-950">{page.title}</h1>
          <p className="mt-1 text-sm text-ink-500">
            <span className="font-mono">{publicHref}</span> · {page.status === 'published' ? 'Published' : 'Draft'} ·
            version {page.version}
            {page.is_system ? ' · required page (cannot be deleted)' : ''}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link
            href={`/admin/content/${page.id}/preview`}
            className="inline-flex items-center gap-2 rounded-xl border border-ink-200 px-4 py-2 text-sm font-semibold text-ink-700 hover:bg-ink-50"
          >
            <Eye className="h-4 w-4" aria-hidden /> Preview draft
          </Link>
          {page.status === 'published' ? (
            <a
              href={publicHref}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 rounded-xl border border-ink-200 px-4 py-2 text-sm font-semibold text-ink-700 hover:bg-ink-50"
            >
              Open public page
            </a>
          ) : null}
        </div>
      </div>

      <ContentNotice notice={query.notice} error={query.error} />

      {/* Publishing state + internal warnings. This block never reaches a customer. */}
      <Card className={issues.some((issue) => issue.severity === 'blocking') ? 'border-amber-200 bg-amber-50/40' : undefined}>
        <CardHeader>
          <CardTitle>Publishing status</CardTitle>
        </CardHeader>
        <div className="space-y-3 p-1 text-sm">
          <p className="text-ink-700">
            {page.status === 'published'
              ? stale
                ? 'The published page is live, but this draft has changes that customers cannot see until you publish.'
                : 'The published page matches this draft.'
              : 'This page is not published. Customers see a short “not available” message.'}
          </p>
          {issues.length ? (
            <ul className="space-y-1.5">
              {issues.map((issue) => (
                <li key={issue.message} className="flex gap-2">
                  <AlertTriangle
                    className={issue.severity === 'blocking' ? 'mt-0.5 h-4 w-4 shrink-0 text-amber-600' : 'mt-0.5 h-4 w-4 shrink-0 text-ink-400'}
                    aria-hidden
                  />
                  <span className={issue.severity === 'blocking' ? 'text-amber-950' : 'text-ink-600'}>{issue.message}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-mint-700">No outstanding issues found for this draft.</p>
          )}
          <div className="flex flex-wrap gap-2 pt-1">
            <form action={publishPageAction} className="space-y-2">
              <input type="hidden" name="page_id" value={page.id} />
              {page.kind === 'legal' ? (
                <label className="flex items-start gap-2 rounded-xl border border-ink-200 bg-ink-50/60 p-2 text-xs text-ink-700">
                  <input type="checkbox" name="register_acceptance" className="mt-0.5" />
                  <span>
                    <strong className="font-semibold">Also require acceptance of this version</strong>
                    <span className="block text-ink-500">
                      Off by default. Ticking this records version {page.version} in the acceptance registry (0098), which
                      makes {page.title} a document customers must accept — and stops the database accepting any other
                      version. Publish the page first; only tick this when a consent change is actually intended.
                    </span>
                  </span>
                </label>
              ) : null}
              <button
                type="submit"
                className="inline-flex items-center gap-2 rounded-xl bg-mint-600 px-4 py-2 text-sm font-semibold text-white hover:bg-mint-700"
              >
                <UploadCloud className="h-4 w-4" aria-hidden />
                {page.status === 'published' ? 'Publish changes' : 'Publish page'}
              </button>
            </form>
            {page.status === 'published' ? (
              /* Unpublishing removes a customer-facing page immediately, so it is
                 behind an explicit disclosure + confirmation, never a bare button. */
              <details>
                <summary className="inline-flex cursor-pointer items-center gap-2 rounded-xl border border-ink-200 px-4 py-2 text-sm font-semibold text-ink-700 hover:bg-ink-50">
                  <Upload className="h-4 w-4 rotate-180" aria-hidden /> Unpublish
                </summary>
                <form action={unpublishPageAction} className="mt-2 rounded-xl border border-amber-200 bg-amber-50 p-3">
                  <input type="hidden" name="page_id" value={page.id} />
                  <p className="text-xs text-amber-950">
                    <strong className="font-semibold">Customers lose this page immediately.</strong> “{page.title}” is
                    removed from the public site and its address answers “not available right now”. The draft, the
                    history and any acceptance version already recorded are kept — republishing restores the page.
                  </p>
                  <button
                    type="submit"
                    className="mt-2 inline-flex items-center gap-2 rounded-lg bg-amber-700 px-3 py-1.5 text-xs font-semibold text-white hover:bg-amber-800"
                  >
                    Yes, unpublish this page
                  </button>
                </form>
              </details>
            ) : null}
            {!page.is_system ? (
              <details className="ml-auto">
                <summary className="inline-flex cursor-pointer items-center gap-2 rounded-xl border border-error-200 px-4 py-2 text-sm font-semibold text-error-700 hover:bg-error-50">
                  <Trash2 className="h-4 w-4" aria-hidden /> Delete page
                </summary>
                <form action={deletePageAction} className="mt-2 rounded-xl border border-error-200 bg-error-50 p-3">
                  <input type="hidden" name="page_id" value={page.id} />
                  <p className="text-xs text-error-900">This removes the page permanently. It cannot be undone.</p>
                  <button type="submit" className="mt-2 rounded-lg bg-error-700 px-3 py-1.5 text-xs font-semibold text-white hover:bg-error-800">
                    Yes, delete this page
                  </button>
                </form>
              </details>
            ) : null}
          </div>
        </div>
      </Card>

      {/* Page settings */}
      <Card>
        <CardHeader>
          <CardTitle>Page details</CardTitle>
        </CardHeader>
        <form action={updatePageSettingsAction} className="grid gap-3 p-1 sm:grid-cols-2">
          <input type="hidden" name="page_id" value={page.id} />

          <label className="text-sm sm:col-span-2">
            <span className="font-semibold text-ink-800">Page title</span>
            <input name="title" required maxLength={160} defaultValue={page.title} className="mt-1 w-full rounded-xl border border-ink-200 px-3 py-2 text-sm" />
          </label>
          <label className="text-sm sm:col-span-2">
            <span className="font-semibold text-ink-800">Introduction</span>
            <textarea name="intro" required rows={3} maxLength={1200} defaultValue={page.intro ?? ''} className="mt-1 w-full rounded-xl border border-ink-200 px-3 py-2 text-sm" />
            <span className="mt-1 block text-xs text-ink-500">Shown directly under the title. Required before publishing.</span>
          </label>
          <label className="text-sm">
            <span className="font-semibold text-ink-800">Menu label</span>
            <input name="nav_label" required maxLength={60} defaultValue={page.nav_label} className="mt-1 w-full rounded-xl border border-ink-200 px-3 py-2 text-sm" />
          </label>
          <label className="text-sm">
            <span className="font-semibold text-ink-800">Short label</span>
            <input name="short_label" maxLength={60} defaultValue={page.short_label ?? ''} className="mt-1 w-full rounded-xl border border-ink-200 px-3 py-2 text-sm" />
          </label>
          <label className="text-sm">
            <span className="font-semibold text-ink-800">Eyebrow</span>
            <input name="eyebrow" maxLength={80} defaultValue={page.eyebrow ?? ''} className="mt-1 w-full rounded-xl border border-ink-200 px-3 py-2 text-sm" />
          </label>
          <label className="text-sm">
            <span className="font-semibold text-ink-800">Search description</span>
            <input name="meta_description" maxLength={320} defaultValue={page.meta_description ?? ''} className="mt-1 w-full rounded-xl border border-ink-200 px-3 py-2 text-sm" />
          </label>
          <label className="text-sm">
            <span className="font-semibold text-ink-800">Version</span>
            <input name="version" required pattern="\d+\.\d+" defaultValue={page.version} className="mt-1 w-full rounded-xl border border-ink-200 px-3 py-2 text-sm" />
            <span className="mt-1 block text-xs text-ink-500">Change this for a new policy version (for example 1.1).</span>
          </label>
          <label className="text-sm">
            <span className="font-semibold text-ink-800">Effective date</span>
            <input type="date" name="effective_date" required defaultValue={page.effective_date ?? ''} className="mt-1 w-full rounded-xl border border-ink-200 px-3 py-2 text-sm" />
          </label>
          <label className="text-sm">
            <span className="font-semibold text-ink-800">Type</span>
            <select name="kind" defaultValue={page.kind} className="mt-1 w-full rounded-xl border border-ink-200 px-3 py-2 text-sm">
              <option value="page">Information page</option>
              <option value="legal">Legal / policy document</option>
            </select>
          </label>
          <label className="text-sm">
            <span className="font-semibold text-ink-800">Audience</span>
            <select name="audience" defaultValue={page.audience} className="mt-1 w-full rounded-xl border border-ink-200 px-3 py-2 text-sm">
              <option value="everyone">Everyone</option>
              <option value="buyers">Retailers and wholesale buyers</option>
              <option value="sellers">Sellers</option>
            </select>
          </label>
          <label className="text-sm">
            <span className="font-semibold text-ink-800">Menu order</span>
            <input type="number" name="sort_order" min={0} defaultValue={page.sort_order} className="mt-1 w-full rounded-xl border border-ink-200 px-3 py-2 text-sm" />
          </label>
          <label className="text-sm">
            <span className="font-semibold text-ink-800">Related pages</span>
            <textarea name="related_slugs" rows={3} defaultValue={(page.related_slugs ?? []).join('\n')} className="mt-1 w-full rounded-xl border border-ink-200 px-3 py-2 font-mono text-xs" />
            <span className="mt-1 block text-xs text-ink-500">One page address per line (for example privacy).</span>
          </label>
          <label className="text-sm sm:col-span-2">
            <span className="font-semibold text-ink-800">Header image URL</span>
            <input name="hero_image_url" maxLength={2048} defaultValue={page.hero_image_url ?? ''} className="mt-1 w-full rounded-xl border border-ink-200 px-3 py-2 font-mono text-xs" />
          </label>
          <div className="flex flex-wrap gap-4 text-sm sm:col-span-2">
            <label className="inline-flex items-center gap-2">
              <input type="checkbox" name="show_in_footer" defaultChecked={page.show_in_footer} /> Show in footer / information menu
            </label>
            <label className="inline-flex items-center gap-2">
              <input type="checkbox" name="show_in_index" defaultChecked={page.show_in_index} /> List on the policies index
            </label>
            <label className="inline-flex items-center gap-2">
              <input type="checkbox" name="show_contact_details" defaultChecked={page.show_contact_details} /> Show the contact card
            </label>
          </div>
          <div className="sm:col-span-2">
            <button type="submit" className="inline-flex items-center gap-2 rounded-xl bg-primary-600 px-4 py-2 text-sm font-semibold text-white hover:bg-primary-700">
              <Save className="h-4 w-4" aria-hidden /> Save draft
            </button>
          </div>
          <p className="text-xs text-ink-500 sm:col-span-2">
            Last modified {new Date(page.updated_at).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })} IST
            {page.updated_by
              ? ` by ${actorNames.get(page.updated_by) ?? 'another Super Admin'}`
              : ''}
            . Saving never changes the live page until you publish.
          </p>
        </form>
      </Card>

      {/* Sections */}
      <Card>
        <CardHeader className="flex flex-wrap items-center justify-between gap-2">
          <CardTitle>Content sections</CardTitle>
          <span className="text-xs text-ink-500">
            {sections.length} section(s) · {visibleSections(sections).length} visible
          </span>
        </CardHeader>
        <div className="space-y-3 p-1">
          {ordered.length === 0 ? (
            <p className="rounded-xl border border-dashed border-ink-200 p-4 text-sm text-ink-600">
              No sections yet. Add the first section below — a page cannot be published without at least one visible
              section.
            </p>
          ) : null}
          {ordered.map((section, index) => (
            <details key={section.id} className="rounded-2xl border border-ink-100 bg-white">
              <summary className="flex cursor-pointer flex-wrap items-center justify-between gap-2 p-4">
                <span className="font-semibold text-ink-900">
                  {index + 1}. {section.heading}
                </span>
                <span className="flex items-center gap-2 text-xs">
                  {section.is_visible ? (
                    <span className="rounded-full bg-mint-100 px-2 py-0.5 font-semibold text-mint-900">Visible</span>
                  ) : (
                    <span className="rounded-full bg-slate-100 px-2 py-0.5 font-semibold text-slate-700">Hidden</span>
                  )}
                  {section.tone === 'highlight' ? (
                    <span className="rounded-full bg-lavender-100 px-2 py-0.5 font-semibold text-primary-800">Highlighted</span>
                  ) : null}
                </span>
              </summary>
              <div className="border-t border-ink-100 p-4">
                <form action={updateSectionAction} className="space-y-3">
                  <input type="hidden" name="page_id" value={page.id} />
                  <input type="hidden" name="section_id" value={section.id} />
                  <label className="block text-sm">
                    <span className="font-semibold text-ink-800">Heading</span>
                    <input name="heading" required maxLength={200} defaultValue={section.heading} className="mt-1 w-full rounded-xl border border-ink-200 px-3 py-2 text-sm" />
                  </label>
                  <label className="block text-sm">
                    <span className="font-semibold text-ink-800">Paragraphs</span>
                    <textarea name="body" rows={6} defaultValue={(section.body ?? []).join('\n\n')} className="mt-1 w-full rounded-xl border border-ink-200 px-3 py-2 text-sm" />
                    <span className="mt-1 block text-xs text-ink-500">
                      Separate paragraphs with a blank line. A link is written as [label](/legal/returns).
                    </span>
                  </label>
                  <label className="block text-sm">
                    <span className="font-semibold text-ink-800">Bullets</span>
                    <textarea name="bullets" rows={4} defaultValue={(section.bullets ?? []).join('\n')} className="mt-1 w-full rounded-xl border border-ink-200 px-3 py-2 text-sm" />
                    <span className="mt-1 block text-xs text-ink-500">One bullet per line.</span>
                  </label>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <label className="text-sm">
                      <span className="font-semibold text-ink-800">Style</span>
                      <select name="tone" defaultValue={section.tone} className="mt-1 w-full rounded-xl border border-ink-200 px-3 py-2 text-sm">
                        {TONES.map((tone) => (
                          <option key={tone.value} value={tone.value}>{tone.label}</option>
                        ))}
                      </select>
                    </label>
                    <label className="text-sm">
                      <span className="font-semibold text-ink-800">Image URL</span>
                      <input name="image_url" maxLength={2048} defaultValue={section.image_url ?? ''} className="mt-1 w-full rounded-xl border border-ink-200 px-3 py-2 font-mono text-xs" />
                    </label>
                    <label className="text-sm">
                      <span className="font-semibold text-ink-800">Button label</span>
                      <input name="link_label" maxLength={80} defaultValue={section.link_label ?? ''} className="mt-1 w-full rounded-xl border border-ink-200 px-3 py-2 text-sm" />
                    </label>
                    <label className="text-sm">
                      <span className="font-semibold text-ink-800">Button destination</span>
                      <input name="link_href" maxLength={2048} defaultValue={section.link_href ?? ''} className="mt-1 w-full rounded-xl border border-ink-200 px-3 py-2 font-mono text-xs" />
                    </label>
                  </div>
                  <label className="inline-flex items-center gap-2 text-sm">
                    <input type="checkbox" name="is_visible" defaultChecked={section.is_visible} /> Visible on the public page
                  </label>
                  <div className="flex flex-wrap items-center gap-2 pt-1">
                    <button type="submit" className="inline-flex items-center gap-2 rounded-xl bg-primary-600 px-4 py-2 text-sm font-semibold text-white hover:bg-primary-700">
                      <Save className="h-4 w-4" aria-hidden /> Save section
                    </button>
                  </div>
                </form>
                <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-ink-100 pt-3">
                  <form action={moveSectionAction}>
                    <input type="hidden" name="page_id" value={page.id} />
                    <input type="hidden" name="section_id" value={section.id} />
                    <input type="hidden" name="direction" value="up" />
                    <button type="submit" disabled={index === 0} className="inline-flex items-center gap-1 rounded-lg border border-ink-200 px-3 py-1.5 text-xs font-semibold text-ink-700 disabled:opacity-40">
                      <ArrowUp className="h-3.5 w-3.5" aria-hidden /> Move up
                    </button>
                  </form>
                  <form action={moveSectionAction}>
                    <input type="hidden" name="page_id" value={page.id} />
                    <input type="hidden" name="section_id" value={section.id} />
                    <input type="hidden" name="direction" value="down" />
                    <button type="submit" disabled={index === ordered.length - 1} className="inline-flex items-center gap-1 rounded-lg border border-ink-200 px-3 py-1.5 text-xs font-semibold text-ink-700 disabled:opacity-40">
                      <ArrowDown className="h-3.5 w-3.5" aria-hidden /> Move down
                    </button>
                  </form>
                  <form action={deleteSectionAction} className="ml-auto">
                    <input type="hidden" name="page_id" value={page.id} />
                    <input type="hidden" name="section_id" value={section.id} />
                    <button type="submit" className="inline-flex items-center gap-1 rounded-lg border border-error-200 px-3 py-1.5 text-xs font-semibold text-error-700 hover:bg-error-50">
                      <Trash2 className="h-3.5 w-3.5" aria-hidden /> Delete section
                    </button>
                  </form>
                </div>
              </div>
            </details>
          ))}

          <details className="rounded-2xl border border-dashed border-ink-200 p-4">
            <summary className="cursor-pointer text-sm font-semibold text-ink-800">Add a section</summary>
            <form action={addSectionAction} className="mt-3 space-y-3">
              <input type="hidden" name="page_id" value={page.id} />
              <label className="block text-sm">
                <span className="font-semibold text-ink-800">Heading</span>
                <input name="heading" required maxLength={200} className="mt-1 w-full rounded-xl border border-ink-200 px-3 py-2 text-sm" />
              </label>
              <label className="block text-sm">
                <span className="font-semibold text-ink-800">Paragraphs</span>
                <textarea name="body" rows={5} className="mt-1 w-full rounded-xl border border-ink-200 px-3 py-2 text-sm" />
                <span className="mt-1 block text-xs text-ink-500">Blank line between paragraphs. [label](/path) for a link.</span>
              </label>
              <label className="block text-sm">
                <span className="font-semibold text-ink-800">Bullets</span>
                <textarea name="bullets" rows={3} className="mt-1 w-full rounded-xl border border-ink-200 px-3 py-2 text-sm" />
              </label>
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="text-sm">
                  <span className="font-semibold text-ink-800">Style</span>
                  <select name="tone" className="mt-1 w-full rounded-xl border border-ink-200 px-3 py-2 text-sm">
                    {TONES.map((tone) => (
                      <option key={tone.value} value={tone.value}>{tone.label}</option>
                    ))}
                  </select>
                </label>
                <label className="text-sm">
                  <span className="font-semibold text-ink-800">Image URL</span>
                  <input name="image_url" maxLength={2048} className="mt-1 w-full rounded-xl border border-ink-200 px-3 py-2 font-mono text-xs" />
                </label>
                <label className="text-sm">
                  <span className="font-semibold text-ink-800">Button label</span>
                  <input name="link_label" maxLength={80} className="mt-1 w-full rounded-xl border border-ink-200 px-3 py-2 text-sm" />
                </label>
                <label className="text-sm">
                  <span className="font-semibold text-ink-800">Button destination</span>
                  <input name="link_href" maxLength={2048} className="mt-1 w-full rounded-xl border border-ink-200 px-3 py-2 font-mono text-xs" />
                </label>
              </div>
              <label className="inline-flex items-center gap-2 text-sm">
                <input type="checkbox" name="is_visible" defaultChecked /> Visible on the public page
              </label>
              <button type="submit" className="inline-flex items-center gap-2 rounded-xl bg-primary-600 px-4 py-2 text-sm font-semibold text-white hover:bg-primary-700">
                <Save className="h-4 w-4" aria-hidden /> Add section
              </button>
            </form>
          </details>
        </div>
      </Card>

      {/* Internal notes */}
      <Card className="border-amber-200">
        <CardHeader>
          <CardTitle>Internal review — never shown to customers</CardTitle>
        </CardHeader>
        <form action={saveAdminNotesAction} className="space-y-3 p-1">
          <input type="hidden" name="page_id" value={page.id} />
          <label className="block text-sm">
            <span className="font-semibold text-ink-800">Review status</span>
            <select name="review_status" defaultValue={notes?.review_status ?? 'owner_review_pending'} className="mt-1 w-full rounded-xl border border-ink-200 px-3 py-2 text-sm">
              {Object.entries(REVIEW_STATUS_LABEL).map(([value, label]) => (
                <option key={value} value={value}>{label}</option>
              ))}
            </select>
            <span className="mt-1 block text-xs text-ink-500">
              Choosing &ldquo;owner approved&rdquo; or &ldquo;legal review recorded&rdquo; records you as the reviewer with the
              current time. Do not record an approval that has not happened.
            </span>
          </label>
          <label className="block text-sm">
            <span className="font-semibold text-ink-800">Internal notes</span>
            <textarea name="internal_notes" rows={4} maxLength={8000} defaultValue={notes?.internal_notes ?? ''} className="mt-1 w-full rounded-xl border border-ink-200 px-3 py-2 text-sm" />
          </label>
          <label className="block text-sm">
            <span className="font-semibold text-ink-800">Open owner decisions</span>
            <textarea name="owner_decisions" rows={4} maxLength={8000} defaultValue={(notes?.owner_decisions ?? []).join('\n')} className="mt-1 w-full rounded-xl border border-ink-200 px-3 py-2 text-sm" />
            <span className="mt-1 block text-xs text-ink-500">
              One per line. These are the commercial points the owner must decide; they stay here and are not published.
            </span>
          </label>
          <button type="submit" className="inline-flex items-center gap-2 rounded-xl bg-ink-900 px-4 py-2 text-sm font-semibold text-white hover:bg-ink-800">
            <Save className="h-4 w-4" aria-hidden /> Save internal notes
          </button>
          {notes?.reviewed_at ? (
            <p className="text-xs text-ink-500">
              Last review recorded {new Date(notes.reviewed_at).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })} IST
              {notes.reviewed_by
                ? ` by ${actorNames.get(notes.reviewed_by) ?? 'another Super Admin'}`
                : ''}
              .
            </p>
          ) : null}
        </form>
      </Card>

      {/* Publishing history */}
      <Card>
        <CardHeader className="flex items-center gap-2">
          <History className="h-4 w-4" aria-hidden />
          <CardTitle>Publishing history</CardTitle>
        </CardHeader>
        {revisions.length === 0 ? (
          <p className="p-1 text-sm text-ink-600">Nothing has been published from this page yet.</p>
        ) : (
          <ul className="space-y-2 p-1 text-sm">
            {revisions.map((revision) => {
              const summary = revisionSummary(revision.snapshot);
              const restorable = revisionToDraft(revision.snapshot) !== null;
              return (
                <li key={revision.id} className="rounded-xl border border-ink-100 p-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="font-semibold text-ink-900">
                      {revision.event === 'published' ? 'Published' : revision.event === 'unpublished' ? 'Unpublished' : 'Published new version'}{' '}
                      <span className="font-normal text-ink-500">v{revision.version}</span>
                    </span>
                    <span className="text-xs text-ink-500">
                      {new Date(revision.created_at).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })} IST
                    </span>
                  </div>
                  {summary ? (
                    <p className="mt-1 text-xs text-ink-600">
                      “{summary.title}” · {summary.sectionCount} section{summary.sectionCount === 1 ? '' : 's'}
                    </p>
                  ) : null}
                  {restorable ? (
                    <details className="mt-2">
                      <summary className="cursor-pointer text-xs font-semibold text-ink-700 hover:text-ink-900">
                        Restore this revision into the draft
                      </summary>
                      <form action={restoreRevisionAction} className="mt-2 rounded-xl border border-ink-200 bg-ink-50/60 p-3">
                        <input type="hidden" name="page_id" value={page.id} />
                        <input type="hidden" name="revision_id" value={revision.id} />
                        <p className="text-xs text-ink-600">
                          This replaces the working draft with the wording recorded above. The live page does not change
                          until you publish, and this revision stays in the history.
                        </p>
                        <button
                          type="submit"
                          className="mt-2 rounded-lg bg-ink-900 px-3 py-1.5 text-xs font-semibold text-white hover:bg-ink-800"
                        >
                          Restore into the draft
                        </button>
                      </form>
                    </details>
                  ) : (
                    <p className="mt-1 text-xs text-ink-500">
                      This entry has no complete page wording to restore (it records an unpublish).
                    </p>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </Card>

      <p className="text-xs text-ink-500">
        Public address: <span className="font-mono">{publicHref}</span>. Last effective date:{' '}
        {page.effective_date ? formatPolicyDate(page.effective_date) : 'not set'}.
      </p>
    </div>
  );
}
