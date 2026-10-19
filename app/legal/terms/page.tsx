import type { Metadata } from 'next';
import Link from 'next/link';
import { PublicInfoShell, InfoCard } from '@/components/legal/public-info-shell';

export const metadata: Metadata = { title: 'Ordering terms — Maharani Traders' };

export default function TermsPage() {
  return (
    <PublicInfoShell eyebrow="Business information · draft" title="Ordering terms" intro="This describes the functions currently visible in the retailer portal. Final contracting party, merchant-of-record, tax-invoice particulars and commercial terms must be approved and published before taking live multi-seller orders.">
      <InfoCard title="Retailer account and catalogue">
        <p>Retailer registration needs approval. The catalogue and cart show current wholesale pack offers and minimum quantities. Prices, GST-inclusive totals, stock, coupons and Coins are checked again before an order commits, so a saved cart or preview is not a fixed offer or stock reservation.</p>
        <p>Seller businesses are created only by Super Admin invitation, remain pending until reviewed and cannot trade while inactive. An approved seller offer can have its own stock, price and fulfilment sub-order.</p>
      </InfoCard>
      <InfoCard title="Orders, payments and fulfilment">
        <p>At checkout you choose an owned saved address with a configured serviceable PIN. Confirmed order totals and per-line details are recorded on the order. Coins are a ledger-backed shop balance; any remainder displayed is payable on delivery under the current checkout workflow. No credit line, pay-later offer or live GPS tracking is advertised here.</p>
        <p>Order history shows recorded status changes, not guaranteed delivery dates. Positive delivery charges are not yet accounted for in split-order settlement: online checkout is intentionally blocked for any PIN configured with such a fee rather than billing an incomplete total. <Link href="/legal/shipping" className="font-semibold text-primary-700 underline">Delivery details</Link>.</p>
      </InfoCard>
      <InfoCard title="Cancellations and issues">
        <p>Pending orders can be submitted for cancellation through the portal when their actual status permits it. Delivered orders can start a return request; acceptance and any reimbursement require review of the order and applicable law. No fixed refund window or automatic approval is asserted. <Link href="/legal/returns" className="font-semibold text-primary-700 underline">Returns information</Link>.</p>
        <p>Nothing here limits rights that apply by law. B2B purchases for resale can have different legal treatment from consumer purchases; obtain a review of the final contract and seller-of-record model before publication.</p>
      </InfoCard>
    </PublicInfoShell>
  );
}
