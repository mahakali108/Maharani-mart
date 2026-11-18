# Migration 0109 — Dependency Failure Report & Owner Runbook

**Date:** 2026-11-17
**Migration under investigation:** `supabase/migrations/0109_phase3_business_control.sql`
**Official project (read-only audited):** `fhrmsrumsraprvutrpeo` (`Maharani-mart`, PostgreSQL **17.11**)
**Legacy project:** `gbxhmffsbsfhdrfuwurx` (`maharanimaa`) — NOT modified, NOT targeted.
**Production writes performed:** **NONE.** Every statement executed against the official
project during this investigation was a `SELECT`. No DDL, no DML, no `GRANT`/`REVOKE`,
no `supabase migration repair`, no `db push`, no deployment, no merge.

> ## ⚠ PRODUCTION MIGRATIONS 0104–0109 HAVE **NOT** BEEN APPLIED
>
> The official project `fhrmsrumsraprvutrpeo` is still at the **`0001`–`0103` baseline**.
> Its ledger holds 100 entries: `0001`–`0102` plus `0103` recorded as `20261115155706`.
> **`0104`, `0105`, `0106`, `0107`, `0108` and `0109` are absent** — verified read-only in
> block 3 of the diagnostic (99 `APPLIED` + 1 CLI-recorded `0103` + **6 `ABSENT`
> (`0104`–`0109`)** = 106 repository migrations).
>
> Consequences that are still live in production right now:
> * **`0107` is not applied**, so `authenticated` can still `SELECT`
>   `products.cost_price` (block 6: `0107 NOT IN FORCE`, `authenticated` exposed, `anon`
>   already locked by `0025`). The wholesale cost-price lockdown exists in the repository
>   only. Note the round-2 scope correction: `0107` revokes table-level `SELECT` from
>   **`anon` and `authenticated`**, so the pre-flight check now verifies **both**; on this
>   database only `authenticated` is the exposed role.
> * **`0109` is not applied**, so none of the Phase 3 control plane exists: no
>   `wholesale_pricing_rules`, `seller_pricing_permissions`, `product_wholesale_limits`,
>   `product_moderation_history`, `membership_program_settings`,
>   `membership_upgrade_requests`, `ad_program_settings`, `seller_ad_campaigns`,
>   `seller_ad_campaign_audit`.
> * **`0104`/`0106` are not applied**, so there is no managed site content
>   (`site_pages`) and no Super Admin bootstrap allowlist.
> * Because `0109` is not applied, the hardening it carries is **also not live**:
>   `can_current_staff_read_profile(uuid)` still lacks its caller-role guard and is
>   `EXECUTE`-able by `anon` (block 9), and `submit_supplier_application(...)` still has
>   no database-level rate limiter.
>
> **This change is review-only. It does not, and must not, make production
> ready. Nothing in this PR is production-ready deployment authorisation.**

---

## 1. The reported error, verbatim

```
ERROR: 42P01: MIGRATION ORDER VIOLATION: 0109 requires base catalog, seller, supplier,
              membership, banner and control-center tables (0001–0108).
CONTEXT: PL/pgSQL function inline_code_block line 15 at RAISE
```

## 2. What the two error lines prove

| Evidence | Conclusion |
|---|---|
| `line 15 at RAISE` | The executing text is the **current** guard. PR #137 revisions `3b4d0b0f` / `6cde4cde` / `af2e7f1e` / `e5ce852f` raise on **line 13** and their message does not contain the word *supplier*. The merged file (commit `a3bbdee` = `main` `9754725`) raises on **line 15**. Reproduced locally: dropping one relation produces `line 15 at RAISE` only for the merged version. |
| message names *supplier* | Confirms the merged text again — the older text reads "base catalog, seller, membership, banner and control-center". |
| `MIGRATION ORDER VIOLATION: 0109 requires base catalog …` (not "helper functions …") | The failing assertion is the **relation** block, not the function block. |
| `42P01` + `exec_stmt_raise` + `line 15` | The relation block raised. It raises only when at least one of its 12 `to_regclass()` calls returned `NULL` **for the connection that ran the script**. |

So the failure is a *relation* dependency of the current guard — never a helper function.

## 3. Exact production state (read-only, this session)

### 3.1 Migration ledger — 100 entries

`supabase_migrations.schema_migrations` contains `0001` … `0102` (with the documented
historical gaps `0061`, `0075`, `0076`) followed by exactly one CLI-style row:

| version | name | statements length | statements md5 | equals the repo file? |
|---|---|---|---|---|
| `20261115155706` | `0103_security_advisor_remediation` | 6296 bytes | `890894e96a8ebd1cedd5b838548b9fe2` | **YES** — `md5sum supabase/migrations/0103_security_advisor_remediation.sql` is identical |

`0104`, `0105`, `0106`, `0107`, `0108`, `0109` are **absent** from the ledger.

### 3.2 The 19 guard objects — all present today

| Required object | Kind | Created by | Status in `fhrmsrumsraprvutrpeo` |
|---|---|---|---|
| `public.products` | table | `0001_init` | PRESENT (oid 34010) |
| `public.banners` | table | `0001_init` | PRESENT (oid 34057) |
| `public.audit_logs` | table | `0001_init` | PRESENT (oid 34408) |
| `public.profiles` | table | `0001_init` | PRESENT (oid 33881) |
| `public.retailers` | table | `0001_init` | PRESENT |
| `public.product_packs` | table | `0004_product_packs` | PRESENT (oid 34476) |
| `public.super_admin_audit_logs` | table | `0020_super_admin_control_center` | PRESENT (oid 35348) |
| `public.product_pricing_tiers` | table | `0022_case_based_pricing` | PRESENT (oid 35418) |
| `public.suppliers` | table | `0059_supplier_applications` | PRESENT (oid 42387) |
| `public.supplier_application_rate_limits` | table | `0060_supplier_application_rate_limit` | PRESENT (oid 42457) |
| `public.sellers` | table | `0062_seller_identity` | PRESENT (oid 42481) |
| `public.seller_offers` | table | `0063_seller_offers` | PRESENT (oid 42584) |
| `public.seller_offer_tiers` | table | `0069_seller_portal_access` | PRESENT (oid 42953) |
| `public.membership_plans` | table | `0080_retailer_memberships_and_loyalty` | PRESENT (oid 43203) |
| `public.retailer_memberships` | table | `0080_retailer_memberships_and_loyalty` | PRESENT (oid 43235) |
| `public.is_admin_or_above()` | function | `0001_init`, hardened `0052` | PRESENT |
| `public.is_staff_or_above()` | function | `0001_init`, hardened `0052` | PRESENT |
| `public.current_user_role()` | function | `0001_init`, hardened `0052` | PRESENT |
| `public.is_retailer_area_assigned_to_current_staff(uuid)` | function | `0037_staff_scope_policies` | PRESENT |
| `public.is_active_seller_member(uuid)` | function | `0072_super_admin_seller_invitations` | PRESENT |
| `public.consume_supplier_application_rate_limit(text,text,integer,integer)` | function | `0060_supplier_application_rate_limit` | PRESENT |
| `public.log_audit()` | trigger fn | `0001_init`, hardened `0057` | PRESENT |

**19 / 19 predicates resolve. The guard cannot produce a relation-block failure on this
schema as it stands at the time of this report.**

### 3.3 The one thing that IS still pre-migration

| Probe | Value | Meaning |
|---|---|---|
| `has_column_privilege('authenticated','public.products','cost_price','SELECT')` | **`true`** | 0107 is **not** applied |
| `has_column_privilege('anon','public.products','cost_price','SELECT')` | `false` | |
| `products.description` exists | `false` | 0109 §1 not applied |
| `wholesale_pricing_rules`, `ad_program_settings`, `membership_program_settings`, `product_moderation_history` | absent | 0109 not applied |
| `site_pages`, `site_page_sections`, `site_page_revisions` | absent | 0104 not applied |
| `super_admin_bootstrap_allowlist` | absent | 0106 not applied |
| Data volumes | products 0, profiles 0, sellers 0, offers 0, suppliers 0, orders 0, banners 0, retailers 0, memberships 0; `membership_plans` 3 rows, all `is_active = false` | no business data at risk |

## 4. Result classification (requested categories A–F)

| Category | Verdict | Evidence |
|---|---|---|
| **A. 0001–0108 never applied** | **NO** | Ledger holds `0001`–`0102`; every base relation exists. |
| **B. Applied but objects missing** | **NO** (for all 19 guard objects, current state) | §3.2. |
| **C. Ledger inconsistent** | **PARTLY, and irrelevant to this error** | `0103` is stored as `20261115155706`. Its SQL is byte-identical to the repo file, its schema effects are present, and **0109's guard never reads the ledger**, so the timestamp has no causal role. |
| **D. Migration only partially applied** | **NO evidence** | Every object any applied migration (`0001`–`0103`) defines for the guard is present. No orphan/partial table found. |
| **E. Repository files do not match production schema** | **NO** for guard objects | 19/19 resolve; no object exists in a non-`public` schema. |
| **F. Dependency guard is incorrect / incomplete** | **YES — the only repository-side defect confirmed** | (1) 0109 §1 writes a column-level SELECT grant on the new `products.description` column specifically so 0107's `cost_price` lockdown keeps holding — but the guard never verified that 0107 ran. Applying 0109 without 0107 leaves `cost_price` readable by `authenticated` (proved locally, §6 T1). (2) The guard collapsed 12 relations into one opaque sentence, so the owner could not tell *which* object failed. |

### 4.1 Why the error could still have appeared for the owner

All 19 predicates resolve **now**, and the guard **passes** on the exact production
baseline (proved on real PostgreSQL 17.11, §6 T0). Two explanations remain, and the
diagnostic script in §8 decides between them in one read-only run:

1. **The SQL was executed against a different database.** The legacy project
   `gbxhmffsbsfhdrfuwurx` is a genuine match for this guard: **11 of the 12 relations
   exist and `supplier_application_rate_limits` (0060) is missing**, and
   `consume_supplier_application_rate_limit` is likewise absent. Replaying the merged
   guard on a 0001–0059 schema reproduces `42P01`, `line 15 at RAISE`, with this exact
   message (§6 T4). That is the only observed schema that reproduces the owner's output.
   *(1 SQL statement was run there — a `pg_class` catalog read — and nothing was changed.)*
2. **The schema changed between the attempt and this audit** (e.g. `0001`–`0103` were
   re-applied). OID/creation timestamps are not exposed by this connection, so this
   cannot be confirmed or excluded from here.

The two explanations are distinguished by **block 10** of the verification script
(`current_database()`, ledger entry count, postmaster start) and **block 1** (the 19-row
verdict) — see §8/§10.

## 5. Do `0104`–`0108` need to be applied?

**`0104`, `0105`, `0106`, `0107`, `0108` are all unapplied and must be applied, in that
order, before `0109`.** `0107` is not optional: it is the migration that revokes
table-level `SELECT` on `products` and re-grants every column **except** `cost_price`,
and `0109` §1 extends exactly that column grant.

Proved on real PostgreSQL 17.11 (§6):

| Run | Sequence | 0109 result | `authenticated` can read `cost_price` afterwards |
|---|---|---|---|
| T1 | `0109` alone on baseline `0103` | **applies** | **`true` — exposed** |
| T3 | `0104,0105,0106,0108,0109` (0107 skipped) | **applies** | **`true` — exposed** |
| T2 | `0104 → 0105 → 0106 → 0107 → 0108 → 0109` | applies | **`false` — locked** |

`0109` is therefore **ordering-safe but not order-independent**. The new guard now
refuses T1 and T3 with an explicit statement of the problem instead of silently leaving
wholesale cost prices readable by every signed-in user.

## 6. Local reproduction (real PostgreSQL 17.11, disposable cluster)

Binary: `@embedded-postgres/linux-x64@17.11.0-beta.19` → `postgres (PostgreSQL) 17.11`,
matching the production server version reported by `current_setting('server_version')`.
Nothing here connects to Supabase.

| Run | Setup | Result |
|---|---|---|
| **T0** | `0001`–`0102` + `0103` (exact production baseline), then the **merged (pre-fix)** `0109` | **0109 applies.** 19/19 guard predicates present. Confirms the guard is not the cause on this schema. |
| **T1** | production baseline → `0109` (skipping `0104`–`0108`) | applies; **`cost_price` left exposed** |
| **T2** | production baseline → `0104`,`0105`,`0106`,`0107`,`0108`,`0109` (with production's 3 `membership_plans` rows seeded) | all six apply; `cost_price` locked for `authenticated` and `anon`; `description` readable; `membership_program_settings.program_enabled = false`, `live_payment_collection_enabled = false`, `ad_program_settings.seller_ads_enabled = false`, live payment collection `false`; plans stay `is_active = false`, `expiry_behavior = immediate_stop`, `renewal_mode = manual_owner_approval` |
| **T3** | same chain with `0107` skipped | applies; **`cost_price` left exposed** |
| **T4** | `0001`–`0059` (legacy-project shape) → merged `0109` | **`42P01`, `PL/pgSQL function inline_code_block line 15 at RAISE`**, message identical to the owner's report |
| **L1**–**L4** | merged guard with one relation dropped (`sellers`, `banners`, `super_admin_audit_logs`, `retailer_memberships`) | all raise `line 15 at RAISE`; zero partial Phase 3 tables created |
| **V1** | obsolete PR revision (`3b4d0b0f`) with a relation dropped | raises **`line 13 at RAISE`** — excludes the older text |
| **P1** | guard run as a role without `USAGE` on `public` | fails with `42501 must be owner of table products`, **not** `42P01` — excludes "the runner lacked privileges" |

### 6.1 Behaviour of the fixed guard (real PostgreSQL 17.11)

| Scenario | Result |
|---|---|
| production baseline `0103` → `0109` before `0107` | `42501` **MIGRATION ORDER VIOLATION: 0109 must run AFTER 0107_restore_cost_price_column_lockdown** … "Apply 0104 -> 0105 -> 0106 -> 0107 -> 0108 first", **zero** Phase 3 objects created |
| `0001`–`0059` → `0109` | `42P01` naming **all six** missing relations with their creating migrations |
| only `0060`'s table dropped | `42P01` naming **exactly** `public.supplier_application_rate_limits (from 0060_supplier_application_rate_limit)` |
| only the `0060` function signature changed | `42883` naming `public.consume_supplier_application_rate_limit(text,text,integer,integer) (from 0060_supplier_application_rate_limit)` — **not** reported as a table problem |
| `0104`…`0109` correct order | applies; second replay of `0109` applies again; singleton rows stay **1/1/1** (idempotent) |

### 6.2 Round-2 security review — both API roles, and a deterministic column check

Two review findings were raised against the first revision of this guard. Both were real;
both are now fixed and re-proved on the same disposable **PostgreSQL 17.11** cluster
(10 guard scenarios + 6 diagnostic scenarios, **16/16 pass**).

**Finding 1 — the pre-flight only asked about `authenticated`.**
`0107_restore_cost_price_column_lockdown.sql` revokes table-level `SELECT` on
`public.products` from `PUBLIC`, `anon` **and** `authenticated`, then grants column-level
`SELECT` for every column except `cost_price` to **both** API roles. The original probe
asked only `has_column_privilege('authenticated', …)`, so a database where **only `anon`**
had lost its lockdown would have been accepted. The check now builds the set of exposed
roles and names them:

```sql
select array_agg(role_name order by role_name)
  into v_cost_price_readable
  from unnest(array['anon', 'authenticated']) as role_name
 where has_column_privilege(role_name, 'public.products', 'cost_price', 'SELECT');
```

**Finding 2 — missing-column protection relied on boolean evaluation order.**
`has_column_privilege()` raises `42703 column "cost_price" … does not exist` when the column
is absent (measured, not assumed — see the table below). The old form was
`where <column-exists> and has_column_privilege(…)`, i.e. a single boolean expression whose
safety depends on `AND` short-circuiting. That is an evaluation detail, not a contract. The
guard is now three **sequential statements**: (1) `public.products` exists → else `42P01`
naming `0001_init`; (2) `cost_price` exists, read from `pg_catalog.pg_attribute` only →
else `42703` with an actionable message pointing at `0001_init -> 0025_cost_price_column_lockdown`;
(3) only then are the two `has_column_privilege()` calls made. No privilege function is
reachable while the column is unknown.

| Run (PostgreSQL 17.11) | Posture | Result |
|---|---|---|
| **C0** | production baseline `0001`–`0103` | `anon=false`, `authenticated=true` — recorded |
| **C1** | `authenticated` exposed only (live production shape) | `42501` **MIGRATION ORDER VIOLATION: … must run AFTER 0107…**; names `authenticated`; **0** Phase 3 tables created |
| **C2** | `anon` exposed, `authenticated` locked (new finding-1 case) | `42501`; names **`anon` only**; does **not** mention `authenticated` can still read |
| **C3** | `0104`…`0108` applied, both roles locked | `0109` applies; afterwards `cost_price` is `false/false`, `description` is `true` |
| **C4** | `products.cost_price` dropped (view `inventory_product_totals` dropped first) | actionable `42703 **MIGRATION ORDER VIOLATION: 0109 cannot verify the 0107…** because public.products.cost_price is missing … 0001_init -> 0025_cost_price_column_lockdown` — **not** the bare catalog error |
| **C5** | `public.products` dropped entirely | `42P01` from the relation block, which still fires first |
| **C6** | full ordered chain, then replay | applies, replay idempotent, singletons stay **1/1/1** |

How the drop was made real, and why the previous revision could not do it: on native 17.11
`alter table public.products drop column cost_price` fails `2BP01`, and the blocking
dependent is the **`public.inventory_product_totals`** view (a `pg_rewrite` rule referencing
`cost_price`) — dropping `admin_product_cost(uuid)` alone does **not** unblock it. After
`drop view public.inventory_product_totals` the column drop succeeds, and then an unguarded
`has_column_privilege(…)` raises exactly `42703 column "cost_price" of relation "products"
does not exist`. That measured sequence is what C4 pins.

**Diagnostic block 6** was updated to match, and now reports the exposed role set rather than
one boolean. Its verdict has four outcomes: `products TABLE MISSING`, `products.cost_price
MISSING`, `0107 NOT IN FORCE — <roles> can still SELECT …`, `0107 IN FORCE`. It also no longer
uses a boolean-`AND` guard: the privilege functions are reached through a
`left join lateral` over `pg_catalog.pg_attribute`, so with no such column there is no input
row and the projection never runs. Native 17.11 verification of the finished script:

| Run | Posture | Verdict |
|---|---|---|
| P1 | production baseline | `0107 NOT IN FORCE — authenticated can still SELECT …`, `cost_price_readable_by = authenticated` |
| P2 | `anon` only re-opened | `0107 NOT IN FORCE — anon can still SELECT …`, and **not** `authenticated` |
| P3 | both re-opened | `cost_price_readable_by = anon and authenticated` |
| P4 | `0104`…`0108` applied | `0107 IN FORCE — ordering satisfied for 0109`, `cost_price_readable_by = null` |
| P5 | `cost_price` missing | no raise; `products.cost_price MISSING — 0001_init/0025 never applied here` |
| S0 | static | 10 top-level statements, all `SELECT`/`WITH`; every block ran inside `begin read only` … `rollback` |

## 7. Repository changes made

1. **`supabase/migrations/0109_phase3_business_control.sql`** — §0 pre-flight guard
   rebuilt. **No dependency was removed or weakened**: the same 12 relations and 7
   functions with the same exact signatures are still required and still abort the
   migration before any DDL.
   * Every unmet object is now named together with the migration that creates it.
   * A 0107 ordering contract was **added** (`has_column_privilege(…)` must be `false`),
     so 0109 can no longer run before the lockdown it depends on.
   * **Round 2, finding 1:** that contract now checks **both** API roles — `anon` **and**
     `authenticated` — because `0107` revokes table-level `SELECT` from both and re-grants
     every column except `cost_price` to both. The exception message names the role(s) that
     are actually exposed, so a partial 0107 is diagnosable from the error alone.
   * **Round 2, finding 2:** the column-exists check no longer shares a boolean expression
     with `has_column_privilege()`. Three sequential statements (products exists →
     `cost_price` exists via `pg_catalog` → per-role privilege probe) make the `42703`
     protection a guarantee rather than a short-circuit side effect. A missing column now
     produces an actionable `MIGRATION ORDER VIOLATION` pointing at
     `0001_init -> 0025_cost_price_column_lockdown`, never the bare catalog error.
   * Both failure modes are proved on native PostgreSQL 17.11, not only by unit tests (§6.2).
   * The file header now documents the full object → migration matrix and the required
     order.
2. **`supabase/audits/0109_dependency_diagnostic_readonly.sql`** *(new)* — the read-only
   diagnostic in §8. Ten `SELECT`/`WITH`-only blocks. Validation, stated exactly:
   * AST check: 10 top-level statements, **0 non-`SELECT`**.
   * **All 10 blocks were executed against `fhrmsrumsraprvutrpeo` (PostgreSQL 17.11,
     `ledger_entries = 100`).** Provenance, per block, so the claim is auditable:
     | Block | Executed against production as | Result on production |
     |---|---|---|
     | 1 | the block text verbatim | 19 rows, all `PRESENT` |
     | 2 | verbatim | `19 / 19 / 0` → `GUARD SHOULD PASS …` |
     | 3 | verbatim; re-run with a `where r.version >= '0100'` display filter, then re-run wrapped in an aggregate over **all 106** repository rows | 99 `APPLIED` + 1 `0103` = `APPLIED (CLI-recorded … KNOWN)` + 6 `ABSENT` (`0104`–`0109`) = 106 |
     | 4 | verbatim | exactly 1 row: `20261115155706` / `KNOWN: CLI-recorded 0103` |
     | 5 | verbatim | 10 `PRESENT`, 6 `MISSING (migration not applied)` |
     | 6 | **the pre-round-2 text verbatim** (it returned `0107 NOT IN FORCE — apply 0104 -> 0105 -> 0106 -> 0107 -> 0108 before 0109`, derived from the `authenticated` probe). The round-2 revision, which also returns `anon_can_read_cost_price` / `cost_price_readable_by` and names the exposed role(s), was **not** run against production — it is verified on the disposable PostgreSQL 17.11 cluster only (runs P1–P5, §6.2). The owner re-runs block 6 in Step 2 below, which is where the new text is exercised on the real database. |
     | 7 | verbatim | 13 tables, all `rls_enabled = true` |
     | 8 | verbatim | 15 `PRESENT` + `products.description` `MISSING (expected — 0109 adds it)` |
     | 9 | verbatim | 9 rows (`get_retailer_membership_overview` / `super_admin_assign_membership` correctly absent pre-0109) |
     | 10 | verbatim | `postgres` / `17.11` / `ledger_entries 100` / highest ledger version `20261115155706` |
   * **Correction to an earlier draft of this section.** It said "blocks 1, 2, 5, 6, 7, 8,
     9, 10" were executed against production, implying blocks 3 and 4 had not been. That
     was wrong in both directions: block 4 *had* been executed, and blocks 3 and 5–9 had
     at that point only been executed as equivalent rewrites, not as the literal file
     text. The table above is the corrected record; every block has now been run against
     production.
   * Additionally, all 10 blocks were executed on a disposable **PostgreSQL 17.11**
     cluster at the exact production baseline **inside a single `set transaction read only`
     transaction** — no block raised. The round-2 revision was re-run the same way (inside
     `begin read only` … `rollback`) and additionally under five further postures — P1–P5
     in §6.2 — with no block raising in any of them.
   * Its embedded repository list is checked against `supabase/migrations` (106/106
     versions, zero name mismatches) — see the test in item 4.
3. **`tests/migration-0109-dependency-guard.test.ts`** *(new)* — **13** regression tests
   (dependency matrix vs. repository, named-relation reporting, wrong-signature
   reporting, zero-partial-object failure, idempotent replay, owner gates closed after a
   full rollout) plus the round-2 ordering block:
   * `authenticated` can read `cost_price` ⇒ reject;
   * **only `anon`** can read it while `authenticated` cannot ⇒ reject, and the message
     names `anon` and not `authenticated`;
   * neither role can read it ⇒ ordering check passes and 0109 applies;
   * `cost_price` genuinely absent ⇒ actionable `MIGRATION ORDER VIOLATION`, and the test
     first proves the raw call raises `42703` so the guard's value is demonstrated, not
     assumed.
   The earlier `42703` test **early-returned** on PGlite because it tried to drop the
   column without dropping the dependent `inventory_product_totals` view. That was not
   proof of anything. It has been replaced by the real scenario: drop the view, then the
   column — constructible in PGlite too, so the case is now genuinely executed.
4. **`tests/migration-0109-diagnostic-readonly.test.ts`** *(new)* — **5** tests: no write
   statement anywhere in the diagnostic; all blocks run unchanged on the live production
   baseline (`0001..0103`) and report `GUARD SHOULD PASS` / `0107 NOT IN FORCE` naming only
   `authenticated`; block 6 fails when **only `anon`** is exposed and flips to
   `0107 IN FORCE` when neither role is; block 6 stays read-only and non-throwing when
   `cost_price` is missing entirely; a genuinely missing dependency is reported as
   `MISSING (from 0060…)` instead of crashing.
5. **`docs/repair/MIGRATION_0109_DEPENDENCY_REPORT.md`** *(this file)*.

Nothing else was touched: no new migration number, no edit to `0104`–`0108`, no rollback
weakening, no security relaxation, no `CASCADE`, no destructive statement.

## 8. Owner actions (exact, in order)

### Step 1 — identify the database (read-only)

Run **block 10** of `supabase/audits/0109_dependency_diagnostic_readonly.sql`:

* confirm the dashboard header says **`fhrmsrumsraprvutrpeo`**;
* confirm `server_version` = `17.11` and `ledger_entries` = `100`.

If `current_database()` / the project header is not `fhrmsrumsraprvutrpeo`, you were in
the legacy project `gbxhmffsbsfhdrwurx`-class database: **stop**, open the official
project's SQL editor, and re-run. Never apply repository migrations to the legacy project.

### Step 2 — capture the 19-row verdict (read-only)

Run **block 1**, then **block 2**. `block 2` prints one of:

* `GUARD SHOULD PASS in this database — the reported 42P01 did not originate here`
  → the earlier attempt was not against this schema.
* `GUARD WILL FAIL here` → the named rows in block 1 are genuinely absent; that is the
  real dependency gap and must be fixed by applying the migration that creates them.

Also run **block 6** — it reports the 0107 ordering state.

### Step 3 — expected values on the official project today

| Block | Expected |
|---|---|
| 1 | 19 rows, all `PRESENT` |
| 2 | `objects_checked 19`, `present 19`, `missing 0`, `GUARD SHOULD PASS` |
| 3 | `0001`–`0102` = `APPLIED`; `0103` = `APPLIED` (ledger version `20261115155706`); `0104`–`0109` = `ABSENT` |
| 4 | one row: `20261115155706` / `0103_security_advisor_remediation` / `KNOWN: CLI-recorded 0103` |
| 5 | `0004`–`0080` objects `PRESENT`; `0104`, `0106`, `0109` objects `MISSING (migration not applied)` |
| 6 | `authenticated_can_read_cost_price = true` → **`0107 NOT IN FORCE`** |
| 7 | all 13 tables `rls_enabled = true` |

### Step 4 — reconcile `0103` (metadata only, only if you decide to use the CLI)

The ledger row is already correct in content. If you use `supabase db push`, the CLI will
classify `20261115155706` as a remote version it cannot map to a local file. Reconcile
**metadata only**, after re-confirming the md5 in §3.1:

```bash
supabase migration repair --status reverted 20261115155706
supabase migration repair --status applied  0103
```

This changes no schema and executes no SQL. **It is not required for `0109`** — `0109`'s
guard never reads the ledger. It is required only to make CLI-driven deploys see a clean
sequence.

### Step 5 — apply the pending chain, in this exact order, in one maintenance window

```
0104_site_content_management.sql
0105_seed_site_content.sql
0106_first_super_admin_bootstrap.sql
0107_restore_cost_price_column_lockdown.sql
0108_publishing_integrity.sql
0109_phase3_business_control.sql
```

Before the window: take a fresh backup. After `0108` and before `0109`, **block 6 must
report `0107 IN FORCE`**.

`0104`–`0106` and `0108` create objects (site content, bootstrap allowlist, actor
stamping); `0107` is the privilege lockdown; `0109` is the Phase 3 control plane. No run
in §6 needed anything outside this order.

### Step 6 — verify after `0109` (read-only)

Re-run blocks **1** and **6**, then:

```sql
select public.get_retailer_membership_overview(null);  -- expect 42501 for a non-retailer caller
select * from public.wholesale_pricing_rules;          -- expect exactly 1 row
select * from public.membership_program_settings;      -- expect program_enabled = false
select * from public.ad_program_settings;              -- expect seller_ads_enabled = false
select * from public.membership_plans;                 -- expect every is_active = false
```

## 9. Security properties preserved / re-verified

| Property | Where | Status |
|---|---|---|
| `can_current_staff_read_profile(uuid)` caller-role guard | 0109 §6.2 | unchanged, still `SECURITY DEFINER`, `search_path = pg_catalog, public, pg_temp`, `is_staff_or_above()` check |
| DB-level supplier-application rate limiting | 0109 §6.3 + `0060` | unchanged; wrong signature now reported explicitly |
| 13 internal trigger functions revoked from `public, anon, authenticated` | 0109 §6.1 | unchanged |
| `products.cost_price` lockdown | 0107 + 0109 §1 | **strengthened** — guard refuses to run before 0107, and (round 2) it now checks **both** API roles `anon` and `authenticated`, matching what 0107 actually revokes and re-grants |
| Column-existence failure mode | 0109 §0 step 2 | **strengthened** — a missing `products.cost_price` is read from `pg_catalog` metadata *before* any privilege function is called, so the `42703` protection is sequential, not boolean-short-circuit dependent |
| `products.description` column grant | 0109 §1 | unchanged; still column-level only |
| Seller governance / approval, MOQ & discount ceilings | 0062–0072, 0109 §2 | unchanged |
| Membership expiry & discount restrictions | 0109 §3 | unchanged; `immediate_stop`, `grace_period_days = 0`, 0 % after expiry |
| Banner / ad campaign security, owner gates closed by default | 0047/0074/0077, 0109 §4 | unchanged; verified `false` after full rollout (§6 T2) |
| Append-only audit records | 0001, 0020, 0109 §5 | unchanged |
| Rollback data-loss guards | `supabase/rollbacks/0109_…down.sql` | untouched |
| RLS on every Phase 3 table | 0109 | unchanged; all 13 pre-existing tables report `rls_enabled = true` in production |

## 10. Test evidence

| Suite | Result |
|---|---|
| Full repository suite, before changes | **237 files / 3626 tests passed**, 0 failed, 0 skipped |
| Full repository suite, after round 1 | **239 files / 3640 tests passed**, 0 failed, 0 skipped |
| **Full repository suite, after round 2** | **239 files / 3644 tests passed**, **0 failed, 0 skipped** |
| `tests/migration-0109-dependency-guard.test.ts` | **13 tests passed** (PGlite PostgreSQL 16) |
| `tests/migration-0109-diagnostic-readonly.test.ts` | **5 tests passed** (PGlite PostgreSQL 16) |
| Targeted run of only the two 0109 suites | **18 / 18 passed** |
| `pnpm typecheck` (`tsc --noEmit`) | exit 0 |
| `pnpm lint` (`eslint .`) | exit 0 |
| `pnpm build` | exit 0 |
| `tests/migration-validation-0103-to-0109-db.test.ts` | passes (baseline → 0104–0109, parity, idempotency, fail-fast) |
| `tests/phase3-business-control-db.test.ts`, `tests/phase3-rollback-protection-db.test.ts` | pass |
| Real PostgreSQL 17.11 runs T0–T4, L1–L4, V1, P1, C0–C6, and diagnostic P1–P5/S0 | as tabulated in §6 and §6.2 |
| Non-weakening diff check | executable SQL **outside §0 byte-identical** to `9754725` (1576 lines); 12 relations + 7 exact-signature functions retained; both errcodes retained |

**Coverage honesty for round 2.** The previous revision's `42703` test passed by **early
return**, so it proved nothing; that has been removed, not re-labelled. The replacement drops
`public.inventory_product_totals` and then the column, which is constructible in PGlite as
well as native PostgreSQL, so the case is now executed rather than skipped. No test in either
0109 suite returns early or is marked skipped. The native PostgreSQL 17.11 evidence remains
**separate** from `pnpm test`, because PGlite is PostgreSQL 16 (WASM) with stubbed
`auth`/`storage`; the 17.11 runs come from a disposable native cluster and are tabulated
above so the two are not conflated. Neither proves hosted-Supabase role-graph behaviour.

## 11. Confirmation

No production write of any kind was performed during this investigation: no DDL, no DML,
no `GRANT`/`REVOKE`, no migration execution, no `migration repair`, no `db push`, no
deployment, no PR merge, no Auth or SMTP change, no paid resource. The legacy project was
read at catalog level only and was not modified.

The same holds for round 2. Every privilege and missing-column scenario in §6.2 was built
and measured on a **disposable native PostgreSQL 17.11 cluster** created for this purpose
and destroyed afterwards; it does not connect to Supabase at all. `0104`–`0109` remain
**unapplied** in production, and this pull request remains **open and review-only**: it is
not a deployment authorisation and does not make production ready.
