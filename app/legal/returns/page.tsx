import type { Metadata } from 'next';
import Link from 'next/link';
import { PublicInfoShell, InfoCard } from '@/components/legal/public-info-shell';

export const metadata: Metadata = { title: 'Cancellations and returns — Maharani Traders' };

export default function ReturnsPage() {
  return (
    <PublicInfoShell eyebrow="Order support · draft" title="Cancellations and returns" intro="What the current portal can do, not a promise that every order can be cancelled or that every return or reimbursement is automatic. Final eligibility and timings require operator and legal review.">
      <InfoCard title="Before fulfilment">
        <p>Retailers can request to cancel an order while the actual order status allows cancellation (for example, a pending order). A seller sub-order may have its own fulfilment progress; cancelling one part does not automatically cancel every other part of a mixed order. Check the order detail and request help if dispatch has already started.</p>
      </InfoCard>
      <InfoCard title="After delivery">
        <p>The portal can submit a return request for a delivered order. Provide the order number, affected items and what happened in a support ticket. The team reviews the recorded delivery, item condition, fulfilling seller and applicable obligations before deciding the outcome. No unverified blanket return period or refund speed is advertised.</p>
        <p>Coins and stock are adjusted through auditable order/return workflows when an approved reversal applies. Marketplace invoice or tax-credit-note obligations require merchant-of-record and tax review; an in-app status alone is not a tax credit note or proof of a bank refund.</p>
      </InfoCard>
      <InfoCard title="How to reach us">
        <p>Sign in and open your <Link href="/retailer/orders" className="font-semibold text-primary-700 underline">order history</Link> or <Link href="/retailer/help" className="font-semibold text-primary-700 underline">Help centre</Link> to raise a support ticket. Statutory rights, where applicable, are not waived by this draft. Verified public grievance and contact details must be supplied before launch.</p>
      </InfoCard>
    </PublicInfoShell>
  );
}
