import Link from 'next/link';
import { AlertTriangle, ArrowUpRight, CheckCircle2, Eye, Plus, Star } from 'lucide-react';
import { requireSuperAdminPage } from '@/lib/admin/control-center/guard';
import { createPageAction } from '@/lib/admin/site-content-actions';
import { loadAdminNotes, loadAdminPages, loadAdminSections } from '@/lib/site-content/queries';
import { hasUnpublishedChanges } from '@/lib/site-content/draft-preview';
import { REVIEW_STATUS_LABEL, type SitePageRow } from '@/lib/site-content/types';
import { getAuthoritativeBusinessProfile, getAuthoritativeContactGrievance } from '@/lib/admin/business-settings/server';
import { ContentNotice } from '@/components/admin/site-content/content-notice';
import { Card, CardHeader, CardTitle } from '@/components/ui/card';

export const dynamic = 'force-dynamic';

export const metadata = { title: 'Website content — Super Admin' };

function statusBadge(page: SitePageRow, stale: boolean) {
  if (page.status !== 'published') {
    return <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-semibold text-slate-700">Draft</span>;
  }
  if (stale) {
    return <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-900">Published · unpublished edits</span>;
  }
  return <span className="rounded-full bg-mint-100 px-2 py-0.5 text-xs font-semibold text-mint-900">Published</span>;
}

/**
 * Super Admin → Website content.
 *
 * This is the ONLY place an operator warning about a page is rendered. A customer
 * reading /legal/<slug> sees the published wording and nothing else.
 */
export default async function AdminContentPage({
  searchParams,
}: {
  searchParams: Promise<{ notice?: string; error?: string }>;
}) {
  await requireSuperAdminPage();
  const params = await searchParams;

  const [pages, business, contact] = await Promise.all([
    loadAdminPages(),
    getAuthoritativeBusinessProfile(),
    getAuthoritativeContactGrievance(),
  ]);

  const rows: Array<{ page: SitePageRow; stale: boolean; notes: Awaited<ReturnType<typeof loadAdminNotes>> }> = [];
  if (pages) {
    for (const page of pages) {
      const [sections, notes] = await Promise.all([loadAdminSections(page.id), loadAdminNotes(page.id)]);
      rows.push({ page, stale: hasUnpublishedChanges(page, sections), notes });
    }
  }

  const published = rows.filter((row) => row.page.status === 'published').length;
  const drafts = rows.length - published;
  const pendingReview = rows.filter((row) => (row.notes?.review_status ?? 'owner_review_pending') === 'owner_review_pending').length;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-ink-950">Website content</h1>
          <Link href="/admin/branding" className="inline-flex min-h-11 items-center font-semibold text-primary-700">Storefront branding studio →</Link>
          <p className="mt-1 max-w-3xl text-sm text-ink-500">
            About Us, Contact and every policy page. Customers only ever see a published page; your draft, internal
            notes and owner decisions stay here.
          </p>
        </div>
        <Link
          href="/admin/content/business"
          className="inline-flex items-center gap-2 rounded-xl border border-ink-200 px-4 py-2 text-sm font-semibold text-ink-700 hover:bg-ink-50"
        >
          Business &amp; contact details <ArrowUpRight className="h-4 w-4" aria-hidden />
        </Link>
      </div>

      <ContentNotice notice={params.notice} error={params.error} />

      <div className="grid gap-3 sm:grid-cols-3">
        <Card className="p-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-ink-500">Published pages</p>
          <p className="mt-1 text-2xl font-bold text-ink-950">{published}</p>
        </Card>
        <Card className="p-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-ink-500">Draft pages</p>
          <p className="mt-1 text-2xl font-bold text-ink-950">{drafts}</p>
        </Card>
        <Card className="p-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-ink-500">Owner review pending</p>
          <p className="mt-1 text-2xl font-bold text-ink-950">{pendingReview}</p>
        </Card>
      </div>

      {/* Internal notices — admin-only by design. */}
      {business.verificationStatus !== 'verified' || !contact.isConfigured ? (
        <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-950">
          <p className="flex items-center gap-2 font-semibold">
            <AlertTriangle className="h-4 w-4" aria-hidden /> Business details are not marked verified
          </p>
          <ul className="mt-2 list-disc space-y-1 pl-5">
            {business.verificationStatus !== 'verified' ? (
              <li>Legal entity / GST details: <strong>{business.verificationStatus.replace(/_/g, ' ')}</strong>.</li>
            ) : null}
            {!contact.isConfigured ? (
              <li>
                Storefront contact and grievance details are not confirmed in{' '}
                <Link href="/admin/control-center" className="font-semibold underline">Control Center → business settings</Link>.
                The contact text on the published pages is whatever the page content says.
              </li>
            ) : null}
          </ul>
          <p className="mt-2 text-xs text-amber-900">
            This notice is internal. It is never rendered on a public page.
          </p>
        </div>
      ) : null}

      <Card>
        <CardHeader className="flex flex-wrap items-center justify-between gap-2">
          <CardTitle>Pages</CardTitle>
          <span className="text-xs text-ink-500">{rows.length} total</span>
        </CardHeader>
        {rows.length === 0 ? (
          <div className="p-6 text-sm text-ink-600">
            <p className="font-semibold text-ink-900">Website content management is empty</p>
            <p className="mt-1">
              No pages exist yet. Migration 0105 seeds the pages that were published before this module existed;
              if that migration was not applied, create the pages below (an unpublished page shows customers a short
              &ldquo;not available&rdquo; message).
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] text-sm">
              <thead>
                <tr className="border-b border-ink-100 text-left text-xs uppercase tracking-wide text-ink-500">
                  <th className="px-4 py-3 font-semibold">Page</th>
                  <th className="px-4 py-3 font-semibold">Address</th>
                  <th className="px-4 py-3 font-semibold">Status</th>
                  <th className="px-4 py-3 font-semibold">Version</th>
                  <th className="px-4 py-3 font-semibold">Review</th>
                  <th className="px-4 py-3 font-semibold">Actions</th>
                </tr>
              </thead>
              <tbody>
                {rows.map(({ page, stale, notes }) => (
                  <tr key={page.id} className="border-b border-ink-50 align-top">
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2 font-semibold text-ink-900">
                        {page.is_system ? <Star className="h-3.5 w-3.5 text-amber-500" aria-label="Required page" /> : null}
                        {page.title}
                      </div>
                      <div className="text-xs text-ink-500">{page.nav_label} · {page.kind === 'legal' ? 'Policy' : 'Page'}</div>
                    </td>
                    <td className="px-4 py-3 font-mono text-xs text-ink-600">
                      {page.kind === 'legal' ? `/legal/${page.slug}` : `/${page.slug}`}
                    </td>
                    <td className="px-4 py-3">{statusBadge(page, stale)}</td>
                    <td className="px-4 py-3 text-ink-700">{page.version}</td>
                    <td className="px-4 py-3 text-xs text-ink-600">
                      {REVIEW_STATUS_LABEL[notes?.review_status ?? 'owner_review_pending']}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex flex-wrap items-center gap-2">
                        <Link
                          href={`/admin/content/${page.id}`}
                          className="rounded-lg bg-ink-900 px-3 py-1.5 text-xs font-semibold text-white hover:bg-ink-800"
                        >
                          Edit
                        </Link>
                        <Link
                          href={`/admin/content/${page.id}/preview`}
                          className="inline-flex items-center gap-1 rounded-lg border border-ink-200 px-3 py-1.5 text-xs font-semibold text-ink-700 hover:bg-ink-50"
                        >
                          <Eye className="h-3.5 w-3.5" aria-hidden /> Preview
                        </Link>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Create a new page</CardTitle>
        </CardHeader>
        <form action={createPageAction} className="space-y-3 p-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="text-sm">
              <span className="font-semibold text-ink-800">Address</span>
              <input name="slug" required pattern="[a-z][a-z0-9]*(-[a-z0-9]+)*" placeholder="about-us" className="mt-1 w-full rounded-xl border border-ink-200 px-3 py-2 font-mono text-sm" />
              <span className="mt-1 block text-xs text-ink-500">Lowercase, hyphens. This becomes the public link.</span>
            </label>
            <label className="text-sm">
              <span className="font-semibold text-ink-800">Menu label</span>
              <input name="nav_label" required maxLength={60} placeholder="About us" className="mt-1 w-full rounded-xl border border-ink-200 px-3 py-2 text-sm" />
            </label>
            <label className="text-sm">
              <span className="font-semibold text-ink-800">Page title</span>
              <input name="title" required maxLength={160} placeholder="About Maharani Traders" className="mt-1 w-full rounded-xl border border-ink-200 px-3 py-2 text-sm" />
            </label>
            <label className="text-sm">
              <span className="font-semibold text-ink-800">Type</span>
              <select name="kind" className="mt-1 w-full rounded-xl border border-ink-200 px-3 py-2 text-sm">
                <option value="page">Information page</option>
                <option value="legal">Legal / policy document</option>
              </select>
            </label>
            <label className="text-sm">
              <span className="font-semibold text-ink-800">Audience</span>
              <select name="audience" className="mt-1 w-full rounded-xl border border-ink-200 px-3 py-2 text-sm">
                <option value="everyone">Everyone</option>
                <option value="buyers">Retailers and wholesale buyers</option>
              </select>
            </label>
          </div>
          <button type="submit" className="inline-flex items-center gap-2 rounded-xl bg-primary-600 px-4 py-2 text-sm font-semibold text-white hover:bg-primary-700">
            <Plus className="h-4 w-4" aria-hidden /> Create draft page
          </button>
          <p className="text-xs text-ink-500">
            The new page starts as a draft with no content. Nothing is visible to customers until you publish it.
          </p>
        </form>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>How publishing works</CardTitle>
        </CardHeader>
        <ul className="space-y-2 p-4 text-sm text-ink-600">
          <li className="flex gap-2"><CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-mint-600" aria-hidden />
            <span><strong>Save</strong> keeps your changes in the draft. The public page does not change.</span></li>
          <li className="flex gap-2"><CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-mint-600" aria-hidden />
            <span><strong>Publish</strong> copies the draft into the published page, records the version, and keeps a snapshot in the publishing history.</span></li>
          <li className="flex gap-2"><CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-mint-600" aria-hidden />
            <span><strong>Unpublish</strong> removes the page from the public site immediately. Customers see a short &ldquo;not available&rdquo; message; no draft text is exposed.</span></li>
        </ul>
      </Card>
    </div>
  );
}
