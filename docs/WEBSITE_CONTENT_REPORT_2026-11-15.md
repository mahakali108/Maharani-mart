# Website content module — phase report (2026-11-15)

Branch `arena/1c8f9eed-maharani-mart`. Sections 1–8 were written at head `60ff20f`;
section 9 records the later session on the same branch (audit, native screens,
security hardening).
Base `main` @ `656a6a4` (merge of PR #126). **Nothing here has been applied to a
live Supabase project, deployed to production, merged, or published to Google
Play.** This report separates what is *implemented*, what was *actually executed
and passed*, and what is *blocked on the owner*.

---

## 1. What a Super Admin now controls

`/admin/content` (Super Admin only, `content.manage`) manages **19 pages** and
their sections:

| Route | Purpose |
| --- | --- |
| `/admin/content` | All pages, publishing state, draft-vs-live warnings, create/delete, business-details summary |
| `/admin/content/[id]` | Page settings (title, intro, nav label, version, effective date, footer/index visibility), section add/edit/delete/reorder, publish/unpublish, internal review notes, publishing history |
| `/admin/content/[id]/preview` | Draft preview — the only place the operator notice and unpublished wording are rendered |
| `/admin/content/business` | Business and contact details that feed the published pages |

Every write goes through a Server Action in `lib/admin/site-content-actions.ts`,
each one guarded by `requireSuperAdmin()`, and through RLS policies that call
`public.is_super_admin()`.

## 2. What a customer sees

* Published snapshot only: `/about`, `/contact`, `/legal`, `/legal/<slug>`.
* Unpublished page → *"This page is not available right now."* (no mention of
  draft/review/admin). Missing page → 404. Read failure → an honest
  "could not be loaded" state, never a fake 404.
* **The yellow "Publication review required" notice no longer exists anywhere in
  public code** — it was retired from the seed and from every public component.
  Internal warnings live only in `/admin/content`.
* All 19 footer links are **managed content**: `loadFooterLinks()`
  (`lib/site-content/nav.ts`) reads `published_pages()` and feeds the public
  shell, the sign-in frame, and the retailer, seller, staff, salesman and admin
  footers. Unpublishing removes the link without a deploy; no component keeps its
  own list.

## 3. Database work (not applied anywhere)

| File | Content |
| --- | --- |
| `supabase/migrations/0104_site_content_management.sql` | `site_pages`, `site_page_sections`, `site_page_revisions`, `site_page_admin_notes`; RLS; publish/unpublish RPCs; `published_page()` / `published_pages()`; checks that refuse an incomplete publish |
| `supabase/migrations/0105_seed_site_content.sql` | Seeds and publishes the wording already live today, moves the operator notices into internal notes, inserts **no** approval (every page stays `owner_review_pending`) |
| `supabase/rollbacks/0104…down.sql`, `0105…down.sql` | Rollbacks; 0104 refuses to drop content unless the data-loss flag is set |

`0103` is skipped deliberately — it belongs to PR #127 (security advisor). The
gap registries in `tests/migration-catalog-invariants.test.ts` and
`tests/retailer-enterprise-upgrade.test.ts` now tolerate either state, so this
branch and #127 cannot conflict.

## 4. Android

* `GET /api/mobile/v1/pages` and `GET /api/mobile/v1/pages/{slug}` are public,
  rate-limited, read through the anonymous client, and return the same published
  snapshots as the website. Drafts → `404 not_found` + `details.reason =
  "unpublished"`. Contract: `docs/NATIVE_ANDROID_API_CONTRACT.md` §2.4.1.
* **The app screens are written** (later in this session — see §9). Account and
  Help both open *Policies & information*: the index of published pages and one
  screen per page, rendering the same text, version and effective date as the
  website. They read the two endpoints above and hold no policy text of their
  own.

## 5. Verification — executed in this session

| Check | Command | Result |
| --- | --- | --- |
| Typecheck | `pnpm run typecheck` | **PASS** |
| Lint | `pnpm run lint` | **PASS**, 0 warnings |
| Full web tests | `pnpm test` | **PASS** — 219 files / 3365 tests |
| Production build | `pnpm run build` | **PASS** |
| New suites (counts as of the first pass; the draft-read regression raised `site-content-db` to 15) | — | `site-content-db` 14, `site-content-public`+`site-content-admin` 23, `site-content-seed` 10, `site-content-footer-nav` 6, `site-content-editor-reads` 6, `legal-registry` 6, `public-information` 6, `mobile-pages-api` 8 |

CI, run [43741769331](https://github.com/mahakali108/Maharani-mart/actions/runs/43741769331)
(commit `60ff20f`, `workflow_dispatch` on this branch) — **whole workflow SUCCESS** in 18 m 55 s:

| Job / step | Result |
| --- | --- |
| Production probe (maharanitraders.vercel.app) | **SUCCESS** |
| Web typecheck | **SUCCESS** |
| Web lint | **SUCCESS** |
| Web tests (full suite) | **SUCCESS** |
| Next.js production build | **SUCCESS** |
| Android unit tests, lint, assemble debug APK | **SUCCESS** |
| Debug APK identity / version / signing check | **SUCCESS** |
| Artifact version against the declared policy | **SUCCESS** |
| Unsigned release APK + AAB for size measurement | **SUCCESS** (correctly reports "unsigned; no keystore") |
| Keystore-dependent steps (signed artifacts) | skipped — no signing secrets exist |
| Build diagnostics bundle uploaded | **SUCCESS** |

Artifacts of that run (downloadable from the run page; this sandbox cannot fetch
GitHub artifact blobs):

| Artifact | Size |
| --- | --- |
| `maharani-traders-debug-apk` (installable debug APK) | 15,602,680 B ≈ 14.9 MB |
| `maharani-traders-release-artifacts` (unsigned release APK + AAB) | 8,524,131 B ≈ 8.1 MB |
| `android-reports` (unit-test + lint reports) | 447,259 B |
| `android-build-diagnostics` | 4,693 B |

Three defects were found and fixed **because** this ran end to end:

1. **`SessionManagerTest`** asserted against a fresh manager (`Restoring`) instead
   of a restored session; production code was correct. Fixed by calling
   `session.restore()` first. Green in CI.
2. **The debug-APK identity step** parsed `versionCode = <number>` and
   `versionName = "…"` out of `build.gradle.kts`, but both are now derived from
   `android/version.properties`, so the expectation was blank and the `aapt`
   greps failed although the APK was correct. It now reads the same
   `version.properties` the next step verifies against, rejects a blank field,
   and prints the tool paths and installed build-tools.
3. **`tests/infinite-scroll-ui.test.tsx` was flaky** (2 of 10 tests, twice in CI):
   it fired the fake `IntersectionObserver` immediately after render/await, when
   the sentinel's observer — registered in an effect after the previous batch
   commits — did not exist yet, so the scroll was a silent no-op. `scrollToBottom()`
   now waits for a live sentinel; the one test whose point is "extra scrolls change
   nothing" uses `scrollToBottomIfObserved()`, which is deliberately a no-op when
   the sentinel is unmounted.

## 6. CI status elsewhere (not caused by this branch)

* **`main` Web CI is failing** ([43733196860](https://github.com/mahakali108/Maharani-mart/actions/runs/43733196860),
  `393a6843`, merge of PR #127) at *Unit and integration tests*. Evidence: `main`
  now contains `supabase/migrations/0103_security_advisor_remediation.sql`, while
  `tests/migration-catalog-invariants.test.ts` on `main` still asserts the gap
  list `['0061','0075','0076']`. That is #127's migration meeting the old
  registry; this branch's tolerant version of the same assertion passes.
* **Cloudflare Workers build** for PR #126 was failing before this work. The cause
  is still unknown from this sandbox (Cloudflare logs are not accessible) and no
  external configuration was touched.
* **Vercel**: the production probe against `maharanitraders.vercel.app` passes.

## 7. Blocked — needs the owner, not more code

| Blocker | Why it cannot be done here |
| --- | --- |
| Owner review of every seeded page | Engineering wording is live; the owner has not approved it. Recorded as *Owner review pending*, never as approved. |
| CA / legal review of the policy set | `docs/legal-review/*` stays `0.1-review-draft` and unpublished. |
| GSTIN / tax details on business pages | Not invented. Must come from the owner. |
| Android release signing (keystore + 4 CI secrets) | No key exists in this repository; release APK/AAB stay unsigned and `ANDROID_RELEASE_*` secrets are missing. |
| Play Console listing / upload | No Play credentials; nothing is published. |
| Third-party marketplace selling | Stays disabled until the owner and CA approve and seller agreements are signed. |
| Applying 0104/0105 to the live Supabase project | Requires explicit approval; not done. |

## 8. Not claimed

* The website is **not** production-ready on the strength of this work: the
  content is unapproved, `main`'s Web CI is red for reasons above, and Cloudflare
  is failing.
* The Android app's legal screens are **not verified on a device**: they compile,
  pass their unit tests and are asserted by the integrity check, but no emulator
  or signed build exists in this environment (see §9).
* No device install/functional test was performed — no device and no keystore in
  this environment.

---

## 9. Update — later session, same day: audit, native screens, hardening

Branch head after this session: see §9.4. Nothing was applied to Supabase, deployed
or merged; the owner decisions in `docs/0104_0105_MIGRATION_AUDIT.md` are still open.

### 9.1 One migration-gap registry (not two)

`tests/helpers/migration-reservations.ts` now owns the single list of
authored-but-unapplied migration numbers plus `classifyMigrationGaps()`, which
scans only the covered span `min…max` (scanning from 1 reports ~97 false gaps
because the numbering has deliberate holes). Both `migration-catalog-invariants`
and `retailer-enterprise-upgrade` call it, so adding a migration is a one-line
change and this branch and PR #127 cannot disagree again.

### 9.2 Security fix: anonymous drafts were readable (0104)

`0104` granted `anon` `SELECT` on `site_pages`/`site_page_sections` filtered by a
row policy (`status = 'published'`). **A policy filters rows, not columns**, so an
anonymous caller could read `title_draft`, `body_draft`, `internal_notes`, the
`seo_*` columns and every section of a published page — including sections hidden
from the live page. Fixed by revoking `ALL` on both tables from `anon`, replacing
the read policies with super-admin-only ones, and pinning `is_super_admin()` to
`search_path = public, pg_temp`. The public surface is unchanged and is the only
one: `published_page(text)` / `published_pages()`.

`tests/site-content-db.test.ts` now proves it: anon → `permission denied`; a
signed-in retailer → `0` rows on both tables; the published document contains
neither the draft sentence nor the hidden section body.

Full write-up: `docs/WEBSITE_CONTENT_SECURITY_REVIEW_2026-11-15.md`.

### 9.3 Audit before applying anything

`docs/0104_0105_MIGRATION_AUDIT.md` records the live state of project
`fhrmsrumsraprvutrpeo` (history ends at `0102` + `20261115155706`; no site-content
tables; `is_super_admin()` absent), every object each file creates, the dependency
order, the risk register R1–R8 and the exact owner actions. **Nothing was applied.**

Open owner decisions: R2 (should the 19 legal pages be registered in the `0098`
acceptance registry through `publish_legal_document_version`, or only
`seller-agreement`?), R4 (applying `0105` publishes all 19 pages immediately with
a backdated `published_at`), and the apply channel (`0104` is not transactional in
the Supabase SQL editor — use the CLI or one transaction).

### 9.4 Phase D — native About and policy screens

| Piece | File |
| --- | --- |
| DTOs | `android/core/network/.../dto/ContentDtos.kt` |
| Endpoints | `MaharaniApi.publishedPages()` / `publishedPage(slug)` |
| Repository | `feature/engagement/ManagedContentRepository.kt` (+ `NetworkManagedContentRepository`) |
| State | `ManagedContentViewModels.kt` — `LegalCentreViewModel`, `ManagedPageViewModel` |
| UI | `ui/ManagedContentScreens.kt` — `LegalCentreScreen`, `ManagedPageScreen` |
| Routes | `MaharaniRoutes.LEGAL`, `MaharaniRoutes.LEGAL_PAGE`, `legalPage(slug)`; registered in `AuthenticatedShell` |
| Entry points | Account → *Policies & information*; Help → *Policies & information* |
| Tests | `ManagedContentSerializationTest.kt` (contract), `ManagedContentViewModelTest.kt` (states, link routing), `LegalRoutesTest.kt` (routes) |

The app holds **no** policy text and no page list: the server decides what exists,
what it says, its version and its effective date. The five states are explicit —
loading, published, empty (*"No published pages yet"*), error with retry, and
*unavailable* for the server's `404`, which is shown with the website's own
sentence and **no** retry button because retrying cannot publish a page. An
on-site link (`/contact`) opens the same page inside the app; only `https`,
`mailto:` and `tel:` are handed to the platform; any other scheme becomes plain
text. Section images are deliberately not rendered in this release.

Two CI defects were found and fixed by running the pipeline (each was a real
compile/test failure, not a flake):

1. `:feature:engagement:compileDebugKotlin` — `SMARTCAST_IMPOSSIBLE` on
   `AppResult.error` (a public property declared in another module). Bound to a
   local before the type test.
2. `:core:auth:compileDebugUnitTestKotlin` — `FakeMaharaniApi` was missing the two
   new endpoints. The integrity test that exists to catch exactly this never saw
   the class: its regex ended the constructor match at a `)` inside a doc comment.
   The check now blanks comments before matching, and a mutation was used to prove
   it now names the class.

### 9.5 Verification — executed, this session

| Gate | Result |
| --- | --- |
| `corepack pnpm test` (full web suite) | **PASS** — 220 files / 3372 tests |
| Target suites (`site-content-db`, `api-privilege-hardening`, `migration-catalog-invariants`, `site-content-admin`, `mobile-pages-api`, `public-information`, `site-content-seed`, `site-content-public`) | **PASS** — 86 tests |

CI, run [43774795591](https://github.com/mahakali108/Maharani-mart/actions/runs/43774795591)
(commit `683fac9`, `workflow_dispatch` on this branch) — **whole workflow SUCCESS**:

| Job / step | Result |
| --- | --- |
| Production probe | **SUCCESS** |
| Web typecheck / lint / full tests / Next.js build | **SUCCESS** |
| Android unit tests + lint | **SUCCESS** (includes the four new Kotlin test files) |
| Debug APK assembled, identity/version verified | **SUCCESS** |
| Unsigned release APK + AAB for size measurement | **SUCCESS** (still reports "unsigned; no keystore") |
| Keystore-dependent steps | skipped — no signing secrets exist |

Two earlier dispatches of the same workflow failed on the compile errors in §9.4
(runs `43773560359` and `43772660295`); the failures are what identified them.

### 9.6 Still blocked — unchanged

Owner review of the seeded wording, CA/legal review, GSTIN, Android keystore and
Play Console, applying `0104`/`0105`, deploying, and any decision on R2/R4. No
device install or end-to-end run against live Supabase has happened.
