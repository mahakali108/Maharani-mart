import type { Metadata } from 'next';
import Link from 'next/link';
import { PublicInfoShell, InfoCard } from '@/components/legal/public-info-shell';

export const metadata: Metadata = { title: 'Terms and Conditions — Maharani Traders' };

export default function TermsPage() {
  return (
    <PublicInfoShell eyebrow="Legal policies" title="Terms and Conditions" intro="Effective date: 04 November 2026. These terms cover Maharani Traders’ current own-stock wholesale and retail sales.">
      <InfoCard title="Acceptance and business model">
        <p>By using the website, creating an account, placing an order or purchasing products, you agree to these terms and the applicable website policies. If you do not agree, please do not use the website.</p>
        <p>Maharani Traders is a customer-facing brand operated by AJAY KUMAR, Proprietor, under the registered trade name AJAY GENERAL; it is not a separate incorporated company or legal entity. These policies cover own-stock cosmetics, personal-care products and non-food FMCG. Food products are excluded.</p>
        <p>The application includes marketplace and seller features, including seller offers and fulfilment; their availability depends on configuration. These own-stock sales terms do not provide a complete set of terms for third-party seller transactions. Any third-party launch or ongoing operation requires separately reviewed customer and seller terms, including the seller of record, invoicing, fulfilment, returns and support responsibilities. Applicable rights are not excluded.</p>
      </InfoCard>
      <InfoCard title="Product information, prices and taxes">
        <p>We endeavour to display accurate product names, descriptions, photographs, prices and quantities. Packaging, colour and other visual details may vary. Please check the actual label, ingredients, directions, warnings, manufacturer details and expiry or use-before information before use.</p>
        <p>Prices, applicable taxes, any delivery or compulsory charges, and applicable wholesale quantities, slabs or minimum orders will be displayed or communicated before confirmation. GST will be charged and invoiced as required by law. An obvious listing or pricing error may be corrected before order acceptance; if an amount was collected for an unfulfilled order, it will be refunded.</p>
      </InfoCard>
      <InfoCard title="Order placement and acceptance">
        <p>An order is a request to purchase, subject to stock availability, delivery serviceability and confirmation. We may contact you to verify the order, quantity, address or phone number.</p>
        <p>An order may be declined or cancelled if the product is unavailable, the address is outside the serviceable area, information is incomplete or appears fraudulent, the listing contains a material error, or fulfilment would violate applicable law. Amounts collected for an unfulfilled cancelled order will be refunded.</p>
      </InfoCard>
      <InfoCard title="Payment and customer responsibilities">
        <p>The current cash payment method is Cash on Delivery (COD). The checkout may apply an available Coins balance automatically; the remaining confirmed amount is payable to an authorised delivery representative on delivery. Review the checkout total before confirming.</p>
        <p>Provide accurate contact and delivery information, check your order, keep account credentials confidential, use the site lawfully and pay the confirmed COD balance when accepting delivery. Do not send money to an unknown personal account or unauthorised payment link. Additional payment methods, if introduced, will be displayed before use.</p>
      </InfoCard>
      <InfoCard title="Intellectual property and applicable law">
        <p>The Maharani Traders name, original site design, logos, text and graphics may not be reproduced or commercially used without permission except as permitted by law. Third-party product names and trademarks belong to their respective owners.</p>
        <p>Nothing in these terms excludes a right or remedy that cannot lawfully be excluded. Indian law applies; disputes may be handled by the competent authority or court having jurisdiction under applicable law. See our <Link href="/legal/returns" className="font-semibold text-primary-700 underline">cancellation and return policy</Link> and <Link href="/contact" className="font-semibold text-primary-700 underline">contact details</Link>.</p>
      </InfoCard>
    </PublicInfoShell>
  );
}
