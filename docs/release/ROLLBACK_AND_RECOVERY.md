# Rollback and recovery — website content module

**Scope:** migration 0104, seed 0105, the two publication stages, and the deploy.
**Prepared:** 16 November 2026. **Nothing in this document has been run against a
remote database.** Every statement below was executed on a database built from
this repository's migrations (PostgreSQL 16 / PGlite) — see §7 for the evidence.

---

## 1. What can be rolled back independently

| Layer | Reversible on its own? | Method |
|---|---|---|
| Stage 2 publication (10 pages) | yes, one statement per page | `unpublish_site_page()` or SQL §4.1 |
| Stage 1 publication (9 pages) | yes, but leaves the site with no legal pages | SQL §4.1 — do **not** do this while the new code is deployed |
| Application deploy | yes, instant rollback on Vercel to the previous deployment | Vercel dashboard; the old build reads static JSX and ignores the tables |
| Seed 0105 | yes | `supabase/rollbacks/0105_seed_site_content.down.sql` |
| Migration 0104 | yes, destructive | `supabase/rollbacks/0104_site_content_management.down.sql` |
| Acceptance registry row | yes (only the one you added) | SQL §4.5 |

The two *content* layers and the two *schema* layers are independent. Rolling back
the deploy alone is always safe: the previous build never queries these tables.

---

## 2. Order and dependency checks

Correct removal order is the exact reverse of the creation order:

```
drop stage 2 / stage 1 publications          (content)
  → 0105 down   (delete the seeded pages)    (content)
    → 0104 down (drop the module)            (schema)
```

Reverse order fails. `0105 down` cannot run after `0104 down` (the table is gone),
and `0104 down` refuses while rows exist unless the data-loss flag is set.

### 2.1 Dependency check before removing anything

Run these first. The expected results are the ones observed on a freshly migrated
database:

```sql
-- a. What exists from this module (9 relations: 4 tables + 5 indexes)
select c.relname, c.relkind from pg_class c
 where c.relnamespace = 'public'::regnamespace and c.relname like 'site_page%'
 order by 1;

-- b. Foreign keys pointing AT site_pages — must be the module's own children only
select conrelid::regclass::text as from_table, conname
  from pg_constraint where confrelid = 'public.site_pages'::regclass order by 1;
-- expected exactly 3: site_page_admin_notes, site_page_revisions, site_page_sections

-- c. Views or materialised views built on it — must be none
select distinct v.relname
  from pg_depend d
  join pg_rewrite r on r.oid = d.objid
  join pg_class v on v.oid = r.ev_class
 where d.refobjid = 'public.site_pages'::regclass and v.relkind in ('v','m');
-- expected: 0 rows. If this returns a row, the rollback will fail and that view
-- must be dropped first — nothing in this repository creates one.

-- d. Functions that mention the module (6) — dropped by the rollback, in order
select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public' and p.prosrc ilike '%site_page%' order by 1;
```

Nothing outside this module depends on it: no other table has a foreign key to
`site_pages`, no view selects from it, and no function outside the six belongs to
the module. The mobile pages endpoint and the website call
`published_pages()` / `published_page()` by name and are covered by the deploy
rollback, not by this SQL.

### 2.2 Why ordering matters inside 0104 down

The rollback drops, in this order: (1) the functions that declare a `%ROWTYPE` or
read the tables, (2) the tables (which takes their triggers and policies with
them), (3) the trigger functions, (4) `is_super_admin()`. Dropping the tables
before the functions fails on the dependency, and dropping a trigger function
before its trigger fails too. This order is not theoretical: it was corrected
after the first version of the file failed, and it is now executed by a test.

---

## 3. Transaction behaviour and partial failure

* The Supabase CLI applies each migration file in its own transaction. 0104 and
  0105 contain no `CONCURRENTLY`, so a failure inside one file leaves **nothing**
  from that file applied — there is no "half 0104" state to repair by hand.
* The publication scripts are `do $$ … $$` blocks: each block is one transaction.
  Either all nine stage-1 pages are stamped, or none.
* The two rollback files are **not** wrapped in a transaction by the CLI (they are
  run by hand in the SQL editor). Each begins with a guard and each statement is
  independent. If a rollback stops halfway, re-run the *first failing statement*
  after reading the error — the guard at the top will tell you what state you are
  in.

### Detecting a partial state

```sql
select to_regclass('public.site_pages')                as tables_present,
       (select count(*) from public.site_pages)        as pages,
       (select count(*) from public.site_pages
         where status = 'published')                   as published,
       (select count(*) from public.legal_document_acceptances) as acceptances;
```

| `tables_present` | `pages` | Interpretation | Next step |
|---|---|---|---|
| null | — | 0104 not applied (or fully rolled back) | apply 0104 → 0105 |
| present | 0 | 0104 applied, 0105 not (or seed rolled back) | apply/verify 0105 |
| present | 19 | seed applied | check `published` |
| present | 19, published 9 | stage 1 done | deploy, or unpublish |
| present | 19, published 19 | stage 2 done | live |

---

## 4. Recovery procedures

### 4.1 A page was published by mistake

With the admin UI (after a Super Admin exists):

```sql
select public.unpublish_site_page((select id from public.site_pages where slug = 'about'));
```

Without any Super Admin (the state of the live project today), as the project
owner / `service_role` — this is the same statement the function performs:

```sql
update public.site_pages
   set status = 'draft',
       published_at = null,
       published_by = null,
       published_snapshot = null
 where slug = 'about'
   and status = 'published';
```

The customer sees "This page is not available right now." on the next request —
there is no cache to purge and no deploy. For a policy that must stay online, edit
the draft and publish again instead of unpublishing.

### 4.2 A published page contains the wrong text

The published text customers see is `published_snapshot`; the draft columns are
what the editor shows. The safe sequence is: fix the draft, then publish again with
**a new version** (`1.0` → `1.1`) if the change affects rights or duties — a
version string is never reused, and an acceptance recorded against `1.0` stays
meaningful. `site_page_revisions` keeps the previous snapshot, so the text that was
actually live can always be reproduced:

```sql
select r.created_at, r.action, r.snapshot -> 'title' as title
  from public.site_page_revisions r
  join public.site_pages p on p.id = r.page_id
 where p.slug = 'terms'
 order by r.created_at desc limit 10;
```

### 4.3 The deploy went out before the migrations

Symptom: `/about`, `/contact` and every `/legal/*` show "unable to load"; the
mobile pages API returns `database_unavailable`.

Recovery: apply 0104, then 0105, then the stage-1 script — in that order. No code
change is needed; the routes are already deployed and start working as soon as the
data exists. Do **not** roll the deploy back first: the previous build renders
static JSX, so it would mask the empty database instead of fixing it.

### 4.4 The migrations went out but the deploy did not

Harmless and expected. Nothing in the deployed build reads the new tables. Publish
nothing yet if the deploy is imminent; otherwise run stage 1 and verify with
`supabase/publication/verify_publication.sql`.

### 4.5 A document version was registered by mistake (acceptance registry)

Registering pins the version `record_legal_acceptance()` will accept; an
already-recorded acceptance keeps working, but a new acceptance of any other
version raises `LEGAL_VERSION_NOT_CURRENT`.

```sql
-- Remove ONLY a row this release added, and only if no acceptance exists for it.
delete from public.legal_document_current_versions v
 where v.document_key = 'terms'
   and not exists (select 1 from public.legal_document_acceptances a
                    where a.document_key = v.document_key);
```

On the live project today this affects one row: `seller-agreement 1.0`, which
predates this change and **must not** be removed — it is the seller gate.

### 4.6 Total removal (review environment only)

```sql
-- 1. delete the seeded pages (gated; sets the flag for its own session)
\i supabase/rollbacks/0105_seed_site_content.down.sql

-- 2. drop the module (refuses while rows exist)
set maharani.allow_data_loss = 'true';
\i supabase/rollbacks/0104_site_content_management.down.sql
```

After step 2 the site must be running the **previous** build, which renders the
static JSX. If it is running the new build, every policy page answers "not
available" — that is the signal that the deploy rollback comes first.

### 4.7 Content restore after an accidental loss

The seed is regenerable: `node scripts/generate-site-content-seed.mjs` writes
`content/site-pages.seed.json` and `supabase/migrations/0105_seed_site_content.sql`
from the committed source. Applying 0105 restores all 19 pages **as drafts**, after
which stage 1 (nine live pages) must be re-run. Any edit the owner made in
`/admin/content` and did not export is lost — which is why §5 exists.

---

## 5. Pre-flight backup (recommended, 30 seconds)

Before any stage, capture the two things that are not in Git — the current
published snapshots and the registry:

```sql
create table if not exists public.site_content_backup_20261116 as
  select p.slug, p.status, p.version, p.effective_date, p.published_at,
         p.published_snapshot,
         (select jsonb_agg(s order by s.sort_order) from public.site_page_sections s
           where s.page_id = p.id) as draft_sections
    from public.site_pages p;

select count(*) as captured from public.site_content_backup_20261116;
```

Drop the backup table after the release is verified. It is a normal table in
`public` with RLS **off** — nothing grants `anon` access to it, but do not leave it
behind.

---

## 6. Verification after every recovery step

Use `supabase/publication/verify_publication.sql` (read-only, five statements) and
compare against these expectations:

| Moment | `drafts` | `published` | `published_without_snapshot` | anonymous index size |
|---|---|---|---|---|
| after 0104 | 0 | 0 | 0 | 0 |
| after 0105 | 19 | 0 | 0 | 0 |
| after stage 1 | 10 | 9 | 0 | 9 |
| after stage 2 | 0 | 19 | 0 | 19 |
| after a single unpublish | 1 more | 1 fewer | 0 | 1 fewer |

`published_in_the_future` must be 0 at every moment.

---

## 7. Execution evidence

`tests/site-content-release.test.ts` runs the real files, in the documented order,
on PostgreSQL 16:

1. after 0104/0105 — 19 pages, 0 published, 0 snapshots, 0 future timestamps;
2. `stage1_publish_live_text.sql` — exactly 9 published, 10 drafts, every
   `published_at` stamped today (0 backdated, 0 future), anonymous state
   `published` for the nine and `unpublished` for the ten, index size 9, no
   `internal_notes` / `owner_decisions` in any published document;
3. `verify_publication.sql` — runs unchanged, before and after stage 1;
4. dependency check — only the three child tables reference `site_pages`;
5. `0105_seed_site_content.down.sql` then `0104_site_content_management.down.sql`
   — 0 pages, no tables, 0 module functions, no `is_super_admin()`.

Result: **5 tests, 5 passing.** Item 5 found a real defect on its first run — the
system-page delete guard blocked the seed rollback, so the file could never have
worked. The guard now honours `maharani.allow_data_loss`, and the existing
`tests/site-content-db.test.ts` (18 tests) still passes.

---

## 8. What is still unverified

* No rollback has been run against the live project, because nothing has been
  applied there.
* PGlite is a single connection: it proves the statements and their dependencies,
  not how two concurrent sessions behave.
* The `\i` form in §4.6 is the SQL-editor include; in the Supabase SQL editor, paste
  the file contents instead.
