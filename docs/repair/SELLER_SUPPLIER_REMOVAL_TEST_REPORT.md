# Seller & Supplier Removal — Test Report

**Branch:** `arena/b4ce4177-maharani-mart`
**Base commit:** `450e22fd4390a1396b460b40116fe911aed9a306`
**Runtime:** Node v22.22.3 · pnpm 9.15.9 · Vitest 2.1.9 · PGlite (PostgreSQL 16) · TypeScript 5.9.3

---

## 1. Headline numbers

| Check | Baseline (before any change) | Final | Verdict |
| --- | --- | --- | --- |
| Test suites | 239 passed | **234 passed, 234 total** | ✅ EXIT=0 |
| Tests | 3644 passed | **3520 passed, 3520 total** | ✅ EXIT=0 |
| `tsc --noEmit` | 0 errors | **0 errors** | ✅ EXIT=0 |
| `eslint .` | 0 problems | **0 errors, 0 warnings** | ✅ EXIT=0 |
| `next build` | not run at baseline | **compiles, all routes emitted** | ✅ |

**No test was weakened to make it pass, and no failure was relabelled as a pass.** The count fell
because **11 seller/supplier test suites were deleted in the same commit as the modules they covered**
(deleting a module without its tests fails `typecheck` on `@/…` imports). Four new suites were added
(+61 tests) during the owner-review corrections. Full accounting is in §5.

---

## 2. Exact final run

```
$ corepack pnpm exec vitest run
 Test Files  234 passed (234)
      Tests  3520 passed (3520)
   Duration  ~515s
   EXIT=0
```

No test was skipped by me. (The suite contains individual `describe.skipIf` guards inherited from the
baseline; none were added or widened by this work.)

```
$ pnpm run typecheck   → tsc --noEmit → EXIT=0
$ pnpm run lint        → eslint .     → EXIT=0   0 errors, 0 warnings
$ pnpm run build       → EXIT=0, route manifest emitted (all retired routes absent)
```

---

## 3. Checkout regression

The ordering spine was the main risk (see Phase 1 audit: the seller surface underpinned it). It is now
pack-only and fully green.

| Suite | Tests | Result | What it proves |
| --- | --- | --- | --- |
| `mobile-checkout-atomic-db` | 15 | ✅ | `create_order_atomic` v1 atomicity end-to-end |
| `checkout-atomic` | 9 | ✅ | Atomic checkout contract |
| `coins-order-flow` | 17 | ✅ | Coin application/reversal through the pack-only spine |
| `coupon-checkout-wiring` | 11 | ✅ | Coupon lines built from packs only |
| `order-request-replay` | 6 | ✅ | Idempotent replay |
| `order-state-machine` | 11 | ✅ | Legal transitions |
| `order-tracking-timeline` | 6 | ✅ | Tracking |
| `order-launch-readiness` | 2 | ✅ | Launch gate |
| `mobile-cart-service` | 9 | ✅ | Pack-only cart |
| `mobile-quick-order` | 13 | ✅ | Quick order |
| `mobile-order-invoice` | 11 | ✅ | Invoice path |
| `mobile-order-delivery` | 6 | ✅ | Delivery |
| `atomic-split-cancellation-db` | 27 | ✅ | **Historical** split-order cancellation still works |
| `fulfilment-atomic-actions-db` | 22 | ✅ | Fulfilment actions |
| `delivery-completion-action-db` | 38 | ✅ | Delivery completion |
| `return-request-actions-db` | 13 | ✅ | Returns |
| `category-tier-pricing-db` | 23 | ✅ | Category pricing survives the spine change |
| `simplified-pack-stock-db` | 11 | ✅ | Pack stock |
| `delivery-trust-and-loyalty-integrity-db` | 34 | ✅ | Ledger integrity |

**Result: no checkout regression.** Historical split orders remain cancellable, settleable and
viewable; new orders are pack-only.

---

## 4. Super Admin regression

| Suite | Tests | Result | What it proves |
| --- | --- | --- | --- |
| `phase3-business-control-db` | 11 | ✅ | RLS, triggers, 0109 rollback protection, moderation audit |
| `phase3-rollback-protection-db` | 14 | ✅ | 0109 data-loss protection |
| `command-center` | 32 | ✅ | Command center, incl. renamed Purchases & GRN section |
| `dashboard-upgrade` | 37 | ✅ | Reshaped `SuperAdminBusinessOperations` counters |
| `admin-page-error-states` | 6 | ✅ | Admin page read-failure handling |
| `security-phase0-db` | 57 | ✅ | Security posture |
| `security-advisor-remediation-db` | 8 | ✅ | Advisor remediation, incl. closed supplier funnel |
| `api-privilege-hardening` | 25 | ✅ | Privilege surface |
| `pr126-migration-review-db` | 11 | ✅ | 0094–0102 reviews + rollback chain |
| `migration-validation-0103-to-0109-db` | 3 | ✅ | Baseline→0109 upgrade parity, idempotency, ordering |
| `phase-2d1-compliance-flow-db` | 6 | ✅ | 0087 compliance activation + evidence RLS |
| `migration-0109-dependency-guard` | 13 | ✅ | 0109 preflight preserved |
| `rollback-0081-dependency` | 17 | ✅ | 0082 chain reversal |

**Result: the real Super Admin was not locked out.** Historical seller records remain readable and
annotatable; sub-order settlement and the append-only moderation audit still function.

---

## 5. Test-file accounting (why the count moved)

### Deleted — 11 suites, with the modules they covered

| Suite | Removed because |
| --- | --- |
| `seller-marketplace-actions` | Module deleted |
| `seller-marketplace-db` | Module deleted |
| `seller-offer-gate` | `/admin/offers` removed |
| `seller-agreement-gate-db` | Seller onboarding removed |
| `supplier-actions-f1` | Module deleted |
| `supplier-applications` | Route removed |
| `supplier-applications-db` | Route removed |
| `supplier-rate-limit` | Funnel closed (limiter still proven — see §6) |
| `suppliers-directory` | `/admin/suppliers` removed |
| `marketplace-launch-ui-db` | Route removed |
| `catalog-seller-compliance-migration` | Superseded by `migration-0110-*` |

### Added — 2 suites, 20 tests

| Suite | Tests | Covers |
| --- | --- | --- |
| `migration-0110-seller-supplier-retirement` | 10 | Migration applies, revokes, preserves, is idempotent, rollback restores, content rewrite works |
| `seller-supplier-retirement-authorization` | 10 | Retired role refused in code, retired routes absent, middleware order, DB-level refusal |

### Re-pointed — assertions changed to the new truth, not weakened

| Suite | Old assertion | New assertion |
| --- | --- | --- |
| `api-privilege-hardening` | `anon` **can** execute `submit_supplier_application` | `anon` and `authenticated` **cannot** |
| `security-advisor-remediation-db` | function in the anon-allowed list | asserted separately as **closed** |
| `pr126-migration-review-db` | `record_marketplace_launch_approval`, `seller_offer_gate_status` in `AUTHENTICATED_MAY_CALL` | removed from the list (0110 revokes both) |
| `phase3-business-control-db` | 6th anon call → `SUPPLIER_RATE_LIMITED` | **no API call reaches it at all**; limiter proven directly, still refuses the 6th |
| `deliveries-workflow` | `PrivateBucket` had 5 buckets incl. `supplier-documents` | 4 buckets — no code path mints supplier URLs |
| `policy-shell-links` | seller footer renders nav | seller shell no longer exists (`existsSync` false) |
| `public-information` | reads `app/seller/layout.tsx` | seller layout excluded; live layouts checked |
| `site-content-footer-nav` | `seller` in the role list | `seller` removed from `UserRole` |
| `site-content-seed` | stage 2 = 10 pages | stage 2 = 9; `seller-agreement` deliberately unpublished |
| `site-content-continuity` | 19/10/0 pages | 18/9/0 of 18; retirement pinned |
| `migration-validation-0103-to-0109-db` | `maxNum === 109` | `110`, with 0110's rollback registered |

### Behavioural tests whose *expectation* legitimately changed

`phase-2d1-compliance-flow-db` and `phase3-business-control-db` needed their **fixtures** routed
through the service role / owner-on-behalf-of:
the marketplace launch gate and `seller_offers` inserts are no longer reachable by an administrator's
RLS grant, which is the intended outcome. The environment-level rules those suites exist to test are
unchanged and still fully asserted.

---

## 6. Controls that survived (and are still proven)

The supplier anti-abuse rate limiter is a live database control even though the funnel is closed. It is
now exercised directly, and the suite asserts both:

* it allows attempts 1–5 and **refuses the 6th** (`allowed: false`);
* no API role (`anon`, `authenticated`) can call it.

---

## 7. Bugs the tests caught during this work

Recorded because each was a real defect that review alone missed.

| # | Bug | Caught by | Fix |
| --- | --- | --- | --- |
| 1 | `0110` guessed the `reserve_seller_invite` signature, silently skipping its revoke | `0110`'s own block-8 verification | Correct signature `(text,text,text,text,text,text,text)`; verification block exists precisely for this |
| 2 | Revoking `is_member_of_seller` / `is_active_seller_member` broke **migration application** (`permission denied for function`) because live RLS policies call them | `ai-retention`, `security-phase0-db` (11 suites failed at setup) | Kept executable; rationale documented in the migration |
| 3 | Dropping `seller_offers` admin `UPDATE` silently stopped the append-only moderation audit | `phase3-business-control-db` | `seller_offers_admin_update` re-stated |
| 4 | Dropping `suppliers_admin_update` and `seller_members_admin_*` broke compliance fixtures | `phase-2d1-compliance-flow-db`, `phase3-business-control-db` | Admin paths re-stated; only self-service removed |
| 5 | Non-idempotent re-create: `policy "seller_offers_admin_update" already exists` | `migration-0110-*` idempotency test | Added `drop policy if exists` |
| 6 | `body`/`bullets` are `text[]`, not `jsonb` — first content-rewrite block was wrong | `migration-0110-*` content test | Rewritten with `unnest(... ) with ordinality` over `text[]` |
| 7 | Website seed drifted from its generator after a hand-edit | `site-content-seed` "generator drift" | Replacement table moved into `generate-site-content-seed.mjs`; regeneration verified byte-identical |
| 8 | Two dead internal links to `/admin/offers` | Manual grep during verification | Removed |
| 9 | **Block 7 deactivated approved retailers.** One bulk `update ... where role::text='seller'` also matched dual-role profiles that legitimately owned an approved `retailers` row | Owner-review re-read of the migration against `0001_init.sql`; new `migration-0110-retailer-preservation` suite | Three-population split; block-8 assertion that no approved retailer may lose access |
| 10 | A `do $tag$ begin` block would not parse: a named block needs `declare` (or `as`). Finding this took a statement-level bisect, since the error (`syntax error at or near "is"`) named the wrong token entirely | `migration-0110-*` setup | Body opened with `declare`; diagnosed by executing each top-level block separately |
| 11 | The loop variable `r` was shadowed by the table alias `r` inside the same `for r in select ... join retailers r` → `record "r" is not assigned yet` at run time | `migration-0110-retailer-preservation` | Loop variable renamed `v_row`; aliases untouched |
| 12 | A regex used to rename that variable also rewrote `join public.retailers r on r.id = p.id` in two **count** queries, corrupting them | Same suite, immediately after | Repaired by hand and re-read the whole block; the lesson is to re-read a mechanical patch, not just trust the diff |
| 13 | The corrected legal copy introduced a *new* unverified claim ("we are the seller of record") | New `business-identity-claims` suite | Claim removed; suite now fails the build if it returns |
| 14 | **The replacement table was applied once per pair, so it never followed its own chain.** The marketplace sentence → neutral copy → owner-approved identity is a chain; a database seeded at an intermediate revision stopped on the middle link | New convergence assertion in `migration-0110-seller-supplier-retirement` | Generator and `0110` both iterate to a fixpoint; test plants the *original* sentence and asserts the final wording |
| 15 | The generator's table used a whole-paragraph `Map` key, so a sentence-level entry could not fire inside a paragraph | Same suite, plus `site-content-seed` | Rewrite tries the paragraph, then each sentence |
| 16 | A `to` value still said orders are "invoiced by Maharani Traders" — an invoice-issuer role asserted for the *brand* | Manual read of the rendered about page; now also `business-identity-claims` | Corrected to the AJAY GENERAL proprietorship, and the guard flags `invoiced/billed by Maharani` |

---

## 8. How to reproduce

```bash
pnpm install --frozen-lockfile
pnpm run typecheck                 # EXIT=0
pnpm run lint                      # EXIT=0
pnpm exec vitest run               # 232 files / 3467 tests, EXIT=0
pnpm run build                     # EXIT=0
```

Focused:

```bash
pnpm exec vitest run tests/migration-0110-seller-supplier-retirement.test.ts   # 10 tests
pnpm exec vitest run tests/migration-0110-retailer-preservation.test.ts        # 37 tests
pnpm exec vitest run tests/seller-supplier-retirement-authorization.test.ts    # 11 tests
pnpm exec vitest run tests/business-identity-claims.test.ts                    # 11 tests
```

### Account-state matrix — before → after → rollback

Every row is a test in `tests/migration-0110-retailer-preservation.test.ts` (37 tests, native
PostgreSQL 16 via PGlite). "Rollback" is the opt-in path
(`set local maharani.reactivate_seller_profiles = 'true'`).

| # | Before | After 0110 | `is_active` touched? | Rollback restores |
| --- | --- | --- | --- | --- |
| 1 | `seller`, **active**, approved `retailers` | `retailer`, active | no | `seller`, active |
| 2 | `seller`, **inactive**, approved `retailers` | `retailer`, **inactive** | **no** | `seller`, inactive |
| 3 | `seller`, **active**, seller-only | `seller`, inactive | active → inactive | `seller`, active |
| 4 | `seller`, **inactive**, seller-only | **unchanged**, no audit row | no | unchanged |
| 5 | `seller`, active, `retailers` = pending | `seller`, inactive | active → inactive | `seller`, active |
| 6 | `seller`, active, `retailers` = suspended | `seller`, inactive | active → inactive | `seller`, active |
| 7 | `retailer`, active (never a seller) | unchanged | no | unchanged |
| 8 | `super_admin` / `admin` / `staff` | unchanged | no | unchanged |

Additional rollback evidence:

* restored `role` **and** `is_active` match the recorded before-state for every case (deep equality on
  the whole profile state, not just one column);
* a plain rollback with **no** opt-in changes nothing;
* running the opt-in rollback **twice** is stable;
* a profile the owner changed *after* the migration is **skipped**, not overwritten;
* `audit_logs` is only ever appended to;
* 0081's original approval function is restored, and a subsequent approval no longer promotes;
* the block-9 helper no longer exists.

### Retailer approval after the migration — through the real path

| Case | Result |
| --- | --- |
| `admin_review_retailer_application(approved)` on a deactivated dual-role profile | role → `retailer`, `retailers.status='active'`, audited, `profile_role_promoted: true` |
| same, on an account the owner had suspended | role → `retailer`, **`is_active` stays false** |
| `rejected` | nothing promoted, access gate stays `pending_approval` |
| reason shorter than 3 characters | raises (0081 rule preserved) |
| Gold without an explicit request | raises (0081 rule preserved) |
| caller who is not an admin | raises `administrator authorization required` |

### Checkout is pack-only at the database

`tests/mobile-checkout-atomic-db.test.ts` (18 tests):

| Case | Result |
| --- | --- |
| new order whose line carries a `seller_offer_id` | raises `SELLER_OFFERS_RETIRED`, writes no order, does not clear the cart |
| ordinary own-stock pack line in the same fixture | succeeds |
| replay of an existing request key | returns the original order (`replayed: true`), proving the replay path precedes the guard |

### The retailer-preservation suite, case by case

| Case | Assertion |
| --- | --- |
| Seller-only profile | deactivated, `role` still `seller`, never gains a `retailers` row |
| Seller-only profile, history | profile row, orders, payments, refunds, memberships and audit rows all survive |
| Dual-role, retailer `active` | re-roled to `retailer`, stays active |
| Dual-role, retailer `active` | the preserved retailer can still use retailer-scoped access afterwards |
| Dual-role, retailer `pending_approval` | deactivated, role untouched — access is **not** preserved |
| Dual-role, retailer `suspended` | deactivated, role untouched — access is **not** preserved |
| Ordinary retailer | byte-identical before/after |
| `super_admin` / `admin` / `staff` | untouched |
| Every population | seller RPCs stay revoked regardless of who kept retailer access |
| Preserved dual-role retailer | calling a seller RPC still raises |
| Rollback, no opt-in | profile row left alone; grants restored separately |
| Rollback, `maharani.reactivate_seller_profiles='true'` | re-role reversed via the audit marker; a genuine retailer is never demoted; block-9 helper dropped |
| Rollback, history | `audit_logs` only appended to, never truncated |
| Block 9 | promotes only an approved dual-role account; idempotent; refuses seller-only and unapproved; not executable by any API role |

The migration suite boots a real PostgreSQL 16 (PGlite) and applies **every** migration in the
repository, including `0110`, then exercises revoke / preserve / idempotency / rollback and the
website-content rewrite.
