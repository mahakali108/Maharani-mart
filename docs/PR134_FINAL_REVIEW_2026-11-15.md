# PR #134 — final review and safe release preparation (2026-11-15)

Branch `arena/1c8f9eed-maharani-mart`, PR [#134](https://github.com/mahakali108/Maharani-mart/pull/134),
Supabase project `fhrmsrumsraprvutrpeo` (the official project — no other project was
connected, read or written).

**Nothing in this review was applied, merged, deployed, signed or published.** Every
statement about the live database below comes from read-only queries
(`pg_class`, `pg_proc`, `information_schema`, `supabase_migrations`), run in this
session and quoted with its result.

---

## 0. Verdicts

| Question | Verdict |
| --- | --- |
| Is PR #134 reviewable and mergeable as *code*? | **Yes — with the caveats in §1.8.** Review complete; no blocking defect found. Not merged, per instruction. |
| Is migration `0104` safe to apply? | **Yes, in the order in §7**, after owner approval. The draft-read hole found earlier is closed and now proven closed by an executed test. |
| Is migration `0105` safe to apply? | **Yes — as changed in this session.** It now seeds **19 drafts and publishes nothing**, and cannot publish: it had been publishing all 19 with a backdated timestamp. |
| Has anything been applied to the live database? | **No.** `0104` and `0105` have never touched `fhrmsrumsraprvutrpeo`. |
| Is the Android app verified on a device? | **No.** It compiles, its unit tests and lint pass in CI, and it has been verified only by automated tests — never installed on a phone or run against a live server (§6). |
| Are the 19 policy texts approved? | **No.** All 19 are `owner_review_pending`; 10 of them have never been public at all (§8). |

---

## 1. PR #134 review

93 files, +9,985 / −698 against base `656a6a4`. Reviewed in four passes: the Android
client, the web content module, the two migrations (separate documents), and the
tests/CI.

### 1.1 Android — DTOs, endpoints, repository, ViewModels, screens

| File | Finding |
| --- | --- |
| `core/network/dto/ContentDtos.kt` | Every field has a default and `ignoreUnknownKeys` is set in `NetworkModule`, so an additive server change cannot break an installed build. Field names match `app/api/mobile/v1/pages/[slug]/route.ts` exactly (`navLabel`, `shortLabel`, `effectiveDate`, `publishedAt`, `showContactDetails`, `relatedSlugs`, `sections[].linkLabel/linkHref`). **OK.** |
| `MaharaniApi.kt` (+22) | Two `@GET`s, no auth annotation: both routes are genuinely public (the Anonymous-client paths on the server), reached through the existing bearer interceptor which sends a token only when one is stored. **OK.** |
| `ManagedContentRepository.kt` | Wraps `ApiCallExecutor.executeEnvelope` (the same path every other repository uses, so a 401 triggers the standard refresh-and-replay); validates the slug against `^[a-z][a-z0-9]*(-[a-z0-9]+)*$` **before** the network call; drops a half-filled link. **OK.** |
| `ManagedContentViewModels.kt` | Five explicit states. A `404` becomes `unavailable` (no retry offered, because retrying cannot publish a page); every other failure keeps the server message and `retryable` from `ApiErrorCode`. Fixed this session: `SMARTCAST_IMPOSSIBLE` on the cross-module `AppResult.error` property. **OK.** |
| `ui/ManagedContentScreens.kt` | Renders plain text, bullets and one link; no HTML anywhere. On-site `/path` links open the in-app page, `https`/`mailto`/`tel` go to the platform, anything else is discarded — unit-tested (`openLink`). Images are deliberately not rendered. **One change made in this review:** the "Contact Maharani Traders" shortcut no longer assumes the page exists — it is shown only when the server's published list contains the `contact` slug, so an unpublish cannot produce a dead button. **OK.** |
| Routes (`MaharaniDestinations.kt`, `AuthenticatedShell.kt`) | `legal` and `legal/{slug}` are registered sub-screens; the slug is a `NavType.StringType` argument consumed only by `ManagedPageViewModel`. Reached from **Account → Policies & information** and **Help → Policies & information**. The account row is deliberately not gated on the server's navigation policy (public content, not a permission). **OK.** |
| `AccountScreen.kt`, `RetailerAccountScreens.kt` | +10 and +7 lines: one shortcut row and one help button. Nothing else in those screens changed. **OK.** |

**Authentication / roles / session:** the Android change adds no auth logic, no token
handling, no new stored state and no session code. Both endpoints are anonymous by
design (the Terms and grievance route must be readable before sign-in, as on the
website). A signed-out user therefore cannot reach an authenticated-only screen
through them, and nothing on these screens is role-dependent — a retailer, seller,
admin or super admin sees exactly the same published text.

**No content hardcoded in Kotlin:** verified by grep over all non-test Kotlin. The
only slug the app names is `contact`, and only to decide whether to draw a
shortcut; the page list, all headings, all body text, all versions and all effective
dates come from the API. The five static FAQs in `HelpScreen` are unchanged and are
not policy text.

**Error handling:** offline → retryable error with *Try again*; 5xx → retryable;
404 → the unavailable sentence; empty list → *"No published pages yet"* with a
*Check again* action; a malformed slug → refused locally as `NOT_FOUND`; a blank
navigation argument → unavailable without a network call (tested).

### 1.2 Web content module (reviewed for regressions)

* `lib/site-content/{types,queries,render,nav,draft-preview}.ts` — reads go through
  `published_page()`/`published_pages()` only; the admin loaders are the only code
  that touches `site_pages`, and they are called only from `/admin/content/*` behind
  `requireSuperAdminPage()`. Verified by the existing source-guard tests
  (`site-content-admin.test.ts`).
* `lib/admin/site-content-actions.ts` (449 lines) — every exported action starts with
  `requireSuperAdmin()` (asserted by a test that enumerates the exports), validates
  with zod, writes through the RPCs, audits, and revalidates the affected public
  paths. **Changed in this review:** `publishPageAction` now forwards an explicit
  `p_register_acceptance` boolean read from the form instead of relying on the
  database to register every legal page (§5).
* Deleted pages: `app/legal/{terms,privacy,returns,shipping,grievance,business-disclosure,product-safety}/page.tsx`
  and their `/terms`, `/privacy`, … aliases are replaced by `app/legal/[slug]` +
  managed content. `tests/legal-canonical-redirects.test.ts` (6 tests) and
  `tests/public-information.test.ts` (6 tests) still pass, so the canonical
  redirects and the public information surface are intact.
* Footer/index: `loadFooterLinks()` reads `published_pages()`, with a static
  fallback used **only** when the function itself fails — so the site does not lose
  its footer while the migration is unapplied. Verified in
  `site-content-footer-nav.test.ts` (6 tests).
* `lib/legal/acceptance.ts` now reads current versions from the database with a
  fallback to the static registry. This is a genuine improvement (the database is
  what enforces the version), but it is also the change that makes §5 matter: once a
  row exists, the database refuses any other version.

### 1.3 Tests added or changed

`site-content-db` (17, real PostgreSQL 16 via PGlite), `site-content-seed` (16),
`site-content-admin` (19), `site-content-public` (5), `site-content-footer-nav` (6),
`site-content-editor-reads` (6), `legal-registry` (6), `mobile-pages-api` (8),
`public-information` (6), `api-privilege-hardening` (25), `migration-reservations`
(new), plus the Android suites `ManagedContentSerializationTest` (4),
`ManagedContentViewModelTest` (15), `LegalRoutesTest` (3).

### 1.4 CI

| Run | Commit | Result |
| --- | --- | --- |
| [43774795591](https://github.com/mahakali108/Maharani-mart/actions/runs/43774795591) | `683fac9` | **SUCCESS** — production probe, web typecheck/lint/tests/build, Android unit tests + lint, debug APK identity/version, unsigned release artifacts |
| [43773560359](https://github.com/mahakali108/Maharani-mart/actions/runs/43773560359) | `e9be8f8` | failure — `:core:auth:compileDebugUnitTestKotlin`, `FakeMaharaniApi` missing the new endpoints (fixed in `683fac9`) |
| [43772660295](https://github.com/mahakali108/Maharani-mart/actions/runs/43772660295) | `50ba90d` | failure — `:feature:engagement:compileDebugKotlin`, smart cast across modules (fixed in `e9be8f8`) |

Both failures were real compile errors caught by the pipeline, not flaky tests; both
are fixed, and the third run is fully green. The Android workflow is
`workflow_dispatch`-only, so "no run appeared" is never evidence of success.

### 1.5 Local gates on this review's final tree

| Gate | Result |
| --- | --- |
| `pnpm run typecheck` | **PASS** |
| `pnpm run lint` | **PASS**, 0 warnings |
| `pnpm test` | **PASS** — 220 files / 3,381 tests |

### 1.6 Regressions checked specifically

| Risk | Result |
| --- | --- |
| A public legal page 404s after the deploy | **Real, and prevented by ordering** — the site now reads drafts from the database, so stage 1 must be published **before** the deploy (§7). This is the single most important operational finding of this review. |
| Footer loses its links when nothing is published | Not possible: `loadFooterLinks()` keeps its static fallback for a read failure, and an empty published list is an empty list, not an error. |
| Acceptance prompt changes for existing users | Not possible without an explicit operator opt-in (§5). |
| Admin screens leak into public routes | Guarded by tests that scan every public file for `site_page_admin_notes` / business settings / the retired operator banner. |
| Product, order, cart, wallet flows | Untouched: the diff is additive in `lib/`, `app/api/mobile`, `app/admin`, and the legal/about/contact surfaces only. Full suite green. |

### 1.7 Residual code-level risks

1. **`legal` is a top-level route name** in the Android graph; a future server
   navigation policy that used `legal` as a workspace would collide. Low, documented.
2. **Section `imageUrl` is carried by the contract but not rendered.** No published
   page uses one; a page that gains an image renders without it.
3. **The web's `/legal/[slug]` and the app both key on slug**; renaming a slug breaks
   inbound links (a 404, not a wrong page). The system pages are protected from slug
   changes by a database trigger.
4. **`site_page_snapshot()` is service-role only**; the publish RPC and the
   publication scripts call it as the definer/owner. Intentional.

### 1.8 Caveat on merging

The code is mergeable; **deployment is not** until stage 1 has been published (§7),
because the merged code reads pages from a database table that does not yet exist in
production. Merging without deploying is safe; deploying before applying 0104/0105
would break `/about`, `/contact` and every policy route (they would answer the
"not available" message, not a 500 — but still a customer-visible regression).

---

## 2. Migration 0104 — independent security review

Re-read in full (717 lines).

### 2.1 Anonymous capability matrix (as written)

| Object | `anon` | `authenticated` (retailer/seller/admin) | `service_role` |
| --- | --- | --- | --- |
| `site_pages` | **no privilege** | `SELECT` gated by `is_super_admin()`; writes same | all |
| `site_page_sections` | **no privilege** | `SELECT`/write gated by `is_super_admin()` | all |
| `site_page_admin_notes` | **no privilege** | `ALL` gated by `is_super_admin()` | all |
| `site_page_revisions` | **no privilege** | `SELECT` gated by `is_super_admin()`; no write policy at all | all |
| `published_page(text)` | `EXECUTE` | `EXECUTE` | `EXECUTE` |
| `published_pages()` | `EXECUTE` | `EXECUTE` | `EXECUTE` |
| `site_page_snapshot(uuid)` | none | none | `EXECUTE` |
| `publish_site_page(uuid, boolean)` | none | `EXECUTE`, but raises unless `auth.uid()` is a super admin | `EXECUTE` |
| `unpublish_site_page(uuid)` | none | `EXECUTE`, same guard | `EXECUTE` |
| `is_super_admin()` | none | `EXECUTE` | `EXECUTE` |

**Draft fields, internal notes, SEO drafts and unpublished sections cannot be read
by an anonymous caller**: `anon` has no table privilege at all, so the question never
reaches RLS. That is the fix this review re-verified — a row-level policy filters
rows, not columns, and the earlier revision of the file granted `anon SELECT` with a
`status = 'published'` predicate, which exposed `title_draft`, `body_draft`,
`internal_notes`, `seo_*` and hidden sections of a published page.

**Retailer/seller access is correctly restricted**: they hold the table privileges but
every policy calls `is_super_admin()`, so both get **0 rows** and cannot write. A
plain `admin` is in the same position (tested).

### 2.2 Function hygiene

Every function is `SECURITY DEFINER` with an explicit
`set search_path = public, pg_temp`, and every `EXECUTE` was revoked from `PUBLIC`
before the intended roles were granted. `is_super_admin()` is itself pinned, so a
shadowing function cannot be planted earlier on the path. `site_page_snapshot()` is
not granted to any API role.

### 2.3 Public surface

Only `published_page(text)` and `published_pages()` are callable by `anon`, and both
return the **snapshot** written by `publish_site_page()` — never a draft column. The
snapshot is built by `site_page_snapshot()` from visible sections only
(`is_visible`), so a hidden section cannot be published by accident either.

### 2.4 Integrity rules that hold server-side

* `site_pages_publish_complete` check: a row cannot be `published` without a title,
  an effective date and a snapshot — the table refuses the state even for
  `service_role` (tested).
* `publish_site_page()` refuses: no effective date, no intro, zero visible sections.
* Protected system pages cannot be deleted or have their slug changed (trigger).
* Publishing writes a `site_page_revisions` row; the history table has no write policy
  for any API role, so history cannot be rewritten.
* `unpublish_site_page()` clears the snapshot, so an unpublished page leaves nothing
  readable behind.

### 2.5 What changed in 0104 during this review

`publish_site_page(uuid)` became `publish_site_page(uuid, p_register_acceptance boolean default false)`,
and the call to `publish_legal_document_version()` now happens **only** when the
caller passes `true`. Reason: the old code registered every published legal page in
the acceptance registry (0098), which pins that version in the database and makes
`record_legal_acceptance()` reject any other version. A copy edit must not be able to
create a consent requirement. The editor exposes this as an unticked checkbox; the
RPC default is `FALSE`; the admin action forwards the form value and never a
constant. Tests: publishing a legal page without the flag leaves the registry with
exactly `seller-agreement`; publishing with the flag registers the version and then
enforces it.

### 2.6 Function permissions and search_path — checked line by line

`is_super_admin`, `site_pages_before_write`, `site_pages_block_system_delete`,
`site_page_sections_touch`, `site_pages_record_revision`, `published_page`,
`published_pages`, `site_page_snapshot`, `publish_site_page`, `unpublish_site_page`,
`site_page_admin_notes_touch`: all `SECURITY DEFINER` where they need it, all with
`search_path` pinned, all with `revoke all … from public` before any grant. The two
trigger functions that do not need definer rights are `SECURITY INVOKER`.

### 2.7 Transaction behaviour and rollback

* The migration is a single file of DDL with no implicit `COMMIT`. **Run it in one
  transaction** (`supabase db push` does; the SQL editor does not unless you wrap it
  in `begin; … commit;`). Applying it statement-by-statement in the editor after a
  failure is recoverable — every object is `create … if not exists` or
  `create or replace`, and the policies are dropped before being recreated — but the
  window between "tables exist" and "policies exist" is a real exposure if the editor
  stops halfway.
* Rollback `0104_…down.sql` refuses to drop anything unless
  `maharani.allow_data_loss = 'true'` is set in the session; it raises otherwise
  (executed by a test).
* `0105_…down.sql` deletes only rows whose slug is in the seed **and** `is_system = true`,
  so a page the owner created, or a seeded page they edited into something else, is
  left alone. It cannot delete a page that is not the seed.

---

## 3. Migration 0105 — publication safety

### 3.1 What it did, and what it does now

| | Before this review | After |
| --- | --- | --- |
| Status of the 19 seeded pages | `published` | **`draft`** |
| `published_at` | **backdated** `2026-11-14T00:00:00+00` for all 19 | **none** |
| `published_snapshot` | written for all 19 | none |
| Public visibility on apply | 19 policies instantly readable | **nothing readable** |
| Guard in the file | checked all 19 were published | raises unless all 19 are pure drafts |

The migration's own final check now fails the whole migration if any seeded row has a
status other than `draft`, a snapshot, a `published_at` or a `published_by` — so a
future edit that reintroduces publication (or backdating) breaks the build rather
than shipping.

### 3.2 Exactly what the 19 pages are

| # | Slug | Audience | Wording already live before this module? | Stage |
| --- | --- | --- | --- | --- |
| 1 | `terms` | everyone | **yes** (`app/legal/terms`) | 1 |
| 2 | `privacy` | everyone | **yes** | 1 |
| 3 | `returns` | everyone | **yes** | 1 |
| 4 | `shipping` | everyone | **yes** | 1 |
| 5 | `grievance` | everyone | **yes** | 1 |
| 6 | `business-disclosure` | everyone | **yes** | 1 |
| 7 | `product-safety` | everyone | **yes** | 1 |
| 8 | `about` | everyone | **yes** (`app/about`) | 1 |
| 9 | `contact` | everyone | **yes** (`app/contact`) | 1 |
| 10 | `damaged-goods` | everyone | no — new text | 2 |
| 11 | `seller-agreement` | sellers | no | 2 |
| 12 | `retailer-terms` | retailers | no | 2 |
| 13 | `marketplace-disclaimer` | everyone | no | 2 |
| 14 | `gst-pricing-invoice` | everyone | no | 2 |
| 15 | `prohibited-products` | sellers | no | 2 |
| 16 | `ip-complaints` | everyone | no | 2 |
| 17 | `suspension-termination` | everyone | no | 2 |
| 18 | `cookies` | everyone | no | 2 |
| 19 | `coins-loyalty` | everyone | no | 2 |

### 3.3 The staged plan (files in `supabase/publication/`)

Not migrations — `supabase db push` never runs them. `stage1_publish_live_text.sql`
publishes exactly rows 1–9 with `published_at = now()`; `stage2_publish_reviewed_additions.sql`
publishes rows 10–19 and refuses to run unless stage 1 is already live. Both refuse a
page whose snapshot has no visible section, both are idempotent, and
`verify_publication.sql` is read-only.

Tests pin the invariants: the two stages partition the 19 seeded slugs exactly
(9 + 10), neither contains a backdated timestamp, neither touches the acceptance
registry, and the verification file contains no write statement.

### 3.4 Unpublished pages stay inaccessible

Proven in `site-content-db.test.ts` against real PostgreSQL: with the seed applied,
`published_pages()` returns `[]` and `published_page('about')` returns
`state = 'unpublished'` for every seeded slug; the ten stage-2 pages remain
invisible after stage 1 and are absent from the index. `anon` cannot read the table
at all (`permission denied`), so the draft text is unreachable, not merely filtered.

---

## 4. Live Supabase verification (`fhrmsrumsraprvutrpeo`, read-only)

| Check | Result |
| --- | --- |
| Project identity | `fhrmsrumsraprvutrpeo` — the official project. No other project was opened. |
| Migration history (tail) | `0100`, `0101`, `0102` (`anonymous_read_policies_fail_closed`), then **`20261115155706` = `0103_security_advisor_remediation`**. Nothing after it. |
| Is 0103 applied? | **Yes** — recorded under the CLI's timestamp version (not `0103`). Independently confirmed by schema: all four audited views carry `security_invoker=true`. |
| Are 0104 / 0105 applied, fully or partially? | **No.** `to_regclass('public.site_pages')` is NULL, and there is no `site_page_*` / `published_page*` / `is_super_admin` object in `pg_proc`. |
| Dependencies 0104 needs | `public.profiles` ✅, `public.super_admin_audit_logs` ✅, `legal_document_acceptances` ✅, `legal_document_current_versions` ✅, `publish_legal_document_version(text,text)` ✅, `is_super_admin()` ❌ (created by 0104 — expected). |
| Acceptance registry content | exactly one row: `seller-agreement @ 1.0`, published `2026-11-15 14:51:11Z`. |
| Migration gaps never authored | `0061`, `0075`, `0076` — deliberate; both gap tests treat them as reserved. |
| Version-format note | The live history mixes `0102` with `20261115155706`. `supabase db push` will warn that the remote timestamped version is not a local file; it must not be "repaired" by editing the remote history. |

Nothing was inferred from GitHub: the migration list above is the database's own
`supabase_migrations.schema_migrations`, read in this session.

---

## 5. Acceptance registry decision and legal rationale

**Decision applied:** the acceptance registry (`legal_document_current_versions`,
0098) holds **only `seller-agreement`**, and no migration or publication script adds
to it. Registration is now an explicit, per-publish, off-by-default operator action.

**Why the registry is not the same thing as the policy library.** A row in that table
means *"the database enforces this version"*: `record_legal_acceptance()` refuses any
other version (`LEGAL_VERSION_NOT_CURRENT`), and `lib/legal/acceptance.ts` asks the
user to accept the version the table holds. Publishing a page, by contrast, only
makes it **readable**. Conflating the two would mean that correcting a comma in the
Privacy Policy could force every retailer and seller to re-accept a document, and
would create an acceptance requirement for purely informational pages (cookies,
coins, IP complaints) that no user should ever be asked to consent to.

**Terms and Privacy consent, reviewed separately.** These are genuinely
consent-worthy, and they are already in `REQUIRED_ACCEPTANCE` for both audiences
(`lib/legal/documents.ts`: `retailer: terms, privacy, retailer-terms`;
`seller: terms, privacy, seller-agreement, prohibited-products`). Today they work
**without** a registry row — `record_legal_acceptance()` accepts any version when no
row exists, which is how the app has been recording them. That is a real gap: a
version the user accepted is not currently enforced for those four documents. Three
options, for the owner:

| Option | Effect | Recommendation |
| --- | --- | --- |
| **A. Leave the registry as it is** | Terms/Privacy acceptance keeps working as today; nothing is enforced version-by-version. No consent change. | Safe default, but leaves the version gap open. |
| **B. Register the four documents at their current published versions**, with the operator ticking the box once per document | Acceptance becomes version-enforced from then on; nobody is forced to re-accept unless the version string changes. | **Recommended**, as a separate, deliberate step *after* stage 1, with the versions matching what users already accepted. |
| **C. Register all 19** | Every informational page becomes an acceptance requirement. | **Rejected** — no legal basis for requiring consent to a cookies or coins page. |

Until the owner chooses, **A is what the code does**, and the publication scripts
never change it.

---

## 6. Android testing status

| Requirement | Status |
| --- | --- |
| About and Legal navigation from **Account** | Implemented (`AccountScreenTags.POLICIES` → `MaharaniRoutes.LEGAL`). **Static review + route test only** — the screen test is not a Compose UI test. |
| Navigation from **Help** | Implemented (`onOpenLegal` on `HelpScreen`). Same caveat. |
| All five UI states | Unit-tested (`ManagedContentViewModelTest`, 15 tests): loading, published, empty, error+retry, and 404-unavailable. Rendering of each branch is reviewed, not instrumented. |
| HTTPS / mailto / tel links | Unit-tested (`openLink`): `/contact` opens in-app, `https`/`mailto` go to the platform, `javascript:` is discarded, a bare `/` is ignored. |
| API failure and retry | Unit-tested: a network failure keeps *Try again*; retry re-reads and recovers; a 404 offers no retry. |
| Kotlin unit tests | **PASS** in CI run 43774795591 (`testDebugUnitTest`, all modules). |
| Android lint | **PASS** in the same run (`lintDebug`, `abortOnError = true`). |
| Physical-device testing | **Has not happened.** No phone, emulator, JDK or Android SDK exists in this environment; the review ran no on-device step. The claim "verified on Android" must not be made. |

Two defects were found by running the pipeline (a cross-module smart cast; a test
double missing the new endpoints — and the integrity test that should have caught it
was blind to a class whose doc comment contained a `)`), both fixed, both re-verified.

---

## 7. Safe SQL application order

Run as the owner, on `fhrmsrumsraprvutrpeo` only, with `0104` and `0105` in **one
transaction each**. Use the CLI (`supabase db push --linked`) rather than the SQL
editor: the editor does not wrap a file in a transaction.

```bash
# 0. Backup / point-in-time recovery confirmed available for the project.
#    (Owner action — this review cannot enable or verify PITR.)

# 1. 0104 — schema + RLS + functions. Nothing becomes readable.
supabase link --project-ref fhrmsrumsraprvutrpeo
supabase db push --linked --include-all        # applies 0104 only (0105 next run if preferred)

# verify: expect 4 tables, 4 RLS-enabled, anon has no privilege, functions present
# (see docs/0104_0105_MIGRATION_AUDIT.md §7 verification queries)

# 2. 0105 — seeds 19 DRAFT pages. Still nothing readable.
# verify: select count(*) filter (where status='published') from public.site_pages;  -- 0

# 3. Stage 1 — publish the nine pages that are already public today.
psql "$SUPABASE_DB_URL" -f supabase/publication/stage1_publish_live_text.sql

# 4. Verify stage 1 before deploying.
psql "$SUPABASE_DB_URL" -f supabase/publication/verify_publication.sql
# expect: drafts 10, published 9, published_without_snapshot 0, future 0

# 5. DEPLOY the application (Vercel). Only now do the routes read the new tables.

# 6. Smoke test the live site: /about, /contact, /legal, /legal/terms, /legal/privacy,
#    and GET /api/mobile/v1/pages (expect 9 pages).

# 7. Stage 2 — ONLY after owner + legal approval of the ten new pages.
psql "$SUPABASE_DB_URL" -f supabase/publication/stage2_publish_reviewed_additions.sql

# 8. Verify again; then re-run the smoke test and the Play/CI Android build if desired.
```

**Do not deploy before step 3.** That is the only ordering that avoids a
customer-visible "not available" on the policy pages.

**Rollback** at any point: unpublish (`update site_pages set status='draft',
published_snapshot=null, published_at=null where slug = …`) makes a page invisible
immediately; `0105…down.sql` removes the seeded drafts; `0104…down.sql` refuses unless
`maharani.allow_data_loss = 'true'`.

---

## 8. Legal pages requiring owner approval before any publication

Stage 1 pages carry wording that is **already public today** — publishing them
changes nothing a customer reads. They still need the owner's confirmation that the
text is current (the contact details, the grievance officer and the return window are
facts only the owner can attest). Stage 2 pages are **new public statements** and
need owner + CA/advocate review before they go live.

| Page | Why it needs a decision |
| --- | --- |
| `terms` | Governing law, COD-only payment, the marketplace carve-out — the owner must confirm these reflect how the shop actually trades. |
| `privacy` | Data categories, retention, the grievance route. Also named in `REQUIRED_ACCEPTANCE`. |
| `returns` | The return window and the damaged-goods process are commercial commitments. |
| `shipping` | Delivery area (Gaya/Bihar), timelines and charges. |
| `grievance` | Requires a named grievance officer and a reachable contact — currently the shop's own phone/email. |
| `business-disclosure` | Legal entity (AJAY KUMAR, proprietor, trade name AJAY GENERAL) and address. |
| `product-safety` | Manufacturer/importer and caution wording. |
| `about`, `contact` | Business identity, phone, email, address, GSTIN (absent — must not be invented). |
| `damaged-goods`, `seller-agreement`, `retailer-terms`, `marketplace-disclaimer`, `gst-pricing-invoice`, `prohibited-products`, `ip-complaints`, `suspension-termination`, `cookies`, `coins-loyalty` | **New text, never public.** Every one is a statement the business would be held to: refund process, GST invoicing, account suspension grounds, contract with sellers, cookie use, and a loyalty programme with monetary value. |

All 19 carry `review_status = 'owner_review_pending'`; no approval is recorded
anywhere, and the platform does not claim one.

---

## 9. Exact owner decisions required

1. **Approve applying `0104`.** (Schema only; nothing becomes readable.)
2. **Approve applying `0105`.** (19 drafts; nothing becomes readable.)
3. **Approve stage 1** (nine already-public pages). Required **before** the deploy.
4. **Approve the deploy window**, and confirm the order in §7.
5. **Acceptance registry:** choose A, B or C in §5. Recommended: **B**, as a separate
   step after stage 1, registering `terms`, `privacy`, `retailer-terms`,
   `prohibited-products` at their current versions (plus the existing
   `seller-agreement`), with explicit owner sign-off.
6. **Owner + legal approval of the ten stage-2 pages.** Until then they stay drafts;
   the site behaves exactly as it does today.
7. **GSTIN and tax details** for the business pages, or an explicit instruction to
   omit them.
8. **Android:** upload keystore + the four CI secrets, then Play Console entry. No
   signed artifact exists and no device run has been performed.
9. **Photo/asset decision** for section images (currently not rendered) — only if a
   page is meant to carry artwork.

---

## 10. What this review did not do

* No SQL was executed on `fhrmsrumsraprvutrpeo` except read-only `SELECT`s.
* Nothing was merged; PR #134 stays open.
* Nothing was deployed to Vercel; no Vercel project setting was changed.
* No Android artifact was signed; nothing was uploaded to Play.
* No device or emulator test was performed.
* No legal, tax or CA opinion was formed or implied — §8 lists what a human must
  decide.
