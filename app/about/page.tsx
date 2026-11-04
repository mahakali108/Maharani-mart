import type { Metadata } from 'next';
import Link from 'next/link';
import { PublicInfoShell, InfoCard } from '@/components/legal/public-info-shell';

export const metadata: Metadata = { title: 'About — Maharani Traders' };

export default function AboutPage() {
  return (
    <PublicInfoShell eyebrow="What we do" title="Wholesale, with clearer choices" intro="Maharani Traders is the brand of AJAY KUMAR, Proprietor, trading as AJAY GENERAL. The current policy scope is own-stock wholesale and retail trading of cosmetics and non-food FMCG.">
      <InfoCard title="How ordering works">
        <p>Approved retailer accounts can maintain a cart and choose a saved delivery address. The order service rechecks product availability, pricing, GST, applicable offers, available Coins and the address at checkout. A pending order is not a delivery guarantee.</p>
        <p>The application includes marketplace and seller features, subject to configuration. The own-stock sales policies do not provide complete terms for third-party transactions; any launch or ongoing operation requires separate review. Food products are excluded from the stated current scope.</p>
      </InfoCard>
      <InfoCard title="Where can we deliver?">
        <p>Gaya, Bihar is the initial configuration default, not blanket coverage. A retailer can order online only to an active, individually verified district/state/PIN combination. Delivery availability is checked again when an order is placed. <Link href="/legal/shipping" className="font-semibold text-primary-700 underline">Read delivery details</Link>.</p>
      </InfoCard>
      <InfoCard title="Identity and trust">
        <p>Owner-provided business and contact details are available for review; GST and other statutory invoice information must be verified before publication. See the <Link href="/contact" className="font-semibold text-primary-700 underline">contact options</Link> or sign in to raise a support ticket.</p>
      </InfoCard>
    </PublicInfoShell>
  );
}
