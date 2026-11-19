# Seller & Supplier Removal — Database Safety Report

**Migration:** `supabase/migrations/0110_retire_seller_supplier_marketplace.sql`
**Rollback:** `supabase/rollbacks/0110_retire_seller_supplier_marketplace.down.sql`
**Position:** after `0109_phase3_business_control.sql` (already merged as PR #139)
**Applied to production?** **No.** Not applied by this work, in whole or in part.

---

## 1. The one-sentence version

`0110` is a **capability-removal** migration: it revokes grants, replaces one trigger function and
rewrites RLS policies. It **deletes no table, no row, no column and no foreign key**, and no already-
applied migration was edited.

---

## 2. Why dropping the seller tables is not an option

Three independent constraints make `drop table` a data-loss event, not a cleanup. All three are
verified in the repository and asserted by `tests/migration-0110-seller-supplier-retirement.test.ts`.

### 2.1 `collection_allocations.sub_order_id` is NOT NULL + ON DELETE RESTRICT (0067)

```
collection_allocations.sub_order_id → sub_orders(id) ON DELETE RESTRICT, NOT NULL
```

Money that was collected against a sub-order cannot be un-allocated. Dropping `sub_orders` would
destroy the link between a payment collection and the order line it settled — i.e. destroy
reconciliation history for real payments.

### 2.2 Thirteen foreign keys point at `public.sellers`

| Behaviour | Count | Consequence of dropping `sellers` |
| --- | --- | --- |
| `ON DELETE CASCADE` | 5 | Silently deletes historical rows |
| `ON DELETE RESTRICT` | 7 | Migration fails outright |
| `ON DELETE SET NULL` | 1 | Orphans a record that must stay attributable |

Sources: 0064, 0066, 0067, 0072, 0086, 0109.

### 2.3 0109's own preflight would break

0109 (PR #139, merged) raises:

```
MIGRATION ORDER VIOLATION
```

unless `public.sellers`, `public.seller_offers`, `public.seller_offer_tiers` and
`public.is_active_seller_member(uuid)` all exist. Re-creating 0109 or reverting it is forbidden, so
these four objects **must** survive. `0110` therefore only ever `revoke`s.

---

## 3. `user_role` still contains `seller` — deliberately

PostgreSQL has no `DROP VALUE` for an enum, and re-creating the type would rewrite every dependent
column and all history. The value is therefore **refused at runtime**, in four places:

| Layer | Mechanism |
| --- | --- |
| Middleware | `isRetiredRole()` → sign out + redirect to `/login` |
| `requireUser()` | Refuses a retired role rather than returning it |
| `assertSignInAllowed()` | Returns `role_retired` |
| **Database** | `0110` replaces `handle_new_user()`, so no new seller account can be created; and deactivates every existing seller profile |

`0110` block 7 sets `profiles.is_active = false` where `role::text = 'seller'`. Every existing
restrictive policy from 0052 already consults `is_active_account()`, so a surviving token fails
immediately. **Nothing is deleted** — profile, auth user, membership row and order history all
remain, and the migration emits a `NOTICE` with the exact number affected.

---

## 4. What `0110` does, block by block

| Block | Action | Reversible by the rollback? |
| --- | --- | --- |
| 0. Preflight | Raises if `sellers`/`seller_offers`/`current_user_role()` are missing, or if 0110 has already run. | n/a |
| 1. Signup | `create or replace function public.handle_new_user()` — seller-invitation branch removed; explicit non-retailer signup refused; trigger function re-revoked from API roles (0078 H3 rule). | ✅ verbatim 0072 body |
| 1b. Invites | `staff_account_invites_role_check` narrowed to `('staff','salesman')`. | ✅ |
| 2. Seller portal RPCs | `revoke all ... from public, anon, authenticated` on 6 functions. Bodies untouched. | ✅ |
| 3. Seller invitations | Same, on 3 functions. | ✅ |
| 4. Marketplace RPCs | Same, on 7 functions. | ✅ (0086 verify) |
| 5. Supplier funnel | `submit_supplier_application` + rate limiter revoked from `anon`/`authenticated`; `supplier-documents` bucket policies dropped. Bucket and objects kept. | ✅ |
| 6. RLS write policies | Seller **write** policies dropped; admin read/update re-stated. | ✅ |
| 7. Seller accounts | **Three populations, decided by the `retailers` row** (see §4.1). Seller-only → deactivated, never converted. Dual-role + `retailers.status='active'` → re-roled to `retailer`, kept active. Dual-role + not approved → deactivated. **No delete.** | ⚠️ opt-in only |
| 7b. Website content | Exact-sentence rewrite of retired marketplace wording in `site_page_sections`. Never touches `status`/`published_at`/snapshot/version. | ⚠️ content only, no version bump |
| 8. Verification | RAISES if any capability survived, if an approved retailer lost retailer access, or if a preserved table is missing. | n/a |
| 9. Re-role helper | `retire_promote_dual_role_seller(uuid)`, service_role-only, for approvals granted *after* 0110. Idempotent, audited, refuses to promote a seller-only account. | ✅ dropped |

### 4.1 Block 7 must not destroy a legitimate retailer

`public.retailers` is a **separate table keyed on the same profile id** (`retailers.id references
profiles(id)`), and `profiles.role` is a single column. That means a profile can legitimately hold a
`role='seller'` while also owning an approved `retailers` row — the dual-role account. An earlier
version of block 7 ran one bulk `update ... set is_active = false where role::text = 'seller'`,
which silently destroyed the retailer half of exactly those accounts.

The corrected block splits the population and decides each case on evidence that already exists in
the database, never on a guess:

| Population | Test | Action | Audited reason |
| --- | --- | --- | --- |
| Seller-only | no `retailers` row | `is_active = false`, role kept `seller` | "Not converted to a retailer." |
| Dual-role, approved | `retailers.status = 'active'` | `role = 'retailer'`, `is_active = true` | "legitimate retailer access preserved" |
| Dual-role, not approved | `status` is `pending_approval`/`suspended` | `is_active = false`, role kept | "not approved: deactivated, not promoted" |

**Why the re-role is not a new grant.** `is_active_account()` (0052) already requires
`retailers.status = 'active'` for a retailer-role profile, and the approval workflow (0081) is what
sets that status. A dual-role account that passes the `status = 'active'` test therefore had *no*
extra permission to lose or gain: only the seller capability is removed, and that removal is enforced
by the EXECUTE revocations in blocks 2–6, not by the profile row.

**Why seller-only accounts are never promoted.** The promotion branch requires a pre-existing
`retailers` row, which only the retail registration or approval workflow creates. There is no code
path in the migration that can mint one.

**An approval that arrives after 0110.** `admin_review_retailer_application` (0081) flips
`retailers.status` but does not re-role the profile, so a formerly dual-role account approved later
would sit at `role='seller'`, `is_active=false`. Block 9 exposes
`public.retire_promote_dual_role_seller(uuid)` for that case: `SECURITY DEFINER`, granted to
`service_role` only, idempotent, writes an `audit_logs` row, and **refuses**
(`seller_only_never_converted`, `retailer_not_approved`) rather than widening access.

**Every decision leaves evidence.** Each row updated by block 7 gets an `audit_logs` entry carrying
`source='migration 0110'`, the before/after `role` and `is_active`, and a human-readable reason. The
rollback reverses the re-role by reading that marker, so it can never demote a genuine retailer. The
final `NOTICE` reports all three counts plus promoted/deactivated totals.

### Safety properties

* **Forward-only.** No applied migration was edited. `0105` was regenerated (not edited after
  application) — 0104/0105 have never been applied to the hosted project, per
  `docs/PR134_FINAL_REVIEW_2026-11-15.md`, so regenerating it is safe.
* **Idempotent.** Every statement is guarded by `to_regprocedure` / `to_regclass` /
  `drop policy if exists` / `create or replace`. A second application is a verified no-op — this was
  a real bug caught by the test suite (`policy "seller_offers_admin_update" ... already exists`) and
  fixed before commit.
* **Self-verifying.** Block 8 fails loudly if a revoke silently missed, which is how the wrong
  signature for `reserve_seller_invite` was caught during development.

---

## 5. Two things that must NOT be revoked (learned the hard way)

### 5.1 `is_member_of_seller(uuid)` and `is_active_seller_member(uuid)`

The first draft revoked both. Migration application then failed with:

```
error: permission denied for function is_member_of_seller
```

Cause: live RLS policies from **0062, 0063, 0086 and 0109** still *call* these predicates. A policy
that calls a revoked function **raises** instead of evaluating to `false`, which breaks unrelated
reads and can abort a migration. They are therefore kept, and this is safe:

* both are read-only predicates ("is the caller a member of this seller");
* `0110` deactivates every seller-role profile, so both return `false` for every caller;
* 0109's preflight needs `is_active_seller_member` to remain resolvable.

The actual access was removed by the policy changes in block 6, not by these predicates. The
migration carries this explanation inline so a future reader does not "tidy" it away.

### 5.2 Administrative update paths

Also learned from the suite: dropping `suppliers_admin_update` and `seller_members_admin_*` broke
`phase-2d1-compliance-flow-db` and the 0109 moderation-audit trigger. A Super Admin must still be able
to annotate a historical supplier row, correct a membership, and reject/modify a historical offer so
`product_moderation_history` keeps appending. Only the **seller self-service** policies were removed.

---

## 6. Rollback script

`supabase/rollbacks/0110_retire_seller_supplier_marketplace.down.sql` — **review only, not applied
anywhere.**

It restores:

* the verbatim 0072 `handle_new_user()` (including the invitation-consuming branch);
* the `staff_account_invites` role check;
* every revoked EXECUTE grant to authenticated (and the supplier funnel to `anon`);
* the `supplier-documents` bucket policies;
* the pre-0110 bodies of every dropped policy.

It does **not** silently restore seller logins: block 7 is gated behind
`maharani.reactivate_seller_profiles = 'true'`. A test asserts that after running the rollback,
seller profiles remain inactive and the grants are back.

With the opt-in set, the reversal is **surgical**: it first returns the accounts 0110 itself
promoted (`audit_logs.new_data->>'source' = 'migration 0110'`, `old role=seller`, `new role=retailer`)
to `role='seller'`, and only then re-activates the `seller`-role profiles. A retailer that was never a
seller carries no such marker and is therefore never demoted. The block-9 helper is dropped, so no
re-role path outlives the migration. Three tests cover this: plain rollback leaves the profile alone,
opt-in rollback reverses the re-role and spares the genuine retailer, and the audit trail is only ever
appended to.

**Order matters:** roll back the application first, then run this script. Never the other way round —
the rollback re-opens RPCs that the application no longer restricts.

---

## 7. Production actions NOT performed

| Action | Performed? |
| --- | --- |
| Apply `0110` to `fhrmsrumsraprvutrpeo` | **No** |
| `supabase db push` | **No** |
| Repair production migration history | **No** |
| Change production Auth / SMTP / env / Storage policy | **No** |
| Delete any production row or table | **No** |
| Access legacy project `gbxhmffsbsfhdrfuwurx` | **Never** |
| Merge the PR | **No** |

The verification notice `0110` will print on the real database
(`retired seller profiles=N, newly deactivated=M`) is the owner's first review artefact. If any
deactivated account is a real person who also trades legitimately, the owner must deliberately create
or re-approve a retailer account — this migration will not invent one.
