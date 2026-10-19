import type { Metadata } from 'next';
import Link from 'next/link';
import { PublicInfoShell, InfoCard } from '@/components/legal/public-info-shell';

export const metadata: Metadata = { title: 'Delivery areas and order status — Maharani Traders' };

export default function ShippingPage() {
  return (
    <PublicInfoShell eyebrow="Delivery · no invented coverage" title="Delivery areas and fulfilment" intro="Online delivery is limited to explicitly active district/state/PIN combinations. Gaya, Bihar is only the initial district default; not all Gaya PINs are serviceable.">
      <InfoCard title="Check your exact PIN">
        <p>Add a saved delivery address with its real district, state and six-digit PIN. Checkout checks an admin-verified active PIN, any configured minimum order amount and a zero delivery fee. It repeats this validation inside the order transaction. If no matching PIN is configured, the address has missing fields, or coverage changes, online checkout will not place the order.</p>
        <p>An inventory/pricing area selected during retailer registration is separate from delivery-PIN coverage. An old order with no structured PIN is not evidence that a location remains serviceable.</p>
      </InfoCard>
      <InfoCard title="After an order is placed">
        <p>Orders and seller sub-orders show recorded processing, dispatch and delivery statuses as updates are entered. This is not real-time location tracking. We do not promise a delivery date, a particular courier or universal coverage; the actual arrangements depend on the order, stock and fulfilling party.</p>
        <p>When a PIN has a non-zero delivery fee configured, online checkout is blocked until the fee can be accurately included in parent/sub-order totals. Contact support for clarification before arranging anything outside the online flow; the website does not create an unquoted charge.</p>
      </InfoCard>
      <InfoCard title="Need a correction?">
        <p>Change the saved address before placing a new order. An address recorded on a placed order is a historical snapshot. For a placed order, use your signed-in <Link href="/retailer/help" className="font-semibold text-primary-700 underline">Help centre</Link> and include the order number. For public contact information, see <Link href="/contact" className="font-semibold text-primary-700 underline">Contact</Link>.</p>
      </InfoCard>
    </PublicInfoShell>
  );
}
