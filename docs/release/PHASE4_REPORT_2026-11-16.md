# Phase 4 — final release orchestration

> **SUPERSEDED — kept as a historical record.** This document describes the site as it stood on the
> date in its title and quotes statutory facts that were later withdrawn because the owner never
> verified them (the proprietor's personal name, the trade-name registration status, the registered
> address, the named grievance officer). Do not copy any identity or contact line out of this file.
> The current approved statement is: *Maha Bazar by Maharani is the customer-facing website and app
> name for the AJAY GENERAL proprietorship, which trades under the brand MAHARANI TRADERS. AJAY
> GENERAL is the legal seller and invoice issuer. Maharani Traders is a trading style, not a separate
> incorporated company or legal entity. Maa Kali Enterprises is a separate business identity.*
> See `docs/repair/MAHA_BAZAR_BUSINESS_IDENTITY_REPORT.md`.

**Status: review package complete. Nothing was applied, published, deployed, created,
signed or merged.** No SQL was executed against `fhrmsrumsraprvutrpeo` in this phase;
every live statement was a read. The single checklist the owner signs is
`docs/release/FINAL_OWNER_APPROVAL_AND_LAUNCH_CHECKLIST.md`.

| | |
|---|---|
| Branch | `arena/1c8f9eed-maharani-mart` |
| Pull request | **#134 — open, not merged** |
| Supabase project | `fhrmsrumsraprvutrpeo` (official) |
| Production site | https://maharanitraders.vercel.app |
| Android | unsigned debug builds only; no device testing, no Play Console |

---

## 1. Fresh verification of the live state (16 November 2026)

Everything below was re-read in this phase. Earlier reports were **not** carried
forward.

### 1.1 Database

| Check | Result |
|---|---|
| `list_migrations` | history ends at `20261115155706` (0103). **0104, 0105 and 0106 are absent.** |
| `site_page*` tables | 0 |
| `super_admin_bootstrap*` tables | 0 |
| `bootstrap_super_admin()`, `is_super_admin()` | absent |
| `auth.users` rows | **0** |
| `profiles` rows | **0** |
| Super Admin accounts | **0** — every privileged surface is unreachable |
| `legal_document_current_versions` | only `seller-agreement 1.0` |
| `marketplace_launch_approvals` | 0 |
| products / orders | 0 / 0 |
| Published pages | **0 of 19** |

The project is a clean, empty instance: applying 0104–0106 cannot overwrite user
data because there is none. It also means the storefront has no live catalogue, so
the 19 public pages are the whole public surface today.

### 1.2 Production site — a correction that changes the release order

Fetched directly from the deployed site (read-only HTTPS GETs, no credentials):

| URL | Result |
|---|---|
| `/legal` | 200 — lists **17** documents, and the "not published because the feature does not exist" card |
| `/about` | 200 — eyebrow "What we do", title "Wholesale, with clearer choices" |
| `/contact` | 200 — eyebrow "Support", title "Get help with your account or order" |
| `/legal/seller-agreement` | 200 — full agreement, version 1.0, contact block |
| `/legal/cookies` | 200 — full notice, version 1.0, contact block |

Four of the five fetches are a **stage-2** page or a page that stage 2 depends on,
and they are live *now*. That refutes an assumption written into
`supabase/publication/README.md`:

> ~~"the 10 stage-2 pages are beyond what the site published before, so leaving
> them as drafts keeps the public surface exactly as it is today."~~

That statement was false, and the order of operations built on it ("deploy, then
run stage 2 whenever") would have taken **ten live URLs** off the air for however
long the gap lasted:

```
/legal/damaged-goods      /legal/seller-agreement    /legal/retailer-terms
/legal/marketplace-disclaimer   /legal/gst-pricing-invoice
/legal/prohibited-products      /legal/ip-complaints
/legal/suspension-termination   /legal/cookies        /legal/coins-loyalty
```

`seller-agreement` is the sharp edge: acceptance is enforced at `1.0` in the
registry, so a seller invitation issued during that gap would ask a person to
accept a page that answers "This page is not available right now."

**Fixed in this phase:** `supabase/publication/README.md` now states the verified
fact, moves stage 2 before the deploy, names the ten URLs, and
`tests/site-content-seed.test.ts` fails if the dangerous order is ever restored
("publishes both stages before the deploy", 1 test).

**Also fixed:** the health probe had no coverage of any of these pages — "the site
is up" would have stayed green while policies 404'd. `scripts/production-health-probe.py`
gained a `--pages` mode: **19 anonymous GETs, one per published page, expecting
200**, plus 4 offline guards in `tests/production-health-probe.test.ts` that keep
its path list equal to `content/site-pages.seed.json`. It can be run on launch day
from any machine with egress (this sandbox has none) and writes the same
machine-checkable JSON as the health probe.

### 1.3 Wording drift — measured, not assumed

Re-running the seed generator against the current page sources:

```
node --experimental-strip-types scripts/generate-site-content-seed.mjs
Wrote content/site-pages.seed.json and migrations/0105 (19 pages, 70 sections).
$ git status --porcelain      # empty
```

Byte-identical. Combined with two static facts — `lib/legal/content.ts` and
`lib/legal/documents.ts` are **unchanged** from the base commit `656a6a4`, and the
four live pages I fetched match the seed sentence for sentence — the seed
reproduces today's customer-visible wording, and publishing it is a move from JSX
to database, not a rewrite.

All seventeen seeded document titles equal the titles the live site renders today
(checked programmatically, 17/17). The two page titles (`about`, `contact`) equal
the live `<h1>` and eyebrow strings. **There is no title change in this release.**

### 1.4 Vercel — could not be verified

The Vercel connector authenticates (`mahakali1`, `limited: true`) but both
`list_projects` and `list_deployments` return *"Access denied. Your token may not
have the required permissions."* I did not retry.

So the following remain **unverified**, and are owner items in the checklist rather
than claims in this report: the project's Git link and production branch, build
command and Node version, environment variables, domain/redirect configuration, and
which commit is currently deployed. What *is* verified about production is
behavioural: the pages above answer 200 with the wording recorded here, and the
probe job on this branch's head is green.

---

## 2. Release orchestration — one window

Order is unchanged from the approved plan except for the correction in §1.2:
**both publication stages run before the deploy**, not one before and one after.

| # | Step | Approval | Verification | If it goes wrong |
|---|---|---|---|---|
| 0 | Snapshot the two things Git does not hold: published snapshots and the registry (`ROLLBACK_AND_RECOVERY.md` §5), plus a Supabase dashboard backup | owner | `select count(*)` on the backup table = 19 | none needed; nothing has changed yet |
| 1 | Apply **0104** (schema, RLS, functions, acceptance registry opt-in) | owner | `verify_publication.sql` → 0 published | `rollbacks/0104_*.down.sql` |
| 2 | Apply **0105** (19 draft pages, 70 sections) | owner | 19 drafts, 0 published, anon reads nothing | `rollbacks/0105_*.down.sql` |
| 3 | Apply **0106** (bootstrap allowlist/events, guard, `bootstrap_super_admin`) | owner | tables exist, no grants to API roles | `rollbacks/0106_*.down.sql` |
| 4 | Run `verify_continuity.sql` | — | 19 draft, 0 missing rows | stop |
| 5 | Run **stage 1** (9 pages) | owner | 9 published, 10 draft | unpublish one page, or full rollback |
| 6 | Run **stage 2** (10 pages) | owner + legal | **19 published, 0 draft** | unpublish one page |
| 7 | Create the owner login, allowlist row, `bootstrap_super_admin()` — `SUPER_ADMIN_BOOTSTRAP.md` §4 | owner (separate decision) | one `super_admin`, one event, allowlist consumed | the account is just a profile; role can be reverted in SQL |
| 8 | **Deploy** the application | owner | `--pages` probe: 19/19; health probe: 11/11 | Vercel rollback to the previous deployment |
| 9 | Verify Android managed-content endpoints | owner | `/api/mobile/v1/pages` returns 19 entries | unpublish if a page must be withdrawn |
| 10 | Registry decision (A / B1 / B2 / C) | owner + CA | acceptance screen lists readable pages | delete the registered row |

Steps 5–6 are minutes apart, before any customer sees the new code. Because the
wording is identical (1.3), a customer sees **no change at step 8** except the
removal of the internal review banner described in §4.1 — which is the one visible
difference in the whole release.

---

## 3. First Super Admin — reviewed, not created

`docs/release/SUPER_ADMIN_BOOTSTRAP.md` (214 lines) plus 10 execution tests
(`tests/super-admin-bootstrap-db.test.ts`, PostgreSQL 16) were re-checked against
the objectives:

| Requirement | Where it is enforced | Verified |
|---|---|---|
| allowlist authorisation | `super_admin_bootstrap_allowlist`, `check (id = 1)` | ✔ one row only, DB owner writes it |
| DB-owner-only execution | gate 1: `session_user` ∈ {postgres, supabase_admin} | ✔ PostgREST connects as `authenticator`, so an API call cannot pass even if EXECUTE leaked |
| one-time consumption | `consumed_at`, gate 3 | ✔ second call raises |
| confirmed email required | gate 4: `email_confirmed_at is not null` | ✔ |
| exact address match | gate 5: `lower(email)` equality | ✔ |
| no public API execution | `EXECUTE` revoked from `anon`, `authenticated`, `service_role` | ✔ test asserts `permission denied for function` |
| no service-role bypass | `service_role` holds `SELECT` only on both tables | ✔ INSERT/UPDATE/DELETE denied |
| append-only event | one row written per successful bootstrap | ✔ no API write path |
| role-insert guard | `guard_profile_role_insert()` on `profiles` | ✔ refuses privileged INSERT from API roles |
| MFA + recovery | owner steps 0 and 6 (dashboard MFA, private mailbox) | ✔ documented, **not enforceable in code** — project setting |

The owner procedure is §4 of that document (7 steps: decide who + MFA → apply 0106 →
create the login → write the allowlist row → `bootstrap_super_admin(id)` → verify with
three queries → add the second admin through `/admin/team`). **No account, profile or
allowlist row exists anywhere.** The live project still has 0 `auth.users`.

---

## 4. Consolidated owner review table

One table for every wording/commercial decision this release touches. "Live today"
is what a customer reads *right now*; "after release" is what the same URL shows
after step 8. Recommendation column is advice, not a decision.

### 4.1 The one visible change: the internal review banner

| Item | Live today | After release | Owner decision | Recommendation |
|---|---|---|---|---|
| "**Publication review required.** Business and contact details are owner-provided… require operational verification and Indian legal/tax review before production publication…" | Rendered on **all 19 pages** | **Gone from all 19** — moved into `site_page_admin_notes`, visible only in `/admin/content` | ☐ approve removal ☐ keep it public | **Approve removal.** It is an operator note written in the customer's voice; on a live site it advertises that the policies were never reviewed, which is worse than silence. The obligation it describes does not disappear — it moves to this checklist, where it can be ticked. Tests `site-content-public`/`site-content-seed` already forbid it in published text. |

### 4.2 Page titles (previously "3 titles to approve")

| Page | Live title | Seeded title | Decision |
|---|---|---|---|
| grievance | Grievance Redressal Policy | identical | **no change** |
| business-disclosure | Contact and Legal Information | identical | **no change** |
| product-safety | Product Authenticity and Safety Policy | identical | **no change** |
| all 17 documents | — | 17/17 identical to `lib/legal/documents.ts` | **no change** |
| about / contact | as live `<h1>` | identical | **no change** |

**D1 is closed: zero title changes.** Any further renaming is an editorial decision
for a *later* version, not a launch blocker.

### 4.3 The nine engineering caveats in customer-facing text

These sentences are live today and would be republished verbatim. Each proposed
rewrite is a **proposal only** — nothing in the seed was changed.

| # | Page | Live text (abridged) | Proposed replacement | Owner/CA |
|---|---|---|---|---|
| 1 | privacy (intro) | "…all uses, including any marketplace processing, require verification before publication." | "This policy describes how this website handles personal information." | ☐ |
| 2 | privacy (sharing) | "Marketplace data flows and disclosures require verification before any third-party operation." | "Where a third-party seller fulfils an order, that seller receives the order and delivery details needed to fulfil it." | ☐ |
| 3 | privacy (sharing) | "…actual deployment and provider arrangements should be verified before publication." | "Authentication is provided by Supabase and site analytics by Vercel." | ☐ |
| 4 | privacy (cookies) | "Any legally required consent mechanism must be implemented and verified before publication." | "We will ask for consent where the law requires it before using non-essential cookies or analytics." | ☐ |
| 5 | privacy (retention) | "Retention periods and deletion procedures require verification…" | "We keep order and tax records for the period required by law, and other information only as long as needed." | ☐ |
| 6 | grievance | "…require operational and legal verification before publication…" | delete the clause; keep "Applicable statutory rights and timelines are not affected." | ☐ |
| 7 | business-disclosure | "The GST certificate, GSTIN, registration status and invoice configuration have not been independently verified." | "GSTIN: <to be supplied>." — or omit until the number exists | ☐ |
| 8 | business-disclosure | "…we have not verified whether those features are operating in production." | "Third-party seller offers are not operating at present." (true: switch OFF) | ☐ |
| 9 | about | "GST and other statutory invoice information must be verified before publication." | delete | ☐ |
| — | shipping | "The current checkout blocks online ordering for PINs configured with a positive delivery fee…" | "Where a delivery charge applies, it is shown at checkout before the order is confirmed." | ☐ |
| — | business-disclosure | "If online payment gateways, wider delivery areas, food products or other services are introduced later…" | **keep as-is** — legitimate forward-looking statement | — |

Two matter beyond cosmetics: #7 is the sentence a customer would quote in a
complaint about a missing invoice, and #6 advertises an unverified complaint
process. Editing **before** step 5 costs nothing (regenerate the seed); editing
after publication means version `1.0 → 1.1` and, if registered, a re-acceptance.

### 4.4 Grievance officer and timelines

| Item | Live today | Needs |
|---|---|---|
| Named officer, address, phone, email | AJAY KUMAR, Proprietor; Plot No. 231, Ander Bazar, Belaganj, Gaya, Bihar – 804403; 8987023959; adinathsahu8987@gmail.com | owner confirms each is monitored and current |
| Acknowledgement window | published as "**proposed** 48 hours" | owner decides: commitment or target. A consumer forum reads "proposed" as evasive and the number as a promise |
| Resolution window | published as "**proposed** one month" | same decision |
| Record-keeping | no evidence trail configured | confirm the mailbox retains complaints |

### 4.5 GSTIN and tax invoices

| Item | State |
|---|---|
| GSTIN | **not published anywhere, and not available to this review** — nothing was invented |
| Tax invoice | **cannot be issued today**: no GSTIN, no invoice series, no HSN/rate list |
| Policy text | `gst-pricing-invoice` describes GST-inclusive pricing and invoice timing without a number — honest, but incomplete for a customer |
| Invoice issuer | policies say the proprietorship issues the invoice for own-stock sales | owner must confirm that matches the GST registration |
| Decision | ☐ supply GSTIN and invoice series ☐ publish only after CA confirms display ☐ leave unstated until then |

### 4.6 Seller agreement

| Item | State |
|---|---|
| Page | live today, version 1.0, effective 14 Nov 2026 |
| Registry | `seller-agreement 1.0` is the **only** registered/enforced document |
| Acceptance record | preserved by this release; nothing in the publication scripts touches the registry (asserted by tests) |
| Commercial gaps | commission/payout cycle deliberately absent; TCS/TDS undecided; liability cap, indemnity, notice period, forum absent |
| Launch impact | none for own-stock sales; **blocking for the first third-party seller**. Publish stage 2 in the same window (§2) so the page a seller must accept is readable |

### 4.7 Privacy / DPDP

| Item | State |
|---|---|
| Policy page | live, version 1.0 |
| Data actually collected | listed in `LEGAL_TAX_READINESS.md` §3.1 — owner must confirm each item |
| Processors | Supabase (auth/db) and Vercel (hosting, Web Analytics) — locations and DPA position unconfirmed |
| Retention | 14-day AI-retention window exists in code (0084); financial 120-day window is **on hold** |
| Consent mechanism | none implemented for analytics; the policy promises one "where the law requires" |
| Data-principal route | access/correction/deletion described; the answering mailbox is unverified |
| Decision | ☐ CA review before launch ☐ accept the caveat text as-is |

### 4.8 Marketplace TCS / TDS

| Item | State |
|---|---|
| Marketplace switch | **OFF** (`marketplace_launch_approvals` = 0 rows) |
| TCS s.52 CGST / TDS s.194-O | not registered, not computed, no code path verified |
| Customer impact today | none — there are no third-party offers |
| Decision | ☐ stay OFF for launch (recommended) ☐ CA sign-off + registration before any seller goes live |

---

## 5. Publication and the acceptance registry

| Stage | Pages | Live today (JSX) | After step 6 (DB) |
|---|---|---|---|
| stage 1 | `about`, `contact`, `terms`, `privacy`, `returns`, `shipping`, `grievance`, `business-disclosure`, `product-safety` | 9 live | 9 published |
| stage 2 | `damaged-goods`, `seller-agreement`, `retailer-terms`, `marketplace-disclaimer`, `gst-pricing-invoice`, `prohibited-products`, `ip-complaints`, `suspension-termination`, `cookies`, `coins-loyalty` | 10 live | 10 published |

19 in, 19 out, same words, real `now()` timestamps, no backdating, no approval row
written. Executed proof: `tests/site-content-continuity.test.ts` (19 live before →
19 published after both stages, idempotent re-run) and 14 catalog invariants in
`tests/migration-catalog-invariants.test.ts`.

**Registry recommendation (unchanged, restated with the numbering decision):**

| Option | What it registers | Verdict |
|---|---|---|
| **A** | nothing (`seller-agreement 1.0` only) | safe, but a material edit to `terms` would go live with no re-acceptance |
| **B1** | `terms`, `privacy` — **same window as stage 1** | **recommended** |
| **B2** | `retailer-terms`, `prohibited-products` — only once public | **recommended**, same window |
| **C** | all 19 | **not recommended** — 14 are notice documents nobody accepts; it pins versions for pages the acceptance UI never shows |

Sequence: fix/accept the §4.3 wording first → B1 and B2 in the launch window →
record the SQL, the output of the verification query, who ran it and when. The
`legal_document_current_versions` row for `seller-agreement 1.0` is preserved
either way; the publication scripts are asserted not to touch it.

---

## 6. Android readiness

| Item | State |
|---|---|
| Four secret names | `ANDROID_RELEASE_KEYSTORE_BASE64`, `ANDROID_RELEASE_KEYSTORE_PASSWORD`, `ANDROID_RELEASE_KEY_ALIAS`, `ANDROID_RELEASE_KEY_PASSWORD` — **none configured**; the workflow prints `BLOCKED` and marks its artifact UNSIGNED |
| Keystore generation | `ANDROID_SIGNED_RELEASE_PLAN.md` §2: `keytool` on the owner's machine, `-validity 10950`, never in the repo or CI; back up twice offline (encrypted drive + printed recovery sheet). Losing it means the app can never be updated |
| Signing | workflow does **not** sign; the owner runs `./gradlew assembleRelease bundleRelease` with `RELEASE_*` env vars and verifies with `apksigner --print-certs` |
| Device plan | 23 cases (A1–A5 install/identity, B1–B4 sign-in/session, C1–C11 policies, D1–D3 acceptance). **None executed** — no device, emulator, JDK or SDK here |
| Native legal pages | Account → About & policies and Help → Policies & information both route to `MaharaniRoutes.LEGAL`, which reads `/api/mobile/v1/pages` → `published_pages()` |
| Session / role / offline / retry | covered by B1–B4, A5, C7–C10 as *cases*; not asserted by any build artifact |

Two plan adjustments forced by the corrected order (§2): with both stages published
before the deploy, C2 ("exactly 9 entries") and C6 ("stage-2 page absent during the
gap") should not be reachable in production — C3 (`19 entries`) and D3
("agreement readable before accepting") are the cases that must pass. Nothing was
signed, installed on a device, or uploaded.

---

## 7. Verification performed in this phase

| Check | Command | Result |
|---|---|---|
| Full web suite | `corepack pnpm test` | **224 files, 3,409 tests passed** (was 3,404: +4 probe guards, +1 publication-order guard) |
| Typecheck | `corepack pnpm run typecheck` | clean |
| Lint | `corepack pnpm run lint` | clean |
| Production build | `corepack pnpm run build` | clean; `/legal/[slug]`, `/about`, `/contact` present |
| Seed drift | `node --experimental-strip-types scripts/generate-site-content-seed.mjs` | byte-identical, no diff |
| Probe self-test | `python3 scripts/production-health-probe.py --self-test` | PASSED (includes the 19-page mode) |
| PostgreSQL suites | 0104/0105/0106 replay, catalog invariants, continuity, release procedure, bootstrap | all pass on PostgreSQL 16 |
| Android | unit tests + lint + assembleDebug (CI) | pass; **unsigned** |
| CI | workflow on this head | see PR #134 checks |

---

## 8. What this phase did not do

* No SQL executed against the live project. No migration applied.
* No page published, no registry row added, no acceptance recorded.
* No account, profile, allowlist row or Super Admin created.
* No deploy, no Vercel setting changed, no domain touched.
* No keystore generated, no secret added, no signed artifact, no Play Console action.
* No device testing and no claim of it.
* No customer-facing wording changed — §4.3 remains proposals only.
* No merge. PR #134 stays open for the owner.

## 9. Decisions this checklist needs from the owner

| # | Decision | Status after this phase |
|---|---|---|
| D1 | Three page titles | **closed — no change needed** (§4.2) |
| D2 | One window vs ten URLs dark | **recommendation changed and implemented in the docs: one window, both stages before the deploy** (§1.2, §2) |
| D3 | Registry option A / B1 / B2 / C | B1+B2 recommended (§5) |
| D4 | Banner removal | recommend approve (§4.1) |
| D5 | Nine caveat rewrites | owner + CA, before step 5 if possible (§4.3) |
| D6 | GSTIN / invoice series | open — no number exists (§4.5) |
| D7 | Grievance timelines: commitment or target | open (§4.4) |
| D8 | Marketplace switch stays OFF | recommend keep OFF (§4.8) |
| D9 | Return window, COD refund method, commission/payout, Coins expiry (the 15 stage-2 commercial items) | open, `STAGE2_OWNER_CA_CHECKLIST.md` |

Everything above is inert until the owner runs it. The sequence in §2 and the
tick-list in `FINAL_OWNER_APPROVAL_AND_LAUNCH_CHECKLIST.md` are the same release:
one package, one signature.
