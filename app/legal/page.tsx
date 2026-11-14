import type { Metadata } from 'next';
import Link from 'next/link';
import { PublicInfoShell, InfoCard } from '@/components/legal/public-info-shell';
import { LEGAL_DOCUMENTS, NOT_APPLICABLE_DOCUMENTS, type LegalAudience } from '@/lib/legal/documents';

export const metadata: Metadata = { title: 'Legal and Policies — Maharani Traders' };

const GROUPS: Array<{ audience: LegalAudience; title: string; note: string }> = [
  { audience: 'everyone', title: 'For everyone', note: 'These apply to every visitor and account.' },
  { audience: 'buyers', title: 'For retailers and wholesale buyers', note: 'Ordering, delivery, returns, Coins and points.' },
  { audience: 'sellers', title: 'For sellers', note: 'For independent sellers invited to list on the marketplace.' },
];

/** Legal & Policies centre: every published document with its version and dates. */
export default function LegalIndexPage() {
  return (
    <PublicInfoShell
      eyebrow="Legal policies"
      title="Legal and Policies"
      intro="Every policy that applies to this website, in one place. Each document shows its version, the date it took effect and the date it was last updated."
    >
      {GROUPS.map((group) => (
        <InfoCard key={group.audience} title={group.title}>
          <p>{group.note}</p>
          <ul className="divide-y divide-slate-100">
            {LEGAL_DOCUMENTS.filter((doc) => doc.audience === group.audience).map((doc) => (
              <li key={doc.key} className="py-3">
                <Link href={doc.href} className="inline-flex min-h-11 items-center font-semibold text-primary-700 underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500">
                  {doc.title}
                </Link>
                <p className="text-slate-600">{doc.summary}</p>
                <p className="text-xs text-slate-500">
                  Version {doc.version} · Effective {doc.effectiveDate} · Last updated {doc.lastUpdated}
                </p>
              </li>
            ))}
          </ul>
        </InfoCard>
      ))}
      <InfoCard title="Not published because the feature does not exist">
        <ul className="space-y-2">
          {NOT_APPLICABLE_DOCUMENTS.map((doc) => (
            <li key={doc.ref}><strong>{doc.title}.</strong> {doc.reason}</li>
          ))}
        </ul>
      </InfoCard>
      <InfoCard title="How changes are made">
        <p>When a policy changes we publish a new version with a new version number and update the dates shown above. Where a policy needs your acceptance, you are asked to accept the new version, and the version and time are recorded against your account.</p>
      </InfoCard>
    </PublicInfoShell>
  );
}
