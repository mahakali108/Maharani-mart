# Public information pages — operator/legal review required

These drafts are visible at `/about`, `/contact`, `/legal/terms`, `/legal/privacy`, `/legal/shipping`, `/legal/returns` and `/legal/grievance`. They explain the current *software behavior* and explicitly state where policy or operator data is unverified. They are **not** approved contracting, privacy, returns or statutory-disclosure documents. Remove the review notice only after the operator and appropriate Indian legal/tax professionals approve final content. Do not invent a name, registration, GSTIN, address, contact, certification, refund time or delivery ETA to fill a gap.

The complete unpublished, versioned professional-review drafts are in [`docs/legal-review/README.md`](./legal-review/README.md). They include terms, privacy, shipping/delivery, cancellation/returns/refunds, grievance, marketplace seller agreement, seller declaration and authenticity/anti-counterfeit documents. They are review aids only and must not be copied to public routes before their individual publication controls are met.

## Authoritative sources consulted for the draft (2026-10-18 review)

- Department of Consumer Affairs, [Consumer Protection (E-Commerce) Rules, 2020](https://consumeraffairs.nic.in/theconsumerprotection/consumer-protection-e-commerce-rules-2020). Whether/how any provision applies to a specific B2B marketplace model, and the corresponding grievance, entity and seller disclosures, need qualified assessment; the draft does **not** claim an exemption merely because the site is B2B.
- Ministry of Electronics and IT, [Digital Personal Data Protection Rules, 2025, notification G.S.R. 846(E)](https://www.meity.gov.in/static/uploads/2025/11/53450e6e5dc0bfa85ebd78686cadad39.pdf) and [Act commencement notification G.S.R. 843(E)](https://www.meity.gov.in/static/uploads/2025/11/c56ceae6c383460ca69577428d36828b.pdf). Commencement is staggered; do not assert all provisions or rules already apply on a given date without checking current notifications. Operator must specify lawful processing, notices, contacts, retention, processors, rights workflow and any applicable security/incident obligations.
- Central Board of Indirect Taxes and Customs, [GST invoice / credit and debit note rules](https://cbic-gst.gov.in/gst-invoice-rules.html). The portal's order rows and Coins reversals do **not** by themselves establish who is supplier of record, issue compliant tax invoices or issue GST credit notes. Confirm the actual seller-of-record and invoice/refund processes before making claims.

These links are review starting points, not legal advice or a determination of applicability. Check the current official text and any later notifications again immediately before launch.

## Facts the operator must supply and approve

- Correct legal/brand entity, registered address, business and GST status, customer-support channel, required grievance-officer details and response process. Public Contact currently shows *no fabricated* phone/email/address; authenticated retailers have the existing in-app Help workflow.
- Checkout/contract formation, cash-on-delivery responsibility, applicable wholesale prices, seller-of-record, tax-invoice and credit-note issuer, seller verification and responsibilities. Existing status/ledger rows cannot stand in for tax documents.
- Exact verified active service PINs, delivery fee treatment, minimum-order basis, operations, any delivery commitment, cancellation eligibility, return conditions, refund channel and timeframes. No fixed SLA or blanket Gaya coverage is represented. A nonzero fee intentionally blocks online orders instead of silently omitting the fee.
- Privacy-controller/processor roles (Supabase, Vercel Analytics and any others actually configured), lawful basis/notice, retention limits, security controls, data-subject request handling, complaints and cross-border arrangements. Confirm with current Indian rules and service contracts.

## Engineering checks before the notice can be removed

Test authenticated and anonymous links; verify no dead routes, link targets and accessible keyboard/mobile navigation. Confirm support-ticket creation/response, order cancellation/return affordances and claims against staging behavior; resolve any discrepancies before publication. Legal/tax review and operator sign-off are separate from passing automated tests.
