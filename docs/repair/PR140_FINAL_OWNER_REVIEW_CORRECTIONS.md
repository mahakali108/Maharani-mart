# PR #140 — Final Owner-Review Corrections

**Branch:** `arena/b4ce4177-maharani-mart` · **PR:** #140
**Scope:** legal identity, invoice identity, Retailer approval + activation
**Production actions performed:** none. No migration applied, no `db push`, no deploy.

---

## A. Legal identity — only owner-approved facts are asserted

### What the owner approved

> Maha Bazar by Maharani is the customer-facing website and app name for the AJAY GENERAL
> proprietorship, which trades under the brand MAHARANI TRADERS. AJAY GENERAL is the legal seller and
> invoice issuer. Maharani Traders is a trading style, not a separate incorporated company or legal
> entity. Maa Kali Enterprises is a separate business identity.

### What was removed, and from where

Three claims had been asserted that the owner never verified. Each was replaced with an explicit
owner-supplied placeholder rather than a silent deletion, so nothing is hidden from a customer or
from the owner's launch checklist.

| Claim | Why it is not permitted | Replacement |
| --- | --- | --- |
| `AJAY KUMAR, Proprietor` | the proprietor's **personal name**. The owner approved the business name `Ajay General`, not a person. | `Proprietor name: to be supplied by the owner before publication` |
| `registered trade name AJAY GENERAL` | that the trade name is *registered*, and that a registration status exists at all | `Registered trade name and registration status: to be supplied by the owner before publication` |
| `Plot No. 231, Ander Bazar, Belaganj, Gaya, Bihar – 804403` | a **registered address** | `Registered address: to be supplied by the owner before publication` |
| `Grievance Officer: AJAY KUMAR, Proprietor` | a **statutory appointment**, naming a person who was never formally appointed | `Grievance officer: to be supplied by the owner before publication` |

`Maa Kali Enterprises` is now described in exactly one way, and no other claim is made about it. The
earlier draft said *"…and is not connected to this business"*. That is itself a legal conclusion — it
asserts the absence of common ownership, control or contractual link — so it was removed too. A test
fails on any stronger wording (not connected / not related / owned by another / separate legal
entity).

### Every surface that could still hold the old text

The correction is a **chain applied to a fixpoint**, not a single find-and-replace, because a database
seeded at any earlier revision must converge:

1. `scripts/generate-site-content-seed.mjs` — `RETIRED_MARKETPLACE_SENTENCES` gained 9 chain entries.
   Two `retireMarketplaceIntro()`/`meta_description` gaps were closed: the `about` and `contact`
   pages built their intro and meta description outside the correction chain, which is how
   `about` kept the old name. `normaliseContactBlock()` rebuilds a stale contact block from
   `CONTACT_LINES` and is idempotent.
2. `content/site-pages.seed.json` + `supabase/migrations/0105_seed_site_content.sql` — regenerated.
   `AJAY KUMAR` = **0**, `Plot No. 231` = **0**, `not connected` = **0**. Regeneration is byte-identical
   on a second run (verified).
3. `supabase/migrations/0110_…sql` `$site_copy$` — the replacement table now ends at the approved
   sentence, with the statutory-fact pairs appended, so a seeded database converges.
4. Tests that had been written to expect the removed strings were **corrected, not deleted**:
   `site-content-seed` (18), `public-information` (7), `business-identity-claims` (14).
5. Historical audit documents now carry a **SUPERSEDED** banner. Their dated quotations are preserved
   as history rather than falsified, and the banner says not to copy identity lines out of them.

`lib/legal/issuer.ts` models the remaining statutory facts (GSTIN, registered address, phone,
grievance officer) as owner-supplied values with `value = null` and a controlled placeholder;
`statutoryBlockIsComplete()` is the machine-checkable flag.

---

## B. Invoice identity — issuer, trading style and app name cannot be confused

### The defect

`app/retailer/orders/[id]/invoice/download/route.ts` passed `brandName: BRAND.name`. The renderer
prints that field as **"Trading as …"**, so every downloaded invoice read:

> **Ajay General** / *Trading as Maha Bazar by Maharani*

That tells a tax authority the proprietorship trades under an installable app's name.

### The fix

| Surface | Before | After |
| --- | --- | --- |
| Invoice HTML download | `brandName: BRAND.name` | `brandName: BRAND.tradingStyle` → *Trading as Maharani Traders* |
| Mobile invoice payload | `brand: BRAND.name` | `tradingStyle: BRAND.tradingStyle` + `appName: BRAND.name` (distinct fields) |
| Invoice issuer | `issuance.issuer` (Ajay General) | unchanged — still the only legal issuer |

Verified rendered output: `Trading as Maharani Traders`, `issued by Ajay General`, and the string
`Maha Bazar by Maharani` does **not** appear on the document at all.

Issuer validation stays **fail-closed**: `isApprovedIssuerName()` requires `/\bajay\s+general\b/i`, so
both `Maharani Traders` and `Maha Bazar by Maharani` are rejected as issuers with
`issuer_identity_unapproved`. Regression tests cover both, plus a check that reverting the fix
reproduces the failure.

---

## C. Retailer approval **and activation**

### The defect

Migration 0110 deactivates an unapproved dual-role seller profile (`is_active = false`, role kept
`seller`). Approving the application later promoted the role to `retailer` and set
`retailers.status = 'active'` — but deliberately did not touch `is_active`. The result was a state no
UI could escape:

```
profiles.role             = 'retailer'         <- looks approved
retailers.status          = 'active'           <- looks approved
profiles.is_active        = false              <- cannot sign in
is_active_account()       = false              <- every RLS policy denies
```

The Super Admin screen reported success. The person still could not log in.

### Why "just set is_active = true when approving" is wrong

After migration 0110, `is_active = false` has two indistinguishable causes: **(a)** this migration
deactivated the account, or **(b)** the owner suspended it afterwards. Blanket reactivation would
silently undo (b) — handing back a login a human deliberately revoked. So the two causes are recorded
separately and activation is a deliberate act.

### What was built (migration 0110, block 12)

| Piece | Purpose |
| --- | --- |
| `retailer_activation_ledger` (new table) | append-only record of exactly which accounts **this migration** deactivated, with the exact original `role` / `is_active`. A new table, so no existing row, policy or trigger is altered. |
| `auth_user_is_banned(uuid)` | the linked GoTrue user's ban state, looked up column-tolerantly so the function never fails on a database without `banned_until`. |
| `admin_retailer_activation_status(uuid)` | read-only: can this account actually sign in, was it deactivated by 0110, is an activation permitted, and if not, why. |
| `admin_activate_retailer(uuid, text, text)` | the only activation path. Super-Admin-only, reason required, literal `ACTIVATE` confirmation required, audited with before/after, writes the ledger. |
| `admin_review_retailer_application` (rewired again) | approval now returns `activation_required`, `sign_in_eligible` and a plain-language `next_step`, so no UI can report "approved" while the account is unusable. |

### Safeguards, each with a test

1. An account inactive **before** 0110 is never auto-reactivated (role changes, active flag does not).
2. A 0110 deactivation is distinguishable from a later Owner/Admin suspension (ledger + approval-event trail).
3. Approval no longer implies success: it returns `sign_in_eligible: false` and an explicit next step.
4. Activation is Super-Admin-only, authorised inside PostgreSQL, reason-required, confirmation-required, audited.
5. An Owner/Admin suspension recorded after the migration is **preserved** — activation is refused and points at the suspension workflow.
6. A seller-only account is **never** converted and never activated.
7. The exact original state is preserved for rollback (ledger `original_role` / `original_is_active`).
8. Direct API access is closed: `anon` denied outright; an `admin` and the retailer themselves are rejected by the NULL-safe role check.

### A NULL-safety bug found in the author's own guard

`current_user_role()` returns **NULL** for a caller with no active profile, and in PL/pgSQL
`if null <> 'super_admin'` evaluates to NULL — not TRUE. A plain `<>` therefore **falls through and
grants access**. Both functions use `is distinct from 'super_admin'`, and
`retirement-security-audit.test.ts` now asserts that the unsafe comparison appears nowhere.

### State matrix (verified by execution, not assertion)

| Starting state | After 0110 | Approve | Activate | `is_active_account()` |
| --- | --- | --- | --- | --- |
| dual-role, approved, active | `retailer`, active | n/a | no-op (`changed: false`) | **true** |
| dual-role, approved, inactive before 0110 | `retailer`, still inactive | n/a | permitted (deliberate) | false until activated |
| dual-role, pending, active | `seller`, deactivated | `retailer`, still inactive | **required** → active | **true** after activation |
| pending, deactivated, approved, then suspended by admin | `seller`, deactivated | `retailer`, inactive | **refused** | false |
| seller-only | `seller`, deactivated | n/a | **refused**, never converted | false |
| ordinary retailer | untouched | n/a | no-op | **true** |
| Super Admin | untouched | may approve | only role allowed to activate | **true** |
| `admin` | untouched | may approve | **refused** | n/a |

Every row checks `public.is_active_account()` executed **as that user** — the predicate every
restrictive RLS policy uses — because `role = 'retailer'` alone was true throughout the bug.

### Rollback

The opt-in profile replay (`maharani.reactivate_seller_profiles = 'true'`) is unchanged in behaviour
and now reports explicitly when an account was activated after the migration, and skips it: a
deliberate Super Admin grant is not revoked by rolling the migration back. Block 12's functions and
the ledger are dropped; `audit_logs` (the evidence) is never touched.

---

## Verification

| Gate | Result |
| --- | --- |
| Full migration chain through 0110 (PGlite, real PostgreSQL 16) | applies clean |
| 0110 re-applied on top of itself | no error, no duplicate ledger rows, no state change |
| Rollback with exact before-state | restores `role` **and** `is_active`; activations preserved |
| Vitest | **235 files / 3551 tests passed, exit 0** |
| `tsc --noEmit` | exit 0, no output |
| `eslint .` | exit 0, no output |
| `next build` | exit 0 |
| No test deleted or weakened | 4 test files corrected where they asserted the withdrawn facts; 40 new tests added |

### Test counts for the surfaces touched here

`migration-0110-retailer-activation` **22** (new) · `migration-0110-retailer-preservation` 37 ·
`retirement-security-audit` 16 · `brand-identity` 21 · `business-identity-claims` 14 ·
`site-content-seed` 18 · `public-information` 7 · `super-admin-bootstrap-db` 10.

---

## Still outstanding — owner-supplied facts

Nothing below has been invented, and nothing below is published as if it were verified.

| Fact | State |
| --- | --- |
| Proprietor's personal name | **not supplied** — placeholder published |
| Trade-name registration status | **not supplied** — placeholder published |
| GSTIN | **not supplied** — `issuer.gstin.value = null`, invoice readiness is `false` |
| Registered address | **not supplied** — placeholder published |
| Grievance officer | **not supplied** — placeholder published |
| Support phone / email | owner-provided: `8987023959`, `adinathsahu8987@gmail.com` |

Until GSTIN and the registered address are supplied, `getTaxInvoiceReadiness()` returns
`ready: false` and the invoice endpoints answer **409** rather than printing an incomplete tax
document. That is the intended fail-closed behaviour, not a defect.

---

## Not performed (by instruction)

Not merged · no production SQL · no `supabase db push` · no Auth/SMTP/Storage/env/secret change ·
no deploy · no legacy project access · no APK/AAB · no Android/Flutter work.
