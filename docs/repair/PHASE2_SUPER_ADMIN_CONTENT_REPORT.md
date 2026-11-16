# Phase 2 — Super Admin, Admin Dashboard, Website Content Management, Secure Bootstrap

**Branch:** `arena/a1a3a8cb-maharani-mart`
**Pull request:** [#136](https://github.com/mahakali108/Maharani-mart/pull/136) (open, not merged)
**Base commit:** `b2143e7be5c8dfb065a9475e29bdf9d8c76cdb48` (= merge commit of PR #135)
**Report date:** 2026-11-16
**Production touched:** **no.** No migration applied, no auth setting changed, no account created, no page published, no environment variable changed, no deployment made.

---

## 1. Starting main commit

| Item | SHA | Note |
| --- | --- | --- |
| `main` HEAD at start | `b2143e7be5c8dfb065a9475e29bdf9d8c76cdb48` | `Merge pull request #135 from mahakali108/arena/8b4db142-maharani-mart` |
| PR #135 head | `167346c53b2955e4190785976992939bbba35ea9` | already merged into `main` before this branch was cut |
| This branch base | `b2143e7be5c8dfb065a9475e29bdf9d8c76cdb48` | identical to `main` HEAD |

`git cat-file -t 167346c5…` fails locally (the object is not in this shallow
checkout), so the PR head is evidenced from the GitHub API rather than from the
local object store. Stated plainly so nobody reads the SHA as locally verified.

---

## 2. Phase 1 verification result — **PASS**

Verified on the exact base SHA `b2143e7…`, not on an earlier run.

| Gate | Result | Evidence |
| --- | --- | --- |
| Web CI (`typecheck`, `lint`, `test`, `build`) | **success** | Actions run for `b2143e7…`, conclusion `success` |
| Production probe | **success** | same commit |
| Vercel (status context) | **success** | `vercel.com/mahakali108s-projects/maharanitraders` |
| `Supabase Preview` | **failure** | *"Remote migration versions not found in local migrations directory"* — see §4; pre-existing, documented, not a web-gate failure |
| Local `typecheck` | **PASS** | `tsc --noEmit`, no output |
| Local `lint` | **PASS** | `eslint .`, clean |
| Local full test suite (base) | **PASS** | 225 files / **3417** tests |
| Local `build` | **PASS** | Next.js production build |

### Migration 0107 review — accepted

`0107_restore_cost_price_column_lockdown.sql`:

* revokes table-level `SELECT` on `public.products` from `public, anon,
  authenticated`, then re-grants **column-level** `SELECT` on every column
  except `cost_price`;
* pins `search_path` on `admin_product_cost(uuid)`;
* replaces `inventory_product_totals` as `security_invoker` and reads purchase
  cost only through the admin-gated `admin_product_cost()` accessor.

**The public catalogue still reads `products`.** Verified, not assumed: the
column list is computed from `pg_attribute` at run time, so every non-cost column
is granted; and `tests/security-advisor-remediation-db.test.ts` →
*"keeps products.cost_price hidden while preserving anonymous and authenticated
catalogue reads"* executes `select id from public.products` as `anon` and asserts
`has_column_privilege('anon','public.products','cost_price','SELECT') = false`.

**No migration was applied to production.** Read-only `list_migrations` on
`fhrmsrumsraprvutrpeo` returns a history ending at `20261115155706`
(`0103_security_advisor_remediation`). `0104`, `0105`, `0106`, `0107` and the new
`0108` are **absent**. Confirmed by the connector, not by reading the repository.

---

## 3. PR #135 status — **MERGED**

`state = MERGED`, `mergedAt = 2026-11-16T13:46:29Z`, base `main`, head
`arena/8b4db142-maharani-mart`. Its checks on the PR head: Web CI `SUCCESS`,
Vercel `SUCCESS`, Vercel Preview Comments `SUCCESS`, Supabase Preview `SKIPPED`.
No failing check was merged. No action taken on it in this phase.

---

## 4. Supabase Preview failure — diagnosed, not a code defect

The integration reports:

```
Remote migration versions not found in local migrations directory.
```

Cause: the live history records `0103` under the CLI timestamp
**`20261115155706`**, while the repository file is
`0103_security_advisor_remediation.sql`. The Supabase GitHub integration compares
remote history to local filenames and treats the timestamped row as missing.

| | |
| --- | --- |
| Pre-existing? | **Yes.** Already documented in `docs/0104_0105_MIGRATION_AUDIT.md` §R3, `docs/PR134_FINAL_REVIEW_2026-11-15.md` L328–334, `docs/release/PHASE4_REPORT_2026-11-16.md` L27. |
| Effect on the web gate | **None.** Web CI, the production probe and Vercel are all green on the same SHA. |
| Correct fix | **None from the repository.** Deleting or renaming the file, or rewriting `supabase_migrations.schema_migrations`, would corrupt evidence of how 0103 was applied. |
| Who must decide | The owner — either disable the Supabase Preview integration, or accept the warning. Renaming `0103_*.sql` to a timestamp would make the *repository* match the remote but would make the file order non-deterministic for `createMigratedDb()`, which sorts by filename. **Not done.** |

This is recorded as a **known, accepted CI warning**, not as a repaired check.
It is not claimed green.

---

## 5. Files inspected

<details>
<summary>Application (42)</summary>

`middleware.ts`, `lib/auth/roles.ts`, `lib/permissions/permissions.ts`,
`lib/admin/guard.ts`, `lib/admin/control-center/guard.ts`,
`lib/admin/control-center/actions.ts`, `lib/admin/control-center/types.ts`,
`lib/admin/team-actions.ts`, `lib/admin/dashboard/{data,compute,types,range,visibility}.ts`,
`lib/admin/site-content-actions.ts`, `lib/admin/business-settings/server.ts`,
`lib/site-content/{types,queries,render,nav,draft-preview}.ts(x)`,
`lib/legal/{content,documents}.ts`,
`app/admin/content/page.tsx`, `app/admin/content/[id]/page.tsx`,
`app/admin/content/[id]/preview/page.tsx`, `app/admin/content/business/page.tsx`,
`app/admin/control-center/page.tsx`, `app/admin/control-center/client.tsx`,
`app/admin/control-center/users/[id]/{page,client}.tsx`,
`app/admin/dashboard/page.tsx`, `app/about/page.tsx`, `app/contact/page.tsx`,
`app/legal/page.tsx`, `app/legal/[slug]/page.tsx`,
`components/legal/{managed-page,public-info-shell}.tsx`,
`components/admin/site-content/content-notice.tsx`,
`components/layout/admin-shell.tsx`, `types/database.types.ts`
</details>

<details>
<summary>Database (18)</summary>

`0001_init`, `0020_super_admin_control_center`, `0025_cost_price_column_lockdown`,
`0052_phase0_security_hardening`, `0072_super_admin_seller_invitations`,
`0078_privilege_hardening`, `0095_legal_acceptance_and_privacy_requests`,
`0098_seller_agreement_and_marketplace_gate`,
`0102_anonymous_read_policies_fail_closed`, `0103_security_advisor_remediation`,
**`0104_site_content_management`**, **`0105_seed_site_content`**,
**`0106_first_super_admin_bootstrap`**, **`0107_restore_cost_price_column_lockdown`**,
rollbacks for 0104/0105/0106, `supabase/publication/stage1_publish_live_text.sql`,
`stage2_publish_reviewed_additions.sql`
</details>

<details>
<summary>Tests and docs (19)</summary>

`tests/helpers/{pg-harness,migration-reservations}.ts`,
`tests/site-content-{db,admin,seed,release,continuity,editor-reads,public,footer-nav}.test.ts(x)`,
`tests/super-admin-bootstrap-db.test.ts`,
`tests/security-advisor-remediation-db.test.ts`,
`tests/simplified-pack-stock-db.test.ts`,
`tests/migration-catalog-invariants.test.ts`,
`tests/migration-reservations.test.ts`,
`tests/dashboard-upgrade.test.ts`, `tests/control-center.test.ts`,
`docs/audit/MAHARANI_TRADERS_COMPLETE_A_TO_Z_AUDIT.md`,
`docs/repair/PHASE1_CRITICAL_REPAIR_REPORT.md`,
`docs/0104_0105_MIGRATION_AUDIT.md`, `docs/PR134_FINAL_REVIEW_2026-11-15.md`
</details>

### What was executed, not merely read

Every "cannot" in this report is either an executed statement against a real
PostgreSQL 16 (PGlite) migrated database with real `anon`/`authenticated` roles
and JWT subjects, or a direct read of the live project. Where a claim could only
be reviewed (not executed), it says so.

---

## 6. Files changed

| File | Change |
| --- | --- |
| `supabase/migrations/0108_publishing_integrity.sql` | **new** — closes two evidence-integrity defects (§8) |
| `supabase/rollbacks/0108_publishing_integrity.down.sql` | **new** — reverses 0108 without changing what customers read |
| `lib/admin/control-center/user-admin-rules.ts` | **new** — pure, testable authorization rules for user management |
| `lib/admin/control-center/actions.ts` | write errors now surface; self-targeting and `super_admin` escalation refused; reasons required; access days bounded |
| `app/admin/control-center/users/[id]/client.tsx` | removed the Super Admin option + escalation dialog; every action now reports success/failure |
| `lib/admin/site-content-actions.ts` | **new** `restoreRevisionAction` (draft-only rollback, audited) |
| `lib/site-content/draft-preview.ts` | **new** `revisionToDraft` / `revisionSummary` with full re-validation |
| `lib/site-content/queries.ts` | `updated_by`/`published_by`/`reviewed_by` selected; `loadActorNames()` |
| `lib/site-content/types.ts` | attribution fields typed |
| `app/admin/content/[id]/page.tsx` | "last modified by", revision summary + restore UI, unpublish confirmation |
| `components/admin/site-content/content-notice.tsx` | `restored` notice |
| `tests/publishing-integrity-0108-db.test.ts` | **new** — 14 DB tests |
| `tests/site-content-role-matrix-db.test.ts` | **new** — 27 DB tests, full role matrix + injection surface |
| `tests/site-content-revision-restore.test.ts` | **new** — 13 tests |
| `tests/user-admin-authorization.test.ts` | **new** — 22 tests |
| `tests/site-content-admin.test.ts`, `tests/site-content-db.test.ts` | fixtures/expectations updated |
| `docs/repair/PHASE2_SUPER_ADMIN_CONTENT_REPORT.md` | **new** — this file |
| `docs/repair/SUPER_ADMIN_FIRST_BOOTSTRAP_GUIDE.md` | **new** — owner procedure |

No unrelated feature was modified. No file was reset, stashed, discarded or
force-pushed.

---

## 7. Super Admin security findings

### Verified sound (executed)

| Control | Where | Evidence |
| --- | --- | --- |
| Role hierarchy is an explicit allow-list, not a rank guess | `lib/auth/roles.ts`, `lib/permissions/permissions.ts` | `ROLE_ROUTE_PREFIXES`, `ROLE_PERMISSIONS` |
| `/admin/*` is middleware-restricted to `super_admin`/`admin` | `middleware.ts` | role gate before render |
| Page guards redirect, action guards throw | `lib/admin/guard.ts`, `lib/admin/control-center/guard.ts` | `requirePagePermission` → `/unauthorized`; `requirePermission`/`requireSuperAdmin` throw |
| A plain `admin` cannot open Super Admin screens | `requireSuperAdminPage()` on `/admin/content*`, `/admin/control-center*` | executed: `is_super_admin()` returns `false` for `admin` |
| A retailer/seller/staff cannot read **any** site-content table | 0104 policies | executed, 3 roles × 4 tables, all zero rows |
| A retailer/seller/staff cannot write any site-content row | 0104 policies + grants | executed, `affectedRows = 0` |
| An ordinary user cannot promote themselves | `guard_profile_privileged_columns()` (0052) | executed in `security-phase0-db.test.ts`; unchanged |
| No API caller can insert a privileged profile | `guard_profile_role_insert()` (0106) | executed in `super-admin-bootstrap-db.test.ts` |
| Publishing is Super-Admin-only, twice | RPC check **and** RLS policy | executed: `admin` gets *"Only a Super Admin can publish"* |
| Admin audit rows are preserved and Super-Admin-readable | 0020 policies | `super_admin_audit_logs` read policy = `current_user_role() = 'super_admin'` |

Frontend role checks are **not** relied on anywhere: every one of the above is
re-enforced by RLS, a trigger, or a `SECURITY DEFINER` check.

---

## 8. Bootstrap audit (0106) — **VERIFIED, not executed**

Findings and evidence in
[`SUPER_ADMIN_FIRST_BOOTSTRAP_GUIDE.md`](./SUPER_ADMIN_FIRST_BOOTSTRAP_GUIDE.md)
§2. Summary of the ten required properties:

| # | Requirement | State |
| --- | --- | --- |
| 1 | Only the database-owner process creates the first Super Admin | `session_user in ('postgres','supabase_admin')`; PostgREST connects as `authenticator` |
| 2 | `anon`/`authenticated` cannot call it | `revoke all … from public, anon, authenticated, service_role`; executed test |
| 3 | `service_role` cannot bypass it | no `EXECUTE`, no write on the allowlist; executed test |
| 4 | Owner e-mail must be explicitly confirmed | `email_confirmed_at IS NOT NULL` + address equality |
| 5 | Allowlist is one-time and tightly restricted | `check (id = 1)`, `consumed_at`/`consumed_profile_id` pair |
| 6 | Bootstrap events are append-only | no insert/update/delete grant to any API role |
| 7 | Duplicate attempts fail safely | refuses if **any** `super_admin` exists; second call raises `23505` |
| 8 | No privilege escalation via RPC/direct API | §7 matrix + §8 triggers |
| 9 | No default/hardcoded owner account | none in the repository; allowlist starts empty |
| 10 | Auditable and recoverable | event row + `0106` rollback that never demotes |

**No production account was created and the bootstrap was not executed.**

---

## 9. Admin content management status — **COMPLETE** (code), **BLOCKED** (live)

`/admin/content` was reported broken/blocked in the audit. Two distinct causes
were found:

1. **Blocked by data, not code.** `is_super_admin()` is true only for a row in
   `profiles` with `role = 'super_admin'`. The live project has **zero** such
   rows, so every content screen correctly redirects to `/unauthorized`. That is
   the authorization working, and the reason §8 exists.
2. **Blocked by schema.** `0104`/`0105` are not applied, so `site_pages` does not
   exist and `loadAdminPages()` returns `null` → the honest empty state.

Editor capabilities, all present and exercised:

| Requirement | State |
| --- | --- |
| Page list | `/admin/content` — 19 seeded pages, status, address, version, review state |
| Title and slug | editable; slug locked for `is_system` pages by trigger |
| Rich text / safe structured content | paragraph + bullet blocks; **no raw HTML** — `renderRichText` only linkifies `[text](href)` and `[text](tel:/mailto:)` with `isSafePublicLink()` |
| Draft saving | yes — never touches the live page |
| Preview | `/admin/content/[id]/preview`, rendered through the **public** component with an admin-only banner, `noindex` |
| Publish / unpublish | `publish_site_page()` / `unpublish_site_page()`; unpublish now needs an explicit confirmation disclosing the customer impact |
| Revision history | append-only `site_page_revisions` |
| Last modified timestamp + who | **added in this phase** (`updated_by` + `loadActorNames()`) |
| Validation before publishing | `draftIssues()` blocking list **and** the RPC's own checks |
| Safe rollback to an earlier revision | **added in this phase** — restores into the **draft** only, re-validated, audited |
| Mobile responsive | existing design system, tables scroll, forms stack |
| Loading / empty / error / success | `ContentNotice`, empty states, `throwIfReadFailed()` → error boundary retry |
| Publishing is server-side authorized | yes, twice (§7) |
| XSS / script injection | structured fields only; `isSafePublicLink()` rejects `javascript:`; React escapes output; `pageSettingsSchema`/`sectionSchema` cap lengths |
| Draft/publication separation | executed: `anon` cannot read a draft column of a **published** page; `unpublished` returns nav label + message and **no** content |
| No existing draft auto-published | `0105` seeds 19 pages as drafts — verified: `published = 0` |

**Not done, deliberately:** no page was published. All 19 remain drafts.

---

## 10. User management status — **COMPLETE** (after repair)

Three real defects were found and fixed.

### Defect A — silent failure recorded as success (fixed)

`changeUserRole` ran:

```ts
await supabase.from('profiles').update({ role: newRole, … }).eq('id', userId);
// error never checked
await logSuperAdminAction(user.id, userId, 'ROLE_CHANGED', { role: oldRole }, { role: newRole }, reason);
```

Supabase returns `{ error }` instead of throwing. A refusal by
`guard_profile_privileged_columns()` (0052) was therefore swallowed **and**
followed by a `ROLE_CHANGED` audit row asserting a change that never happened —
worse than no audit, because it is false evidence. `suspendUser` and
`reactivateUser` had the same shape.

Fixed with `assertWrite(error, what)` before every audit call; the ordering is
asserted by `tests/user-admin-authorization.test.ts` (*"checks the write result
before recording it as a success"*).

### Defect B — a `super_admin` escalation path in the UI (fixed)

The role dropdown offered `<option value="super_admin">`, branching to a
confirmation dialog that called `changeUserRole(id, 'super_admin')`. There was
also a dead branch (`if (newRole === 'super_admin') { /* nothing */ }`) that read
as an authorization check but enforced nothing.

Removed: the option, the dialog, and the dead branch. `ASSIGNABLE_ROLES` excludes
`super_admin`; `assertRoleChangeAllowed()` additionally refuses to edit an
existing Super Admin or a no-op. Creating a Super Admin now has exactly one
documented path — the 0106 bootstrap — or an explicit team action.

### Defect C — every refusal was invisible (fixed)

`app/admin/control-center/users/[id]/client.tsx` awaited Server Actions inside
`startTransition` with no `try`/`catch`. A thrown *"Record why you are
suspending…"* or *"You cannot change your own role"* reached React as an
unhandled rejection and the operator saw a button that did nothing. Every call
now routes through `run()`, which shows `role="alert"` on failure and
`role="status"` on success, and rethrows Next's redirect/notFound sentinels.

### Also hardened

| Change | Why |
| --- | --- |
| `assertNotSelf` on role/suspend/reactivate/access | the database already refuses self-role-change; the UI now says so in words instead of a raw trigger denial |
| `assertReason` (≥ 4 chars, capped at 500) | audit rows need a reason an auditor can read later |
| `assertSuspensionAllowed` / `assertReactivationAllowed` | "reactivate" on an active account used to write a `USER_REACTIVATED` row describing a change that did not happen |
| `assertAccessDays(1…365)` | a typo of `3650` granted a decade of access; the UI passes `accessDays ?? 365` |
| `grantAccess` closes the previous period **fatally** | two simultaneously `active` access rows made the effective state ambiguous |

### Capabilities

View users, search (name/phone/id), filter by role, view profile + role, suspend
and reactivate with confirmation, extend/expire access, feature overrides,
per-user audit history `getUserManagementView().recentActivity` — all present.

**Not implemented, by instruction:** destructive user deletion (needs a separate
retention/compliance policy), and self-service Super Admin creation.

---

## 11. Dashboard data verification — **VERIFIED**

`app/admin/dashboard/page.tsx` → `requirePagePermission('dashboard.view')` →
`dashboardVisibility(user.role)` → `gatherDashboardData(supabase, range)`.

* Every read is a real table through the **cookie-bound RLS client** — never the
  service-role key: `orders`, `order_items`, `products`, `product_packs`,
  `retailers`, `profiles`, `brands`, `categories`, `warehouses`,
  `inventory_product_totals`, `inventory_expiry_report`, `return_requests`,
  `support_tickets`, `payment_collections`, `retailer_wallet_ledger`,
  `notification_logs`, `audit_logs`.
* No demo/mock/fixture branch and no hardcoded statistic exists in
  `compute.ts`; empty reads produce `status: 'empty'` and render an honest empty
  state (`compute.ts` L252, L277).
* Revenue is summed from `order_items` for the selected range, with a
  previous-period comparison; it is not a stored or invented number.
* Visibility is per-role (`dashboardVisibility`), so a role without a permission
  never receives the section — financial and customer data are not shown to
  unauthorized roles.

**With the live database at zero records the dashboard shows zero and an empty
state.** That is the correct behaviour and was not "fixed" into sample data.

---

## 12. Migration review

| Migration | Verdict |
| --- | --- |
| `0104_site_content_management` | **Sound.** Tables before grants before RLS; every policy preceded by `if exists` drop (re-runnable in the non-transactional Dashboard editor); every `SECURITY DEFINER` function pins `search_path = public, pg_temp`; `is_super_admin()` revoked from `anon`; draft columns have **no** `anon` grant; `site_page_revisions` is select-only for API roles; publishing paired with a `published_snapshot` check constraint. |
| `0105_seed_site_content` | **Sound.** Idempotent (`select … where slug` then insert-if-missing); seeds **drafts only**; verified `19 pages / 70 sections / 19 notes / 0 published`. |
| `0106_first_super_admin_bootstrap` | **Sound** — §8. |
| `0107_restore_cost_price_column_lockdown` | **Sound** — §2. |
| **0108_publishing_integrity** (new) | Fixes §13 defects 1–2. Ordered after 0107; depends only on 0104. Rollback shipped. |

Dependency order is `0104 → 0105 → 0106 → 0107 → 0108`, and 0108's preamble
raises if 0104 is absent. No already-applied production migration was rewritten.
`0104`/`0105`/`0106` were **not** modified — the defects were fixed forward in a
new file, which is the only safe option once a migration may be applied.

---

## 13. Security defects found and fixed

Both require an authenticated **Super Admin** to exploit; both falsify evidence,
which is the whole point of the content module. Both were **reproduced** against
a migrated database before being fixed.

### Defect 1 — an approval could be attributed to somebody who did not give it

`site_page_admin_notes.reviewed_by` was caller-supplied and unchecked against
`auth.uid()`. Reproduced on the 0104 schema:

```sql
-- signed in as Super Admin A
update public.site_page_admin_notes
   set review_status = 'owner_approved',
       reviewed_by  = '<Super Admin B>',   -- never signed in
       reviewed_at  = now()
 where page_id = '<terms>';
-- succeeded; the record said B approved the legal wording
```

Fix (0108 §1): `guard_site_page_admin_notes_author()` — a **non**-`SECURITY
DEFINER` trigger, because inside a definer function `current_user` is the owner
and the API-role test would never match (the exact trap 0106 documents). For
`anon`/`authenticated` it refuses any `reviewed_by` other than `auth.uid()`,
stamps `reviewed_at` itself so an approval cannot be back-dated, and keeps the
original approval time when notes are re-saved. Owner-run SQL keeps the ability
to record a historical attribution on purpose.

### Defect 2 — `published` with no snapshot and no history

`site_pages_super_admin_update` is a plain `FOR UPDATE` policy, so a direct
`UPDATE … SET status = 'published'` bypassed `publish_site_page()` entirely:

```sql
update public.site_pages set status = 'published' where slug = 'terms';
-- published_at/published_by stamped by the trigger, published_snapshot NULL:
-- /admin/content says "Published", published_pages() omits the page,
-- and site_page_revisions holds no record of the publication.
```

Fix (0108 §2): `guard_site_pages_publish_path()` binds the transition to the
**invariant** rather than to a caller list — a row cannot become `published`
without a non-null snapshot equal to `site_page_snapshot()` for that same page,
and cannot leave `published` unless the snapshot is cleared. The RPCs and the
reviewed owner-run scripts in `supabase/publication/` satisfy this already, so
the guard is invisible to them and closes the bypass. Asserted against the real
`stage1_publish_live_text.sql`, so the owner's documented path is proven to still
work.

---

## 14. RLS and permission review

| Object | `anon` | `authenticated` | `service_role` | Super Admin | Notes |
| --- | --- | --- | --- | --- | --- |
| `site_pages` | **no grant** | `select/insert/update/delete` + RLS `is_super_admin()` | all | read/write | draft columns unreachable by guests by **grant**, not by policy |
| `site_page_sections` | **no grant** | same | all | read/write | |
| `site_page_admin_notes` | **no grant** | same | all | read/write | 0108 pins `reviewed_by` |
| `site_page_revisions` | **no grant** | `select` + RLS | all | read | **no** insert/update/delete for any API role |
| `published_page(text)` | `execute` | `execute` | `execute` | — | returns the **snapshot** or a state record |
| `published_pages()` | `execute` | `execute` | `execute` | — | published only, `published_at <= now()` |
| `site_page_snapshot(uuid)` | revoked | revoked | `execute` | — | internal |
| `publish_site_page` / `unpublish_site_page` | revoked | `execute` (RPC re-checks) | `execute` | — | server-side check is the real gate |
| `is_super_admin()` | revoked | `execute` | — | — | |
| `super_admin_bootstrap_allowlist` | no grant | no grant | **select only** | — | owner writes it |
| `super_admin_bootstrap_events` | no grant | no grant | **select only** | — | append-only |
| `bootstrap_super_admin(uuid)` | no grant | no grant | **no grant** | — | owner only |

Verified by execution: `tests/site-content-role-matrix-db.test.ts` (27 tests)
and `tests/publishing-integrity-0108-db.test.ts` (14 tests).

---

## 15. Test counts

| | Files | Tests |
| --- | --- | --- |
| Base `b2143e7…` | 225 | 3417 |
| **This branch** | **229** | **3493** |
| Added | 4 | **76** |

New coverage:

| File | Tests | Proves |
| --- | --- | --- |
| `tests/site-content-role-matrix-db.test.ts` | 27 | the full role matrix (§14) on real PostgreSQL 16; injection surface |
| `tests/publishing-integrity-0108-db.test.ts` | 14 | both §13 defects closed; RPCs and stage-1 script still work; rollback |
| `tests/user-admin-authorization.test.ts` | 22 | no self-promotion, no `super_admin` escalation, write-before-audit ordering |
| `tests/site-content-revision-restore.test.ts` | 13 | rollback restores a **draft** only; history stays append-only |

Required Phase 2 security cases, and where each lives:

| Case | Test |
| --- | --- |
| anon cannot read drafts | role matrix — "cannot read a single draft table directly"; "cannot see the draft column of the page that IS published" |
| retailer / seller cannot access admin content | role matrix — `describe.each(['retailer','seller','staff'])` |
| staff cannot publish without permission | role matrix — "cannot publish or unpublish" |
| admin can perform only authorized actions | role matrix — "plain admin" block |
| only Super Admin can publish | role matrix + `site-content-db` — "only a super admin can publish or unpublish" |
| unauthorized user cannot bootstrap | `super-admin-bootstrap-db` — "is not executable by any API role" |
| no self-promotion | `user-admin-authorization` + `security-phase0-db` |
| no direct table privilege bypass | role matrix (grants) + `publishing-integrity-0108` (direct UPDATE) |
| no unsafe HTML / script injection | role matrix — "renders a script tag as inert text"; "never uses dangerouslySetInnerHTML in the content rendering path"; `site-content-admin` — `isSafePublicLink()` rejects `javascript:` |
| revision history cannot be altered | role matrix — no insert/update/delete grant; `site-content-revision-restore` |
| published content public only via approved endpoints | role matrix — `published_page()` / `published_pages()` |
| drafts never leak through APIs | role matrix — "answers 'unpublished' — never the draft text" (asserts exact key set) |
| admin audit records preserved | `user-admin-authorization` write-before-audit; 0020 read policy |

Every database test runs against **real PostgreSQL 16** via PGlite with the full
migration chain applied, real `anon`/`authenticated` roles and real JWT claims.
No Supabase client is mocked for the RLS, grant, trigger or `SECURITY DEFINER`
assertions.

**Harness limits, stated honestly:** PGlite is single-connection, so two
transactions cannot truly interleave; the `auth`/`storage` schemas are minimal
stubs, not GoTrue; and none of this says anything about the state of the hosted
project, which needs the owner-run audit SQL. Concurrency claims are therefore
asserted structurally, not concurrently.

---

## 16. CI result

**PR #136** — https://github.com/mahakali108/Maharani-mart/pull/136
**Where to read the verified result:** the PR's own **Checks** tab, on the head
SHA GitHub currently reports. That is the only place a head SHA can be quoted
without going stale the moment this file is committed — every commit of this
report changes the head, so any SHA written here would be wrong by the next push.
Read it from the API, not from the description:

```
gh api repos/mahakali108/Maharani-mart/commits/$(gh pr view 136 --json headRefOid --jq .headRefOid)/check-runs \
  --jq '.check_runs[] | "\(.name): \(.status) / \(.conclusion)"'
```

Every push on this branch was verified this way before the next one was made:

| Verified SHA | `Web checks` | `Vercel` | `Vercel Preview Comments` | `Supabase Preview` |
| --- | --- | --- | --- | --- |
| `c7b27dc` (code) | **success** (3m13s) | **success** | **success** | skipped |
| `bf5390e` (report) | **success** | **success** | **success** | skipped |
| `19a62e4` (report) | **success** | **success** | **success** | skipped |

`mergeable = MERGEABLE`. No push was made without the previous one being green.

| Local gate | Result |
| --- | --- |
| `typecheck` | **PASS** |
| `lint` | **PASS** |
| `test` | **PASS** — 229 files / 3493 tests |
| `build` | **PASS** |

Note on `Supabase Preview`: it reported **failure** on `main` (§4) and **skipped**
on this branch and on PR #135. The skipping behaviour depends on the
integration's push context, not on this branch's content — no migration was
applied either way, and the live history is unchanged (§18). Treating the
`main` failure as fixed would be wrong; the underlying timestamp mismatch is
still there and is still the owner's decision (§4).

---

## 17. Owner-only actions still required

1. **Confirm the owner e-mail address** to be used for the first Super Admin.
2. **Approve and apply** `0104`, `0105`, `0106`, `0107`, `0108` — one approval,
   in that order, transactionally (CLI or `begin; … commit;`). Nothing is applied.
3. **Create/confirm the owner login** (an existing, e-mail-confirmed account is
   required; the bootstrap does not create one).
4. **Insert the single allowlist row** (guide §6).
5. **Run `bootstrap_super_admin()` once** (guide §7) and archive the evidence.
6. **Decide on the Supabase Preview integration** — accept the documented warning
   or disable the integration (§4). Do not rewrite migration history.
7. **Publish content** — stage 1 (9 pages whose wording is already live) and
   stage 2 (10 new pages) are separate, reviewed owner decisions.
8. **Legal review** of Terms, Privacy, Returns, Shipping, Seller Agreement,
   Prohibited Products and the Grievance Officer wording before publication.
9. **Tax/legal readiness** before third-party marketplace selling is enabled
   (still disabled by `0098`'s gate).
10. **Retention/compliance policy** before any destructive user deletion is
    implemented.

---

## 18. Production actions NOT performed

* No SQL migration applied. Live history still ends at `20261115155706` (0103).
* No Supabase Auth setting read-modified; no setting changed at all.
* No Super Admin account created; no allowlist row inserted.
* No page published or unpublished; all 19 seeded pages remain drafts.
* No environment variable changed.
* No deployment, no merge, no force-push.
* No legal wording invented, no GSTIN/address/grievance detail altered.
* The legacy project `maharanimaa` (`gbxhmffsbsfhdrfuwurx`) was not touched.
* PR #125 not touched. No Android/Flutter/Play Store work performed.

---

## 19. Remaining blockers

| # | Blocker | Blocks | Owner action |
| --- | --- | --- | --- |
| B1 | `0104`–`0108` not applied to production | `/admin/content`, `/admin/control-center`, bootstrap, 0107 cost lockdown | approve + apply |
| B2 | Zero Super Admin accounts exist live | every Super-Admin screen (correctly redirects today) | bootstrap (guide) |
| B3 | `Supabase Preview` check reports a pre-existing false failure | a fully green check list | disable the integration or accept it |
| B4 | No page is published | `/about`, `/contact`, `/legal/*` show "not available" once 0104/0105 land | publish decision + legal review |
| B5 | Legal wording still `owner_review_pending` | publishing the 10 new pages | owner + Indian legal/tax review |
| B6 | Marketplace selling disabled | third-party sellers | legal/tax approval |

### Honest status

The code, migrations, tests and documentation for Phase 2 are complete and
verified locally. **Production readiness is not claimed:** the live database has
no site-content schema and no Super Admin, and those two facts are owner-gated by
design.
