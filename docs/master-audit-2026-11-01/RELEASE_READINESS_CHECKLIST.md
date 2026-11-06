# Release readiness checklist

2026-11-01: **NO-GO / evidence incomplete**, not a legal certification. All boxes below remain unchecked; source implementations and historical reports are not live approvals.

- [ ] Owner confirms legal entity, verified GST registration/identity, real business/support/grievance contacts and published lawyer-approved policies and agreements.
- [ ] CA approves HSN/rates, invoice/credit note format, seller-of-record, marketplace GST/TCS, e-invoice applicability, settlements/refunds and reconciliation.
- [ ] Lawyer reviews B2B/consumer applicability, privacy, IT intermediary responsibilities, product labels, advertising and trademark/IP.
- [ ] Food exclusion verified at all publication and ordering paths, including existing data, against correct target with owner approval.
- [ ] Cosmetics and non-food FMCG labels, manufacturer/importer evidence, batch/expiry and authenticity review completed for every launch SKU.
- [ ] Confirm official project and deployed environment, actual schema/function/RLS/storage drift, pending migrations, privileges and cross-tenant security. Resolve findings only with a separate approved migration/diff, backup, rollback and staging rehearsal.
- [ ] Restore drill passes from usable backup. Data retention, privacy requests, incident response and audit logs are approved.
- [ ] Two existing TypeScript errors fixed and CI green; typecheck, lint, full unit/integration/E2E, dependency/secret/security and regression evidence recorded with totals/skips/failure details. Critical advisories assessed and mitigated; no claim of no vulnerabilities.
- [ ] Operations: verified delivery service area, exact fees and MOQ, stock accuracy, COD collection/reconciliation, refund/return workflow, test support and failure handling. Ordering gate remains fail-closed until authorized evidence and approvals.
- [ ] Native Android audience enforcement, mobile API contract, accessibility, device/lifecycle/offline security tests and recovery deep links accepted. Build, signing, publication and any APK separately approved.
- [ ] Vercel commercial-use eligibility and Supabase plan/capacity verified; monitoring/backup cost and quota limits accepted; no surprise billing or paid activation.
- [ ] Existing PR conflicts reviewed without blind merging; manual owner merge policy and environment protections documented.
- [ ] Owner explicitly approves production change window, exact deployment, rollback, communication and business data impact. Separate approvals for database writes, deployment and release.
