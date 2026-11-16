# Public page continuity — 19 URLs must not disappear

**Prepared:** 16 November 2026. **Nothing was published, unpublished or deployed.**
Verification artefact: `supabase/publication/verify_continuity.sql` (read-only,
executed by `tests/site-content-continuity.test.ts`).

---

## 1. What is public before this change

Nineteen URLs are served today. They come from two mechanisms, which is why the
"stage 1 / stage 2" split exists at all:

| # | URL | Source before | Stage | Legacy alias |
|---|---|---|---|---|
| 1 | `/about` | `app/about/page.tsx` (JSX) | 1 | — |
| 2 | `/contact` | `app/contact/page.tsx` (JSX) | 1 | — |
| 3 | `/legal/terms` | own page file | 1 | `/terms` → redirect |
| 4 | `/legal/privacy` | own page file | 1 | `/privacy` → redirect |
| 5 | `/legal/returns` | own page file | 1 | `/returns` → redirect |
| 6 | `/legal/shipping` | own page file | 1 | `/shipping` → redirect |
| 7 | `/legal/grievance` | own page file | 1 | — |
| 8 | `/legal/business-disclosure` | own page file | 1 | — |
| 9 | `/legal/product-safety` | own page file | 1 | — |
| 10 | `/legal/damaged-goods` | `app/legal/[slug]` + `lib/legal/content.ts` | 2 | — |
| 11 | `/legal/seller-agreement` | same | 2 | — |
| 12 | `/legal/retailer-terms` | same | 2 | — |
| 13 | `/legal/marketplace-disclaimer` | same | 2 | — |
| 14 | `/legal/gst-pricing-invoice` | same | 2 | — |
| 15 | `/legal/prohibited-products` | same | 2 | — |
| 16 | `/legal/ip-complaints` | same | 2 | — |
| 17 | `/legal/suspension-termination` | same | 2 | — |
| 18 | `/legal/cookies` | same | 2 | — |
| 19 | `/legal/coins-loyalty` | same | 2 | — |

Plus `/legal` itself, the index — a route, not a stored page.

Every one of the nineteen was verified against this repository at `656a6a4`
(`STAGE1_PAGE_REVIEW.md` §2 and `STAGE2_OWNER_CA_CHECKLIST.md` §1): stage 1 carries
the nine **verbatim**, stage 2 carries the ten **verbatim** (0 added, 0 dropped
sentences).

---

## 2. Everything that reads the published state

| Reader | What it shows when 0 pages are published | When 9 are published | When 19 are |
|---|---|---|---|
| Footer links (`loadFooterLinks()`) | the 9-entry `FALLBACK_FOOTER_LINKS` constant + *All policies* | the 9 published pages + *All policies* | the 19 + *All policies* |
| `/legal` index | "Policies are being updated" card | 7 legal pages in 3 audience groups | 17 legal pages |
| Android app *Policies & information* | empty/error state from `GET /api/mobile/v1/pages` | 9 entries | 19 entries |
| `GET /api/mobile/v1/pages`, `/pages/{slug}` | `database_unavailable` (migrations absent) or an empty list | 9 | 19 |
| `layout.tsx` / admin shells that render footer links | fallback constant | 9 | 19 |

Two consequences that are easy to miss:

* the fallback footer is **navigation only**; every address in it is safe to click
  and shows the clean "not available" state rather than a draft;
* the `/legal` index groups by audience from the published rows, so a page that is
  a draft cannot appear in a group — it disappears from the index without leaving a
  broken link.

---

## 3. The gap, stated exactly

If the deploy happens after stage 1 and before stage 2:

* **10 of 19 URLs answer "This page is not available right now."** — all ten
  stage-2 policies, including `/legal/seller-agreement`, which the acceptance card
  links to;
* the footer drops from 19 entries to 9;
* the `/legal` index drops from 17 legal pages to 7;
* the Android policies screen drops from 19 entries to 9;
* nothing crashes, no draft leaks, and the four legacy redirects
  (`/terms`, `/privacy`, `/returns`, `/shipping`) still land on live pages, because
  all four targets are stage-1 pages.

`verify_continuity.sql` reports exactly this: `published = 9, missing = 10`, with
each missing slug named. The test asserts those numbers, so the gap is measured, not
estimated.

---

## 4. The two ways to close the gap

### Plan A — one coordinate, one transaction (recommended when a gap is unacceptable)

Stage 1 and stage 2 are both plain `do $$ … $$` blocks with no DDL and no
`CONCURRENTLY`, so they can run in a single transaction. Either all nineteen pages
become public, or none do:

```sql
begin;
  -- paste supabase/publication/stage1_publish_live_text.sql
  -- paste supabase/publication/stage2_publish_reviewed_additions.sql
commit;
```

The scripts are written to be combined: each skips a page that is already published,
so running them in either order — or twice — converges on the same state
*[executed: re-running stage 2 leaves every `published_at` unchanged]*.

What this buys: no page ever goes dark, and the deploy has exactly one moment at
which public content changes.
What it costs: it publishes ten documents no CA has blessed yet. That is the whole of
Decision D2; this document does not decide it.

### Plan B — stage 1, deploy, stage 2 later (the briefed order)

```text
S1  apply 0104 → 0105 → 0106
S2  run verify_continuity.sql          → expect published 0,  missing 19
S3  run stage1_publish_live_text.sql
S4  run verify_continuity.sql          → expect published 9,  missing 10  ← the gap
S5  run verify_publication.sql         → 9 published, 10 drafts, 0 without snapshot
S6  deploy the web app
S7  check the 19 URLs by hand (§5)
S8  run stage2_publish_reviewed_additions.sql after owner + CA sign-off
S9  run verify_continuity.sql          → expect published 19, missing 0
```

The gap lasts from S6 to S8. It is a scheduling decision, not a defect: the pages are
drafts because the brief says they are drafts.

---

## 5. What to check on the deployed site, in order

1. `/about`, `/contact` — 200, correct title, contact block intact.
2. `/legal` — the seven stage-1 legal pages, three audience groups, the
   "Not published because the feature does not exist" card (§6), the "How changes
   are made" card.
3. `/legal/{terms,privacy,returns,shipping,grievance,business-disclosure,product-safety}`
   — 200, version 1.0, effective 04 November 2026.
4. `/terms`, `/privacy`, `/returns`, `/shipping` — 308 to the `/legal/*` targets, and
   the target renders.
5. `/legal/{cookies,seller-agreement,…}` — either 200 (Plan A / stage 2 done) or the
   clean unavailable state (Plan B, gap open). Never a stack trace, never a draft.
6. Footer on any page — the same set as the index.
7. `/api/mobile/v1/pages` — the same set, and `details.reason = "unpublished"` for a
   draft slug.
8. Android *Policies & information* — the same list (see
   `ANDROID_SIGNED_RELEASE_PLAN.md` §4).

---

## 6. Content continuity fix made in this phase

The rewrite of `/legal` dropped a public disclosure: the old page rendered
`NOT_APPLICABLE_DOCUMENTS` as *"Not published because the feature does not exist"*
(the advertising / sponsored-listing policy), and the new index did not. That is
content disappearing from a live page for no reason connected to the release.

Restored in `app/legal/page.tsx`, guarded by `length > 0`, with a regression test in
`tests/public-information.test.ts` ("keeps the public disclosure of which document is
deliberately not published"). `NOT_APPLICABLE_DOCUMENTS` remains the single source of
that text.

---

## 7. Executed evidence

| Check | Result |
|---|---|
| 0105 applied, nothing published | continuity: `published 0, missing 19` |
| stage 1 applied | `published 9, missing 10`, zero pages without a snapshot |
| legacy redirect targets after stage 1 | all four published |
| stage 2 applied | `published 19, missing 0`, index size 19, all anonymous states `published` |
| stage 2 re-applied | every `published_at` unchanged (idempotent) |
| footer/index/API counts | derived from the same `published_pages()` function, asserted in the mobile-pages and site-content tests |

Tests: `tests/site-content-continuity.test.ts` (4), `tests/site-content-release.test.ts`
(5), `tests/site-content-db.test.ts` (18), `tests/mobile-pages-api.test.ts`.

---

## 8. What is still unverified

* No page has been published anywhere, so none of the above has been observed against
  the official project or a deployed build.
* The Android screen has never been run on a device — its list is asserted from the
  API contract and the route tests, not from a screen.
* Sitemap/SEO behaviour is unchanged by this release only because this repository
  ships no sitemap route (`app/sitemap.ts` does not exist); if one is added later it
  must read `published_pages()` too, or it will advertise drafts.
