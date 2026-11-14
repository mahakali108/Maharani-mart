import type { Metadata } from 'next';
import { PublicInfoShell, InfoCard } from '@/components/legal/public-info-shell';
import { BusinessContact } from '@/components/legal/business-contact';

export const metadata: Metadata = { title: 'Business Disclosure — Maharani Traders' };

export default function BusinessDisclosurePage() {
  return (
    <PublicInfoShell documentKey="business-disclosure" eyebrow="Legal policies" title="Business Disclosure" intro="Effective date: 04 November 2026. Maharani Traders is the customer-facing brand of AJAY KUMAR, Proprietor, under the registered trade name AJAY GENERAL.">
      <InfoCard title="Business details"><BusinessContact /><p><strong>Business activity:</strong> Wholesale and retail trading of own-stock cosmetics and non-food FMCG products. Maharani Traders is not a separate incorporated company or legal entity.</p></InfoCard>
      <InfoCard title="Tax and policy scope">
        <p>The owner reports that the business is registered for GST as an active regular taxpayer. The GST certificate, GSTIN, registration status and invoice configuration have not been independently verified. Any applicable GST details should be provided on invoices and other statutory documents as required by law.</p>
        <p>The own-stock sales policies do not provide complete terms for third-party seller transactions. The application includes marketplace features for seller offers and fulfilment, subject to configuration; we have not verified whether those features are operating in production. Any third-party launch or ongoing operation requires separately reviewed seller and customer terms and clear allocation of invoicing, fulfilment, return and support responsibilities. Applicable rights are not excluded.</p>
        <p>Food is excluded from the stated current product scope. If online payment gateways, wider delivery areas, food products or other services are introduced later, the relevant policies and disclosures must be reviewed and updated before launch.</p>
      </InfoCard>
    </PublicInfoShell>
  );
}
