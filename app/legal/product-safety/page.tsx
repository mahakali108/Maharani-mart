import type { Metadata } from 'next';
import { PublicInfoShell, InfoCard } from '@/components/legal/public-info-shell';
import { BusinessContact } from '@/components/legal/business-contact';

export const metadata: Metadata = { title: 'Product Authenticity and Safety Policy — Maharani Traders' };

export default function ProductSafetyPage() {
  return (
    <PublicInfoShell documentKey="product-safety" eyebrow="Legal policies" title="Product Authenticity and Product Safety Policy" intro="Effective date: 04 November 2026. Maharani Traders intends to source products through lawful suppliers and offer genuine products.">
      <InfoCard title="Product information and safety">
        <p>We will take reasonable steps to offer products that are lawfully sourced, carry applicable manufacturer, packer or importer information and declarations such as batch, quantity, MRP, manufacturing and expiry or use-before details, and display applicable warnings and usage information.</p>
        <p>We will not knowingly offer products after expiry or where sale is prohibited by law. Customers should check labels and instructions before use, stop using a product if they discover a safety, quality or labelling concern, and contact support.</p>
        <p>Maharani Traders does not claim to manufacture branded products it resells unless expressly stated for a particular product. Current policy scope is cosmetics and non-food FMCG; food is excluded.</p>
      </InfoCard>
      <InfoCard title="Product concerns"><BusinessContact /></InfoCard>
    </PublicInfoShell>
  );
}
