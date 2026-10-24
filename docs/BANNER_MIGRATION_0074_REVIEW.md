# Migration 0074 — banner lifecycle and responsive artwork

**Status: repo-only. NOT applied to any Supabase project.** This review is a
pre-application assessment, not a safety guarantee. Nothing below has been
executed against a hosted database, and the migration must stay unapplied until
the owner approves and the checklist in §8 is complete.

Related files:

- `supabase/migrations/0074_banner_lifecycle_and_variants.sql`
- `supabase/rollbacks/0074_banner_lifecycle_and_variants.sql`
- `tests/banner-lifecycle-db.test.ts` (executes the SQL against PGlite/Postgres 16)

---

## 1. What it changes

| Object | Change | Why |
| --- | --- | --- |
| `public.banners.image_url_mobile` | new `text` column, nullable | optional 4:3 artwork for < 768 px; `NULL` means "use the desktop artwork" |
| `public.banners.status` | new `text NOT NULL DEFAULT 'published'` | separates a private draft from the merchant's `is_active` pause switch |
| `banners_status_check` | `CHECK (status in ('draft','published'))` | rejects any other value |
| `banners_public_feed_idx` | partial index on `(status, is_active, sort_order, id) WHERE is_active` | supports the storefront feed read |
| `banners_read` | replaced: `(is_active AND status = 'published') OR is_staff_or_above()` | a draft can no longer leak while `is_active` stays true |
| `banners_write` | replaced: `FOR ALL USING (is_admin_or_above()) WITH CHECK (is_admin_or_above())` | aligns the database with the application permission `banners.manage` (admin + super_admin only) |

Purely additive DDL. No `DELETE`, no `UPDATE` of business columns, no table
rewrite: adding a `NOT NULL` column with a non-volatile default is a
metadata-only change on PostgreSQL 11+.

## 2. Dependencies and ordering

| Dependency | Provided by | Consequence if missing |
| --- | --- | --- |
| `public.banners` table | `0001_init.sql` (line 135) | migration fails immediately |
| RLS enabled on `banners` | `0001_init.sql` (line 487) | policies would be created but not enforced |
| `public.is_staff_or_above()` | `0001`, redefined with `SECURITY DEFINER ... SET search_path = public` in `0052` | read policy fails |
| `public.is_admin_or_above()` | `0052_phase0_security_hardening.sql` | **write policy fails** — 0074 depends on 0052 |
| `subtitle`, `cta_label` | `0047_banner_content.sql` | not required by 0074, but the admin form assumes them |
| Restrictive `active_account_*` policies | `0052` (loop over every RLS table) | writes would lose the "active account" requirement |

Filename ordering places 0074 after 0052 and 0047, so a runner that applies
migrations in order is correct. It does **not** depend on `0059`–`0073`.

## 3. Existing-row behaviour

- Every pre-existing banner becomes `status = 'published'`, so the storefront
  renders exactly what it renders today.
- `is_active` is untouched: paused banners stay paused.
- `image_url_mobile` is `NULL` for every existing row, so the desktop 3:1
  artwork keeps rendering with no visual change.
- No file is moved or deleted in Storage.

## 4. RLS semantics

Postgres combines policies as: **permissive OR'd together, restrictive AND'd**.
Today `banners` carries:

- permissive `banners_read` — `(is_active AND status='published') OR is_staff_or_above()`
- permissive `banners_write` — `is_admin_or_above()` (both `USING` and `WITH CHECK`)
- restrictive `active_account_insert/update/delete` — from 0052, requires
  `is_active_account()` for the `authenticated` role
- restrictive `..._using` policy from 0001 is unchanged

Effective outcomes:

| Caller | Read | Write |
| --- | --- | --- |
| `anon` | published + active only | none |
| retailer | published + active only | none |
| seller | published + active only | none (never in `is_staff_or_above`) |
| staff | **all rows** (including drafts) | **none** (no `banners.manage`) |
| admin / super_admin | all rows | allowed, if the account is active |

Application-layer defence in depth: `lib/retailer/home-data.ts` and
`lib/mobile/catalog-service.ts` both add `.eq('status', 'published')`, so a
future policy mistake would still not surface a draft on the storefront. Direct
PostgREST reads are covered by the policy itself.

**Staff reading drafts is deliberate** (unchanged from 0001) and is not a
permission escalation: staff cannot edit, publish or delete a banner.

## 5. Findings

| # | Severity | Finding | Status |
| --- | --- | --- | --- |
| F1 | Medium | A partially applied earlier attempt could leave `status` nullable. `ADD COLUMN IF NOT EXISTS` would not fix nullability, and a `CHECK` constraint passes for `NULL`, so a `NULL` status could escape the approved set. | **Fixed in-file**: a guarded block backfills `NULL → 'published'`, restores the default and sets `NOT NULL` before the constraint is added. |
| F2 | **High** | `banners_write` (0001) allowed every `staff` member to write banners, while the application permission `banners.manage` is granted only to `admin` and `super_admin`. A staff session talking straight to PostgREST could write banners the UI never offers. | **Fixed in-file**: write policy narrowed to `is_admin_or_above()`; rollback restores the 0001 definition verbatim. |
| F3 | Medium | The `banners` bucket is **public**. A draft's artwork is unlisted (UUID object names) but not access-controlled: anyone holding the URL can fetch it. Draft status hides the row, not the file. | **Open decision**: acceptable for pre-announced campaigns; needs a private bucket + signed URLs if pre-launch secrecy is a requirement. |
| F4 | **High (process)** | The applied state of the hosted project is unverified. `README.md` already flags `0070`–`0073` as unverified remotely. Applying 0074 to a database whose history is uncertain is unsafe. | **Open**: verify `supabase_migrations.schema_migrations` on staging before any application. |
| F5 | Low | `types/database.types.ts` is hand-maintained. Remote type generation will not include the new columns until 0074 is applied, so the `as never` casts remain until then. | **Open**, tracked. |
| F6 | Low | There is no dedicated `alt_text` column; the banner `title` is used as the accessible name. Part 4.4 asks for accessible alternative text. | **Blocked**: adding it requires editing `components/retailer/promo-banner.tsx`, which is owned by open PRs #42 and #66. Reported, not done. |
| F7 | Info | `CHECK` constraints accept `NULL`, which is why F1 mattered. | Mitigated by F1. |
| F8 | Info | The index is partial on `is_active`; the area predicate (`area_id IS NULL OR area_id = …`) is still applied after the index scan. Acceptable at banner scale. | No action. |

## 6. Verification evidence (and its limits)

`tests/banner-lifecycle-db.test.ts` applies **every migration up to 0074** to
PGlite (PostgreSQL 16 compiled to WASM) and asserts behaviour, not source text:

1. a new banner defaults to `published` with `image_url_mobile = NULL`;
2. `status = 'archived'` is rejected by `banners_status_check`;
3. an active draft is invisible to a retailer but visible to staff;
4. a paused published banner is invisible to a retailer;
5. `banners_read` and `banners_write` both exist on the table;
6. an admin can insert a draft;
7. staff insert is refused (row-level security);
8. seller insert is refused;
9. `anon` sees published rows and never a draft.

**What this proves:** the SQL parses and runs in order; the default, constraint
and policies behave as intended for each role.

**What it does not prove:** PGlite is a single connection, so no two
transactions truly interleave; `auth`, `storage` and the JWT helpers are stubs,
not GoTrue/PostgREST; and none of this is a substitute for a staging run through
the real migration runner.

## 7. Rollback review

`supabase/rollbacks/0074_banner_lifecycle_and_variants.sql`:

- restores `banners_read` to `is_active OR is_staff_or_above()`;
- restores `banners_write` to `FOR ALL USING (is_staff_or_above())` (the exact 0001 form);
- drops the index, the constraint and both new columns.

Consequences to plan for:

1. **Data loss**: dropping `status` and `image_url_mobile` discards those
   values. Mobile artwork files remain in Storage but become orphaned — delete
   or re-link them deliberately, not automatically.
2. **Re-exposure**: after rollback, any banner with `is_active = true` is
   publicly readable again regardless of its former draft status. Pause drafts
   in the admin UI before rolling back.
3. **Application order**: roll the application back first. The previous UI does
   not read `status`, so it keeps working during the window either way, but the
   admin form would submit unknown fields to a dropped column.

The rollback is re-runnable (`IF EXISTS` guards throughout).

## 8. Pre-application checklist

- [ ] Confirm the hosted migration history (`schema_migrations`) matches the repo, including `0070`–`0073`.
- [ ] Take a `banners` table snapshot (small table; a plain `COPY` is enough).
- [ ] Record the current policy definitions (`pg_policies`) for `banners`.
- [ ] Apply 0074 to a **staging** project cloned from production, never straight to production.
- [ ] On staging: verify `anon` cannot read a draft, staff cannot write, admin can publish, and the storefront and `/api/mobile/v1/home` both render published banners.
- [ ] Exercise the rollback on staging, then re-apply.
- [ ] Regenerate `types/database.types.ts` from the staging schema and drop the now-unnecessary casts.
- [ ] Update the README migration table.
- [ ] Only then request production approval.

## 9. Open decisions

1. Is a draft's artwork allowed to be publicly fetchable by URL (F3), or is a
   private bucket required?
2. Does the owner want a dedicated `alt_text` column (F6), accepting that the
   change must wait for PR #42/#66 reconciliation?
3. Which environment is the first approved target for this migration?
