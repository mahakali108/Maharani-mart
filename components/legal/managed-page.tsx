import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { InfoCard, PublicInfoShell, type InformationNavLink } from '@/components/legal/public-info-shell';
import { loadPublishedPage, loadPublishedPages, pickRelatedPages } from '@/lib/site-content/queries';
import { formatPolicyDate, renderRichText } from '@/lib/site-content/render';
import type { PublishedPageRecord, PublishedPageSummary } from '@/lib/site-content/types';
import { footerLinksFromPages } from '@/lib/site-content/nav';

/** Navigation built from the pages the Super Admin has published, in order. */
export function informationNav(pages: readonly PublishedPageSummary[]): InformationNavLink[] | undefined {
  const links = footerLinksFromPages(pages);
  return links.length ? links : undefined;
}

function PageBody({ page, related }: { page: PublishedPageRecord; related: PublishedPageSummary[] }) {
  return (
    <>
      {page.page.sections.map((section, index) => (
        <InfoCard key={`${section.heading}-${index}`} title={section.heading} tone={section.tone}>
          {section.image_url ? (
            // Content images are uploaded by the Super Admin through the media
            // module, which returns Supabase Storage URLs. Rendered as a plain
            // <img> so no Next Image domain allow-list can break a page.
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={section.image_url}
              alt=""
              className="mb-1 w-full rounded-xl border border-slate-200 object-cover"
              loading="lazy"
            />
          ) : null}
          {section.body.map((paragraph, paragraphIndex) => (
            <p key={paragraphIndex}>{renderRichText(paragraph)}</p>
          ))}
          {section.bullets.length ? (
            <ul className="list-disc space-y-1.5 pl-5">
              {section.bullets.map((bullet, bulletIndex) => (
                <li key={bulletIndex}>{renderRichText(bullet)}</li>
              ))}
            </ul>
          ) : null}
          {section.link_label && section.link_href ? (
            <p>
              {section.link_href.startsWith('/') ? (
                <Link
                  href={section.link_href}
                  className="inline-flex min-h-11 items-center rounded-xl bg-primary-600 px-4 text-sm font-semibold text-white hover:bg-primary-700"
                >
                  {section.link_label}
                </Link>
              ) : (
                <a
                  href={section.link_href}
                  className="inline-flex min-h-11 items-center rounded-xl bg-primary-600 px-4 text-sm font-semibold text-white hover:bg-primary-700"
                  {...(section.link_href.startsWith('http') ? { target: '_blank', rel: 'noopener noreferrer' } : {})}
                >
                  {section.link_label}
                </a>
              )}
            </p>
          ) : null}
        </InfoCard>
      ))}

      {related.length ? (
        <InfoCard title="Related pages">
          <ul className="flex flex-wrap gap-x-4 gap-y-1">
            {related.map((item) => (
              <li key={item.slug}>
                <Link
                  href={item.kind === 'legal' ? `/legal/${item.slug}` : `/${item.slug}`}
                  className="inline-flex min-h-11 items-center font-semibold text-primary-700 underline-offset-2 hover:underline"
                >
                  {item.title}
                </Link>
              </li>
            ))}
          </ul>
        </InfoCard>
      ) : null}

      {page.show_contact_details ? (
        <InfoCard title="Questions about this page">
          <p>
            Write to us through the{' '}
            <Link href="/contact" className="font-semibold text-primary-700 underline">
              contact page
            </Link>{' '}
            or raise a support ticket from your account. Include your order number where the question is about an order.
          </p>
        </InfoCard>
      ) : null}
    </>
  );
}

/** A published page, exactly as stored in its published snapshot. */
export function ManagedPageView({
  page,
  allPages,
  navLinks,
  adminNotice,
}: {
  page: PublishedPageRecord;
  allPages: readonly PublishedPageSummary[];
  navLinks?: InformationNavLink[];
  /** Rendered above the content for the Super Admin preview only. Never set publicly. */
  adminNotice?: React.ReactNode;
}) {
  const related = pickRelatedPages(allPages, page.related_slugs).filter((item) => item.slug !== page.slug);
  return (
    <PublicInfoShell
      eyebrow={page.page.eyebrow ?? (page.kind === 'legal' ? 'Legal policies' : 'Information')}
      title={page.page.title}
      intro={page.page.intro}
      version={page.kind === 'legal' || page.version !== '1.0' ? page.version : undefined}
      effectiveDate={formatPolicyDate(page.effective_date)}
      navLinks={navLinks}
    >
      {adminNotice}
      <PageBody page={page} related={related} />
    </PublicInfoShell>
  );
}

/**
 * A page that exists but is not published. The message is deliberately plain and
 * customer-facing: it says nothing about drafts, reviews, administrators or why.
 */
export function UnavailablePage({ navLabel, navLinks }: { navLabel: string; navLinks?: InformationNavLink[] }) {
  return (
    <PublicInfoShell
      eyebrow="Information"
      title={navLabel}
      intro="This page is not available right now."
      navLinks={navLinks}
    >
      <InfoCard title="What you can do">
        <p>
          We are updating this page. In the meantime you can read the{' '}
          <Link href="/legal" className="font-semibold text-primary-700 underline">
            other policies
          </Link>{' '}
          or{' '}
          <Link href="/contact" className="font-semibold text-primary-700 underline">
            contact us
          </Link>{' '}
          if you need help with an order or your account.
        </p>
      </InfoCard>
    </PublicInfoShell>
  );
}

/** A read failure. Says so honestly instead of pretending the page is gone. */
export function UnreadablePage({ navLinks }: { navLinks?: InformationNavLink[] }) {
  return (
    <PublicInfoShell
      eyebrow="Information"
      title="This page could not be loaded"
      intro="Something went wrong while loading this page."
      navLinks={navLinks}
    >
      <InfoCard title="Please try again">
        <p>
          The page is temporarily unavailable. Reload the page, or{' '}
          <Link href="/contact" className="font-semibold text-primary-700 underline">
            contact us
          </Link>{' '}
          if it keeps happening.
        </p>
      </InfoCard>
    </PublicInfoShell>
  );
}

/**
 * Server component used by the fixed public addresses (/about, /contact) that
 * are rendered by the same managed content module as /legal/<slug>.
 */
export async function ManagedPublicPage({ slug }: { slug: string }) {
  const [page, pages] = await Promise.all([loadPublishedPage(slug), loadPublishedPages()]);
  const navLinks = informationNav(pages);
  if (page.state === 'missing') notFound();
  if (page.state === 'unavailable') return <UnreadablePage navLinks={navLinks} />;
  if (page.state === 'unpublished') return <UnavailablePage navLabel={page.nav_label} navLinks={navLinks} />;
  return <ManagedPageView page={page} allPages={pages} navLinks={navLinks} />;
}

/** Metadata for /about and /contact, from the published snapshot. */
export async function managedMetadata(slug: string, fallbackTitle: string): Promise<Metadata> {
  const page = await loadPublishedPage(slug);
  if (page.state !== 'published') {
    return { title: `${fallbackTitle} — Maharani Traders`, robots: { index: false, follow: false } };
  }
  return {
    title: `${page.page.title} — Maharani Traders`,
    description: page.page.meta_description ?? page.page.intro,
  };
}
