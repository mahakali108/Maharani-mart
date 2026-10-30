# Maharani Traders — legal and technical readiness audit

**Audit date:** 30 October 2026 (Asia/Kolkata)
**Repository state assessed:** local working tree on `arena/240ffc1c-maharani-mart`, baseline `5fcc22ff753ff2715c9915e4d8d6d39df2815ce0`
**Business described by the owner:** Ajay General (proprietorship), trading as Maharani Traders
**Scope:** Next.js web/PWA and mobile API source, Supabase migrations/RLS/Storage source, public legal pages/drafts, seller and catalogue flows, order/quote/invoice/return/delivery source.

> **Verdict: BLOCKED — OWNER INPUT and BLOCKED — LAWYER/CA APPROVAL.**
>
> This is an engineering/legal-readiness audit, not legal advice, legal certification, a GST opinion, a licence verification, or evidence that any remote database policy is deployed. The working-tree migrations and tests have not been executed against Supabase/PostgreSQL in this audit.

## Method and evidence limits

- Static source was inspected for public disclosures, legal routes, order creation, quote flows, seller/product controls, invoice rendering, return/delivery actions, RLS/Storage migrations, and `SECURITY DEFINER` ACLs.
- The dirty-worktree inventory is recorded in [`WORKTREE_SCOPE_INVENTORY_2026-10-30.md`](./WORKTREE_SCOPE_INVENTORY_2026-10-30.md). No unrelated dirty file was identified by that static review; no file has been staged or committed during this audit.
- There is no checked-in `supabase/config.toml` or visible project reference in `supabase/`. The official remote project was therefore **not identifiable from that location**. No remote project was queried.
- Current live retrieval of government sites was not possible from this environment’s permitted outbound hosts. The references below are official-source links for owner/counsel verification; they are **not represented as re-fetched on 30 October 2026**.
- No business identity, GSTIN, address, phone number, email, grievance officer, licence, seller KYC, physical label, invoice, order, payment, or evidence document was inspected or fabricated.

## Official-source reference register — professional verification required

| Area | Official source reference | Audit treatment |
| --- | --- | --- |
| Consumer/e-commerce | [Department of Consumer Affairs — Consumer Protection Rules](https://consumeraffairs.nic.in/acts-and-rules/consumer-protection) | Verify the currently consolidated E-Commerce Rules, scope, marketplace/inventory duties, disclosures and grievance requirements with counsel. A B2B label alone must not be treated as a conclusive exemption. |
| Consumer protection | [India Code — Consumer Protection Act, 2019](https://www.indiacode.nic.in/) | Lawyer to confirm applicability to each purchaser/transaction and public-policy wording. |
| Cosmetics | [CDSCO — Cosmetics Rules, 2020 PDF](https://www.cdsco.gov.in/opencms/resources/UploadCDSCOWeb/2022/cos_rules/Cosmetics%20Rules%202020.pdf) | Product label, source, licence/import and claim evidence must be checked per SKU; a category/name is not proof. |
| Legal Metrology | [Legal Metrology (Packaged Commodities) Rules, 2011](https://consumeraffairs.nic.in/legalmetrologyactsandrules/legal-metrology-packaged-commodities-rules-2011) | Confirm current consolidated text/amendments and product-specific package/e-commerce disclosure duties. |
| GST/TCS | [CBIC — GST portal](https://cbic-gst.gov.in/) and [CBIC TCS FAQ](https://cbic-gst.gov.in/pdf/FAQs-TCS-30-11-2018.pdf) | CA must determine merchant/operator role, registration, invoice/credit-note series, place of supply, settlement and current TCS treatment. No rate is assumed here. |
| DPDP | [DPDP Act commencement notification](https://www.meity.gov.in/static/uploads/2025/11/c56ceae6c383460ca69577428d36828b.pdf) and [DPDP Rules, 2025](https://www.meity.gov.in/static/uploads/2025/11/53450e6e5dc0bfa85ebd78686cadad39.pdf) | The recorded phased schedule must be verified against the Gazette before reliance. On this audit date, the substantive implementation timetable must not be presented as already complete. |
| IT/intermediary | [MeitY](https://www.meity.gov.in/) | Lawyer to determine intermediary-rule applicability, grievance/security obligations and any CERT-In implications. |

## Findings and technical disposition

| ID | Finding | Evidence reviewed | Disposition in local source | Verification state |
| --- | --- | --- | --- | --- |
| T-01 | New orders must fail closed until controlled owner/legal/CA readiness is recorded. | `lib/orders/create-order.ts`, `lib/compliance/ordering-readiness.ts`, `0085` | Server order writer checks readiness before quote, delivery, warehouse, payment/coin or order RPC work. Protected readiness RPC/audit design is present. | **SOURCE IMPLEMENTED; NOT RUN** |
| T-02 | Products/sellers must be approved on current facts, and food/unclassified items must not sell. | `0086`, `0087`, product/offer/order sources | New forward migrations add category/product classification, product/seller approvals, revision/fingerprint invalidation, RLS visibility and an order-item insert boundary. `food_blocked` and `unclassified` fail closed in `0087`. | **SOURCE IMPLEMENTED; NOT RUN** |
| T-03 | Seller suspension must not be blocked by active offers. | `0087` offer trigger | Offer checks apply on insert/sale-enabling transitions, while deactivation, rejection, withdrawal and suspension drain remain possible. | **SOURCE IMPLEMENTED; NOT RUN; real two-session test required** |
| T-04 | Internal `SECURITY DEFINER` helpers need least-privilege execution. | `0085`–`0087`, ACL regression test | Explicit revokes/grants and a `pg_proc.proacl` test are present in source. | **SOURCE IMPLEMENTED; NOT RUN against PostgreSQL/PGlite** |
| T-05 | Compliance evidence must not be publicly readable. | `0086`, `0087`, `lib/compliance/evidence-storage.ts` | New private bucket/policies/canonical opaque keys/non-upsert upload/fixed five-minute signed URL design is present. | **SOURCE IMPLEMENTED; NOT RUN; no bucket created** |
| T-06 | A tax invoice must never show configuration prompts as issuer facts. | Web, download and mobile invoice paths | This audit added `lib/retailer/tax-invoice-readiness.ts`. Incomplete/placeholder/invalid issuer configuration now blocks web, download and mobile tax-invoice rendering. | **SOURCE IMPLEMENTED; NOT RUN** |
| T-07 | Marketplace seller invoice issuer cannot be assumed to be Ajay General. | Seller-source order model and all invoice paths | This audit now blocks tax-invoice rendering for any seller-source order until a CA-approved seller-of-record/invoice-issuer model and renderer exist. Underlying order/accounting data is not altered. | **SOURCE IMPLEMENTED; NOT RUN; CA BLOCKER** |
| L-01 | Business entity, trade-name relationship, address, public support details and GST status need verified disclosure. | Public/legal routes, business settings schemas, legal pack | No verified values were found or invented. Public review pages label missing fields as owner input; final policies are unpublished. | **BLOCKED — OWNER INPUT** |
| L-02 | Grievance officer and formal route/SLA need evidence. | `/legal/grievance`, support-ticket source, legal pack | Public review information exists before sign-in, but there is no owner-confirmed officer/contact and the signed-in retailer help flow is not approved as the public statutory route. | **BLOCKED — OWNER + LAWYER INPUT** |
| L-03 | Cosmetics and packaged-FMCG evidence must be product-specific. | `0086`/`0087` review/evidence design | Source requires reviewed product classification and evidence before sale after migration. No actual label, manufacturer/packer/importer, batch/expiry, net content, ingredient/warning, licence/import, origin, MRP/UQC, consumer-care or authenticity evidence was verified. | **BLOCKED — OWNER/LEGAL PRODUCT EVIDENCE** |
| L-04 | Existing seller identity, KYC, agreement, bank/settlement and source evidence must be verified. | seller reviews/evidence design and marketplace UI | Invitation/review controls are designed in local migration source. No seller document or agreement was verified; unexecuted migrations cannot prove seller state. | **BLOCKED — OWNER/LEGAL/CA EVIDENCE** |
| L-05 | GST invoices, credit notes, cancellation/return adjustment and marketplace TCS require an approved model. | invoice, delivery, return and settlement source | Stored tax fields and invoice display exist; no verified GST issuer/final invoice series/credit-note/TCS determination exists. TCS is not treated as implemented. | **BLOCKED — CA APPROVAL** |
| L-06 | Delivery/COD/refunds must reflect operations. | configured PIN/delivery/return/settlement source | Source contains delivery terms, delivery states, shortfall calculations and return actions. Service areas, fees, timelines, COD authority, refusal/partial-delivery/refund practice and seller responsibility were not operationally evidenced. | **BLOCKED — OWNER + LEGAL/CA INPUT** |
| L-07 | Privacy notice, processor controls, retention and breach handling need review. | privacy draft, retention docs/migrations, Supabase/Vercel source references | Review-stage privacy material and limited retention controls exist. No verified controller contact, processor contracts, access/backups/logging inventory, retention approval, rights handling or breach runbook was evidenced. | **BLOCKED — OWNER + LAWYER INPUT** |

## Public policy and disclosure assessment

- Canonical legal routes and historical aliases are represented in the local working tree. The public grievance link is included in the authentication frame, before sign-in.
- The public pages expressly state they are review-stage/unpublished material; they do not publish a fabricated GSTIN, address, officer, phone, email, SLA, delivery estimate, refund deadline or certification.
- The versioned professional-review pack includes terms, privacy, shipping/delivery, cancellation/returns/refunds, grievance, seller agreement, seller declaration and anti-counterfeit drafts. It is **not** a final policy pack and must not be represented as accepted by sellers or approved by counsel.
- The public grievance page is not evidence of a staffed public statutory complaint endpoint. Owner and lawyer approval must establish the officer, contact channel, acknowledgement/closure process, escalation, evidence retention and applicable timings before launch.

## Orders, seller disclosure, invoices, cancellations and returns

- Seller name/GSTIN where present, fulfilment type and seller dispatch are displayed in marketplace-offer/order source. This is not evidence that Rule-specific disclosure completeness has been legally approved.
- Order creation is re-quoted server-side, and the local migration source provides an `order_items` insert gate as a final database boundary for product/seller eligibility. Historic order updates/fulfilment are not rewritten by `0087`.
- The invoice source can extract GST from stored GST-inclusive amounts and choose a display split only from syntactically valid GSTIN state codes. This is a display operation, **not** confirmation of GST registration, rate, place of supply, invoice validity or tax treatment.
- This audit added a fail-closed invoice publication guard. It prevents both placeholder issuer details and an unapproved marketplace invoice model from being displayed as a tax invoice. It does not generate a seller invoice, credit note, GST return, TCS statement or settlement reconciliation.
- Delivery/returns/shortfall source exists, but refund method/timing, COD collection authority, failed/refused delivery, mixed-order responsibility and credit-note/adjustment treatment remain owner/CA/legal decisions.

## Owner / lawyer / CA approval register

| Owner evidence or decision | Required approver | Status |
| --- | --- | --- |
| Legal identity of Ajay General, proprietorship evidence, trade-name relationship and principal/registered address | Owner + lawyer | **PENDING** |
| Public support phone/email and public contact policy | Owner | **PENDING** |
| GST certificate, GSTIN validation, registration state and invoice series | Owner + CA | **PENDING** |
| Grievance Officer name/designation/phone/email/address, public route, staffing and escalation evidence | Owner + lawyer | **PENDING** |
| Final published terms/privacy/shipping/cancellation/returns/grievance policies | Owner + lawyer | **PENDING** |
| Marketplace seller agreement, seller declaration and signed acceptance/version controls | Owner + lawyer + CA where settlement/tax matters arise | **PENDING** |
| Seller KYC, GST status, address/contact, bank/settlement and source/authenticity evidence | Owner/reviewer | **PENDING** |
| Product-level labels, sources, licences/import evidence and anti-counterfeit evidence | Owner/reviewer + lawyer where required | **PENDING** |
| Cosmetics/Legal Metrology applicability/evidence standards and every category/product classification | Owner + lawyer/specialist | **PENDING** |
| Own-stock vs marketplace merchant/seller-of-record, invoice issuer, GST/TCS, settlement, returns and credit-note model | CA + lawyer + owner | **PENDING** |
| Serviceable PINs, carrier evidence, COD authority, fees, delivery/refund operations | Owner + lawyer/CA as applicable | **PENDING** |
| Processor contracts, retention schedule, rights/grievance workflow, access/logging/backups and breach response | Owner + lawyer/security owner | **PENDING** |

## Required test/release evidence before professional review

1. Apply migrations only to an authorised **disposable isolated** PostgreSQL/staging environment after backup/release approval; never apply them directly to production as a test.
2. Run unit, integration, PGlite/RLS/Storage/ACL tests, TypeScript typecheck, lint and production build using the repository’s declared dependencies.
3. Run a real two-connection PostgreSQL test for seller suspension versus offer publication and review approval versus fact change.
4. Inspect `pg_proc.proacl`, function owner/search path, RLS policies and Storage bucket/object policies after migration.
5. Verify anonymous, retailer, seller, admin and Super Admin data/object access, including cross-seller evidence denial.
6. Verify every legal URL/alias, public grievance discoverability, missing-issuer invoice blocking, own-stock invoice path, marketplace invoice blocking, cancellation/return/partial-delivery/COD workflows, and historical-order access.
7. Confirm that all source references, amendment status and commencement dates have been reviewed by qualified Indian counsel/CA against official current texts.

## Rollback and recovery

`0087` documents a non-destructive forward-corrective rollback: keep evidence/audit/history private and retained; do not delete documents, rewrite historical orders/invoices, reclassify products, auto-approve records or reopen sale eligibility. For the invoice publication guard, recovery is configuration/model approval and a reviewed forward change—not replacing historic documents or guessing an issuer.

## Final conclusion

The local codebase contains substantial fail-closed readiness, seller/product, evidence and invoice-publication controls, but they are unexecuted source changes and cannot establish operational/legal compliance. Maharani Traders is **not legally certified**, is **not launch ready**, and no production deployment or remote database change was performed.
