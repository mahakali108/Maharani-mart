import type { Metadata } from 'next';
import { PublicInfoShell, InfoCard } from '@/components/legal/public-info-shell';
import { BusinessContact } from '@/components/legal/business-contact';

export const metadata: Metadata = { title: 'Privacy Policy — Maharani Traders' };

export default function PrivacyPage() {
  return (
    <PublicInfoShell documentKey="privacy" eyebrow="Legal policies" title="Privacy Policy" intro="Effective date: 04 November 2026. This policy describes website privacy practices and contacts; all uses, including any marketplace processing, require verification before publication.">
      <InfoCard title="Information we may collect">
        <p>Depending on your use, we may collect your name, mobile number, email, billing and delivery addresses, order and purchase history, COD collection and payment status, support messages and complaints, account, login and device-related information, and information needed for tax, accounting, security, fraud prevention or legal compliance.</p>
        <p>Do not send passwords, OTPs or unnecessary sensitive personal information through customer support.</p>
      </InfoCard>
      <InfoCard title="How information is used and shared">
        <p>Information may be used to manage accounts, confirm and deliver orders, communicate about orders and returns, maintain invoices and tax records, handle support and refunds, detect fraud and misuse, improve the website and comply with applicable law. Unrelated uses require an appropriate lawful basis.</p>
        <p>Where necessary and lawful, information may be shared with delivery providers, technology and security providers, professional advisers or authorities. The application also supports third-party seller fulfilment: if used, the relevant seller may receive order and delivery information, including the recipient address and phone where provided. Marketplace data flows and disclosures require verification before any third-party operation. We do not sell customer personal information as a business practice. The application uses Supabase for authentication and includes Vercel Analytics; actual deployment and provider arrangements should be verified before publication.</p>
      </InfoCard>
      <InfoCard title="Cookies and security">
        <p>The site may use cookies or similar technologies for login, cart functionality, security, preferences and performance. Any legally required consent mechanism must be implemented and verified before publication. Browser settings can control cookies, but disabling essential cookies may affect functionality.</p>
        <p>Reasonable technical and organisational measures are intended to protect information, but no internet service can guarantee absolute security. Use strong passwords and do not share OTPs or login credentials.</p>
      </InfoCard>
      <InfoCard title="Retention, requests and updates">
        <p>Information may be retained for fulfilment, accounting, tax, complaint handling, disputes and legal compliance. Retention periods and deletion procedures require verification; some transaction or tax records may need statutory retention.</p>
        <p>For questions, corrections or other privacy requests, contact AJAY KUMAR, Proprietor, using the details below. Requests will be reviewed under applicable law. This policy may be updated when practices or requirements change; the latest version will carry its effective date.</p>
        <BusinessContact />
      </InfoCard>
    </PublicInfoShell>
  );
}
