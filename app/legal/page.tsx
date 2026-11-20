import type { Metadata } from 'next';
import Link from 'next/link';
import { InfoCard, PublicInfoShell } from '@/components/legal/public-info-shell';
import { informationNav } from '@/components/legal/managed-page';
import { loadPublishedPages } from '@/lib/site-content/queries';
import { NOT_APPLICABLE_DOCUMENTS } from '@/lib/legal/documents';
import { AUDIENCE_LABEL, type EditableSitePageAudience } from '@/lib/site-content/types';
import { formatPolicyDate } from '@/lib/site-content/render';
import { BRAND } from '@/lib/brand';

export const metadata: Metadata = { title: `Legal and Policies — ${BRAND.name}` };
export const dynamic = 'force-dynamic';

// Only audiences that still exist. A page the Super Admin published to the
// retired `sellers` audience is deliberately NOT listed here: there is no seller
// account to bind it to. It is never deleted — /admin/content still shows it,
// with the label "Sellers (retired)", and the owner can republish it to
// `everyone` or `buyers` if any of its text should still apply.
const ORDER: EditableSitePageAudience[] = ['everyone', 'buyers'];
const NOTE: Record<EditableSitePageAudience, string> = {
  everyone: 'These apply to every visitor and account.',
  buyers: 'Ordering, delivery, returns, Coins and points.',
};

/**
 * Legal & Policies centre. Lists exactly the pages the Super Admin has published,
 * with the version and effective date of each published snapshot. A page that is
 * unpublished disappears from this list and its own address answers with a clean
 * "not available" message.
 */
export default async function LegalIndexPage() {
  const pages = await loadPublishedPages();
  const indexed = pages.filter((page) => page.kind === 'legal' && page.show_in_index);

  return (
    <PublicInfoShell
      eyebrow="Legal policies"
      title="Legal and Policies"
      intro="Every policy that applies to this website, in one place. Each document shows its version and the date it took effect."
      navLinks={informationNav(pages)}
    >
      {indexed.length === 0 ? (
        <InfoCard title="Policies are being updated">
          <p>
            Our published policies are not listed at the moment. Please{' '}
            <Link href="/contact" className="font-semibold text-primary-700 underline">
              contact us
            </Link>{' '}
            if you need a copy of any policy or help with an order.
          </p>
        </InfoCard>
      ) : (
        ORDER.map((audience) => {
          const group = indexed.filter((page) => page.audience === audience);
          if (!group.length) return null;
          return (
            <InfoCard key={audience} title={AUDIENCE_LABEL[audience]}>
              <p>{NOTE[audience]}</p>
              <ul className="divide-y divide-slate-100">
                {group.map((page) => (
                  <li key={page.slug} className="py-3">
                    <Link
                      href={`/legal/${page.slug}`}
                      className="inline-flex min-h-11 items-center font-semibold text-primary-700 underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500"
                    >
                      {page.title}
                    </Link>
                    {page.summary ? <p className="text-slate-600">{page.summary}</p> : null}
                    <p className="text-xs text-slate-500">
                      Version {page.version}
                      {page.effective_date ? ` · Effective ${formatPolicyDate(page.effective_date)}` : ''}
                    </p>
                  </li>
                ))}
              </ul>
            </InfoCard>
          );
        })
      )}
      {/* Restored 16 November 2026: the previous /legal page disclosed which
          document is deliberately not published, and why. That card is public
          content; losing it in the rewrite would have removed a disclosure, not
          just a paragraph. */}
      {NOT_APPLICABLE_DOCUMENTS.length > 0 ? (
        <InfoCard title="Not published because the feature does not exist">
          <ul className="space-y-2">
            {NOT_APPLICABLE_DOCUMENTS.map((doc) => (
              <li key={doc.ref}>
                <strong>{doc.title}.</strong> {doc.reason}
              </li>
            ))}
          </ul>
        </InfoCard>
      ) : null}
      <InfoCard title="How changes are made">
        <p>
          When a policy changes we publish a new version and update the version number and effective date shown on
          it. Where a policy needs your acceptance, you are asked to accept the current version, and the version and
          time are recorded against your account.
        </p>
      </InfoCard>
    </PublicInfoShell>
  );
}
