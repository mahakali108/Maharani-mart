# Migration rollback plan — 0081, 0082, 0083, 0084

**Verdict: NO-GO for any production or staging rollback** until every
prerequisite in §9 is satisfied and signed off by an authorised owner/DBA.
Nothing in this document authorises an execution against a hosted database.

| Item | Value |
| --- | --- |
| Scope | `supabase/migrations/0081…0084` and `supabase/rollbacks/0081…0084` |
| Reviewed on | 2026-10-28, branch `arena/616628bf-maharani-mart` |
| Hosted database touched | **No.** No connection, query, migration or rollback was executed against any Supabase project |
| Production configuration changed | **No.** No deploy, cron, secret, billing, spending-limit, Vercel or Supabase setting was modified |
| Local evidence | PostgreSQL 16 (PGlite) replay of every migration, `tests/rollback-0081-dependency.test.ts` and `tests/rollback-0082-checkout-precondition.test.ts` — see §10 |
| Enforced in SQL | §6 (0081 dependency guard, SQLSTATE `55000`), §4 step 0082 precondition |
| Requires an authorised operator | §7 (migration ledger in the hosted project), §5 (backup/PITR), §8 (rehearsal), §9 (checklist) |

---

## 1. What is being reversed

| Migration | Adds | Rollback file |
| --- | --- | --- |
| 0081 | `retailer_category` enum, `retailers.retailer_category`, `retailer_approval_settings`, `retailer_applications`, `retailer_approval_events`, 3 trigger functions, 5 RPCs | `supabase/rollbacks/0081_retailer_categories_and_approval.down.sql` |
| 0082 | `product_tier_prices` + 4 policies, 2 trigger functions + triggers, `pack_category_price_per_piece(uuid,uuid)`, restated `create_order_atomic` (0056) and `create_order_atomic_v2` (0065) | `supabase/rollbacks/0082_category_tier_pricing.down.sql` |
| 0083 | Membership plans deactivated, `admin_set_retailer_membership` revoked, loyalty trigger re-stated without a membership multiplier | `supabase/rollbacks/0083_retire_paid_membership.down.sql` |
| 0084 | `ai_retention_rules`, `ai_cleanup_runs`, `run_ai_data_cleanup(boolean,text,int,int)` (service_role only) | `supabase/rollbacks/0084_ai_data_retention_14_days.down.sql` |

The four migrations only touch each other: migration 0083 and 0084 mention
`retailer_category` / `product_tier_prices` in **comments only**, and no
migration after 0082 redefines the checkout RPCs. That is what makes the
reverse order below correct.

---

## 2. Exact reverse order

```
0084  (AI retention off)      -> no other migration depends on it
0083  (membership retirement) -> no other migration depends on it
0082  (category pricing)      -> must be reversed BEFORE 0081
0081  (retailer categories)   -> blocked by SQL while any 0082 object remains
```

Reversing 0081 first is **blocked in SQL** (SQLSTATE `55000`), not merely
discouraged: `retailers.retailer_category` is referenced by the 0082 read
policy, and both checkout bodies price by category.

---

## 3. Migration ledger — what SQL can and cannot prove

**Repository replay, scratch results, hosted ledger state and live schema
evidence are four different things.** This repository can prove only the first,
and this task proved only the first.

| Question | Where the answer lives | Who can answer it |
| --- | --- | --- |
| Does the repo define 0081–0084 and a rollback for each? | repository | verified — see §1 |
| Does a scratch replay of `supabase/migrations` produce these objects? | PGlite harness | verified — §10 |
| Did the **hosted** project apply 0081–0084? | `supabase_migrations.schema_migrations` | authorised operator/DBA only |
| Is the **live** schema of the hosted project the one this repo describes? | catalog queries | authorised operator/DBA only |

The local harness **does not create `supabase_migrations.schema_migrations`**.
Every scratch test therefore exercises the guard's *absent-ledger* branch unless
the test creates the ledger itself (both cases are covered — see §10).

Operator query (run read-only, in a project where that schema is visible):

```sql
select version, name, inserted_at
  from supabase_migrations.schema_migrations
 where version in ('0081', '0082', '0083', '0084')
 order by version;
```

* Rows present → those versions are still recorded as applied. The 0081 guard
  **blocks** and cannot be overridden.
* No rows, or the table/version convention is different (e.g. timestamped
  versions) → SQL cannot correlate it. The 0081 guard still **blocks** until an
  operator attests with the acknowledgement below. An absent ledger is never
  treated as proof of a completed reversal.

```sql
-- Attestation example (session-local; record the same text in the change log)
select set_config(
  'maharani.rollback_0081_ledger_ack',
  'ledger verified via <evidence ref> at <UTC timestamp> by <operator>', false);
```

The ledger is **not** repaired by these rollback scripts. If a version must be
removed from `supabase_migrations.schema_migrations`, that is a separate,
owner-approved action with its own evidence.

---

## 4. Step-by-step preconditions

### 4.1 Reverse 0084 — AI retention

* **Objects:** `public.ai_retention_rules`, `public.ai_cleanup_runs`,
  `public.run_ai_data_cleanup(boolean, text, int, int)` (0084 lines 44–60,
  63–90, 96–…). Execute is granted to `service_role` only; `public`, `anon` and
  `authenticated` are revoked.
* **Automatically reversible:** the function and its grant.
* **Irreversible:** rows already deleted by a run of `run_ai_data_cleanup`.
  The rollback stops future deletions; it cannot restore data.
* **Retained by default:** `ai_cleanup_runs` and `ai_retention_rules` (run
  history and the registry). Dropping them is an owner decision.
* **Scheduling:** `vercel.json` registers exactly one cron,
  `/api/cron/cleanup` at `0 2 * * *`. **There is no `/api/cron/ai-cleanup`
  entry**, so no schedule must be removed today. The route
  `app/api/cron/ai-cleanup/` exists but is unscheduled, and
  `tests/cron-configuration.test.ts` asserts it stays that way. If a future
  approved change arms it, removing that entry becomes part of this step.
  *(Correction: `docs/MASTER_UPGRADE_AUDIT_2026-10-27.md` §9 says to remove a
  then-existing cron entry; no such entry exists in this commit.)*
* **Owner approval:** not required to stop the engine; required for any future
  deletion of `ai_cleanup_runs`/`ai_retention_rules`.
* **Validation evidence:** `select to_regprocedure('public.run_ai_data_cleanup(boolean, text, int, int)');`
  → `NULL` afterwards; `select has_function_privilege('service_role', 'public.run_ai_data_cleanup(boolean,text,int,int)', 'EXECUTE');`
  → not applicable once dropped; `select count(*) from public.ai_cleanup_runs;` recorded before/after.

### 4.2 Reverse 0083 — membership retirement

* **Changes made by 0083:** every `membership_plans.is_active` set to `false`
  (0083 line ~40); `execute` on
  `public.admin_set_retailer_membership(uuid,text,text,text)` revoked from
  `public, anon, authenticated`; `public.trg_order_delivered_loyalty()`
  re-stated without the membership multiplier and its trigger recreated.
* **Authentic original loyalty definition:** `0080_retailer_memberships_and_loyalty.sql`
  lines 376–445 (body), 447–448 (grants), 450–453 (trigger). The multiplier
  branch reads `retailer_memberships` joined to `membership_plans`
  (`points_multiplier`). **Do not invent a body:** copy 0080:376–445 verbatim.
* **Original plan rows:** `0080` lines 41–46 seed `free` (₹0, 1.00x),
  `silver` (₹499, 1.50x), `gold` (₹999, 2.00x). The rollback's
  `where id in ('free','silver','gold')` matches those ids.
* **Authentic original grant:** `0080` line 229 grants `execute` to
  `authenticated`; the rollback restores exactly that.
* **Not reconstructable automatically:** loyalty points accrued at the base
  rate between 0083 and the rollback. Restoring a multiplier does **not** and
  **must not** retroactively re-award points — that would be invented data.
* **Owner approval:** required. Re-enabling 0083 restores a *paid* feature that
  the owner retired, including its marketing surfaces and multiplier semantics.
* **Validation evidence:** `select count(*) from public.membership_plans where is_active;`
  before/after; `select p.prosrc from pg_proc p where p.proname = 'trg_order_delivered_loyalty';`
  compared with 0080:376–445; `has_function_privilege('authenticated', …)`.

### 4.3 Reverse 0082 — category pricing

* **Objects created by 0082:** table `public.product_tier_prices` (line 44),
  index `idx_product_tier_prices_pack` (62), policies
  `product_tier_prices_read` (69), `…_admin_insert` (98), `…_admin_update`
  (102), `…_admin_delete` (106), `validate_product_tier_prices()` (115) +
  `trg_validate_product_tier_prices` (149), `guard_product_tier_prices_write()`
  (157) + `trg_guard_product_tier_prices_write` (179),
  `pack_category_price_per_piece(uuid,uuid)` (187), and the restated
  `create_order_atomic` (250) / `create_order_atomic_v2` (831).
* **Authentic pre-0082 checkout definitions:** `0056_mobile_checkout_atomic.sql`
  line 479 and `0065_checkout_split_rpcs.sql` line 503. A line-by-line diff of
  the four bodies shows the **only** differences are one
  `v_category_piece_price numeric;` declaration and the 13-line category gate
  in each function — so 0056/0065 restore exactly, with no invented body.
* **Signatures / security / ACL:** both are
  `create_order_atomic(uuid, uuid, uuid, text, text, jsonb, numeric, numeric, numeric, numeric, uuid, text, numeric, bigint, jsonb, boolean)`
  and the same for `create_order_atomic_v2`; both `security definer` with
  `set search_path = public, pg_temp`; 0056:1043–1050 and 0065:1348–1355 revoke
  EXECUTE from `public, anon, authenticated` and grant it to `service_role`
  only. `0082` re-states the bodies without re-issuing ACLs, and
  `CREATE OR REPLACE` preserves them — a scratch test asserts this (§10).
* **Mandatory order inside this step:** restore the two 0056/0065 bodies
  **first**, then run `0082…down.sql`. The script now fails closed
  (SQLSTATE `55000`) while any live function still references
  `pack_category_price_per_piece` or `product_tier_prices`. Without that guard,
  dropping the helper would leave checkout failing on every order.
* **`product_tier_prices` is retained by default.** Its rows are pricing
  configuration with audit value. Removing the table is an **owner decision**
  and is commented out. If removed, `product_tier_prices_read` disappears with
  it and **must never be recreated from guessed access rules**.
* **Retained-object consequence:** the retained table is left without its
  ordering triggers. That is acceptable only because the feature is off; record
  it. Re-applying 0082 recreates every trigger and policy.
* **Owner approval:** required for the table/data decision; not required to
  restore the checkout bodies.
* **Validation evidence:** the guard error/clear run; `to_regprocedure` for the
  three functions → `NULL`; both checkout bodies compared with
  0056:479 / 0065:503; `has_function_privilege` re-checked; one scratch order
  placed through `create_order_atomic` and one through `create_order_atomic_v2`.

### 4.4 Reverse 0081 — retailer categories and approval

* **Objects created by 0081:** enum `retailer_category` (line 42),
  `retailers.retailer_category` (47), `retailer_approval_settings` (55),
  `retailer_applications` (82) + index (103), `retailer_approval_events` (121)
  + index (139), `retailer_approval_events_immutable()` (153) + trigger (163),
  `ensure_retailer_application()` (190) + trigger (228),
  `guard_retailer_sensitive_columns()` (237) + trigger (258), and five RPCs:
  `admin_update_approval_settings(int,int)` (268),
  `admin_review_retailer_application(uuid,text,text,text)` (310),
  `admin_set_retailer_category(uuid,text,text)` (410),
  `admin_set_retailer_access(uuid,text,text)` (460),
  `retailer_resubmit_application(text,text,text,uuid)` (525), each granted to
  `authenticated` and revoked from `public, anon`.
* **Default rollback:** drops the five RPCs, the depth-2 guard trigger +
  function, and the `retailer_category` column. It **keeps** the three
  workflow tables, their RLS policies, the immutable audit trigger, the signup
  application trigger, and the enum type.
* **Why the triggers are kept:** dropping `retailer_approval_settings` would
  break `ensure_retailer_application` on the next signup, and dropping the
  immutable trigger would let retained audit rows be rewritten.
* **Why the guard function must go:** its body reads
  `new.retailer_category`; it cannot survive the column drop. Its only other
  branch guarded `retailers.status`, which **RLS already denies to a retailer**:
  the only permissive UPDATE policy on `public.retailers` is
  `retailers_admin_update` (`is_admin_or_above()`), while
  `active_account_update` is a **restrictive** policy. Verified locally in this
  task (an active retailer's self-update affects 0 rows). Re-verify in the
  target environment (§9, item R3) — the trigger was defense-in-depth.
* **Not reversible:** the retailer category **values** in
  `retailers.retailer_category` are destroyed by the column drop. Export them
  first if the classification matters (§9, item D1). Approval decisions and the
  audit trail survive because their tables are retained.
* **Enum:** deliberately left in place. Dropping a type other objects may
  reference is riskier than leaving an unused type behind.
* **Owner approval:** required for any later deletion of the retained tables or
  enum, and for accepting the loss of category assignments.

---

## 5. Reversibility, data loss and retained objects

| Migration | Automatically reversible | Data-destructive / irreversible | Manual | Owner/DBA approval |
| --- | --- | --- | --- | --- |
| 0084 | function, grant | rows already deleted by a run | cron check (none today) | any deletion of `ai_cleanup_runs` / `ai_retention_rules` |
| 0083 | plan flags, grant, trigger | none (no row deleted); multiplier effect on **past** accrual is not re-awardable | re-apply 0080:376–445 verbatim | yes — re-enables a paid feature |
| 0082 | triggers, functions, helper | `product_tier_prices` contents **if** the owner drops the table; `product_tier_prices_read` rule lost with it | restore 0056:479 and 0065:503 verbatim | yes — retain or drop the pricing rows |
| 0081 | 5 RPCs, guard trigger/function, column | category assignments in the dropped column | export category values; re-verify RLS | yes — table/enum retention decision |

---

## 6. What SQL enforces (0081 guard)

`0081_retailer_categories_and_approval.down.sql` creates a session-local
`pg_temp.assert_0081_rollback_safe(text)` and calls it **before every
destructive statement** (a source-level test asserts this). It raises
SQLSTATE **`55000`** with a `DETAIL` listing each blocker and does not change
anything on failure.

Blockers, each evaluated from the live catalog:

1. `public.product_tier_prices` exists.
2. Any policy on it (including `product_tier_prices_read`).
3. `public.pack_category_price_per_piece(...)` (any overload).
4. `public.validate_product_tier_prices()` / `public.guard_product_tier_prices_write()`.
5. `trg_validate_product_tier_prices`, `trg_guard_product_tier_prices_write`,
   or any other non-internal trigger on the pricing table.
6. `create_order_atomic` / `create_order_atomic_v2` whose body still references
   category pricing **after SQL comments are stripped** (no false positive from
   a comment; only these two functions are inspected, so unrelated functions
   cannot trigger it).
7. Every object in `pg_depend` that depends on the live
   `retailers.retailer_category` column — policy expressions, views,
   constraints, indexes, defaults, triggers — excluding only the objects this
   script removes.
8. Any undocumented public **table** column typed `public.retailer_category`.
9. Migration ledger records `0081`/`0082`/`0083`/`0084` as applied (§3).

A missing object is never accepted as evidence that the chain was reversed:
removing `product_tier_prices` alone still leaves the helper, the two trigger
functions and both checkout bodies, and the guard keeps blocking.

The guard does **not** and cannot enforce: hosted ledger truth, backup
existence, RLS/ACL equivalence with the pre-0081 baseline, or approval by the
owner. Those are operator responsibilities (§7–§9).

---

## 7. RLS and ACL verification (operator, read-only)

```sql
-- 1. The category pricing read rule is exactly the migration's expression,
--    or the table is gone. Never recreate it from a guess.
select policyname, cmd, qual, with_check
  from pg_policies
 where schemaname = 'public' and tablename = 'product_tier_prices'
 order by policyname;

-- 2. A retailer cannot self-update public.retailers after the 0081 rollback.
select policyname, cmd, permissive, roles, qual, with_check
  from pg_policies
 where schemaname = 'public' and tablename = 'retailers'
 order by policyname;
-- Expect: retailers_admin_update is the only PERMISSIVE update policy;
--         active_account_update is RESTRICTIVE.

-- 3. Checkout RPCs stay server-only.
select p.proname,
       has_function_privilege('anon', p.oid, 'EXECUTE')          as anon_execute,
       has_function_privilege('authenticated', p.oid, 'EXECUTE') as auth_execute
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public'
   and p.proname in ('create_order_atomic', 'create_order_atomic_v2');
-- Expect: false, false. Execute is granted to service_role only.

-- 4. The AI engine is never callable by an API role.
select has_function_privilege('authenticated',
        'public.run_ai_data_cleanup(boolean, text, int, int)', 'EXECUTE');
```

---

## 8. Backup, PITR and rehearsal (mandatory)

The rollback is **not approved** until all of the following are evidenced:

1. **Backup / PITR:** confirm the target project's automated backup and
   point-in-time-recovery window covers the planned change window, and record
   the recovery target timestamp.
2. **Rehearsed restore:** a restore into a scratch/non-production project has
   been performed **and timed** — not just assumed — from the same backup class.
3. **Scratch-database rehearsal of this exact chain:** replay `supabase/migrations`
   on an empty scratch database, then run `0082`, `0081` (both must be blocked
   at the first attempt), restore the 0056/0065 bodies, run `0082…down.sql`,
   then `0081…down.sql`. Record the output. On a hosted scratch project, verify
   the ledger behaviour in §3 explicitly.
4. **Data export before destruction:** `retailers.retailer_category`,
   `product_tier_prices` and `membership_plans` exported to an approved
   location if the owner intends to drop any of them.
5. **Bulk-order sanity:** one scratch order per checkout RPC after the 0082
   step, to prove pricing/stock behave as the pre-0082 code.

PGlite (used by the repo's tests) is **not** a substitute for any of this: it
is a single-connection Postgres with stubbed `auth`/`storage` schemas and no
hosted ledger.

---

## 9. Operator checklist (fill in; a blank field is a NO-GO)

| # | Precondition | Evidence field | Done |
| --- | --- | --- | --- |
| P1 | Written owner approval for this rollback and its data-retention choices | reference / date | ☐ |
| P2 | Hosted ledger read (§3) | output of the version query, timestamp | ☐ |
| P3 | Live schema inventory matches expectations (§6 items 1–8) | captured output | ☐ |
| P4 | Row counts before: `retailers`, `retailer_applications`, `retailer_approval_events`, `retailer_approval_settings`, `product_tier_prices`, `ai_cleanup_runs` | numbers | ☐ |
| P5 | `retailers.retailer_category` export (if the column is dropped) | location / checksum | ☐ |
| P6 | Backup + PITR window confirmed, restore rehearsed and timed (§8.1–8.2) | recovery target, rehearsal result | ☐ |
| P7 | Scratch rehearsal of 0084 → 0083 → 0082 → 0081 completed | run log | ☐ |
| D1 | Decision: retain or drop `product_tier_prices` data | retain / drop + approver | ☐ |
| D2 | Decision: retain or drop the three 0081 workflow tables + enum | retain / drop + approver | ☐ |
| D3 | Decision: re-enable paid membership (0083) and accept no retroactive points | approve / decline | ☐ |
| R1 | 0081 guard run **before** the change shows the expected blockers | captured error text + SQLSTATE `55000` | ☐ |
| R2 | 0082 precondition shows the expected `55000` before the bodies are restored | captured error text | ☐ |
| R3 | RLS re-verified in the target environment (§7 queries 1–2) | output | ☐ |
| R4 | ACL re-verified (§7 queries 3–4) | output | ☐ |
| R5 | Checkout sanity: one order per RPC on scratch after 0082 step | order ids | ☐ |
| R6 | Post-change schema inventory equals the pre-0081 baseline (or the documented deviation) | diff output | ☐ |
| R7 | Ledger updated/deleted only by the approved procedure, with evidence | reference | ☐ |

Until P1–P7, D1–D3 and R1–R7 are complete: **NO-GO**.

---

## 10. Local evidence produced with this document

All commands run in this repository, on PostgreSQL 16 via PGlite. No hosted
database was contacted.

| Check | Command | Result |
| --- | --- | --- |
| 0081 guard regression | `corepack pnpm exec vitest run tests/rollback-0081-dependency.test.ts` | 17 tests passed |
| 0082 precondition regression | `corepack pnpm exec vitest run tests/rollback-0082-checkout-precondition.test.ts` | 2 tests passed |
| Category tier pricing DB | `corepack pnpm exec vitest run tests/category-tier-pricing-db.test.ts` | 23 tests passed |
| Retailer approval DB | `corepack pnpm exec vitest run tests/retailer-approval-db.test.ts` | 14 tests passed |
| Migration catalog invariants | `corepack pnpm exec vitest run tests/migration-catalog-invariants.test.ts` | 13 tests passed |
| Typecheck | `corepack pnpm run typecheck` | clean (exit 0) |
| Lint | `corepack pnpm run lint` | no warnings or errors (exit 0) |
| Full suite | `corepack pnpm test` | 172 files / 2856 tests passed |
| Production build | `corepack pnpm run build` | exit 0 |
| Whitespace | `git diff --check` | exit 0 |

What these local tests prove: the guard raises `55000`, lists every blocker,
leaves the schema byte-identical on failure, survives repeated execution, and
allows the rollback only when the 0082 chain is genuinely reversed. What they
**do not** prove: anything about the hosted project, its ledger, its backups,
or its RLS/ACL state. That is why the verdict stays NO-GO.
