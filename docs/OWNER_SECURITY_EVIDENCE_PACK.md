# Owner Security Evidence Pack — Maharani Traders

**Project:** `fhrmsrumsraprvutrpeo` (official). **Legacy `gbxhmffsbsfhdrfuwurx`:** out of scope, never connect to it.
**Date:** 2026-10-24 · **Branch:** `arena/b405a872-maharani-mart` @ `48eb1e2` + this review.
**Status of everything below:** read-only, owner-run. Nothing in this pack was executed against production.

> **Never paste into this chat:** database passwords, `service_role` keys, JWT secrets, `CRON_SECRET` values,
> API keys, connection strings with credentials, or customer rows.
> The only things that should be shared are **query output tables** from the read-only script (they contain
> schema metadata and counts, no customer data) and **Yes/No answers** from §3.

---

## 0. What to send back (the minimum)

| # | Item | Where it comes from | What it proves |
| --- | --- | --- | --- |
| E1 | Output of blocks 1–11 of `supabase/audits/migration_and_security_verification_readonly.sql` | Supabase → SQL Editor | Which migrations are really applied, whether banner/0077 columns exist, current grant posture, whether the retention engine is armed |
| E2 | The **project ref** shown in the dashboard URL and Settings → API (ref only, not keys) | Supabase dashboard | The SQL ran against `fhrmsrumsraprvutrpeo`, not the legacy project |
| E3 | Vercel → Project → Settings → **Cron Jobs**: is a job for `/api/cron/cleanup` listed, and is it enabled? (screenshot or "yes/no + schedule") | Vercel dashboard | Whether the 120-day deletion job can run at all |
| E4 | Vercel → Settings → Environment Variables: does `CRON_SECRET` exist **for Production**? (existence only — never the value) | Vercel dashboard | A cron with no secret gets 503 and deletes nothing |
| E5 | Vercel → Settings → Environment Variables: `NEXT_PUBLIC_SUPABASE_URL` **host only** (e.g. `https://fhrmsrumsraprvutrpeo.supabase.co`) | Vercel dashboard | Which project the deployment talks to |
| E6 | Backup evidence: PITR enabled, or date of the last verified restore rehearsal | Supabase → Database → Backups | The precondition for *any* write |
| E7 | Supabase → Authentication → Providers → Email: is **"Confirm email"** ON? | Supabase dashboard | Staff/salesman roles must not be grantable before e-mail confirmation |

E1 is generated entirely by the repo — no secrets, no customer data. Everything else is a Yes/No or a hostname.

---

## 1. Running the read-only script safely

**Before you run it**

1. Open the dashboard and confirm the URL contains project ref `fhrmsrumsraprvutrpeo`.
   If it says `gbxhmffsbsfhdrfuwurx`, **stop** — that is the legacy project.
2. Use **SQL Editor**, not a third-party client, so the `supabase_migrations` schema is visible.
3. Do not edit the script. Do not add `INSERT`/`UPDATE`/`DELETE`. Do not run it in a transaction you then commit with changes of your own.

**Why it is safe** (verified in this repo, see §4 of the audit doc)

* 19 statements, **all** `SELECT`/`WITH` — 0 non-select statements, 0 DML/DDL keywords after comments and literals are stripped.
* Executed end-to-end against a full 76-migration replay: schema + data fingerprints identical before and after
  (tables, functions, policies, constraints, buckets, retention rows).
* It never reads row data from customer tables. The only row-level reads are:
  `data_retention_rules` (12 configuration rows) and `cleanup_runs` (job history: status + counts).
  Banner/object inventory is `COUNT(*)` and `SUM(bytes)` only — no file contents, no filenames, no customer records.

**How to run**

1. Paste the **whole file** into the SQL Editor and run it once.
   Several blocks contain more than one statement — run it as a script, not statement-by-statement.
2. Copy each result grid into a spreadsheet or the reply. Label them by block number.
3. If any block errors, send the error text and the block number, and stop there.

**Expected results (what "good" looks like)**

| Block | Expected | If it differs |
| --- | --- | --- |
| 1 | Only versions the project really applied (repo has 0001–0074, 0077–0079) | Any 0075/0076/0080+ row is a surprise — report it before doing anything else |
| 2 | `0074`, `0077`, `0078`, `0079` show `NOT APPLIED` | If they show as applied while the app fails, the deployment is ahead of/behind the DB — stop and report |
| 3 | `image_url_mobile` present ⇒ 0074 applied | Present without a history row = drift; report |
| 4 | `banner-drafts` absent until 0077 is applied | Present without approval = report |
| 5 | `anon`/`authenticated` = false for `fefo_plan_for_product`, `current_offer_floor_paise`, `handle_new_user`, `ensure_fefo_coverage`; `release_order_stock` shows `authenticated = true` | Anything `true` for anon on these is a live exposure |
| 6 | banner storage policies mention `is_admin_or_above()` | `is_staff_or_above()` = 0078 not applied |
| 7 | **0 rows** (every table has RLS) | Any row is a P1 finding |
| 8 | **0 rows** (every definer function pins `search_path`) | Any row is a P1 finding |
| 9 | Counts only | — |
| 10 | `business_120` rows with `enabled = true` ⇒ the 120-day job is **armed** | See §2 |
| 11 | Only the reviewed allow-list; **no** `NO CALLER CHECK — REVIEW` row | A review row is a new exposure |

---

## 2. The 120-day deletion job — verify, then pause if needed

**We cannot tell you whether it is running.** That depends on Vercel configuration this repository cannot read.
Evidence E3 + E4 + block 10 together decide it:

| E3 cron? | E4 `CRON_SECRET`? | Block 10 `business_120` | Result |
| --- | --- | --- | --- |
| absent / paused | — | — | Job cannot run from Vercel. Nothing to do. |
| present | absent | — | Endpoint returns **503** and deletes nothing. Documented, not urgent. |
| present | present | all `enabled = false` | Nothing is deleted (registry gate). |
| present | present | any `enabled = true` | **Job is live.** Pause it (§2.2) before anything else. |

### 2.1 Check first (read-only)

```sql
select status, count(*) as runs, min(completed_at) as first_run, max(completed_at) as last_run
  from public.cleanup_runs group by status order by status;
```
If rows exist with recent `completed_at`, **deletion has already happened**; the accountant must review what was removed
before any further cleanup work. This query is already block 10 of the audit script.

### 2.2 Pause (needs your approval — two independent ways)

**A. Vercel side (no database change, instantly reversible).** Settings → Cron Jobs → pause or delete the
`/api/cron/cleanup` entry. Or remove `CRON_SECRET` from Production and redeploy; the route then fails closed with 503.
*Reversible:* re-add the schedule / re-set the variable.

**B. Database side (finer control; keeps the scheduler for the 90-day log tables).**
Must be run in the **SQL Editor** — `guard_data_retention_rules_mutation()` (0055) rejects this write for any role
other than `postgres`/`supabase_admin`, so the app's `service_role` key **cannot** do it (verified: `42501`).

```sql
-- OWNER APPROVAL REQUIRED. Reversible: set enabled = true again.
begin;
update public.data_retention_rules
   set enabled = false
 where category = 'business_120';
select target_key, category, enabled from public.data_retention_rules order by deletion_order;
commit;
```

`business_120` covers: orders, payment_records, coins_ledger, return_requests, order_stock_allocations,
stock_movements. `temporary_90` covers carts, notifications, notification_logs, invites, ai_rate_limit, cleanup_runs.

**Not done, not recommended without approval:** editing `vercel.json` or the retention code
(owned by open PR #107), running `run_data_cleanup`, or deleting records by hand. `0055` and `0075` stay on hold
pending legal + accountant review.

---

## 3. Answers we still need (short form)

Reply with these seven lines — nothing sensitive:

```
E2 project ref confirmed: yes / no
E3 cleanup cron: none / present-paused / present-enabled   (schedule: ___)
E4 CRON_SECRET in Production: yes / no
E5 NEXT_PUBLIC_SUPABASE_URL host: https://________.supabase.co
E6 Backup: PITR enabled yes/no, last restore rehearsal: ____
E7 Confirm email: on / off
E1 audit output: attached / pasted
```

With E1–E7 the audit moves from **repository-verified** to **production-verified**, and only then can 0074/0078/0079
be approved for application.
