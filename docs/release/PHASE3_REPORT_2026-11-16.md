# Phase 3 report — owner blocker resolution

**Prepared:** 16 November 2026 · branch `arena/1c8f9eed-maharani-mart`
**Code head verified by CI:** `364dd61` · **PR #134: open, not merged**
**Live project `fhrmsrumsraprvutrpeo`: unchanged —** no migration applied, no account
created, no page published, nothing deployed or signed.

How to read: **[verified]** = executed or read in this pass; **[procedure]** = written,
reviewed and tested but deliberately not run; **[decision]** = needs the owner.

---

## 1. First Super Admin bootstrap

**[verified] The role was already well defended; the first account was not.**

| Control | Evidence |
|---|---|
| A public signup cannot claim `super_admin`: `handle_new_user()` ignores client `role`, uses server-side invite tables, otherwise `retailer` | `0072` (read in this pass) |
| An API caller cannot change a role: `guard_profile_privileged_columns()` | `0052` (read) |
| `profiles` self-update is scoped to the caller's row and still hits that guard | `0052` (read) |
| The live project has 0 `auth.users`, 0 `profiles` → 0 Super Admins | read-only check earlier this session |

**[procedure] Migration 0106** adds a one-row allowlist, an append-only event table, and
`bootstrap_super_admin(uuid)` with six gates: `session_user` must be the database
owner; no Super Admin may exist; the allowlist row must be unconsumed; the account must
exist with a confirmed email; the email must equal the allowlist; the profile must
already exist. Plus `guard_profile_role_insert()`, which blocks an API caller from
inserting a privileged profile at all.

[verified] 10 tests on PostgreSQL 16: no allowlist → refused; unconfirmed email →
refused; wrong address → refused; happy path promotes once, consumes the row and writes
one event; a second bootstrap → refused; `anon`, `authenticated` and `service_role` all
get `permission denied for function`; neither API role can write either table;
`service_role` can only `SELECT`.

**Two bugs this found, both invisible to a text review:** the first version of 0106
omitted `service_role` from its revokes (so the service key could write the allowlist),
and it left PUBLIC `EXECUTE` on the new trigger function. Both fixed and asserted.

**[decision]** Apply 0106; create the owner login; confirm the address; bootstrap; turn
on MFA. **No account exists**, and none was created. The manual alternative (a bare
`update profiles`) is documented with its weakness: no evidence, repeatable by anyone
with SQL access.

---

## 2. Public page continuity

**[verified] Nineteen URLs are public today**, not nine: nine static/own-file pages plus
ten rendered by `/legal/[slug]` from `lib/legal/content.ts`. Every one was diffed
against `656a6a4`: stage 1 carries nine verbatim, stage 2 carries ten verbatim (0 added,
0 dropped sentences).

**[verified] The gap is now measured, not estimated.** New read-only
`supabase/publication/verify_continuity.sql` reports, after stage 1: `published 9,
missing 10`, with each missing slug named — plus the four legacy redirect targets
(`/terms`, `/privacy`, `/returns`, `/shipping`) which must always resolve.

**[verified] Stage 2 is now executed by CI for the first time**
(`tests/site-content-continuity.test.ts`): 19/19 published, index size 19, every
anonymous state `published`, and a second run leaves every `published_at` unchanged.

**[verified] One real content regression found and fixed:** the rewritten `/legal`
index dropped the *"Not published because the feature does not exist"* card
(`NOT_APPLICABLE_DOCUMENTS` — the advertising/sponsored-listing disclosure). That is a
public disclosure disappearing for reasons unrelated to the release. Restored with a
regression test.

**[decision — D2]** Two plans, both prepared: **A** stage 1 + stage 2 in one transaction
(no page ever goes dark; publishes ten documents no CA has blessed), **B** stage 1,
deploy, stage 2 later (ten URLs answer "not available" in between; footer 19 → 9, index
17 → 7, Android list 19 → 9). Nothing was published.

---

## 3. Migration approval — 0104, 0105, 0106

**[verified] Reviewed by executing, not only by reading**
(`MIGRATION_REVIEW_0104_0106.md`): object inventory, RLS flags, all 8 policies, the full
grants matrix, function ACLs, triggers, foreign keys, and the absence of any view or
external dependency.

Three defects fixed in this phase:

| Defect | How it was found | Fix |
|---|---|---|
| 0104 could not be re-run (`create policy` without a matching `drop`) — a half-applied paste in the non-transactional SQL editor would be unrecoverable | replay test | every `CREATE POLICY` now has a `DROP IF EXISTS`; replay verified |
| 0106 left the allowlist writable by `service_role` | executed test | `service_role` in both revokes, `SELECT` re-granted |
| 0106's trigger function carried PUBLIC `EXECUTE` | catalog query | revoked, as 0078 did for `handle_new_user()` |

**[verified] Replay behaviour:** 0104, 0105 and 0106 all replay cleanly on a migrated
database; 0105 **refuses** once pages are published ("0105 must not publish") and changes
nothing — correct for a seed.

**[verified] Rollbacks:** all four files execute, in order, with their guards.
`0106 down` does not demote the Super Admin it created.

**Residual risks, unchanged:** the apply channel decides what lands in
`schema_migrations` (the SQL editor records nothing); PGlite is a single connection, so
concurrency is not proven; nothing has been applied to the official project.

---

## 4. Legal and tax readiness

**[verified] `LEGAL_TAX_READINESS.md`** — seven areas, with the exact live sentences and
no invented numbers:

1. **GSTIN / invoices** — no number, no series, no HSN rates: **no valid tax invoice can
   be issued today**; six owner/CA actions listed.
2. **Grievance officer** — name, address, phone and email confirmed in the text; the
   48 h / one month targets are still published as *"proposed"*.
3. **DPDP** — the policy itself admits no verified retention schedule, no consent
   mechanism and unverified processors; seven actions listed. **No DPDP review has been
   done.**
4. **Seller agreement** — commission/payout, TCS s.52 / TDS s.194-O, and liability caps,
   indemnity and forum remain undecided; a seller cannot be onboarded before they are.
5. **TCS/TDS** — the marketplace switch is an append-only approval log requiring both an
   owner and a CA reference; no row exists, so third-party offers are **off**.
6. **Returns/refunds/delivery** — the return window (software default 7 days) and the COD
   refund method are undecided; delivery is already limited to serviceable areas.
7. **Public engineering caveats** — nine exact sentences quoted with proposed
   replacements (privacy ×4, business disclosure ×3, about ×1, shipping ×1, grievance
   ×1). None has been changed.

**[decision]** The owner and a CA/advocate must sign each area. No legal or tax opinion
is formed in this report.

---

## 5. Android release

**[verified] Buildable, not distributable, not device-verified.** No keystore, no
signed artifact, no Play Console entry, no device run — ever. `1.0.0` / `versionCode 1`,
`minSdk 24`, `targetSdk 36`.

**[verified] Exact missing secrets** (four, names only):
`ANDROID_RELEASE_KEYSTORE_BASE64`, `ANDROID_RELEASE_KEYSTORE_PASSWORD`,
`ANDROID_RELEASE_KEY_ALIAS`, `ANDROID_RELEASE_KEY_PASSWORD`. The local build reads
`RELEASE_KEYSTORE_PATH`, `RELEASE_KEYSTORE_PASSWORD`, `RELEASE_KEY_ALIAS`,
`RELEASE_KEY_PASSWORD`. The CI job prints `BLOCKED — release keystore secrets not
configured` and refuses to describe the artifact as distributable.

**[verified] Account and Help navigation:** Account tab → `MaharaniRoutes.LEGAL`,
Help → `HelpScreen(onOpenLegal = …)` → the same route, one document at
`legal/{slug}`, all fed by `GET /api/mobile/v1/pages` → `published_pages()`. So the
native list follows publication state exactly like the website (9 after stage 1, 19
after stage 2).

**[procedure] `ANDROID_SIGNED_RELEASE_PLAN.md`:** keystore creation and backup,
secret configuration, signed build with `assembleRelease bundleRelease` and
`apksigner verify --print-certs`, and a 23-case device plan. **No credential was
invented, no key generated, no release made.**

---

## 6. Final verification

| Item | Value |
|---|---|
| Branch | `arena/1c8f9eed-maharani-mart` |
| Code head verified by CI | **`364dd61`** |
| PR #134 | **open**, `MERGEABLE`, **not merged** |
| CI run | **[43805655711](https://github.com/mahakali108/Maharani-mart/actions/runs/43805655711)** — **success**: production probe, web typecheck/lint/tests/`next build`, Android unit tests + lint + debug APK |
| Local suite | `224 files / 3,404 tests` passing; typecheck, lint, `next build` clean |
| Migration state (live) | ends at `20261115155706` (0103); **0104, 0105, 0106 absent** |
| Live database | 0 `site_page*` objects, 0 `auth.users`, 0 `profiles`, 0 Super Admins, registry 1 row (`seller-agreement 1.0`), 0 acceptances |
| Publication state | **0 of 19 published**; the 19 live pages are still served by the current build |
| Deploy state | unchanged; no Vercel deployment was made |

The commit that adds this report is documentation only; the run above covers the code
it describes, and the workflow is re-dispatched on that documentation head so the exact
reported commit is also green (the run id is recorded in the PR's latest comment, since
writing it here would itself create a new head).

**Unresolved blockers, in the order they gate the release:**

1. **D2 — scheduling:** publish both stages in one window, or accept that ten live pages
   go dark until stage 2. Nothing else can be scheduled until this is decided.
2. **Apply 0104 → 0105 → 0106** (three separate approvals), with a `pg_dump` first.
3. **First Super Admin** — 0106 applied, login created, address confirmed, bootstrap,
   MFA on.
4. **Copy decisions:** three titles (D1); nine caveats (D5); grievance timelines (D6).
5. **Registry:** A / B1 / B2 / C (D7).
6. **CA/advocate:** GSTIN and invoices, DPDP, seller terms, TCS/TDS — nine of the ten
   stage-2 pages cannot be called "approved" without this.
7. **Android:** keystore, four secrets, device pass.
8. **Not verified anywhere:** a device run, a live publication, a real signed artifact,
   and any concurrency behaviour against a second live connection.

**Strict rules honoured:** PR #134 not merged; no live SQL executed; no live user
created; no page published or unpublished; no deployment; no signing; no Play Store
action. All existing work preserved — the only test changes tighten or extend coverage,
and the one allow-list extension in `migration-catalog-invariants.test.ts` documents two
deny-by-default tables whose access is asserted in their own suite.

**Disclosure:** during this pass the Supabase connector returned a 500 and then a 401 for
two read-only catalog queries. The live facts above are those verified read-only earlier
in the session plus the repository's own migrations; nothing was inferred from the failed
calls, and the connector may need reconnecting before the owner runs the verification
SQL.
