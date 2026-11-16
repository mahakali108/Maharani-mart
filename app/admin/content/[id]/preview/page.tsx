import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireSuperAdminPage } from '@/lib/admin/control-center/guard';
import { loadAdminPage, loadAdminSections, loadPublishedPages } from '@/lib/site-content/queries';
import { draftToPublishedRecord, visibleSections } from '@/lib/site-content/draft-preview';
import { ManagedPageView, informationNav } from '@/components/legal/managed-page';
import type { Metadata } from 'next';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Preview — Website content',
  robots: { index: false, follow: false },
};

/**
 * Draft preview for the Super Admin. It renders the working draft through the
 * exact component the public page uses, so what is previewed is what publishing
 * produces. The route is super-admin only, is excluded from search engines, and
 * carries a banner that cannot appear on the public page.
 */
export default async function ContentPreviewPage({ params }: { params: Promise<{ id: string }> }) {
  await requireSuperAdminPage();
  const { id } = await params;
  const page = await loadAdminPage(id);
  if (!page) notFound();

  const [sections, published] = await Promise.all([loadAdminSections(page.id), loadPublishedPages()]);
  const record = draftToPublishedRecord(page, sections);
  const hidden = sections.length - visibleSections(sections).length;

  return (
    <ManagedPageView
      page={record}
      allPages={published}
      navLinks={informationNav(published)}
      adminNotice={
        <div className="rounded-2xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-950">
          <p className="font-semibold">Draft preview — not visible to customers</p>
          <p className="mt-1">
            This is what the page will look like when you publish it.
            {page.status === 'published' ? ' The live page may differ until you publish these changes.' : ' The page is not published.'}
            {hidden > 0 ? ` ${hidden} hidden section(s) are not included.` : ''}
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <Link
              href={`/admin/content/${page.id}`}
              className="rounded-xl bg-ink-900 px-3 py-1.5 text-xs font-semibold text-white hover:bg-ink-800"
            >
              Back to the editor
            </Link>
            {page.status === 'published' ? (
              <a
                href={page.kind === 'legal' ? `/legal/${page.slug}` : `/${page.slug}`}
                target="_blank"
                rel="noopener noreferrer"
                className="rounded-xl border border-amber-300 px-3 py-1.5 text-xs font-semibold text-amber-950 hover:bg-amber-100"
              >
                Open the live page
              </a>
            ) : null}
          </div>
        </div>
      }
    />
  );
}
