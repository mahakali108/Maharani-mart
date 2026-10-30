import type { Metadata } from 'next';
import Link from 'next/link';
import { PublicInfoShell, InfoCard } from '@/components/legal/public-info-shell';
import { getAuthoritativeContactGrievance, getAuthoritativeBusinessProfile } from '@/lib/admin/business-settings/server';

export const metadata: Metadata = { title: 'Grievance Redressal — Maharani Traders' };
export const dynamic = 'force-dynamic';

export default async function GrievancePage() {
  const [contact, business] = await Promise.all([
    getAuthoritativeContactGrievance(),
    getAuthoritativeBusinessProfile(),
  ]);

  return (
    <PublicInfoShell
      eyebrow="Grievance information · review required"
      title="Grievance Redressal Information"
      intro="This is an unpublished review-stage grievance information page. The owner and a qualified Indian lawyer must confirm the applicable e-commerce/intermediary requirements, officer details and tested workflow before it is represented as a final statutory mechanism."
    >
      <InfoCard title="Grievance Officer Details">
        <p className="text-sm text-slate-700">
          Formal grievance handling requires an owner-designated officer, verified contact details and an operationally tested workflow. The applicability and final wording of any statutory grievance process require legal review for this B2B and marketplace model.
        </p>

        {contact.isConfigured ? (
          <div className="mt-3 rounded-lg border border-mint-200 bg-mint-50 p-4 text-xs font-mono text-slate-800 space-y-1.5">
            <p><strong>Designation:</strong> {contact.grievanceOfficerDesignation}</p>
            <p><strong>Operating Entity:</strong> {business.legalEntityName} trading as {business.publicBrandName}</p>
            <p><strong>Jurisdiction / Operating Hub:</strong> {business.registrationState}, India</p>
            <p><strong>Grievance Officer:</strong> {contact.grievanceOfficerName}</p>
            <p><strong>Official Grievance Email:</strong> {contact.grievanceEmail}</p>
            <p><strong>Telephone / Help Desk:</strong> {contact.grievancePhone}</p>
            <p><strong>Registered Office Address:</strong> {contact.grievanceAddress}</p>
          </div>
        ) : (
          <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 p-4 text-xs font-mono text-slate-800 space-y-1">
            <div className="flex items-center gap-1.5 font-bold text-amber-900 pb-1">
              <span>⚠️ Status: Pending Owner Confirmation</span>
            </div>
            <p><strong>Operating Entity:</strong> Ajay General trading as Maharani Traders</p>
            <p><strong>Officer name:</strong> Owner input and verification required before publication.</p>
            <p><strong>Designation:</strong> Owner input and verification required before publication.</p>
            <p><strong>Official email:</strong> Owner input and verification required before publication.</p>
            <p><strong>Telephone:</strong> Owner input and verification required before publication.</p>
            <p><strong>Business/grievance address:</strong> Owner input and verification required before publication.</p>
          </div>
        )}
      </InfoCard>

      <InfoCard title="Complaint route and review workflow">
        <p>
          Signed-in retailers can create a support record through the{' '}
          <Link href="/retailer/help" className="font-semibold text-primary-700 underline">
            Retailer Help Centre
          </Link>{' '}
          and receive a ticket reference. The owner must separately approve whether that workflow is the formal grievance route for each applicable legal regime.
        </p>
        {contact.isConfigured ? (
          <p className="mt-2">
            The configured internal workflow targets are acknowledgement within {contact.acknowledgementHours} hours and review within {contact.resolutionDays} days. These are not represented as a statutory or operational SLA until legal applicability, staffing and escalation controls are approved and tested.
          </p>
        ) : (
          <p className="mt-2">
            No public acknowledgement or resolution target is published while the officer details and workflow remain pending owner and legal confirmation.
          </p>
        )}
        <p className="mt-2">
          The intended controlled workflow is received, acknowledged, assigned, in progress and resolved, with attributable communications and escalation of overdue matters. The completed grievance implementation and policy text remain subject to owner and lawyer approval.
        </p>
      </InfoCard>

      <InfoCard title="Security, privacy and regulatory notices">
        <p>
          The owner must publish a verified contact and incident-response procedure before accepting formal security, privacy or regulatory notices through this site. The staged commencement of India&apos;s data-protection framework and any incident-notification duties must be confirmed by qualified advisers; this page does not make a legal-compliance claim.
        </p>
      </InfoCard>
    </PublicInfoShell>
  );
}
