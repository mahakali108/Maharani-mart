import type { Metadata } from 'next';
import { PublicInfoShell, InfoCard } from '@/components/legal/public-info-shell';
import { BusinessContact } from '@/components/legal/business-contact';

export const metadata: Metadata = { title: 'Cancellation, Return and Refund Policy — Maharani Traders' };

export default function ReturnsPage() {
  return (
    <PublicInfoShell eyebrow="Legal policies" title="Cancellation, Return and Refund Policy" intro="Effective date: 04 November 2026. Contact us as soon as reasonably possible about a cancellation or product issue.">
      <InfoCard title="Order cancellation">
        <p>Contact us as soon as possible to request cancellation. A request before dispatch may be accepted; an order already dispatched may not be cancellable through the ordinary process. Cancellation depends on order status and applicable law. If we cancel an order after collecting payment, the amount paid for the unfulfilled order will be refunded.</p>
      </InfoCard>
      <InfoCard title="Product issues and return requests">
        <p>Contact us if a product is damaged, defective, wrong, a wrong quantity, materially different from its description, suspected spurious or non-genuine, or has a relevant labelling, quality or legal issue. We will review the complaint and provide the remedy required by applicable law, which may include replacement, return, refund or another appropriate remedy.</p>
        <p>Please provide your order number, name and mobile number, product and quantity, issue description and photographs or video if reasonably available. We may ask for additional information; a missing photograph alone does not automatically remove statutory rights.</p>
        <p>The website return-request form may have an order-specific deadline. If the form is closed, contact support; an internal deadline does not remove statutory rights or remedies.</p>
      </InfoCard>
      <InfoCard title="Cosmetics, hygiene and refunds">
        <p>A change-of-mind return for opened or used cosmetics may be refused for hygiene and safety where lawful. This does not prevent a legally available remedy for a defective, damaged, wrong, spurious or misdescribed product.</p>
        <p>For an approved COD refund, support will arrange a reasonable and lawful refund method and verify necessary details. We will communicate an expected processing time after approval. Never share an OTP, password or card PIN to obtain a refund. No unverified blanket return period or automatic refund is promised.</p>
        <p>Nothing in this policy limits rights or remedies available under applicable consumer-protection or other Indian law.</p>
      </InfoCard>
      <InfoCard title="Return and refund contact"><BusinessContact /></InfoCard>
    </PublicInfoShell>
  );
}
