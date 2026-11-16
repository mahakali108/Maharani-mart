# Migrations 0104 / 0105 — read-only audit (2026-11-15)

**Status: NOT APPLIED.** Verified against the official project
`Maharani-mart` (`fhrmsrumsraprvutrpeo`) on 2026-11-15 with read-only queries.
No DDL was executed. The legacy project `maharanimaa`
(`gbxhmffsbsfhdrfuwurx`) was not touched.

Everything below separates **verified** (a command or query produced it) from
**reviewed** (read from the SQL in this repository).

---

## 1. Exact files

| File | Lines | Applies |
| --- | --- | --- |
| `supabase/migrations/0104_site_content_management.sql` | 717 | tables, grants, RLS, 4 triggers, `is_super_admin()`, `published_page()`, `published_pages()`, `site_page_snapshot()`, `publish_site_page()`, `unpublish_site_page()` |
| `supabase/migrations/0105_seed_site_content.sql` | 896 | 19 pages + 70 sections + internal notes, publishes them |
| `supabase/rollbacks/0104_site_content_management.down.sql` | 37 | drops 0104 objects, refuses unless `maharani.allow_data_loss = 'true'` when rows exist |
| `supabase/rollbacks/0105_seed_site_content.down.sql` | 12 | deletes only the 19 seeded slugs that are still `is_system = true` |

`0104` is the only migration in the repository that creates
`public.is_super_admin()`; `0105` is the only one that writes `site_pages`.

---

## 2. Verified live-project state (read-only)

`list_migrations(fhrmsrumsraprvutrpeo)` — the live history ends at:

```
0102  anonymous_read_policies_fail_closed
20261115155706  0103_security_advisor_remediation
```

* `0103` is recorded under a **CLI timestamp** (`20261115155706`), not `0103`.
  The repository file is `0103_security_advisor_remediation.sql`. Reproduce this
  before applying anything new (§7).
* `0104` / `0105` are **absent** from the history.
* Gaps `0061`, `0075`, `0076` are absent from the live history too — they were
  never authored (see `tests/helpers/migration-reservations.ts`).

Object existence on the live project:

| Object | Exists | Evidence |
| --- | --- | --- |
| `public.profiles` | yes | `pg_class` count = 1 |
| `public.current_user_role()` | yes | `pg_proc` count = 1 |
| `auth.users` | yes | `pg_class` count = 1 (auth schema) |
| `public.legal_document_current_versions` | yes | `pg_class` count = 1; columns `document_key, document_version, published_at, published_by` |
| `public.super_admin_audit_logs` | yes | `pg_class` count = 1 |
| `public.publish_legal_document_version(text, text)` | yes | `pg_proc`, `prosecdef = true` |
| `public.compliance_boolean(jsonb, text)` | yes | `prosecdef = false`, `search_path=pg_catalog, public, pg_temp` |
| `public.site_pages`, `site_page_sections`, `site_page_admin_notes`, `site_page_revisions` | **no** (0 of 4) | `pg_class` count = 0 |
| `public.published_page()`, `published_pages()`, `site_page_snapshot()` | **no** | `pg_proc` |
| `public.is_super_admin()` | **no** | only `is_authenticated_super_admin()`, `is_admin_or_above()`, `current_user_role()` exist |

`legal_document_current_versions` currently holds exactly one row:
`('seller-agreement', '1.0')`.

---

## 3. Special-attention answers

### 3.1 `public.compliance_boolean(jsonb, text)`

* Signature verified live: `compliance_boolean(p_value jsonb, p_key text)`,
  SECURITY **INVOKER**, `search_path = pg_catalog, public, pg_temp`.
* **`0104` and `0105` do not reference it at all** — `grep` over both files
  returns no match. The dependency does not exist, so it cannot fail. It is also
  present, so a future migration may use it as `public.compliance_boolean(col, 'key')`.

### 3.2 `is_super_admin()`

`0104` **creates** it (`create or replace`, SECURITY DEFINER,
`set search_path = public, pg_temp`) and revokes it from `public`/`anon`, granting
`authenticated`. It is not an external dependency, and its absence live is
expected, not a problem. Re-running `0104` replaces it safely.

### 3.3 `publish_legal_document_version(text, text)`

`0104` calls it **only** inside `publish_site_page()`, only when
`kind = 'legal'` **and** only when
`to_regprocedure('public.publish_legal_document_version(text, text)') is not null`.
Verified present live with that exact signature, so the guard resolves and the
acceptance registry stays in step when an operator publishes a legal page.

### 3.4 Live compatibility with `0103`

`0103` (security-advisor remediation) touched function grants / policies on
unrelated objects. `0104` creates new objects with new names, requires
`profiles` + `current_user_role()` (both present), and drops/recreates only its
own policies. No object created by `0104` collides with `0103`. Verified: none of
the seven 0104 object names exists live.

---

## 4. Dependency / order diagram

```
0001_init                ── auth.users, profiles, gen_random_uuid()
0052_phase0_security_hardening ── current_user_role(), is_admin_or_above()
0095_legal_acceptance    ── (referenced conceptually: document keys == page slug)
0098_seller_agreement    ── legal_document_current_versions(),
                            publish_legal_document_version(text, text)
0103_security_advisor    ── merged to main; independent of 0104
        │
        ├── 0104 site content
        │      preflight: requires public.profiles + current_user_role()
        │      creates:   site_pages ← site_page_sections / admin_notes / revisions (FK, cascade)
        │                 is_super_admin()
        │                 site_page_snapshot(uuid)
        │                 published_page(text), published_pages()
        │                 publish_site_page(uuid) ──(optional, guarded)──> publish_legal_document_version
        │                 unpublish_site_page(uuid)
        │                 triggers: before_write, block_system_delete, sections_touch,
        │                           record_revision, admin_notes_touch
        │
        └── 0105 seed
               preflight: requires public.site_pages (0104)
               writes:    site_pages, site_page_sections, site_page_admin_notes
               now inserts DRAFTS only: publication is staged and owner-run
```

Safe order is **0104 → 0105**, and nothing else in the repository may be applied
between them. Reversing the rollbacks means **0105 then 0104**.

---

## 5. Complete SQL review

### 5.1 `0104` — objects

| Object | Kind | Review note |
| --- | --- | --- |
| `site_pages` | table | Check constraints cover slug format/length, kind, audience, status, version format, label/title/intro/meta lengths, related-slug count (≤12), and `site_pages_publish_complete` (a row cannot be `published` without `published_at`, snapshot, effective date, title, nav label and intro). |
| `site_page_sections` | table | `heading` 1–200, ≤40 paragraphs, ≤40 bullets, tone enum, link label/href must both be set or both null, label 1–80. `page_id` FK cascade. |
| `site_page_admin_notes` | table | 1:1 with page (PK = page_id). `review_status` enum; `site_page_admin_notes_reviewed_pair` refuses an approval without reviewer + timestamp — an approval cannot be faked with a bare flag. |
| `site_page_revisions` | table | Append-only: no INSERT/UPDATE/DELETE grant to any API role; written by a SECURITY DEFINER trigger. Event enum + version format. |
| `is_super_admin()` | fn | SECURITY DEFINER, pinned `search_path`, `revoke … from public, anon`, `grant … to authenticated`. Used by every write policy. |
| `site_pages_before_write` | trigger fn | Stamps `updated_at`/`updated_by`; publishes get `published_at`/`published_by`; a `is_system` page may not change slug or lose its required flag. |
| `site_pages_block_system_delete` | trigger fn | Refuses DELETE of a required page (`23514`). |
| `site_page_sections_touch`, `site_page_admin_notes_touch` | trigger fns | `updated_at` only. |
| `site_pages_record_revision` | trigger fn | Writes a history row on publish / unpublish / version change, never on an ordinary draft save. |
| `published_page(text)` | fn | SECURITY DEFINER, granted to `anon, authenticated, service_role`. Returns the **snapshot** for a published page, a `{state:'unpublished'}` object otherwise, `{state:'missing'}` for an unknown slug. Never returns a draft column. |
| `published_pages()` | fn | SECURITY DEFINER, granted to `anon, authenticated, service_role`. Ordered index of published pages; title/intro are taken from the snapshot. |
| `site_page_snapshot(uuid)` | fn | SECURITY DEFINER, **not granted to any API role** — internal builder used by `publish_site_page()` and by the seed. |
| `publish_site_page(uuid)` / `unpublish_site_page(uuid)` | fns | SECURITY DEFINER; refuse unless `auth.uid()` is a super admin (`42501`); publish refuses an incomplete page and keeps the 0098 registry in step. Granted to `authenticated` (the function re-checks the role) and `service_role`. |

### 5.2 `0104` — grants and RLS (as revised in this branch)

| Table | anon | authenticated | RLS |
| --- | --- | --- | --- |
| `site_pages` | **no privilege at all** | select/insert/update/delete | select → `is_super_admin()`; insert/update/delete → `is_super_admin()` |
| `site_page_sections` | **no privilege at all** | select/insert/update/delete | select → `is_super_admin()`; all → `is_super_admin()` |
| `site_page_admin_notes` | no privilege | select/insert/update/delete | all → `is_super_admin()` |
| `site_page_revisions` | no privilege | select only | select → `is_super_admin()`; no write policy exists |

**Change made during this audit (not yet applied anywhere):** the first revision
of `0104` granted `select` on `site_pages` and `site_page_sections` to `anon`
and to every authenticated user, with a policy of "the parent row is published".
Because a policy filters **rows, not columns**, that let any guest read the
**draft** `title`, `intro`, `meta_description` and — through the sections table —
every draft paragraph, including sections marked *not visible*, of a page that
was already published. That is exactly the "draft content must never be public"
guarantee this module exists to provide. The grants and policies were corrected:
guests have no column of the draft at all, authenticated reads are super-admin
only, and customers continue to read the published snapshot through
`published_page()` / `published_pages()` (SECURITY DEFINER). Regression test:
`tests/site-content-db.test.ts` → *"no API role can read a draft column of a
published page"* (verified: anonymous → `permission denied`; retailer → 0 rows;
published output still shows the last published text).

### 5.3 `0105` — review

* Preflight: raises unless `public.site_pages` exists.
* Per page: `select id … if v_page is not null then return; end if;` → an
  existing slug is **never overwritten**, so re-running is safe and edited pages
  are preserved. Verified by `tests/site-content-seed.test.ts` (10 tests) and the
  PGlite catalog test.
* All 19 rows are inserted with `is_system = true`, `version = '1.0'`,
  `effective_date` set, and **status `draft`** — no `published_at`, no
  `published_by`, no `published_snapshot`. (Earlier revisions of this file published
  all 19 with a backdated `2026-11-14T00:00:00+00`; that was removed — see R4.)
* Internal notes are inserted with `review_status = 'owner_review_pending'`
  (`on conflict do nothing`) and list the open owner decisions. No approval is
  invented.
* The seeded text is the wording already live on the website today; the seed is
  generated by `scripts/generate-site-content-seed.mjs` from the published
  source and reviewed as `content/site-pages.seed.json`.

---

## 6. Risk register

| # | Risk | Severity | State |
| --- | --- | --- | --- |
| **R1** | Draft columns readable by anonymous/any authenticated user for a currently published page (row-level policy cannot filter columns) | **High (content leak)** | **FIXED** in this branch — grants revoked, policies super-admin only, regression test added |
| **R2** | **CLOSED (changed 15 Nov, later session).** Two separate problems were behind this row. (a) `0105` published by direct `UPDATE`, bypassing `publish_legal_document_version()`. (b) `publish_site_page()` registered **every** legal page in the 0098 registry on every publish, which pins the version and makes `record_legal_acceptance()` reject any other one — a copy edit could have created a consent requirement. Fixed: `0105` no longer publishes at all, and the RPC registers only when the operator passes `p_register_acceptance = true` (default `false`, off-by-default checkbox). Registry still holds exactly `seller-agreement` | Was Medium | **Resolved** — see `docs/PR134_FINAL_REVIEW_2026-11-15.md` §5 for the Terms/Privacy rationale and options |
| **R3** | Live migration versions are mixed: `0102` (file prefix) and `20261115155706` (`0103`). Applying `0104` via CLI records `0104`; applying via the Dashboard SQL editor records nothing at all | Low (audit trail) | Recommendation in §7 |
| **R4** | **CLOSED (changed 15 Nov, later session).** `0105` used to publish all 19 pages at once with a backdated `published_at = 2026-11-14T00:00:00+00`. It now seeds 19 **drafts** and publishes nothing; its final check raises if any seeded row is not a pure draft. Publication is two reviewed, owner-run stages in `supabase/publication/` with `published_at = now()` — 9 pages whose wording is already live (stage 1, before the deploy) and 10 new pages after owner/legal approval (stage 2) | Was High (irreversibility + invented history) | **Resolved** — `supabase/publication/README.md` |
| **R5** | `0104` is 717 lines of DDL. The Supabase CLI wraps a migration in a transaction; the Dashboard SQL editor does **not**. A failure halfway through in the editor leaves a partial schema | Medium (operational) | Apply with the CLI, or paste the file inside an explicit `begin; … commit;` |
| **R6** | `create table if not exists` / `create index if not exists` / `drop policy if exists` make re-runs safe, but a *partially* applied 0104 from an older revision would keep old grants | Low | §5.2 revision drops the old anon policies explicitly, so re-applying closes the hole |
| **R7** | FK `references auth.users(id)` requires ownership of `auth.users`; a non-owner role fails the migration | Low | Apply as `postgres` (CLI/Dashboard does) |
| **R8** | Seed publishes 19 pages of **unapproved** engineering wording | Legal, not technical | Internal notes record `owner_review_pending`; the operator warning is admin-only |

---

## 7. Safe application order (when the owner approves)

1. **Back up**: `pg_dump` the `public` schema (or Dashboard → Database → Backups).
2. Confirm the history has not moved:
   `select version, name from supabase_migrations.schema_migrations order by version desc limit 3;`
3. Apply **0104 only**, inside a transaction:
   `supabase db push --include-all` (CLI, transactional) *or* paste 0104 wrapped in
   `begin; … commit;` in the SQL editor. Prefer the CLI so the version is recorded.
4. Verify before going further:
   ```sql
   select relname, relrowsecurity from pg_class
    where relnamespace = 'public'::regnamespace
      and relname in ('site_pages','site_page_sections','site_page_admin_notes','site_page_revisions');
   -- expect 4 rows, relrowsecurity = true
   select has_table_privilege('anon','public.site_pages','select') as anon_can_read_draft;   -- expect false
   select has_function_privilege('anon','public.published_pages()','execute') as guests_can_read_published; -- expect true
   ```
5. Apply **0105**. It prints nothing; verify:
   ```sql
   select status, count(*) from public.site_pages group by status;                    -- expect published = 19
   select count(*) from public.site_page_sections;                                     -- expect 70
   select review_status, count(*) from public.site_page_admin_notes group by 1;        -- expect owner_review_pending = 19
   select public.published_pages() -> 0 ->> 'slug';                                    -- expect a slug, not null
   ```
6. Deploy the web app **after** the migration (the routes call the new functions;
   until the migration exists they render the honest "could not be loaded" state).
7. Re-run `select version from supabase_migrations.schema_migrations order by version desc limit 3;`
   and record the result in `docs/MIGRATION_APPLICATION_EVIDENCE.md`.

---

## 8. Rollback assessment

| Scenario | Action | Effect |
| --- | --- | --- |
| Only `0105` was applied | run `0105…down.sql` | deletes the 19 seeded slugs (`is_system = true`); pages created in `/admin/content` and edited seeds survive. 0104 objects remain |
| Both were applied, content edit is disposable | `0105…down.sql`, then `0104…down.sql` with `set local maharani.allow_data_loss = 'true'` | full removal |
| Both applied, content must be kept | **no rollback** — the tables are additive and inert once the app stops calling them | prefer forward-fixes (a new migration) to a destructive rollback |

The 0104 rollback is genuinely destructive (all pages, sections, notes, history)
and is guarded exactly like 0095/0098: it refuses while rows exist unless the
data-loss flag is set in the same transaction.

---

## 9. Exact owner action required

1. **Approve the wording** of the 19 seeded pages (or ask for the specific pages
   to stay unpublished). Without this, applying `0105` publishes unapproved
   policy text.
2. **Decide R2 (now a choice, not a bug)**: should the acceptance-required documents (`terms`, `privacy`, `retailer-terms`, `prohibited-products`) be recorded in the acceptance
   registry (users are asked to accept them) or not (current behaviour: only the
   seller agreement)?
3. **Choose the apply channel** (CLI vs SQL editor) and confirm the transaction
   wrapper for `0104` (R5).
4. Give explicit approval to apply `0104` then `0105` to `fhrmsrumsraprvutrpeo`.
   Nothing in this document was applied.
5. After applying, deploy the web app; the `/admin/content` module and the
   published routes only work once the migration exists.
