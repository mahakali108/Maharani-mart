# Implementation roadmap and owner decisions

2026-11-01. Sequence is gated, not a commitment to begin all phases. Only audit documents are produced now. All future code stays on the existing dedicated session branch; no commit, push, merge, deployment or production writes without appropriate approval. User asks for a dedicated feature branch; this session branch is already dedicated and cannot be renamed/switched.

| Phase | Scope | Acceptance / dependencies |
|---|---|---|
| 0 | Baseline, legal, GitHub, cost, architecture | This is a scoped baseline; complete deeper reviews and professional decisions before claiming full audit |
| 1 | Website/database security and technical debt | Fix pre-existing typecheck with tests, review/upgrade vulnerable dependencies; owner-approved read-only live project/schema reconciliation, security role matrix, isolated restore and rollback rehearsal; never auto-apply |
| 2 | Retailer Android design and prototype | Inventory existing native app; approve retailer-only security, no Flutter, UX/homepage first, no APK without release-plan approval |
| 3 | Retailer catalog/search/cart/checkout | Reuse current paths, server pricing, food exclusion, test atomic/tenant security; schema parity and business/legal gates |
| 4 | Orders, delivery, invoice, returns | CA-approved invoice/seller-of-record/GST and e-invoice applicability; COD reconciliation; support/returns; staging test |
| 5 | Seller governance | Super Admin-only invitation/activation, scoped products/docs/uploads, server-side approval/suspension, settlement/TCS decisions |
| 6 | Super Admin and compliance | Server-enforced fine roles, legal versions, audits, product evidence, inventory/reports/controls |
| 7 | Membership/discount/loyalty/bulk | Owner resolves paid-plan conflict; expiry, pricing, ledger and tax policies approved; avoid reusing category classification as paid subscription |
| 8 | Banners/ads/analytics | Privacy, image ownership, transparent paid placement, moderated upload, performance and consent decisions |
| 9 | Integration/security/regression | Full isolated test matrix in TESTING_STRATEGY; CI and device evidence |
| 10 | Release | Owner + CA/lawyer + security sign-offs; deployment, app build and release each separately approved |

## Exact owner decisions and evidence requests

1. Confirm official Supabase project ref and production/preview environment host identity (no keys); approve restricted read-only schema/metadata verification and isolated staging, including non-PII test data. Confirm plans/backups and restore expectations.
2. Confirm legal identity documentation, GSTIN/registered and operational addresses, support and grievance contacts, business phone/email, authorized signatory and CA/lawyer contacts. Do not post sensitive credentials.
3. Is seller-of-record Ajay General or each seller, by item? Who collects COD/gateway funds, settles sellers, issues invoices/credit notes and handles TCS? Provide seller contracts, payment flows and tax treatment for CA.
4. Confirm no food at launch and who classifies products, reviews cosmetics/FMCG labels/documents, sets recalls/expiry and approves listing; supply actual categories and origin/manufacturer evidence securely.
5. Explicitly decide whether to **reverse the previous retirement** of paid Silver/Gold subscriptions. If yes, specify Free/Silver/Gold price, tax, duration, upgrade/refund, payment provider, benefits, expiry and transition from existing categories; do not equate categories with paid plans. Set stacking caps and rounding; loyalty earning/redemption/expiry, refunds, immutable adjustments and historical balances.
6. Decide launch PINs, coverage, delivery fees/MOQ, COD controls, returns/cancellation/refunds and operational timelines; validate against existing gate and tax obligations.
7. Approve retailer-only native Kotlin reuse, app ID, design/branding, target devices and secure recovery/deep links. Separately approve build, signing/distribution plan and any APK.
8. Confirm current Vercel/Supabase plans, commercial-use eligibility, acceptable budget and free-tier alternatives; no upgrade is authorized.
9. Provide reviewed policies, marketplace/seller/retailer agreements, grievance and privacy/deletion workflows, data retention periods, consent bases, ad/image rights, trademark check and professional approvals.
10. Approve review strategy for seven conflicting PRs; do not merge automatically. Confirm access/collaborators and manual protection process for private Free repository.

## First recommended task

Approve a small **Phase 1 CI and dependency-security remediation**: reproduce and fix the two pre-existing TypeScript errors, analyze all critical Next advisories and choose a supported patched version with compatibility/regression tests. In parallel only after explicit owner confirmation, conduct restricted **read-only** live schema/identity reconciliation. Neither task authorizes production writes, deployment, APK, or plan changes. Because actual exposure and production drift are unknown, consult owner immediately if a material security risk is confirmed; do not make unapproved production changes.
