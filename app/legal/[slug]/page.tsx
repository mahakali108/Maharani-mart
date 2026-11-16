import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { ManagedPageView, UnavailablePage, UnreadablePage, informationNav } from '@/components/legal/managed-page';
import { loadPublishedPage, loadPublishedPages } from '@/lib/site-content/queries';

type Params = { params: Promise<{ slug: string }> };

/**
 * Every public policy page, rendered from the Super Admin managed content
 * (migration 0104). There is no hardcoded policy text left: the wording, the
 * version, the effective date, the section order, the images, the buttons and the
 * contact block all come from the published snapshot.
 *
 * The route stays dynamic: `published_page()` is the source of truth, so a
 * publish or unpublish in /admin/content takes effect on the next request with no
 * deploy. Slugs are not enumerated in code, so a page the Super Admin creates is
 * reachable immediately.
 */
export const dynamic = 'force-dynamic';

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { slug } = await params;
  const page = await loadPublishedPage(slug);
  if (page.state !== 'published') {
    return { title: 'Policy — Maharani Traders', robots: { index: false, follow: false } };
  }
  return {
    title: `${page.page.title} — Maharani Traders`,
    description: page.page.meta_description ?? page.page.intro,
  };
}

export default async function PolicyDocumentPage({ params }: Params) {
  const { slug } = await params;
  const [page, pages] = await Promise.all([loadPublishedPage(slug), loadPublishedPages()]);
  const navLinks = informationNav(pages);

  if (page.state === 'missing') notFound();
  if (page.state === 'unavailable') return <UnreadablePage navLinks={navLinks} />;
  if (page.state === 'unpublished') return <UnavailablePage navLabel={page.nav_label} navLinks={navLinks} />;

  return <ManagedPageView page={page} allPages={pages} navLinks={navLinks} />;
}
