import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { PublicInfoShell, InfoCard } from '@/components/legal/public-info-shell';
import { BusinessContact } from '@/components/legal/business-contact';
import { POLICY_CONTENT } from '@/lib/legal/content';
import { legalDocumentByKey } from '@/lib/legal/documents';

type Params = { params: Promise<{ slug: string }> };

/** Only registered documents exist; any other slug is a 404, never an empty page. */
export const dynamicParams = false;

export function generateStaticParams() {
  return Object.keys(POLICY_CONTENT).map((slug) => ({ slug }));
}

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const doc = legalDocumentByKey((await params).slug);
  return { title: doc ? `${doc.title} — Maharani Traders` : 'Policy — Maharani Traders', description: doc?.summary };
}

export default async function PolicyDocumentPage({ params }: Params) {
  const { slug } = await params;
  const doc = legalDocumentByKey(slug);
  const content = POLICY_CONTENT[slug];
  if (!doc || !content) notFound();

  return (
    <PublicInfoShell eyebrow="Legal policies" title={doc.title} intro={`Effective date: ${doc.effectiveDate}. ${content.intro}`} documentKey={doc.key}>
      {content.sections.map((section) => (
        <InfoCard key={section.title} title={section.title}>
          {section.paragraphs?.map((text) => <p key={text}>{text}</p>)}
          {section.bullets ? (
            <ul className="list-disc space-y-1.5 pl-5">
              {section.bullets.map((text) => <li key={text}>{text}</li>)}
            </ul>
          ) : null}
        </InfoCard>
      ))}
      {content.ownerDecisions?.length ? (
        <InfoCard title="Points awaiting the owner’s confirmation">
          <p>This version is published for review. The following points are not yet decided, so this document makes no promise about them:</p>
          <ul className="list-disc space-y-1.5 pl-5">
            {content.ownerDecisions.map((text) => <li key={text}>{text}</li>)}
          </ul>
        </InfoCard>
      ) : null}
      {content.related?.length ? (
        <InfoCard title="Related policies">
          <ul className="flex flex-wrap gap-x-4 gap-y-1">
            {content.related.map((key) => {
              const related = legalDocumentByKey(key);
              return related ? (
                <li key={key}>
                  <Link href={related.href} className="inline-flex min-h-11 items-center font-semibold text-primary-700 underline-offset-2 hover:underline">{related.title}</Link>
                </li>
              ) : null;
            })}
          </ul>
        </InfoCard>
      ) : null}
      <InfoCard title="Contact"><BusinessContact /></InfoCard>
    </PublicInfoShell>
  );
}
