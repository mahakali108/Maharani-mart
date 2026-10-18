import type { Metadata } from 'next';
import Link from 'next/link';
import { PublicInfoShell, InfoCard } from '@/components/legal/public-info-shell';

export const metadata: Metadata = { title: 'Privacy information — Maharani Traders' };

export default function PrivacyPage() {
  return (
    <PublicInfoShell eyebrow="Personal data · draft" title="Privacy information" intro="A practical summary of data used by this website. The operator must verify its legal identity, contact, retention schedule, processor arrangements and current obligations before publishing a final privacy notice.">
      <InfoCard title="Data used by the service">
        <p>Account creation and sign-in use email or phone, profile and role information. Retailer and seller workflows use shop/business and contact details, saved delivery addresses, purchase and payment/Coins records, support conversations, and seller offer and fulfilment information. Authentication is handled through Supabase Auth; the website is built on Next.js and hosted through Vercel when deployed.</p>
        <p>Vercel Analytics is included in the site layout. The browser can store a dismissible installation-prompt preference. The service worker caches only public static assets and a generic offline page, not signed-in pages, orders, addresses, API replies or Supabase sessions.</p>
      </InfoCard>
      <InfoCard title="Why this information is used">
        <p>We use it to authenticate accounts, control roles and seller access, review retailer and seller onboarding, price and place orders, process fulfilment and Coins entries, respond to support requests, and protect the service from misuse. Sellers receive only data needed for their own sub-orders, including the delivery address where they fulfil an order; other seller tenants are not exposed by the intended database policies.</p>
      </InfoCard>
      <InfoCard title="Choices and requests">
        <p>Signed-in retailers can review their addresses, order history and support tickets and request help through the <Link href="/retailer/help" className="font-semibold text-primary-700 underline">Help centre</Link>. To request access, correction or erasure of personal data, use support and identify the relevant account. Requests are assessed against identity, order/tax recordkeeping and applicable law; no unverified completion timeline or universal deletion promise is given here.</p>
        <p>The Digital Personal Data Protection Act and notified 2025 rules have phased commencement. A qualified Indian privacy reviewer should confirm the effective obligations, notice, consent/legitimate use, grievance and cross-border processing details for this deployment. See <Link href="/contact" className="font-semibold text-primary-700 underline">contact options</Link>.</p>
      </InfoCard>
    </PublicInfoShell>
  );
}
