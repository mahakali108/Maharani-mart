import type { Metadata } from 'next';
import Link from 'next/link';
import { PublicInfoShell, InfoCard } from '@/components/legal/public-info-shell';
import { BusinessContact } from '@/components/legal/business-contact';
import { getAuthoritativeContactGrievance } from '@/lib/admin/business-settings/server';

export const metadata: Metadata = { title: 'Customer Support and Grievance Policy — Maharani Traders' };

export const dynamic = 'force-dynamic';

export default async function GrievancePage() {
  const configuredContact = await getAuthoritativeContactGrievance();
  return (
    <PublicInfoShell eyebrow="Legal policies" title="Customer Support and Grievance Redressal Policy" intro="Effective date: 04 November 2026. Contact us about products, orders, delivery, payment, returns, refunds or website services.">
      <InfoCard title="Grievance Officer">
        <BusinessContact officer />
        {configuredContact.isConfigured && (
          <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50 p-4">
            <p>Additional contact currently configured in business settings (reconcile and verify before publication):</p>
            <p>{configuredContact.grievanceOfficerName} — {configuredContact.grievanceOfficerDesignation}</p>
            <p className="break-all">{configuredContact.grievanceEmail}</p>
            <p>{configuredContact.grievancePhone}</p>
            <p>{configuredContact.grievanceAddress}</p>
          </div>
        )}
      </InfoCard>
      <InfoCard title="How to submit a complaint">
        <p>Call 8987023959, email <a href="mailto:adinathsahu8987@gmail.com" className="break-all font-semibold text-primary-700 underline">adinathsahu8987@gmail.com</a>, or use the <Link href="/retailer/help" className="font-semibold text-primary-700 underline">website Help centre</Link> where available. Include your order number, contact details and a clear description.</p>
      </InfoCard>
      <InfoCard title="Acknowledgement, resolution and escalation">
        <p>The proposed targets are acknowledgement within 48 hours and an endeavour to resolve the grievance within one month from receipt. These targets and the complaint-handling workflow require operational and legal verification before publication; applicable statutory rights and timelines are not affected. A complaint reference number will be provided where the registration system supports reference tracking.</p>
        <p>If you are dissatisfied, reply to the support email requesting escalation to the Grievance Officer. You may also approach the appropriate consumer protection authority or forum available under Indian law.</p>
      </InfoCard>
    </PublicInfoShell>
  );
}
