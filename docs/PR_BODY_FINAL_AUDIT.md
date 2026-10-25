## 1. Summary

Final full-repository audit of the Maharani Traders PWA, with the safe fixes
applied, tested, and reviewed. Nothing is merged, deployed, or applied to
production by this PR.

Two questions drove it:

1. **Can this codebase tell "empty" from "broken"?** For detail pages: now yes
   (earlier commit). For list pages, queues and money evidence: it could not —
   this PR fixes the highest-consequence cases.
2. **Is the security hardening in `0078`/`0079` safe to apply?** Reviewable,
   applicable, idempotent, and rollback-honest — proven on a disposable
   PostgreSQL 16. Still **not applied** anywhere.

Headline defect fixed here: **a failed database read was rendered as a fact
about the user's data.** `const { data } = await supabase.from('return_requests')…`
drops the error, so a schema drift (`42703`), an RLS denial or a timeout showed
"No return requests yet", "Nothing to dispatch", "No commission records yet".
Operators concluded there was no work; real faults stayed invisible.

## 2. Repository, branch and commit

| Item | Value |
| --- | --- |
| Repository | `mahakali108/Maharani-mart` (default/base branch `main`) |
| Working branch | `arena/b405a872-maharani-mart` |
| Base at start | `0508f8bcff639050fd83f522c8a6a52e51772917` (stale local snapshot, reconciled) |
| Base now | `cdd99b2` (= `origin/arena/b405a872-maharani-mart` at session start) |
| Final commit | `75bf203` |
| Open PRs at start | 7, **all `CONFLICTING`** with `main`; none modified or merged by this work |

## 3. What was verified, and what could not be

**Verified (executed locally, disposable resources only):**

* Full migration replay in dependency order: **76/76 files apply cleanly**;
  historical checkpoint builds at 0055, 0064, 0073, 0074, 0077, 0079 all clean
  (55/79 · 63/88 · 72/95 · 73/95 · 74/95 · 76/95 files/tables).
* `0074` is genuinely required: without it the anonymous banner query fails with
  `42703 column "status" does not exist`; with it, it succeeds.
* `0077` (banner drafts) is **inert**: 0 references to `draft_image_path` or
  `draft_image_mobile_path` anywhere in `app/` or `lib/`.
* `0078`/`0079`: apply twice (idempotent), apply to an empty schema and to a
  0063-level schema (no-op + NOTICE, no half-applied state), 0 differences across
  an exhaustive 95-table `anon` differential, both rollbacks restore the prior
  posture, and the audit script is 19 `SELECT`s with identical schema/data
  fingerprints before and after.
* `0080` is free on `main`, on this branch, on PR #107 and on PR #31 →
  PR #107's `0059` should renumber to `0080+`.
* Typecheck 0 errors · ESLint clean · **155 test files / 2693 tests passed** ·
  production build compiled.

**Not verified — BLOCKED, and not claimed:**

* CI. Every failing job annotation across the three workflows reads *"The job was
  not started because recent account payments have failed or your spending limit
  needs to be increased."* There is no JS/Next workflow at all. CI is **BLOCKED
  by GitHub billing**, not by code; the local runs above are the only executable
  evidence.
* Whether `0074`/`0077`/`0078`/`0079` are applied in `fhrmsrumsraprvutrpeo`.
* Whether the 120-day retention cron runs (`0055` / `business_120` /
  `/api/cron/cleanup`). **No claim is made either way.**
* Live RLS/Storage/PostgREST behaviour and multi-connection concurrency (PGlite
  is single-connection).

## 4. Bugs fixed in this PR

| # | Defect | Consequence | Fix |
| --- | --- | --- | --- |
| 1 | List pages destructured `{ data }` and discarded `error` | "No return requests yet" / "No coupons yet" / "No offers to review" on a failed read — a false statement about operator data, hiding `42703`, RLS denial or timeout | `ReadFailureNotice` on 10 pages |
| 2 | Work queues did the same | "Nothing to dispatch", "No inventory recorded yet", "No collections recorded yet" — the packer is told there is no work | throw with the PostgREST code → existing `error.tsx` boundary (9 pages) |
| 3 | `listOffers` returned `{ offers: [], total: 0 }` on error | the offer list was indistinguishable from "no offers"; the PR #107 moderation flow depends on it | returns `failed`/`failureMessage`, the same documented contract `listSellers` already used |
| 4 | Both delivery list loaders dropped `error` | staff/salesman delivery lists silently empty | throw, mirroring `fetchDeliveryDetail` |
| 6 | Admin wallets credit table | silent empty table where money is administered | notice that balances are **not authoritative** |

Files: 16 pages + 2 shared loaders + 1 new component
(`components/ui/read-failure-notice.tsx`). The notice uses the design-system
`status.warning.*` (amber) semantic pair — the repo's colour contract forbids
red/rose/pink utilities outright, and amber is the sanctioned attention surface.

**No query, RLS rule, business rule, navigation entry or layout was changed.**
Each fix replaces a false statement with a true one.

## 5. Migrations

**None added or changed by this PR.**

* `0059` collision: PR #107's `0059_india_compliance_safety.sql` collides with
  `main`'s `0059_supplier_applications.sql`. Resolution is **PR #107's owner's
  job, at `0080+`** (verified free everywhere). `0061` must not be invented.
* `0077` (banner drafts) stays **on hold** until the upload → review →
  publication → removal workflow is validated end to end.
* `0055` and the proposed `0075` retention work stay **on hold** pending
  legal/accountant review.

## 6. Tests added

| File | Cases | What it pins |
| --- | --- | --- |
| `tests/list-pages-read-failure.test.tsx` | 12 | each fixed page surfaces the failure **and** a successful empty read still shows the true empty state |
| `tests/queue-loaders-read-failure.test.tsx` | 4 | queue/evidence loaders throw with the PostgREST code instead of an empty queue |

Both directions are asserted deliberately: a one-sided test would also pass a
regression that always shows an error. Existing guards
(`tests/detail-pages-read-failure.test.ts`, `tests/release-stock-authorization.test.ts`,
`tests/api-execute-revocation-flows.test.ts`, `tests/design-system-contract.test.ts`)
still pass unchanged.

## 7. Deliberately not changed (and why)

* **PR-owned files** — `app/retailer/orders/[id]/page.tsx`,
  `…/[id]/invoice/page.tsx` (PR #107) and `app/retailer/catalog/[id]/page.tsx`
  (PR #42). Hunk-level handoff in `docs/HANDOFF_TO_PR_OWNERS.md`; #107's invoice
  page already carries the fix.
* **Three more PR-owned files reverted** — `app/retailer/orders/page.tsx`,
  `app/retailer/notifications/page.tsx`, `app/retailer/schemes/page.tsx` were
  edited earlier in this branch and are rebuilt by PR #42 (`orders` also by
  #107). They are now byte-identical to `origin/main` (verified by
  `git hash-object` vs `git rev-parse origin/main:<path>`), and the exact patch
  their owner needs is in `docs/HANDOFF_TO_PR_OWNERS.md`.
* **Multi-read dashboards** — `admin/inventory` (6 reads),
  `admin/inventory/reports` (8), `admin/reports` (6), `admin/command-center` (5),
  `retailer/catalog` (6). Each read needs its own decision (a failed *area* list
  must not kill a successful *product* list). Blanket-editing would trade a false
  empty state for a needlessly dead page.
* **~35 remaining lower-consequence pages** — same defect class, listed
  explicitly in §11.5 of `docs/FINAL_SQL_AND_PAGE_AUDIT.md` rather than silently
  skipped. Fixing them blind in one commit is exactly what this audit exists to
  prevent.
* **`0055` retention**, **`0077` banner drafts**, production cron/secrets/storage
  — require owner approval and evidence (see
  `docs/OWNER_SECURITY_EVIDENCE_PACK.md`).

## 8. Production verification still needed (owner action)

1. `E1` — applied-migration list from `fhrmsrumsraprvutrpeo` (confirms
   `0074`/`0077`/`0078`/`0079` and the `0059` state).
2. `E3`/`E4` — `cron.job` / `cron.job_run_details` for the cleanup job. Until
   then the 120-day deletion job's activation state is **UNVERIFIED**; the
   reversible pause procedure is in `docs/OWNER_SECURITY_EVIDENCE_PACK.md`
   (SQL Editor only — `service_role` hits `42501` from
   `guard_data_retention_rules_mutation()`).
3. Storage policies on the banner buckets, and the anon read surface, checked
   live rather than from migration text.
4. GitHub billing, then CI becomes meaningful again.

### 10.1 Which job actually spent the minutes (measured)

Job durations from the Actions API for 2026-10-08 → 10-09 (the last two days
before the block):

| Job | Executions | Minutes |
| --- | --- | --- |
| `Android unit tests, lint, and debug APK` | 39 | **389.6** |
| `Web typecheck, lint, tests, and build` | ~50 | 156.3 |

**71 % of those two days' minutes were Android**, at 10.0 min/invocation vs 3.1 for
web. **244** runs of the android workflow were created 2026-10-01 → 10-09, and the
`if: github.event_name == 'workflow_dispatch'` gate that exists today was merged
**2026-10-24 in PR #116** — two weeks *after* the block began. Estimate (method
stated, not a measurement): 244 × 10.0 ≈ **2,440 min** against a **2,000 min**
Free-plan allowance. The directly measured lower bound is 389.6 min in 48 hours.

### 10.2 The Android job is already cost-neutral — do not delete it here

Since this PR it runs only on `workflow_dispatch`, so it costs **zero minutes**
unless a human starts it. Removing it would break four passing suites
(`production-readiness`, `android-release-versioning`, `pwa-ci`,
`android-project-integrity`) and buy nothing today. If the owner wants native
work gone, it belongs in one separate approved change that also drops
`needs: web`, retires `android-evidence.yml` and updates those tests — a product
decision, not a CI-cost fix. Full analysis in `docs/CI_ACTIONS_ZERO_COST.md` §2.2.

### 10.3 Free-tier options (no payment)

GitHub Free gives **2,000 private-repo minutes/month**, resets monthly; public
repos and self-hosted runners are free of minute metering. Zero-cost choices:
**(A)** wait for the 1 Nov reset with the new 3-minute gate (recommended),
**(B)** make the repo public (needs explicit owner approval — code becomes
public), **(C)** a self-hosted runner (needs your hardware + a repo-settings
change). Nothing here requires money, and **no billing change was made**.

## 9. Checks — with real results

| Check | Result |
| --- | --- |
| `tsc --noEmit` | **PASS** (0 errors, exit 0) |
| ESLint (`next lint`) | **PASS** (no warnings or errors, exit 0) |
| `vitest run` | **PASS** (155 files · 2694 tests) |
| Production build (`next build`) | **PASS** (exit 0, 133/133 static pages, `NEXT_PUBLIC_*` unset — same as `ci.yml`) |
| Migration replay 76/76 + 6 checkpoint builds | **PASS** |
| `0078`/`0079` privilege + rollback suites | **PASS** (incl. 11/11 revocation flows, 20/20 release-stock authorization) |
| Audit script non-mutating | **PASS** (fingerprints identical) |
| CI (GitHub Actions) | **BLOCKED** — jobs never start (billing) |
| Production applied-migration state | **NOT RUN** — no production access, by instruction |
| Retention cron state | **NOT RUN** — cannot be verified from the repo |
| Live RLS/Storage/PostgREST | **NOT RUN** — needs production evidence |

No merge, no deploy, no production SQL, no secret or cron change, no data
deletion. Not claimed: "all fixed", "production ready", "all tests passed" —
the last would be false in the presence of a BLOCKED CI.

## 10. CI: why the checks are red, and the zero-cost change

**Cause (verified).** Every failing job on this repository starts **zero steps**
and ends ~2 s later with: *"The job was not started because recent account
payments have failed or your spending limit needs to be increased."* Verified on
run `40078570305` (commit `af17247`): the web job and the production-probe job
both have `steps: 0`. A job that runs no steps has executed no line of this
repository's code, so the red Xs are **not** typecheck/test/build failures.

Supporting evidence: private repo, personal (user) account, GitHub Free
(`/rulesets` answers *"Upgrade to GitHub Pro or make this repository public"*),
**last green run 2026-10-09T16:56Z**, **399 runs** created 2026-10-01 → 2026-10-25,
and the scheduled job fails too (so the block is account-wide).

**Not verified:** whether the trigger is exhausted included minutes or a failed
payment method — the billing/timing APIs return `403` for this token; only the
owner's *Settings → Billing → Plans and usage → Actions* screen can say. No claim
is made either way, and nothing was purchased or changed in billing.

**Why it was expensive.** `android-apk.yml` triggered on `push` (all branches;
its path filter includes `tests/**`) **and** `pull_request`, and carried three
jobs: the full web gate, a 45-minute Android job, and a live production probe.
One commit therefore queued two full runs plus a `workflow_run`; the probe also
gated pull requests on the health of the *deployed* build.

**Change (in this PR — no separate PR needed, since it is the same branch's CI
contract):**

| File | Change |
| --- | --- |
| `.github/workflows/ci.yml` **(new)** | one job: `install --frozen-lockfile` → `typecheck` → `lint` → `test` → `build`, on `pull_request → main`, `push → main`, and manual. `cancel-in-progress`, `contents: read`, no secrets, no matrix, no services. |
| `.github/workflows/android-apk.yml` | auto-triggers removed → `workflow_dispatch` only. **No job deleted or edited** (`android` needs `web`; the probe job remains for manual reproduction). |
| `.github/workflows/production-health.yml` | `pull_request` trigger removed; `push → main`, daily schedule and manual dispatch kept. |
| `.github/workflows/android-evidence.yml` | untouched (unrelated). |
| `tests/pwa-ci.test.ts` | asserts the old triggers are **gone**, the web gate still runs on PRs/pushes to `main`, native is still dispatch-gated, and the probe is no longer a PR gate. |

Fresh evidence on **this** commit (`0116622`): GitHub **accepted** the new
workflow — run [`40205122974`](https://github.com/mahakali108/Maharani-mart/actions/runs/40205122974)
(`Web CI`, event `pull_request`) exists, which an invalid workflow file could
never produce — and its single job then started **0 steps** and ended 2 s later
with the same billing annotation. So *workflow validity is proven; step execution
is not*. The check name is `Web checks (typecheck, lint, tests, build)`; it will
stay red until the account-level block clears.

Nothing lifts an account-level Actions block from inside a repository — the
zero-cost options (wait for the monthly reset / make the repo public with owner
approval) are documented in `docs/CI_ACTIONS_ZERO_COST.md`. Until then local runs
are the only executable evidence, and GitHub CI is reported as **BLOCKED**.
