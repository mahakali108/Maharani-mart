import type { Metadata } from 'next';
import Link from 'next/link';
import { PublicInfoShell, InfoCard } from '@/components/legal/public-info-shell';
import { BusinessContact } from '@/components/legal/business-contact';

export const metadata: Metadata = { title: 'Contact and support — Maharani Traders' };

export default function ContactPage() {
  return (
    <PublicInfoShell eyebrow="Support" title="Get help with your account or order" intro="Contact Maharani Traders about your order, delivery, products or account.">
      <InfoCard title="Public support and grievance contact"><BusinessContact officer /></InfoCard>
      <InfoCard title="For signed-in retailers">
        <p>Open the <Link href="/retailer/help" className="font-semibold text-primary-700 underline">Help centre</Link> to raise a support ticket for an order, delivery, payment, product or Coins issue. Include your order number when available. You can review replies in your support list.</p>
      </InfoCard>
      <InfoCard title="Seller and account access">
        <p>Seller accounts are created by Super Admin invitation. If you have an invitation, use the emailed link; verification and approval are required before trading. The current own-stock sales policies do not provide complete terms for third-party seller transactions, which require separate review. For sign-in issues, use <Link href="/forgot-password" className="font-semibold text-primary-700 underline">password recovery</Link>. Do not share passwords, OTPs or one-time links with support.</p>
      </InfoCard>
    </PublicInfoShell>
  );
}
