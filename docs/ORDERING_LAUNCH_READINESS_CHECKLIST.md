# Ordering launch-readiness checklist

**Status: owner review required — no item in this document is an approval.**

This local checklist is a review aid, not legal, tax, product, or compliance certification. It must not be used to invent contact details, GST information, legal conclusions, CA conclusions, seller disclosures, product documents, or policy wording.

The server-side order gate remains fail-closed until the protected readiness setting has all required approvals **and** an explicit owner-recorded validity policy whose expiry has not passed. Approval references are evidence pointers only; they do not prove legal or CA verification.

## Evidence register

For every item below, the owner should record the real reviewer, evidence reference, review date, validity/refresh date, and decision in the protected operational process. Do not enter placeholder values.

| # | Requirement | Required owner evidence before any relevant activation | Current status |
|---|---|---|---|
| 1 | Ajay General identity, registered address, and public contact details | Owner-verified legal identity and address; working public support contacts | **Pending owner evidence** |
| 2 | Grievance officer and complaint handling | Real officer name/designation/contact details, handling process, acknowledgement/resolution workflow | **Pending owner evidence** |
| 3 | Terms, Privacy, Shipping, Cancellation, and Returns | Lawyer-reviewed publication decision and version/reference for each policy | **Pending owner/lawyer evidence** |
| 4 | GST, invoice issuer, and tax treatment | CA review of GST registration status, issuer identity, invoice format/tax treatment | **Pending owner/CA evidence** |
| 5 | Marketplace GST/TCS, seller settlements, and credit notes | CA decision covering marketplace role, TCS, settlement, commission, and credit-note treatment | **Pending owner/CA evidence** |
| 6 | Delivery, COD, cancellation, and refund operations | Tested serviceability, COD collection, cancellation, refund, support, and reconciliation procedures | **Pending owner/operations evidence** |
| 7 | Future seller activation | Seller identity/disclosure, agreement, KYC, tax, and compliance review before any future seller activation | **Pending — future seller scope; no seller workflow is changed here** |
| 8 | Cosmetics authenticity and controls | Source authenticity, applicable licence/import documents, physical labels, batch, and expiry controls | **Pending owner/compliance evidence** |
| 9 | Legal Metrology declarations | Review of applicable packaged-product declarations and supporting label evidence | **Pending owner/legal evidence** |
| 10 | Food exclusion | Confirm food is excluded in server-side catalogue/order rules and admin product workflows before any food activation | **Pending verification — food remains out of scope for this phase** |

## Controlled ordering-gate record

The protected `ordering_launch_readiness` record must contain explicit entries for these order-gate categories:

1. Business identity
2. Public/grievance contacts
3. Legal-policy publication
4. GST/invoice review
5. Marketplace tax/TCS/settlement review
6. Delivery/COD/cancellation/refund operations
7. Privacy/security/data-handling readiness

It must also contain an explicit, owner-recorded UTC `validUntil` policy. The application provides **no default validity period**. Missing, malformed, future-dated record timestamps, expired policy dates, unknown fields, failed reads, or pending categories block new order placement.

## Scope boundaries

- This checklist does not activate sellers, modify seller workflows, alter tax calculations, redesign invoices, approve products, or add food categories.
- Cosmetics/FMCG evidence remains pending until genuine documents and reviews are supplied.
- Existing pending orders are not cancelled, altered, or automatically blocked by this checklist. A separate owner decision is required if readiness should halt approval/fulfilment of already-created orders.
