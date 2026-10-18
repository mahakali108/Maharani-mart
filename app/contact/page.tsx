import type { Metadata } from 'next';
import Link from 'next/link';
import { PublicInfoShell, InfoCard } from '@/components/legal/public-info-shell';

export const metadata: Metadata = { title: 'Contact and support — Maharani Traders' };

export default function ContactPage() {
  return (
    <PublicInfoShell eyebrow="Support" title="Get help with your account or order" intro="Use the in-app support workflow for an existing retailer order. The operator has not supplied verified public contact, registered-business or grievance-officer details for this draft; we will not invent them.">
      <InfoCard title="For signed-in retailers">
        <p>Open the <Link href="/retailer/help" className="font-semibold text-primary-700 underline">Help centre</Link> to raise a support ticket for an order, delivery, payment, product or Coins issue. Include your order number when available. You can review replies in your support list.</p>
      </InfoCard>
      <InfoCard title="For sellers and account access">
        <p>Marketplace seller accounts are created only by Super Admin invitation. If you have an invitation, use the emailed link to set your password; your business needs verification and approval before trading. For sign-in issues, use <Link href="/forgot-password" className="font-semibold text-primary-700 underline">password recovery</Link>. Do not share your password or one-time email link in a support message.</p>
      </InfoCard>
      <InfoCard title="Public business and grievance details pending verification">
        <p>A verified legal entity name, postal address, public support channel and any required grievance contact have not been provided in this repository. They must be confirmed by the operator and reviewed for the intended B2B/marketplace model before public launch. This page is not a substitute for those disclosures.</p>
      </InfoCard>
    </PublicInfoShell>
  );
}
