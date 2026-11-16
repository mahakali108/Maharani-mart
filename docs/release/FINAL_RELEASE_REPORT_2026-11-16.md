# Final release report — 16 November 2026

**Pull request:** [#134](https://github.com/mahakali108/Maharani-mart/pull/134), branch
`arena/1c8f9eed-maharani-mart`, **open, not merged**.
**Live project:** `fhrmsrumsraprvutrpeo` — inspected read-only; **unchanged**.
**Executed in this pass:** nothing against production. No migration, no publication, no
deploy, no signing, no Play Store action.
**Package:** `docs/release/` — seven companion documents, referenced per section.

> **Superseded in part — read `PHASE4_REPORT_2026-11-16.md` first.** Phase 4
> re-verified the live state and corrected one assumption in the release order:
> all nineteen pages (including all ten previously described as "stage-2
> additions") are live in production today, so **stage 2 must run in the same
> window as stage 1, before the deploy**. The signable version of the whole
> release is `FINAL_OWNER_APPROVAL_AND_LAUNCH_CHECKLIST.md`.

How to read this report: **[VERIFIED]** means this pass executed or read the thing
itself; **[ASSUMED]** means it rests on the repository or on a prior report and was
not re-tested; **[DECISION]** means a human must choose.

---

## 1. Pull request #134 — state, review and CI

**Head reviewed:** `2df6603` (`docs: cite the green CI runs for the reviewed head`), 18
commits, `MERGEABLE`. This pass adds commits on top; the PR stays **open**.

| Item | State |
|---|---|
| Mergeability | `MERGEABLE`, no conflicts with `main` (`656a6a4`) |
| Merged | **No.** Deliberately open, as instructed |
| Migration / rollback changes reviewed | Yes — 0104 (742 lines), 0105 (847), both rollbacks, both publication scripts, `verify_publication.sql`, the generator and the new release test |
| New regressions | **None found after the fixes in §2.** Full suite 221 files / 3,387 tests, typecheck, lint, `next build` all clean **[VERIFIED]** |
| CI | Green runs `43774795591` (`683fac9`) and `43784055991` (`bcc5c87`, full matrix incl. Android). Run `43796102330` was dispatched on `2df6603` and was still `in_progress` when this pass began; its verdict is superseded by the newer head and is recorded in the commit that follows this document |

Three defects were found **by running the files**, not by reading them, and are fixed
in this PR (§11 of `docs/PR134_FINAL_REVIEW_2026-11-15.md`):

1. the 0105 rollback could never run — the system-page delete guard refused every
   delete (fixed in 0104 with the same `maharani.allow_data_loss` guard the 0104
   rollback uses);
2. the seed generator silently reverted that rollback on every test run (template +
   drift test fixed);
3. `docs/0104_0105_MIGRATION_AUDIT.md` §7 told an operator to expect `published = 19`
   after 0105, which is wrong — 0105 publishes nothing.

---

## 2. Verified items

**Live database — read-only, 16 November 2026 [VERIFIED]**

| Fact | Value |
|---|---|
| Last migration | `20261115155706` (0103); 0104/0105 absent |
| `site_page*` tables / functions | 0 / 0 |
| `legal_document_current_versions` | 1 row: `seller-agreement 1.0` |
| `legal_document_acceptances` | 0 rows |
| `auth.users`, `profiles`, `super_admins` | **0, 0, 0** |
| products, orders, retailers, banners | 0 |

Consequence: **there is no Super Admin**, so `/admin/content`, `publish_site_page()`
and `publish_legal_document_version()` are unreachable for every human until the owner
creates the first account. Stage 1 must therefore be run as SQL, not from the UI.

**Stage-1 wording vs the previously live site [VERIFIED]**

Baseline read from Git at `656a6a4`, sentence-level comparison, artefacts removed:
**no substantive sentence changed on any of the nine pages.** The only real
differences are three page titles (§3 D1), the removal of the amber "additional
contact configured in business settings" box — which never rendered, because no
`business_settings` table exists in the live project — and links rendered as anchors
instead of `next/link`.

**Stage-2 wording [VERIFIED — corrects an earlier assumption]**

The ten "stage-2" pages are **live today** at `/legal/<slug>` via
`app/legal/[slug]/page.tsx` + `lib/legal/content.ts`. Against that baseline: **0 added,
0 dropped sentences** in all ten, same 15 open decisions. They are not new writing.

**Release procedure [VERIFIED by execution]**

`tests/site-content-release.test.ts` runs the real files on PostgreSQL 16: 0105 leaves
19 drafts; stage 1 publishes exactly 9 with `published_at = now()` (0 backdated, 0
future); anonymous state `published` for 9 and `unpublished` for 10; public index 9; no
`internal_notes` / `owner_decisions` in any published document; `verify_publication.sql`
runs unchanged; 0105 down → 0104 down removes everything. Reverting the trigger fix
makes the test fail, so it tests the fix rather than the file.

**Android [VERIFIED from the repository; nothing executed]**

Workflow is `workflow_dispatch` only; the native tree is a diagnostic path and the
product ships as a web PWA. Debug APK builds; release APK/AAB are **unsigned**, built
only for size. Four `ANDROID_RELEASE_*` secrets are unset. `version.properties` is
`1.0.0` / code `1`. **No device or emulator run has ever happened.**

---

## 3. Pending owner decisions (exact, in the order they block the release)

| # | Decision | Blocks | Where |
|---|---|---|---|
| **D1** | Accept or revert the three page titles: *Grievance Redressal Policy*, *Contact and Legal Information*, *Product Authenticity and Safety Policy* | stage 1 | `STAGE1_PAGE_REVIEW.md` §4 F1 |
| **D2** | **Scheduling:** publish stage 1 only (ten live pages go dark until stage 2), or stage 1 + stage 2 in one window (no page goes dark, no new wording, but publishes unapproved text), or defer the deploy | the whole release | `STAGE1_PAGE_REVIEW.md` §1.1 |
| **D3** | Apply 0104? | everything | `MIGRATION_0104_APPROVAL.md` §9 |
| **D4** | Apply 0105 (19 drafts)? | everything | `MIGRATION_0105_APPROVAL.md` §8 |
| **D5** | Leave the operator caveats in the public text (privacy ×4, business disclosure ×3, about ×1, shipping ×1) or edit them in the seed *before* 0105 is applied | text quality | `STAGE1_PAGE_REVIEW.md` §4 F2 |
| **D6** | Grievance timelines: keep "the proposed targets are 48 hours / one month" or state them as commitments | legal exposure | §4 F4 |
| **D7** | Acceptance registry: **A** (no change), **B1** (`terms`, `privacy` after stage 1), **B2** (`retailer-terms`, `prohibited-products` after publication), or **C** (all 19, not recommended) | consent evidence | `ACCEPTANCE_REGISTRY_OPTIONS.md` §6 |
| **D8** | Create the first Super Admin (needs an email login and a phone number for `profiles`) | any UI-based editing | `STAGE1_PAGE_REVIEW.md` §5 step 7 |
| **D9** | The 15 open items on the ten stage-2 pages (return window, COD refunds, commission/payout, TCS s.52 / TDS s.194-O, liability caps, credit terms, minimum order, Coins expiry, loyalty redemption, arbitration venue) | stage 2 | `STAGE2_OWNER_CA_CHECKLIST.md` |
| **D10** | Android: create the upload keystore + four CI secrets, and commission a device pass | any distribution | `ANDROID_RELEASE_READINESS.md` §4, §5 |

Nothing in D1–D10 has been actioned.

---

## 4. Exact SQL approval requirements

Four SQL actions, each approved separately. Approving one does not approve the next.

| Step | File / statement | What it changes | Publishes? | Rollback |
|---|---|---|---|---|
| **S1** | `supabase/migrations/0104_site_content_management.sql` | 4 tables, 6 functions, 8 policies, 5 triggers, `is_super_admin()` | no | 0104 down (destructive, guarded) |
| **S2** | `supabase/migrations/0105_seed_site_content.sql` | 19 draft pages, 70 sections, 19 notes, 15 open decisions | no | 0105 down (now executable) |
| **S3** | `supabase/publication/stage1_publish_live_text.sql` | 9 pages → published, `now()` | **yes — 9 pages** | `ROLLBACK_AND_RECOVERY.md` §4.1 |
| **S4** | `supabase/publication/stage2_publish_reviewed_additions.sql` | 10 pages → published | **yes — 10 pages** | same |
| **S5** *(optional, D7)* | the two `insert … on conflict` blocks in `ACCEPTANCE_REGISTRY_OPTIONS.md` §4 | registry rows for `terms`, `privacy` (+ `retailer-terms`, `prohibited-products` after S4) | no | `ROLLBACK_AND_RECOVERY.md` §4.5 |

Rules that apply to all of them:

* Apply through the owner's normal controlled channel (CLI `db push --include-all`,
  transactional and records `schema_migrations`, or the SQL editor with the file wrapped
  in `begin; … commit;`). The audit trail difference is risk R3 in
  `docs/0104_0105_MIGRATION_AUDIT.md`.
* Take a `pg_dump` of `public` first (`ROLLBACK_AND_RECOVERY.md` §5 has a 30-second
  snapshot table).
* Run `verify_publication.sql` after S2, S3 and S4 and compare with
  `ROLLBACK_AND_RECOVERY.md` §6.
* Do not remove the `seller-agreement` registry row, ever — it is the seller gate.

Approval line, to be filled once per step: *“I approve S__ , file ___, at commit
_______.”* Name, date, and the channel used.

---

## 5. Website deployment readiness

**Ready to deploy the moment S1–S3 are applied and verified; not before.** [VERIFIED]

| Gate | State |
|---|---|
| Code, typecheck, lint, 3,387 tests | pass |
| Migrations reviewed and reversible | yes (after this pass's fixes) |
| Publication scripts executed in test | yes |
| Vercel project / env vars | no change needed by this release (the module uses the existing Supabase client) **[ASSUMED — no new env var is read by the new code]** |
| Backup | **not taken** — owner action |
| Super Admin | **does not exist** — owner action |

**Order (non-negotiable):** S1 → S2 → S3 → deploy → S4.

What breaks if the order is violated:

* deploy **before** S1/S2/S3: `/about`, `/contact`, every `/legal/*` shows "unable to
  load"; `/api/mobile/v1/pages` returns `database_unavailable` (fails closed, no crash);
* S3 missing: all nine pages say "not available";
* S4 missing (the D2 gap): the ten pages that are live today go dark — a visible
  regression on ten URLs and in the legal index;
* rolling the deploy back is always safe (the old build renders static JSX).

Verification after the deploy: the twelve-row URL table in `STAGE1_PAGE_REVIEW.md` §6,
then `verify_publication.sql`.

---

## 6. Android release readiness

**Buildable, not distributable, not device-verified.** [VERIFIED]

| | State |
|---|---|
| Debug APK | builds in CI on manual dispatch (`./gradlew testDebugUnitTest lintDebug assembleDebug`) |
| Install on a phone | instructions in `ANDROID_RELEASE_READINESS.md` §2; never performed |
| Release artifact | unsigned only; unsigned APKs are refused by Android |
| Signing | no key, no keystore, four secrets unset — **nothing invented** |
| Play Console | no entry |
| Native About/Legal screen | routes `legal` / `legal/{slug}`; content from `GET /api/mobile/v1/pages` → **depends on S1–S3/S4**; a registered `seller-agreement` acceptance currently points at a page that would be a draft |
| Device tests | 20 cases listed, **all unticked** |

The one thing this release changes for Android: the app's policy list is now the
website's published list, so the migration/publication order protects the app too.

---

## 7. Remaining legal and compliance blockers

Nothing here is a code problem; each needs a person.

1. **GSTIN missing.** `business-disclosure` and `gst-pricing-invoice` state GST
   registration, but no number, invoice series or HSN rates exist — so **no valid tax
   invoice can be issued** for a delivered order today. CA input required (D9).
2. **TCS/TDS on marketplace sales.** CGST s.52 and IT s.194-O are unaddressed; the
   marketplace switch must stay off until a CA rules (the switch is
   `marketplace_launch_approvals`, which requires both an owner and a CA reference to
   turn on — no row exists).
3. **The ten stage-2 documents have never been legally reviewed.** They are public
   today with a "points awaiting the owner's confirmation" card; §4 F7 explains why
   removing that card needs a wording fix on six pages.
4. **The nine stage-1 documents carry engineering caveats** ("require verification
   before publication", "have not been independently verified") into customer-visible
   policy text (D5).
5. **Grievance timelines** are published as "proposed" (D6); a consumer forum reads
   them literally.
6. **Consent evidence.** Only the seller agreement is version-enforced; a material
   change to the Terms can go live without anyone re-accepting (D7).
7. **Privacy / DPDP.** The privacy page names Supabase and Vercel, has no retention
   schedule and no consent mechanism; the text itself says so. A DPDP readiness review
   has not been done.
8. **No CA or advocate has reviewed anything in this release** — this report forms no
   legal opinion, and says so deliberately.

---

## 8. What this pass did not do

No `INSERT`, `UPDATE`, `DELETE` or DDL against `fhrmsrumsraprvutrpeo`; no publication;
no merge; no deploy; no Vercel setting changed; no keystore created; no APK signed; no
Play Console action; no device or emulator run. Every SQL statement in `docs/release/`
is a proposal, and the statements that were executed were executed only against a
throwaway PostgreSQL 16 built from this repository's own migrations.

The single most consequential thing this pass found is not a bug: **ten policy pages
that are live today are drafts in stage 1**, so the deploy has to either publish them in
the same window or accept that they go dark. That is Decision D2, and it is the owner's
to make.
