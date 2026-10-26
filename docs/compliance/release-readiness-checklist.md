# Production Release Readiness Checklist — Maharani Traders

**Release Target**: PR #118 & Phase 2B Scope  
**Environment Status**: Local verification complete; Production migration STRICTLY PROHIBITED  
**Audited Database Target Ref**: `fhrmsrumsraprvutrpeo` (Identity verification only; NO WRITES)  
**Date**: 2026-10-27  

---

## 1. Safety & Infrastructure Gates

| Gate Item | Requirement | Verification Method | Status | Responsible |
| :--- | :--- | :--- | :---: | :--- |
| **G1: Production Isolation** | No migrations, SQL scripts, or data mutations executed against remote Supabase project `fhrmsrumsraprvutrpeo`. | Environment connection audit; read-only verification. | **PASS** | Lead Engineer |
| **G2: Remote CI Billing** | GitHub Actions workflows must run and pass on branch `arena/906f17a9-maharani-mart`. | `gh run view 40272469053`. | **BLOCKED** | Repository Owner |
| **G3: Git Branch Hygiene** | Working tree clean, zero uncommitted changes, zero merge conflicts with `main`. | `git status`, `git merge-base`. | **PASS** | Lead Engineer |
| **G4: Local Test Suite** | 100% test pass rate across all unit, integration, and PGlite database test suites. | `npm test` (159 files, 2,726+ tests). | **PASS** | QA Engineer |
| **G5: Production Build** | TypeScript compilation (`tsc --noEmit`) and Next.js production build (`next build`) compile cleanly. | `npm run typecheck`, `npm run build`. | **PASS** | Full-stack Lead |

---

## 2. Financial & Security Gates

| Gate Item | Requirement | Verification Method | Status | Responsible |
| :--- | :--- | :--- | :---: | :--- |
| **F1: Delivery Shortfall Net Refund** | Missing or damaged goods must be refunded at the net paid amount after item-level discounts, never at gross undiscounted value. | Integration tests in `tests/delivery-shortfall-refund.test.ts`. | **PASS** | Financial Lead |
| **F2: Loyalty Accrual on Actual Delivery** | Loyalty points must only be awarded for items actually delivered to the retailer; shortfall items must be excluded from points accrual. | Delivery trigger test suite. | **PASS** | Financial Lead |
| **F3: Cash & Loyalty Separation** | Loyalty ledger points cannot be redeemed as cash or directly deducted from monetary checkout totals. | RPC permission and parameter inspection. | **PASS** | Security Lead |
| **F4: Server-Side Discount Validation** | Database RPC must re-derive active membership tier, expiry, discount %, and plan cap server-side; client-forged discounts must abort with error. | Atomic RPC test suite. | **PASS** | Database Architect |
| **F5: RLS & Privilege Lockdown** | `loyalty_ledger`, `retailer_memberships`, and `sub_orders` have direct client INSERT/UPDATE/DELETE revoked; `SECURITY DEFINER` functions enforce fixed `search_path = public, pg_temp`. | PGlite RLS assertion suite (`tests/membership-db.test.ts`). | **PASS** | Security Lead |

---

## 3. Statutory Compliance & Legal Gates

| Gate Item | Requirement | Verification Method | Status | Responsible |
| :--- | :--- | :--- | :---: | :--- |
| **L1: CA Written Tax Opinion** | Chartered Accountant formal sign-off on Section 15(3) pre- vs post-supply discount, multi-rate tax allocation, and GSTR-1 invoice reporting. | Physical sign-off on `docs/compliance/ca-review-membership-discounts.md`. | **BLOCKED (Awaiting CA)** | Business Owner / CA |
| **L2: Marketplace Settlement Terms** | Formal agreement defining whether Maharani Traders or 3rd-party sellers absorb membership discounts, and TCS collection basis. | Business contract review. | **BLOCKED (Awaiting Owner)** | Business Owner |
| **L3: Owner Business Placeholders** | Mandatory replacement of legal business placeholders in `/legal/terms` and `/legal/grievance` (GSTIN, legal entity name, Grievance Officer details). | Legal page content review. | **PENDING OWNER INPUT** | Business Owner |
| **L4: FMCG & Cosmetics Catalog Scope** | Strict restriction of product catalog to cosmetics and FMCG; food items completely prohibited (avoiding FSSAI licensing breach). | Category taxonomy inspection. | **PASS** | Catalog Lead |
| **L5: Gated Discount Launch** | Checkout discount deduction remains disabled in production until L1, L2, and L3 gates are formally cleared. | Feature flag inspection (`lib/membership/math.ts` / RPC gate). | **PASS** | Release Lead |

---

## 4. Rollback Plan

1. **Database Schema Rollback**:
   - Migration `0080` introduces additive tables (`membership_plans`, `retailer_memberships`, `loyalty_ledger`).
   - If an unexpected regression occurs in production after migration:
     - The tables can remain without impacting existing core orders (`0056` and `0065` RPCs operate independently).
     - The trigger `trg_orders_delivered_loyalty` can be disabled with:
       ```sql
       alter table public.orders disable trigger trg_orders_delivered_loyalty;
       ```
2. **Application Rollback**:
   - Git revert the PR commit. Next.js PWA redeploys cleanly without broken state.
   - Any historical loyalty points remain preserved in immutable ledger without affecting monetary wallet balances.
