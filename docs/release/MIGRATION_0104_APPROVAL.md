# Migration 0104 — approval package

**File:** `supabase/migrations/0104_site_content_management.sql` (742 lines)
**Subject:** website content management — tables, publishing functions, RLS.
**Prepared:** 16 November 2026 · **Status: NOT APPLIED anywhere. Awaiting owner approval.**
**Review companion:** `docs/PR134_FINAL_REVIEW_2026-11-15.md` (pull request #134).

> Nothing in this document has been executed against a remote project. The live
> project `fhrmsrumsraprvutrpeo` was inspected read-only on 16 November 2026 and
> does not contain any object this migration creates.

---

## 1. Why this migration exists

Until this change the About page, the Contact page and every policy are hard-coded
JSX. Changing one sentence in the Terms and Conditions requires a developer, a
review, a build and a deploy — so in practice the wording on the live site drifts
away from the wording the owner has approved, and the version a customer accepted
cannot be proven.

0104 moves that wording into the database, where a Super Admin can edit it, and
introduces a **draft → publish** boundary: a customer can only ever be served a
*published snapshot*, and the snapshot is written at the moment of publishing with
the real timestamp. The acceptance registry (0098) stays exactly as it is; see
`ACCEPTANCE_REGISTRY_OPTIONS.md`.

---

## 2. Exact objects created

| Kind | Object | Notes |
|---|---|---|
| Table | `public.site_pages` | one row per public page; `status` ∈ {draft, published}; `published_at`, `published_by`, `published_snapshot` |
| Table | `public.site_page_sections` | ordered sections; `body` and `bullets` are `text[]` |
| Table | `public.site_page_admin_notes` | internal notes, **never** public |
| Table | `public.site_page_revisions` | append-only publishing log (snapshot per publish/unpublish) |
| Index | `idx_site_pages_status_sort`, `idx_site_pages_footer`, `idx_site_page_sections_page`, `idx_site_page_revisions_page` | |
| Function | `public.is_super_admin()` | `SECURITY DEFINER`, `search_path` pinned; reads `profiles.role` |
| Function | `public.published_page(text)` | public read of one **published** page; granted to `anon` |
| Function | `public.published_pages()` | public index (footer + mobile list); granted to `anon` |
| Function | `public.site_page_snapshot(uuid)` | builds the snapshot JSON; `service_role` only |
| Function | `public.publish_site_page(uuid, boolean default false)` | Super Admin only; second argument is the **opt-in** acceptance registration |
| Function | `public.unpublish_site_page(uuid)` | Super Admin only |
| Trigger | `trg_site_pages_before_write` | timestamps; a system page keeps its slug and its `is_system` flag |
| Trigger | `trg_site_pages_block_system_delete` | refuses to delete a required page |
| Trigger | `trg_site_page_sections_touch` | `updated_at` |
| Trigger | `trg_site_pages_record_revision` | writes the publishing log only on a customer-visible event |
| Trigger | `trg_site_page_admin_notes_touch` | `updated_at` |
| Policies | 8 RLS policies | public read **only** through the two functions; all table access requires `is_super_admin()` |

No existing table, column, function or policy is altered. No `CONCURRENTLY`, no
`ALTER TYPE`, no rewrite of an existing table. The migration only creates new
objects and is therefore short-locking and reversible in a single transaction.

---

## 3. Security review

1. **Nothing is readable by `anon` except the two functions.** `revoke all on
   table … from public, anon, authenticated` is issued for all four tables before
   the grants, and RLS is enabled on all four. `published_page()` and
   `published_pages()` are `SECURITY DEFINER` with `search_path = public, pg_temp`
   pinned, and they read `published_snapshot` — the draft row is never assembled
   for a public caller.
2. **A draft cannot leak.** `published_page()` returns `{state:'unpublished'}` for a
   draft row; `published_pages()` filters `status = 'published'`. Verified by
   execution: an anonymous caller receives `unpublished` for all 10 draft pages
   after stage 1 (`tests/site-content-release.test.ts`).
3. **Publishing requires a Super Admin.** `publish_site_page()` raises `42501` when
   `auth.uid()` is null or `is_super_admin()` is false. `site_page_snapshot()` is
   not executable by `anon`/`authenticated` at all.
4. **No stored XSS surface by design.** Section text is plain text plus a
   constrained `link_href`; the renderer does not accept HTML. A `javascript:` URL
   is rejected at write time (see `lib/admin/site-content-actions.ts`, tested in
   `tests/site-content-*.test.ts`).
5. **Internal material is separated.** Owner decisions and the operator notices
   that used to be visible on the live policy pages live in
   `site_page_admin_notes` / `owner_decisions`, which have no public grant. The
   release test asserts a published document never contains `internal_notes` or
   `owner_decisions`.
6. **Acceptance registration is opt-in.** `publish_site_page(..., true)` is the only
   path that writes to `legal_document_current_versions`, and it is refused unless
   `kind = 'legal'`. A copy edit cannot silently pin a consent version.

### Change made on 16 November 2026 (this PR)

`site_pages_block_system_delete()` refused **every** delete of an `is_system` page.
That is correct for the admin UI, but it also made
`supabase/rollbacks/0105_seed_site_content.down.sql` impossible to run — every
seeded page is a system page — which was discovered by executing the rollback, not
by reading it. The trigger now permits the delete only when the session has set
`maharani.allow_data_loss = 'true'`, the same guard the 0104 rollback already uses.
The admin delete button is unaffected (it is refused a layer higher, in
`lib/admin/site-content-actions.ts`), and the guard still fires for every ordinary
caller. Covered by `tests/site-content-release.test.ts` and the existing
`tests/site-content-db.test.ts`.

---

## 4. Preconditions (all verified read-only on 16 November 2026)

| Precondition | Verified value | Result |
|---|---|---|
| Latest applied migration on the live project | `20261115155706` → `0103` | ✅ 0104/0105 are the next free numbers |
| `0104`/`0105` present in `schema_migrations` | absent | ✅ never applied |
| `site_page*` tables in `public` | 0 | ✅ clean install |
| Functions `published_page`, `published_pages`, `publish_site_page`, `is_super_admin` | 0 | ✅ no name collision |
| `profiles.role` column with `super_admin` | present (used by 0098 gate) | ✅ `is_super_admin()` will resolve |
| `auth.users` rows | **0** | ⚠️ see §6 |

---

## 5. Post-migration verification (read-only, executed on PostgreSQL 16)

Run in the SQL editor immediately after applying 0104. Every statement is a
`SELECT`; the results below are what the release test observed on a database built
from all migrations:

```sql
-- A. the four tables exist and are empty
select 'site_pages' as object, count(*) from public.site_pages
union all select 'site_page_sections', count(*) from public.site_page_sections
union all select 'site_page_admin_notes', count(*) from public.site_page_admin_notes
union all select 'site_page_revisions', count(*) from public.site_page_revisions;
-- expected after 0104 alone: 0 / 0 / 0 / 0

-- B. RLS is on for all four
select relname, relrowsecurity from pg_class
 where relnamespace = 'public'::regnamespace
   and relname in ('site_pages','site_page_sections','site_page_admin_notes','site_page_revisions');
-- expected: true for all four

-- C. the public functions exist with the expected signature
select p.proname, pg_get_function_identity_arguments(p.oid) as args
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public'
   and p.proname in ('published_page','published_pages','publish_site_page','unpublish_site_page','site_page_snapshot','is_super_admin')
 order by 1;
-- expected: 6 rows, publish_site_page has (uuid, boolean)

-- D. anon can execute the two public reads and nothing else
select has_function_privilege('anon', 'public.published_page(text)', 'execute')  as anon_reads_page,
       has_function_privilege('anon', 'public.published_pages()', 'execute')     as anon_reads_index,
       has_function_privilege('anon', 'public.publish_site_page(uuid,boolean)','execute') as anon_publishes,
       has_function_privilege('anon', 'public.site_page_snapshot(uuid)', 'execute')       as anon_snapshots;
-- expected: true / true / false / false

-- E. anon cannot touch the tables at all
select has_table_privilege('anon', 'public.site_pages', 'select') as anon_select;
-- expected: false
```

---

## 6. Known operational consequence — no Super Admin exists

The live project has **zero rows in `auth.users` and zero rows in `profiles`**. No
account therefore satisfies `is_super_admin()`, so:

* `/admin/content` is unreachable for every human user immediately after this
  migration — the page will refuse entry (correctly);
* `publish_site_page()` cannot be called by anyone;
* `publish_legal_document_version()` (0098) cannot be called by anyone.

This is not a defect in 0104 and it is not a reason to delay it, but it **is** a
release-order constraint:

* stage 1 must be executed as the SQL script `supabase/publication/stage1_publish_live_text.sql`
  (direct `UPDATE` as the project owner / `service_role`), not from the admin UI;
* before the owner can edit content in a browser, the first Super Admin must be
  created (`docs/release/STAGE1_PAGE_REVIEW.md` §6 gives the exact steps);
* a registry change (option B) must likewise be applied as SQL by the owner, or
  after the first Super Admin exists.

---

## 7. Risk register

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Migration applied before the deploy, site still reads JSX | certain by design | none | Both readers tolerate the tables existing; no old code path reads them |
| Deploy applied before the migration | low | **content outage** on /about, /contact, /legal/* (`UnreadablePage`, and `database_unavailable` from the mobile pages API) | The deploy order in §8 is mandatory |
| A published page has no snapshot | low | customer sees "not available" while admin shows "published" | `publish_site_page()` refuses to publish without a snapshot; census query counts `published_without_snapshot` |
| Data loss through a rollback | low | total loss of all content | 0104 rollback refuses unless `maharani.allow_data_loss = 'true'`; content can be re-seeded from `content/site-pages.seed.json` |
| Confusion with the acceptance registry | medium | a copy edit could pin a consent version | registration is opt-in, second argument, default `false` |

---

## 8. Mandatory order

```
1. 0104  (this migration)            — objects only, publishes nothing
2. 0105                             — 19 drafts, publishes nothing
3. stage 1 publication SQL          — 9 already-public pages
4. application deploy (Vercel)      — routes start reading the database
5. stage 2 publication SQL          — 10 reviewed additions, owner + CA approval
6. acceptance registry (optional B) — only after the pages it pins are public
```

Reversing 3/4 leaves the site answering "This page is not available right now."
on every policy page until the publication runs.

---

## 9. Approval

Approving this migration approves **the SQL as written in
`supabase/migrations/0104_site_content_management.sql` at the commit that contains
this document**, including the delete-guard change described in §3. It does not
approve 0105, stage 1, stage 2, a deploy or a registry change — each has its own
document.

| Decision | Tick | Name | Date |
|---|---|---|---|
| Apply 0104 to the live project `fhrmsrumsraprvutrpeo` | ☐ approve ☐ reject | | |
| Accept the delete-guard change (§3) | ☐ approve ☐ reject | | |
| Accept the consequence in §6 (SQL publication until a Super Admin exists) | ☐ approve ☐ reject | | |

Owner signature: ______________________  Date: ____________
