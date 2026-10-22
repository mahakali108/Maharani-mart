# Migration application evidence — required before any SQL runs

**Status: nothing has been applied.** This document defines the evidence that
must exist, and be attached to an approval request, before migration 0074 (or
any later migration) touches a hosted Supabase project.

I cannot produce this evidence myself today: this workspace has **no Supabase
CLI, no access token, no `.env.local`**, and outbound access is limited to
GitHub and package registries. Do not paste secrets into chat to unblock it —
run the commands below locally or in your own terminal and share the **output**,
which contains no credentials.

---

## 1. Target project identity

The approving message must name the project explicitly (for example
"apply 0074 to project `fhrmsrumsraprvutrpeo`"), so the change is bound to one
identifiable target and cannot be applied to "whatever is linked".

Evidence to attach:

| # | Evidence | How to obtain (read-only) |
| --- | --- | --- |
| I1 | Project ref, display name, organisation, region | `supabase projects list` |
| I2 | The API URL the application actually uses | the deployed `NEXT_PUBLIC_SUPABASE_URL` (value only, never the keys) |
| I3 | Whether the named project is the **production** project | compare I1/I2 against Vercel project settings |
| I4 | A statement that staging, if used, is a different project ref | I1 for each environment |

**Red flag to stop on:** if the Preview deployment and Production resolve to the
same project ref, there is no isolation and no write test of any kind may run
against Preview.

## 2. Migration-history consistency

| # | Evidence | Command |
| --- | --- | --- |
| M1 | Applied migration versions and names, newest first | `select version, name, inserted_at from supabase_migrations.schema_migrations order by version desc limit 15;` |
| M2 | Whether `0070`–`0073` are recorded as applied | same query, filtered to `version like '007%'` |
| M3 | Any recorded migration that is **absent from the repo** | diff M1 against `ls supabase/migrations` |
| M4 | Any repo migration that is unapplied and *not* the one being proposed | same diff, other direction |
| M5 | The live `banners` definition matches what 0001 + 0047 produced | `select column_name, data_type, is_nullable, column_default from information_schema.columns where table_schema='public' and table_name='banners' order by ordinal_position;` |

**Why this matters:** the README already records that `0070`–`0073` are
unverified remotely. If M2 shows them missing while the application depends on
them, the project is in a partially migrated state and 0074 must not be applied
until that is understood.

**Stop conditions:** M3 non-empty (a recorded migration missing from the repo
means history was rewritten); M4 shows a repo migration newer than 0074 already
applied; M5 does not match 0001 + 0047.

## 3. Verified restorable backup

A backup is only "verified" if a restore has been performed, not merely enabled.

| # | Evidence | How to obtain |
| --- | --- | --- |
| B1 | Backup/PITR configuration and retention | Supabase dashboard → Database → Backups |
| B2 | The most recent **successful** backup timestamp | same screen |
| B3 | A restore rehearsal performed on a scratch project, with its date and outcome | owner-run; record date, duration, and whether the restored `banners` row count matched |
| B4 | A pre-migration snapshot of the affected table | `copy (select * from public.banners) to stdout with (format csv, header true);` — save the output off-repo |
| B5 | Recorded pre-migration state | row count, `select count(*) filter (where is_active) as active from public.banners;`, and the current `pg_policies` output for `banners` |

**Why B4/B5:** 0074 is additive, but the rollback drops columns, and a verified
table snapshot is the only cheap way to prove no banner was lost.

## 4. Rollback rehearsal

| # | Evidence |
| --- | --- |
| R1 | `supabase/rollbacks/0074_banner_lifecycle_and_variants.sql` applied on staging **after** 0074, with the outcome recorded |
| R2 | 0074 re-applied afterwards, confirming the migration is re-runnable |
| R3 | Confirmation that no draft banner was left `is_active = true` at rollback time (otherwise drafts become public) |

## 5. Post-application verification (staging)

Run as the real roles, not as the owner:

1. `anon` cannot select a `draft` banner (expect 0 rows).
2. `staff` cannot insert/update/delete a banner (expect an RLS error).
3. `admin` can insert, publish, unpublish and delete a draft.
4. `/retailer/home` renders only published, active, in-schedule banners.
5. `GET /api/mobile/v1/home` returns the same banner set.
6. `types/database.types.ts` regenerates and the `as never` casts can be
   dropped.

## 6. Approval template

An approval that satisfies this document looks like:

> Apply migration `0074_banner_lifecycle_and_variants.sql` to project
> `<ref>` (`<name>`, region `<region>`), which is **not** the production
> project. History per M1–M5 attached, backup evidence B1–B5 attached,
> rollback rehearsal R1–R3 attached.

Anything less — "go ahead", "apply it", a project name without a ref — should
be treated as ambiguous and clarified before running SQL.
