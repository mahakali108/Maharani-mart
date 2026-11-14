import type { Metadata } from 'next';
import Link from 'next/link';
import { PublicInfoShell, InfoCard } from '@/components/legal/public-info-shell';
import { BusinessContact } from '@/components/legal/business-contact';

export const metadata: Metadata = { title: 'Shipping and Delivery Policy — Maharani Traders' };

export default function ShippingPage() {
  return (
    <PublicInfoShell documentKey="shipping" eyebrow="Legal policies" title="Shipping and Delivery Policy" intro="Effective date: 04 November 2026. Delivery is limited to local serviceable areas in and around Belaganj, Gaya, Bihar.">
      <InfoCard title="Serviceability, charges and estimates">
        <p>Delivery is available only when the address is confirmed as serviceable by the website or support. Not all Gaya PINs are serviceable; we do not promise delivery throughout Gaya district or Bihar. An active serviceable PIN and applicable minimum order are checked at checkout.</p>
        <p>Delivery or other compulsory charges will be disclosed before confirmation. If no charge is shown, confirm it with support before placing an order. The current checkout blocks online ordering for PINs configured with a positive delivery fee until that fee can be accounted for correctly.</p>
        <p>Estimated timing will be communicated at checkout or confirmation, depending on availability and location. Estimates can be affected by weather, local conditions or operational issues. Contact support about significant delays; order status is not real-time location tracking.</p>
      </InfoCard>
      <InfoCard title="Address and delivery inspection">
        <p>Provide an accurate address and reachable phone number. You or your authorised recipient should be available to receive the order and pay the confirmed COD balance. Support may contact you if the address is incorrect, the recipient is unavailable or the order is refused.</p>
        <p>Check the package and quantity at delivery. Report visible damage to the representative and contact support promptly. This does not affect statutory rights concerning defective, damaged, wrong, spurious or misdescribed products.</p>
      </InfoCard>
      <InfoCard title="Delivery contact">
        <p>Use the <Link href="/retailer/help" className="font-semibold text-primary-700 underline">Help centre</Link> for an existing order, or contact us:</p><BusinessContact />
      </InfoCard>
    </PublicInfoShell>
  );
}
