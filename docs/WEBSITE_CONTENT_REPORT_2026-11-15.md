# Website content module — phase report (2026-11-15)

Branch `arena/1c8f9eed-maharani-mart` (head `eeaeceb`, then the CI fix commit).
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
* **Not implemented:** native About/legal screens in the app. The endpoints exist
  and are tested; the Compose screens that consume them are not written. Do not
  read this as "the app shows the policies" — it does not yet.

## 5. Verification — executed in this session

| Check | Command | Result |
| --- | --- | --- |
| Typecheck | `pnpm run typecheck` | **PASS** |
| Lint | `pnpm run lint` | **PASS**, 0 warnings |
| Full web tests | `pnpm test` | **PASS** — 219 files / 3365 tests |
| Production build | `pnpm run build` | **PASS** |
| New suites | — | `site-content-db` 14, `site-content-public`+`site-content-admin` 23, `site-content-seed` 10, `site-content-footer-nav` 6, `site-content-editor-reads` 6, `legal-registry` 6, `public-information` 6, `mobile-pages-api` 8 |

CI, run [43737805333](https://github.com/mahakali108/Maharani-mart/actions/runs/43737805333)
(commit `e2030d6`, `workflow_dispatch` on this branch):

| Job | Result |
| --- | --- |
| Production probe (maharanitraders.vercel.app) | **SUCCESS** |
| Web typecheck, lint, tests, build | **SUCCESS** |
| Android unit tests | **SUCCESS** — 43/43 in `:core:auth`, including the previously failing "wrong password" case |
| Android APK identity check | **FAILURE — a defect in the workflow, not the app** (fixed, rerun pending) |

Two defects were found and fixed *because* this ran:

1. **`SessionManagerTest`** asserted against a fresh manager (`Restoring`) instead
   of a restored session; production code was correct. Fixed by calling
   `session.restore()` first. Confirmed green in CI.
2. **The debug-APK identity step** parsed `versionCode = <number>` and
   `versionName = "…"` out of `build.gradle.kts`, but both are now derived from
   `android/version.properties`, so the expectation was blank and the `aapt`
   greps failed although the APK was correct. It now reads the same
   `version.properties` the next step verifies against, rejects a blank field,
   and prints the tool paths and installed build-tools.

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
* The Android app is **not** "feature complete for legal pages": the API exists,
  the screens do not.
* No device install/functional test was performed — no device and no keystore in
  this environment.
