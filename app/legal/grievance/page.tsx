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
      eyebrow="Compliance · Consumer Protection (E-Commerce) Rules, 2020"
      title="Grievance Redressal Mechanism"
      intro="In accordance with the Consumer Protection (E-Commerce) Rules, 2020 and Information Technology (Intermediary Guidelines and Digital Media Ethics Code) Rules, 2021, the details of the Grievance Officer and ticket escalation workflow are published below."
    >
      <InfoCard title="Grievance Officer Details">
        <p className="text-sm text-slate-700">
          The Grievance Officer is designated to redress grievances of consumers and registered retailer partners regarding orders, catalog content, pricing, data privacy, or delivery discrepancies.
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
            <p><strong>Designation:</strong> Grievance Redressal Officer</p>
            <p><strong>Operating Entity:</strong> Ajay General (Proprietorship) trading as Maharani Traders</p>
            <p><strong>Jurisdiction / Operating Hub:</strong> Gaya District, Bihar, India</p>
            <p><strong>Name:</strong> [OWNER INPUT REQUIRED: Grievance Officer Full Name]</p>
            <p><strong>Official Email:</strong> [OWNER INPUT REQUIRED: e.g. grievance@maharanitraders.com]</p>
            <p><strong>Telephone / WhatsApp Desk:</strong> [OWNER INPUT REQUIRED: e.g. +91 94XXXXXXXX]</p>
            <p><strong>Registered Address:</strong> [OWNER INPUT REQUIRED: Official Business Address, Gaya, Bihar]</p>
          </div>
        )}
      </InfoCard>

      <InfoCard title="Grievance Escalation Timeline & Process">
        <p>
          <strong>1. Ticket Acknowledgement:</strong> Every formal grievance received via email or the in-app support portal is acknowledged with a unique ticket reference number within <strong>{contact.acknowledgementHours} hours</strong> of receipt.
        </p>
        <p className="mt-2">
          <strong>2. Redressal & Resolution:</strong> In compliance with Rule 4(5) of the Consumer Protection (E-Commerce) Rules, 2020, grievances are investigated and redressed within <strong>{contact.resolutionDays} days</strong> from the date of receipt.
        </p>
        <p className="mt-2">
          <strong>3. Direct In-App Support:</strong> For immediate delivery shortfall adjustments, OTP issues, or damaged goods, signed-in retailers should first raise an inquiry through the{' '}
          <Link href="/retailer/help" className="font-semibold text-primary-700 underline">
            Retailer Help Centre
          </Link>{' '}
          or contact the assigned delivery staff during physical handover.
        </p>
      </InfoCard>

      <InfoCard title="Cyber Security & Regulatory Escalations">
        <p>
          For security vulnerabilities, suspected data privacy incidents under the DPDP Act 2023, or CERT-In reporting coordination, notices may be served directly to the administrative desk with subject line <em>&quot;URGENT: Legal / Security Notice&quot;</em>.
        </p>
      </InfoCard>
    </PublicInfoShell>
  );
}
