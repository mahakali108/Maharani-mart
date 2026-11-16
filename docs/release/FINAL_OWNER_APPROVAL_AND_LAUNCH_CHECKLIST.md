# Final owner approval and launch checklist

**Nothing on this page has been done.** Every box is unticked because every
consequential action in this release is an owner decision. This is the single list
that covers the whole release — database, first Super Admin, publication, legal and
tax wording, Android signing, and the production deploy. Sign at the bottom; the
work items and the evidence to keep are in the same row.

| | |
|---|---|
| Release | website content module (0104–0106) + managed publication of 19 pages |
| Pull request | **#134 — open, not merged** |
| Supabase project | `fhrmsrumsraprvutrpeo` |
| Production site | https://maharanitraders.vercel.app |
| Verified live state | 0 migrations past 0103 · 0 pages published · 0 `auth.users` · 0 Super Admins · registry holds only `seller-agreement 1.0` |
| Live production surface | all **19** public pages are live today (About, Contact, 17 policies) |
| Hard stop | no merge, no deploy, no SQL, no account, no signing, no publication without the ticks below |

Read alongside: `PHASE4_REPORT_2026-11-16.md` (why each item matters),
`MIGRATION_REVIEW_0104_0106.md` (what the SQL does), `SUPER_ADMIN_BOOTSTRAP.md`
(the 7-step procedure), `LEGAL_TAX_READINESS.md` (the reviewer's questions),
`ROLLBACK_AND_RECOVERY.md` (how to undo each step).

**Order matters.** Sections are in execution order. Steps 1–3 are minutes apart and
must finish before step 4.

---

## 1. Database

| # | Action | Tick | Evidence to keep |
|---|---|---|---|
| 1.1 | Read the migration review (`MIGRATION_REVIEW_0104_0106.md`) and the three approval files (`MIGRATION_0104_APPROVAL.md`, `MIGRATION_0105_APPROVAL.md`, `MIGRATION_REVIEW_0104_0106.md` §9) | ☐ | signature page |
| 1.2 | Take a **pre-flight backup**: `ROLLBACK_AND_RECOVERY.md` §5 creates `site_content_backup_<date>` with every published snapshot and section; additionally take a Supabase dashboard backup | ☐ | `select count(*)` output (expect 19 rows captured; 0 published today) |
| 1.3 | Apply **0104** `0104_site_content_management.sql` | ☐ | migration timestamp from `list_migrations` |
| 1.4 | Run `supabase/publication/verify_publication.sql` → expect **0 published, 0 pages** (module exists, nothing seeded) | ☐ | query output |
| 1.5 | Apply **0105** `0105_seed_site_content.sql` → inserts 19 drafts, 70 sections, publishes nothing | ☐ | `19 draft, 0 published` |
| 1.6 | Apply **0106** `0106_first_super_admin_bootstrap.sql` → creates the allowlist/events tables, the insert guard and `bootstrap_super_admin()`; **creates no account** | ☐ | migration timestamp |
| 1.7 | Run `supabase/publication/verify_continuity.sql` → expect **19 rows, 0 missing, 0 published** | ☐ | query output |
| 1.8 | Confirm privilege posture: `bootstrap_super_admin` has **no** grant to `anon`/`authenticated`/`service_role`; those roles hold `SELECT` only on the two bootstrap tables | ☐ | `has_function_privilege` / `information_schema.role_table_grants` output |
| 1.9 | Record everything (who, when, timestamps, outputs) in `docs/MIGRATION_APPLICATION_EVIDENCE.md` | ☐ | the file |
| 1.10 | Keep the rollback path ready — do **not** drop the backup table until the release is verified | ☐ | rollback files on hand |

**Rollback if needed:** `supabase/rollbacks/0106_*.down.sql` → `0105_*.down.sql` →
`0104_*.down.sql`, in that order (the seed first, then the module). The 0105
rollback refuses to delete a page that has been published.

---

## 2. First Super Admin

Separate decision from §1: applying 0106 creates no account. **No account exists
anywhere today.**

| # | Action | Tick | Evidence to keep |
|---|---|---|---|
| 2.1 | Decide which mailbox is the owner identity, and enable **MFA** on the Supabase dashboard account that will run SQL | ☐ | dashboard screenshot (no codes recorded) |
| 2.2 | Confirm **email confirmation is ON** (Auth → Providers) — gate 4 depends on it | ☐ | setting state |
| 2.3 | Create the login: register through `/register`, or Auth → Users → *Add user* with "Auto Confirm User" **off**, then click the confirmation link | ☐ | user id, `email_confirmed_at` |
| 2.4 | Write the allowlist row (one row only; lower-case email, 10-digit phone, approval reference in `note`) | ☐ | `select * from super_admin_bootstrap_allowlist` |
| 2.5 | Run `select public.bootstrap_super_admin('<user id>'::uuid);` — from the SQL editor, as the database owner | ☐ | no output; event row |
| 2.6 | Verify: exactly one `super_admin` profile, exactly one event row, allowlist `consumed_at` set | ☐ | the three queries in `SUPER_ADMIN_BOOTSTRAP.md` §4 step 5 |
| 2.7 | Sign in as that account: `/admin/content` opens; a retailer account is still refused | ☐ | screen recording or note |
| 2.8 | Add any second administrator through `/admin/team` (staff invitation), never SQL | ☐ | invitation record |
| 2.9 | Confirm password policy, MFA enforcement and session lifetime in the project settings | ☐ | settings state |

**Do not** create the account by hand-editing `profiles.role`. It works, it leaves no
evidence of who authorised it, and it can be repeated by anyone with SQL access —
that is the whole reason 0106 exists.

---

## 3. Publication

Both stages run **before** the deploy. Verified fact: all 19 pages are live today, so
deploying between the stages would take ten URLs offline (named in
`supabase/publication/README.md` and `PHASE4_REPORT_2026-11-16.md` §1.2) and would
leave a seller-facing agreement
unreadable while its acceptance is still enforced.

| # | Action | Tick | Evidence to keep |
|---|---|---|---|
| 3.1 | Confirm the wording is unchanged: re-run `node --experimental-strip-types scripts/generate-site-content-seed.mjs` → `git status` must be **empty** | ☐ | empty diff |
| 3.2 | Decide §4.1 (review banner removal) and §4.3 (nine caveats) **before** publishing — editing afterwards is a new version (`1.0 → 1.1`) | ☐ | decision note |
| 3.3 | Run `supabase/publication/stage1_publish_live_text.sql` (9 pages) | ☐ | `9 published, 10 draft` |
| 3.4 | Run `supabase/publication/stage2_publish_reviewed_additions.sql` (10 pages) | ☐ | `19 published, 0 draft` |
| 3.5 | Sanity-check timestamps: every `published_at` is the real time of this action; no backdated row | ☐ | `select slug, published_at from site_pages order by published_at` |
| 3.6 | Confirm the scripts did **not** touch the acceptance registry | ☐ | `select * from legal_document_current_versions` → still `seller-agreement 1.0` only |
| 3.7 | Decide the registry option (below) and run it, or record "A — no change" | ☐ | SQL + verification output |

### 3.8 Acceptance registry — the four choices

| Option | Registers | Recommendation |
|---|---|---|
| **A** | nothing new; `seller-agreement 1.0` stays | acceptable, but a material `terms` edit later would go live with no re-acceptance |
| **B1** | `terms`, `privacy` | **recommended** — both public after stage 1 |
| **B2** | `retailer-terms`, `prohibited-products` | **recommended** — only once their pages are public (they are, after stage 2) |
| **C** | all 19 | **not recommended** — 14 are notice documents nobody accepts; every typo fix becomes a consent event |

Tick one: ☐ A ☐ B1 ☐ B2 ☐ C — and record who ran it, when, and the query output.

---

## 4. Legal and tax

No wording below was changed by this release. The live text is what a customer reads
today; every replacement is a proposal awaiting an owner or a CA.

| # | Item | Decision / tick | Owner | CA / advocate |
|---|---|---|---|---|
| 4.1 | **Review banner** — "Publication review required…" disappears from all 19 pages after the deploy; the notice moves into admin notes | ☐ approve removal ☐ keep public | ☐ | |
| 4.2 | **Page titles** — all 17 document titles and both page titles are unchanged (17/17 verified). No action needed | ☐ acknowledged | ☐ | |
| 4.3 | **Nine engineering caveats** (`PHASE4_REPORT` §4.3): privacy intro/sharing ×2/cookies/retention, grievance, business-disclosure GST, business-disclosure features, about GST | ☐ rewrite before publishing ☐ publish as-is | ☐ | ☐ |
| 4.4 | **Grievance officer**: name, address, phone, email confirmed current and monitored | ☐ | ☐ | |
| 4.5 | **Grievance timelines**: "proposed 48 hours" / "proposed one month" — become commitments or stay targets | ☐ commitment ☐ target | ☐ | ☐ |
| 4.6 | **GSTIN and tax invoices**: GSTIN, invoice series, HSN/rate list; how the GSTIN is displayed. Nothing is published today — a tax invoice cannot be issued yet | ☐ supply ☐ publish later | ☐ | ☐ |
| 4.7 | **Seller agreement** v1.0: commission/payout, TCS/TDS, liability cap, indemnity, notice period, forum | ☐ approved for launch ☐ lawyer review | ☐ | ☐ |
| 4.8 | **Privacy / DPDP**: data collected, processors (Supabase, Vercel) and locations, retention (14-day AI window; 120-day financial window on hold), consent for analytics, data-principal request route, DPO need | ☐ reviewed | ☐ | ☐ |
| 4.9 | **Marketplace TCS s.52 / TDS s.194-O**: keep the marketplace switch **OFF** for launch, or register and verify the computation before any seller goes live | ☐ keep OFF ☐ register first | ☐ | ☐ |
| 4.10 | **Stage-2 commercial items** (return window, COD refund method, Coins expiry, loyalty redemption, minimum order, credit terms, arbitration venue) — 15 open items in `STAGE2_OWNER_CA_CHECKLIST.md` | ☐ | ☐ | ☐ |
| 4.11 | **Consent/analytics changes** — no unapproved change to consent behaviour ships in this release | ☐ acknowledged | ☐ | |

---

## 5. Android signing

Nothing here is done: no keystore exists, none of the four secrets is configured,
no signed artifact has been produced, no device has run the app.

| # | Action | Tick | Evidence to keep |
|---|---|---|---|
| 5.1 | Create the upload keystore once, on the owner's machine, with the owner's own passwords (`ANDROID_SIGNED_RELEASE_PLAN.md` §2; `keytool`, `-validity 10950`). Never in the repo, never in CI | ☐ | certificate fingerprint |
| 5.2 | Back it up **twice, offline**: encrypted drive + printed recovery sheet. Losing it means the app can never be updated on an installed device | ☐ | backup location note (no passwords) |
| 5.3 | Add the four GitHub secrets — names only, values never written down: `ANDROID_RELEASE_KEYSTORE_BASE64`, `ANDROID_RELEASE_KEYSTORE_PASSWORD`, `ANDROID_RELEASE_KEY_ALIAS`, `ANDROID_RELEASE_KEY_PASSWORD` | ☐ | the workflow stops printing `BLOCKED` |
| 5.4 | Bump `VERSION_CODE` in the release commit (`versionName` is derived, never hand-written) | ☐ | commit |
| 5.5 | Build signed: `./gradlew assembleRelease bundleRelease`, then `apksigner verify --print-certs` | ☐ | artifact hash, `versionCode`, `versionName`, fingerprint in `ANDROID_BUILD_VERIFICATION.md` |
| 5.6 | Run the **23-case device plan** (`ANDROID_SIGNED_RELEASE_PLAN.md` §4: A1–A5, B1–B4, C1–C11, D1–D3) on a debug build, then repeat A1–A4 and C1–C9 on the signed build | ☐ | per-case result table |
| 5.7 | Within the plan, specifically confirm: both legal entry points (Account → About & policies, Help → Policies & information) show the same list; **19 entries** after stage 2; a document opens with title, version, effective date and contact block; phone/email links open the dialler/mail app; back returns to the list | ☐ | C1, C3–C5, C7–C11 results |
| 5.8 | Play Store publication — **out of scope** for this release, separate human-controlled step | ☐ not required | — |

---

## 6. Production deployment

| # | Action | Tick | Evidence to keep |
|---|---|---|---|
| 6.1 | Confirm Vercel project settings **as the owner** — this review could not read them (connector token lacked project/deployment scope): production branch, build command, Node version, environment variables, domain/redirects, and which commit is deployed | ☐ | screenshot or export of settings |
| 6.2 | Confirm the environment variables the new routes need (Supabase URL + anon key) are present in Production **and** Preview | ☐ | variable names only |
| 6.3 | Merge PR **#134** (the only code action; nothing else in this release changes code) | ☐ | merge commit SHA |
| 6.4 | Deploy to production | ☐ | deployment URL + commit SHA |
| 6.5 | Run the launch health probe: `python3 scripts/production-health-probe.py` → **11/11** | ☐ | verdict JSON |
| 6.6 | Run the page sweep: `python3 scripts/production-health-probe.py --pages` → **19/19 pages answer 200** | ☐ | verdict JSON (this is the "every URL still works" proof) |
| 6.7 | Spot-read `/legal`, `/about`, `/contact`, `/legal/grievance` in a browser: same words as before, version and effective date present, contact block intact, banner gone only if §4.1 approved | ☐ | screenshots |
| 6.8 | Confirm **no customer-facing content disappeared**: all 19 URLs from the sweep, plus the four legacy redirects `/terms`, `/privacy`, `/returns`, `/shipping` | ☐ | redirect status codes |
| 6.9 | Verify the Android managed-content endpoint `GET /api/mobile/v1/pages` returns **19** entries in the `data` envelope | ☐ | JSON count + `requestId` |
| 6.10 | Confirm `/api/health` and `/api/mobile/v1/health` still report `status: ok, database: reachable` | ☐ | verdict JSON |
| 6.11 | Keep the pre-flight backup table and the Vercel previous-deployment reference until 7 days of clean operation | ☐ | note |

**If step 6.6 fails:** roll Vercel back to the previous deployment first (that alone
restores the JSX pages), then decide whether to fix or unpublish the affected page —
`ROLLBACK_AND_RECOVERY.md` §4.1/§4.3. Unpublishing a single page is
`select public.unpublish_site_page(...)`; it hides the page immediately without
touching the draft.

---

## 7. Sign-off

| Area | Owner | CA / advocate | Date |
|---|---|---|---|
| §1 Database (backup, 0104–0106, verification, evidence) | ☐ | — | |
| §2 First Super Admin (login, allowlist, bootstrap, MFA) | ☐ | — | |
| §3 Publication (both stages, timestamps, registry choice) | ☐ | ☐ | |
| §4 Legal and tax (banner, caveats, grievance, GSTIN, seller agreement, DPDP, TCS/TDS) | ☐ | ☐ | |
| §5 Android signing and the 23-case plan | ☐ | — | |
| §6 Production deploy and the 19-URL verification | ☐ | — | |

Owner signature: ______________________________  Date: ______________

CA / advocate: ________________________________  Date: ______________

### What this signature does not cover

* Play Store publication, app-store listing text and store-review compliance.
* Any third-party seller going live (needs §4.7 and §4.9 completed).
* Any change to the policies after publication — that is a new version
  (`1.0 → 1.1`), a re-acceptance if the document is registered, and a new tick here.
* The marketplace switch, which stays OFF unless §4.9 is completed deliberately.
