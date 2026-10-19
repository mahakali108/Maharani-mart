import type { Metadata } from 'next';
import Link from 'next/link';
import { PublicInfoShell, InfoCard } from '@/components/legal/public-info-shell';

export const metadata: Metadata = { title: 'About — Maharani Traders' };

export default function AboutPage() {
  return (
    <PublicInfoShell eyebrow="What we do" title="Wholesale, with clearer choices" intro="Maharani Traders is a B2B ordering website for retailers. Browse catalogue packs, see the current quoted price and minimum quantities, and review your orders in one place.">
      <InfoCard title="How ordering works">
        <p>Approved retailer accounts can maintain a cart and choose a saved delivery address. The order service rechecks product availability, pricing, GST, applicable offers, available Coins and the address at checkout. A pending order is not a delivery guarantee.</p>
        <p>Marketplace sellers may list offers on existing catalogue packs. An offer can be fulfilled by its seller or through Maharani stock. A mixed order is represented as one parent order with separately tracked sub-orders; seller accounts and offers are reviewed before trading.</p>
      </InfoCard>
      <InfoCard title="Where can we deliver?">
        <p>Gaya, Bihar is the initial configuration default, not blanket coverage. A retailer can order online only to an active, individually verified district/state/PIN combination. Delivery availability is checked again when an order is placed. <Link href="/legal/shipping" className="font-semibold text-primary-700 underline">Read delivery details</Link>.</p>
      </InfoCard>
      <InfoCard title="Identity and trust">
        <p>Business registration, GSTIN, public contact, legal entity and marketplace invoice responsibility must be checked and published by the operator before a production launch. We do not present unverified credentials, licences or endorsements as facts. See the <Link href="/contact" className="font-semibold text-primary-700 underline">contact options</Link> or sign in to raise a support ticket.</p>
      </InfoCard>
    </PublicInfoShell>
  );
}
