# PR #137 — Final Completion & Independent Review Report (2026-11-17)

**Scope of this pass:** completion audit + narrowly scoped fixes on top of PR
#137 head `e5ce852fb79236fc71ec821ed989b00c14839b60`, delivered via branch
`arena/7ed02e3c-maharani-mart` into PR #137's branch. Nothing was force-pushed;
PR #125 and merged PR #136 untouched; the legacy Supabase project
`gbxhmffsbsfhdrfuwurx` was never touched; no production SQL, auth, SMTP, env,
deployment, or plan change was made or attempted.

---

## 1. Baseline audit (before any change)

| Fact | Value (verified) |
|---|---|
| `main` baseline | `a99e8f6` (merge of PR #136) |
| PR #137 | OPEN, MERGEABLE, head `arena/db779fee-maharani-mart` @ `e5ce852f` |
| PR #137 checks @ e5ce852f | Web CI **SUCCESS**; Vercel **SUCCESS** (status bound to e5ce852f); Vercel Preview Comments SUCCESS; **Supabase Preview = SKIPPED** |
| Production migration history (`fhrmsrumsraprvutrpeo`, read-only) | `0001`–`0102` + `20261115155706` (`0103`, out-of-band timestamp version). **0104–0108 not applied.** 0109 not applied. |
| Migration gaps 0061/0075/0076 | Deliberate never-authored reservations (`tests/helpers/migration-reservations.ts`) — not lost files |
| Local baseline on merged content | typecheck PASS, lint PASS, 236 files / 3,622 tests PASS, build 114/114 pages |

### Root cause of `MIGRATIONS_FAILED`
Production history records 0103 under version `20261115155706`, which has **no
matching file** in `supabase/migrations/` (the file is versioned `0103`).
Supabase reconciliation (preview branch apply / `db push`) refuses a remote
version it cannot match to a file → branch apply fails → `MIGRATIONS_FAILED`.
On the Free plan preview branching is additionally unavailable, so the PR check
degrades to **SKIPPED**. A skipped/absent check is not a migration test.
Exact owner-side repair: `docs/repair/PRODUCTION_MIGRATION_HISTORY_REPAIR_RUNBOOK.md`
(approval-gated; not executed here).

## 2. Changes made in this pass (complete list)

| File | Change | Reason |
|---|---|---|
| `.github/workflows/ci.yml` | Added explicit **"Migration chain, rollback & security gate (PGlite)"** step running the 9 migration/security suites by name; header comment documenting that the SKIPPED Supabase Preview check is not a migration test | Migration validation must be a visible, unskippable CI signal |
| `tests/ci-migration-gate.test.ts` | New contract test (6 tests): gate step exists, runs all 9 suites, main step stays the unfiltered `pnpm test`, all gate files exist, DB suites use the full-chain PGlite harness, skipped-check warning documented | Prevents silent removal/drift of the gate |
| `docs/repair/PRODUCTION_MIGRATION_HISTORY_REPAIR_RUNBOOK.md` | New owner-only runbook: verification queries → backup → history re-key for 0103 → apply 0104–0108 → 0109 stays gated | The drift blocks every future migration deploy; repair is owner-only |
| `docs/repair/SECURITY_FUNCTION_AUDIT_2026-11-17.md` | New function-by-function audit incl. the five named functions; `is_phone_registered` enumeration design proposal recorded as an owner decision (not shipped) | Prompt §4 deliverable |
| `docs/repair/LEGAL_BUSINESS_READINESS_CHECKLIST.md` | New checklist (GST/HSN/grievance/policies/TCS-TDS/prohibited products/retention), scope locked to cosmetics & FMCG, no invented legal data | Prompt §8 deliverable |
| `docs/repair/PR137_FINAL_COMPLETION_REPORT_2026-11-17.md` | This report | Reviewability |

No application code, migration SQL, rollback SQL, or existing test was
modified. No bug requiring a code fix was found in this pass.

## 3. Migration validation results (PGlite PostgreSQL 16, in-process, no Supabase needed)

- Fresh full-chain application `0001`→`0109`: **PASS** (every DB suite builds
  its DB by applying every migration in order — `tests/helpers/pg-harness.ts`).
- 0109 idempotent re-application: **PASS** (`phase3-business-control-db` §7).
- Rollback: refuses destructive run while any of the 11 Phase 3 data surfaces
  holds data (per-surface tests), atomic no-CASCADE retry, explicit
  transaction-local override with itemized WARNING + immediate disarm, clean
  empty rollback + re-apply: **PASS** (`phase3-rollback-protection-db`).
- Dedicated CI gate run (the exact new step): **9 files / 104 tests PASS**.
- Limitation (honest): PGlite is PostgreSQL 16 in-process, not a Supabase
  branch; hosted-preview parity is unavailable on the Free plan. Paid branch
  creation was not attempted.

## 4. Final gate results on the completion HEAD

| Gate | Result |
|---|---|
| `tsc --noEmit` | **PASS** |
| `eslint .` | **PASS** |
| `vitest run` (full suite) | **237 files / 3,628 tests PASS, 0 failed, 0 skipped** (baseline 236/3,622 + new contract test) |
| `next build` | **PASS — 114/114 static pages generated** |
| PWA | `app/manifest.ts` + `public/sw.js` + registration component present; SW deliberately caches no authenticated HTML |

## 5. Security audit summary

Full matrix in `SECURITY_FUNCTION_AUDIT_2026-11-17.md`. Highlights:
`current_user_role` / `is_admin_or_above` / `can_current_staff_read_profile` —
caller-scoped predicates, no leak path, kept anon-callable only because PUBLIC
RLS policies evaluate them (documented 0103 exception). `submit_supplier_application`
— pending-only by construction, behind the 0060 DB-backed HMAC rate limit with
generic errors. `is_phone_registered` — verified complete caller list (3);
pre-existing documented anon oracle; privacy-preserving replacement designed
(service-role server-side pre-check + fail-open + HMAC bucket) and left as an
explicit owner decision to avoid touching registration/login in this PR.
Phase 3 RLS/trigger/privilege behaviors are machine-tested green.

## 6. Auth / OTP verification

- Email+password and 6-digit email OTP flows unchanged from merged PR #136;
  `supabase/templates/otp-signin.{html,txt}` present; code accepts 6 (UI
  length env-configurable 6–8 to match `mailer_otp_length`).
- No account enumeration (identical responses; masked email), httpOnly
  sameSite=lax pending-cookies, `shouldCreateUser: false`, resend cooldown
  (UX-level; GoTrue rate limits authoritative), no OTP/password/token logging
  (codes only ever flow user → `verifyOtp`).
- **Not verified (owner action):** live SMTP configuration and the production
  Auth email template containing `{{ .Token }}` — check Supabase dashboard →
  Authentication → SMTP/Templates. Do not test with real customer inboxes.

## 7. Free-plan / resource findings

| Resource | Finding |
|---|---|
| Supabase org | Free plan; **2 active project slots both occupied** (known) |
| Official project | `fhrmsrumsraprvutrpeo`, `ap-south-1`, ACTIVE_HEALTHY (per PR #136 report); DB ≈20 MB / 500 MB (known) |
| Preview branches | Unavailable on Free → Supabase Preview check SKIPPED (verified) |
| Usage metrics (storage/egress/MAU/edge/realtime) | **Unknown** — management token scope cannot read usage APIs; owner to confirm in dashboard |
| Vercel account | Authenticated user `mahakali1`, token scope `limited: true` (verified). **Plan unknown** — commercial use on a Hobby plan violates Vercel ToS; owner must verify the plan permits commercial use |
| GitHub Actions | Web CI green; minutes conserved by design (single job, cancel-in-progress) |

## 8. Remaining blockers & owner actions (none hidden)

1. **Production migration drift** (0103 re-key + apply 0104–0108) — owner-only runbook ready; blocks 0109 application and any future `db push`/preview.
2. **Live SMTP unconfirmed** — OTP emails may not send until SMTP is configured in the Supabase dashboard.
3. **`is_phone_registered` anon oracle** — design ready; owner decision.
4. **Legal checklist** — GST/HSN/grievance/TCS-TDS items pending documentary evidence; marketplace/payment gates stay OFF (enforced in DB).
5. **Vercel plan suitability for commercial use** — owner verification.
6. Supabase usage metrics unverifiable with current token scope.

## 9. PR status declaration

**Ready for independent review. NOT ready to merge** until owner actions 1–2
are scheduled and 3–5 are acknowledged: the code is green and reviewable, but
production application of `0109` is impossible until the migration-history
repair runs, and OTP sign-in is unproven until SMTP is confirmed. Merging
remains the owner's explicit action — nothing here merges, deploys, or touches
production.
