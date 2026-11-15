# Launch readiness — Maharani Traders — 14 November 2026

## Verdict: NOT READY TO LAUNCH

This is not a close call. Two critical security defects are still present in
the live database until migration 0094 is applied, the business's legal
identity and GSTIN are unverified, and a large part of the existing security
test suite is broken. The site must not take real orders in this state.

It is safe to say only this: the live database has no users, orders or ledger
rows, so nothing has been exploited or lost.

> **Update after the independent review:** three further High findings were fixed
> in migrations 0096–0098 (SEC-16, SEC-06, SEC-17) and tested on real
> PostgreSQL with several sessions. See `06_REVIEW_FIXES.md`. The verdict does
> not change.

## Status by area

| Area | Status | Why |
|---|---|---|
| Legal documents | BLOCKED | 17 documents (A–Q) are published with version and dates; R is not applicable. All are engineering drafts awaiting an advocate and the owner. 13 commercial points are explicitly left undecided on the pages. |
| Registrations | BLOCKED | No GSTIN, no licence details supplied. Legal name is inconsistent between the brief and the site. |
| Seller compliance | FAIL | Invite-only onboarding, offer moderation and the food block exist. Missing: TCS/TDS handling, lawyer-drafted agreement terms, the acceptance gate now exists in the database (0098, switch ships OFF) but has no Admin screen. Do not enable third-party sellers. |
| GST and invoicing | BLOCKED | App refuses to issue a tax invoice without complete details (good). GSTIN, HSN and rates outstanding. |
| Privacy | FAIL | Policy, cookie notice, export/deletion requests exist; correction and consent-withdrawal added (needs 0095). Missing: consent notice at sign-up, breach procedure, Admin handling screen and deadlines. |
| Database security | FAIL | SEC-01 and SEC-02 (critical) fixed in the PR but **not applied live**. SEC-10 to SEC-13 open. |
| Application security | FAIL | Repairs made and tested. Open: non-transactional delivery workflows, `zod` advisory, no external penetration test. |
| Consumer protection | BLOCKED | Grievance page and ticket tracking exist. Officer details unverified; grievance topic and acknowledgement timestamp exist in 0095 but are not yet wired into the ticket screens. |
| Operations | BLOCKED | Return window, refund method, delivery areas and times not decided by the owner. |
| Testing | FAIL | Type check and build pass. 11 tests and 18 files fail on `main` and still fail; lint fails; multi-session concurrency now tested on real PostgreSQL (16 + 31 passed); still no browser test. |
| Deployment | BLOCKED | Nothing deployed or applied, by instruction. Vercel environment not inspected. |

## What this PR delivers

- Legal & Policies centre at `/legal` with 10 new documents, versioning on all 17, and acceptance records.
- Repairs for 9 security findings, with reproduction and regression tests.
- Two review-only migrations with tested rollbacks.
- This report set: `01_COMPLIANCE_MATRIX.md`, `02_SECURITY_AUDIT.md`, `03_TEST_REPORT.md`, `04_MIGRATIONS.md`, `05_OWNER_CHECKLIST.md`.

## What was asked for and not done

- Admin screens to action privacy requests and grievances with deadlines.
- Blocking seller offers until the current Seller Agreement version is accepted.
- Grievance topic in the ticket form; escalation workflow.
- Consent notice at registration.
- Field-by-field audit of listing pages for Legal Metrology declarations and country of origin.
- Fixing the 18 pre-existing failing test files and 48 lint errors.
- Views `security_invoker`, explicit `WITH CHECK`, transactional delivery workflow.
- Reading official Gazette texts for every statute (only secondary sources and one PIB document were reached).

## Shortest path to launch

1. Owner supplies section A–C of `05_OWNER_CHECKLIST.md`.
2. Merge and deploy this PR; apply 0094 then 0095; run the post-apply checks.
3. Repair the shared test fixture so the 11 database suites run again; fix what they then reveal.
4. Advocate and CA sign-off.
5. Launch **own-stock only**. Keep third-party sellers off until the marketplace items are closed.
