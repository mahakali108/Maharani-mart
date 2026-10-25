# GitHub Actions: why CI is red, and the zero-cost fix

Status: **diagnosis complete, workflow cost reduced, account-level block NOT
lifted** (it cannot be lifted from inside a repository). No paid plan, billing
change, deployment, SQL, or merge was performed.

---

## 1. What is actually happening (verified)

Every failing job on this repository ends in the same way: **zero steps started**,
completed ~2 seconds after it began, with this annotation:

> "The job was not started because recent account payments have failed or your
> spending limit needs to be increased. Please check the 'Billing & plans'
> section in your settings."

Verified on run `40078570305` (commit `af17247`, event `pull_request`):

| Job | Conclusion | Steps started | Annotation |
| --- | --- | --- | --- |
| Production probe (maharanitraders.vercel.app) | failure | **0** | billing message above |
| Web typecheck, lint, tests, and build | failure | **0** | billing message above |
| Android unit tests, lint, and debug APK | skipped | 0 | (its `if:` is dispatch-only) |

A job that starts no steps has not run a single line of this repository's code.
So the red X is **not** a typecheck, test, lint or build failure, and the log
contains no evidence about the diff.

### Supporting evidence

* Repository is **private**, owner type **User** (i.e. a personal account).
* `GET /repos/…/rulesets` answers *"Upgrade to GitHub Pro or make this repository
  public to enable this feature."* — i.e. the account is on **GitHub Free**.
* **Last green run: 2026-10-09T16:56:03Z.** Every run after 2026-10-10 fails with
  the annotation above; none of them started a step.
* **399 workflow runs** were created between 2026-10-01 and 2026-10-25
  (in the first 100: 36 `push`, 15 `pull_request`, 10 `schedule`,
  39 `workflow_run`).
* The scheduled `Production health` job also fails (2026-10-25T07:46Z), which
  confirms the block is account-wide, not workflow-specific.

### The new workflow was accepted; only execution is blocked

The commit that adds `ci.yml` (`0116622`) produced run **`40205122974`**,
workflow **`Web CI`**, event `pull_request`. GitHub therefore **parsed and
registered the new workflow file** — an invalid `on:`/job definition cannot
create a run at all. Its single job then behaved exactly like every other job on
this account:

| Field | Value |
| --- | --- |
| Job | Web checks (typecheck, lint, tests, build) |
| Steps started | **0** |
| Started → completed | 15:03:27Z → 15:03:29Z (2 s) |
| Annotation | the same billing message |

This is the precise distinction to keep: **workflow validity is proven, step
execution is not.** Nothing about typecheck/lint/test/build was measured by
GitHub on this commit, so no check here may be described as "CI passed".

### What is NOT verified — do not assume

* Whether the trigger is **exhausted included minutes** or a **failed payment
  method**. Both render the identical annotation.
* The exact minutes used. The billing and Actions-permission endpoints return
  `403 Resource not accessible by integration` for the token available here, and
  the timing API returns no billable duration. §2.1 therefore *measures job
  durations* and reports a lower bound plus a stated estimate — not the account's
  own meter.
* Branch protection / required status checks: `403` for the same reason, so
  whether "Web checks" is a required check cannot be confirmed from here.

**To distinguish the two causes in one minute, at zero cost:** GitHub → *Settings
→ Billing and plans → Plans and usage → Actions*: read *"Included minutes"*
percentage used, and check whether a payment method shows as failed. That single
screen decides which of §4's options applies. Nothing needs to be purchased to
look at it.

---

## 2. Why the old workflow shape burned minutes

`.github/workflows/android-apk.yml` contained **three** jobs and triggered on
`push` (all branches, path-filtered on `android/**`, `tests/**`,
`package.json`, …) **and** `pull_request`:

* `web` — full install + typecheck + lint + a complete Next.js test run + build.
* `android` — JDK 17, Android SDK 36, Gradle `testDebugUnitTest lintDebug
  assembleDebug`, **45-minute timeout**. It was already gated by
  `if: github.event_name == 'workflow_dispatch'`, so it was skipped — but the
  workflow still queued on every event.
* `production-probe` — a live network probe of the deployed site, run on every
  push and every pull request.

Because `tests/**` is in the path filter, almost every commit matched. Each push
*and* each PR event created a run, and each run also fired
`android-evidence.yml` through `workflow_run`.

Two structural faults, independent of billing:

1. **Duplication** — one commit produced a `push` run and a `pull_request` run of
   the same checks against the same tree.
2. **Wrong coupling** — a production probe ("is the deployed build healthy") was
   a gate on pull requests ("is this diff correct"). It cost minutes to measure
   `main`, and it turned unrelated production incidents into red X's on other
   people's pull requests.

---

## 2.1 Measured: which job spent the minutes

Job durations taken from the Actions API for the runs of **2026-10-08 → 2026-10-09**
(the last two days before the block):

| Job | Jobs that executed | Minutes |
| --- | --- | --- |
| `Android unit tests, lint, and debug APK` | **39** | **389.6** |
| `Web typecheck, lint, tests, and build` | ~50 | 156.3 |

**71 % of the measured minutes on those two days went to the Android job**, at an
average of **10.0 minutes per invocation** versus 3.1 for the web gate.

Run volume for **2026-10-01 → 2026-10-09**: **244** runs of the android workflow,
6 of `Android artifact evidence`, 4 of `Production health`.

Crucially, the Android job was **actually executing on every push and every pull
request** in that window — the `if: github.event_name == 'workflow_dispatch'` gate
that exists today was merged on **2026-10-24 in PR #116**, two weeks *after* the
block began. `git log -S"github.event_name == 'workflow_dispatch'"` on
`.github/workflows/android-apk.yml` returns `0508f8b` and nothing earlier.

**Estimate (method stated, not a measurement):** 244 runs × 10.0 min measured
average ≈ **2,440 Android minutes** for 1–9 October, before counting ~244 web
jobs at ~3 min. Against the Free plan's **2,000 minutes/month** for private
repositories, this is a sufficient explanation for the block beginning on
10 October. It is an estimate because per-job durations for all 244 runs were
not fetched; the *lower bound* measured directly (389.6 min in two days) is fact.

## 2.2 The Android job is cost-neutral now — but it WAS the cost centre

`android-apk.yml` still declares three jobs, but since this PR it only runs on
`workflow_dispatch`, so **it consumes zero minutes unless a human starts it**.

| Item | Status | Note |
| --- | --- | --- |
| `android` job (JDK 17 + Android SDK 36 + Gradle `testDebugUnitTest lintDebug assembleDebug`, 45-min timeout) | manual-only | The product ships as a web PWA: `vercel.json` builds `next build`, no workflow publishes an APK to Play or anywhere else, and no other workflow consumes the artifact except `android-evidence.yml` |
| `needs: web` on the `android` job | present | A manual native dispatch also runs the full web gate — two jobs for one diagnostic |
| `android-evidence.yml` (`workflow_run` on `Native Android Debug APK`) | automatic **when a native build runs** | Dormant while native builds are manual |

**Recommendation: do not delete the Android job in this PR.** Deleting it would
be a behaviour change to a "PWA-only" claim that also breaks three passing test
files, and it buys nothing today because the job already costs zero:

* `tests/production-readiness.test.ts` asserts `android-apk.yml` contains
  `assembleDebug`, `testDebugUnitTest`, `lintDebug`, `com.maharanitraders.app`
* `tests/android-release-versioning.test.ts` asserts the APK version-policy steps
* `tests/pwa-ci.test.ts` asserts the `android` job stays dispatch-gated
* `tests/android-project-integrity.test.ts` inspects the `android/` tree itself

If the owner does want it gone, it should be **one separate, approved change**
that removes the `android` job, drops `needs: web`, retires `android-evidence.yml`
and updates those four test files together — and decides explicitly whether the
`android/` source tree stays as documentation. That is a product decision
(native is out of scope per the audit brief), not a CI-cost fix.

## 3. What this change does (all in the existing PR, not a new one)

| File | Change | Why |
| --- | --- | --- |
| `.github/workflows/ci.yml` | **New**, single `web` job: install → typecheck → lint → test → build. Triggers: `pull_request → main`, `push → main`, `workflow_dispatch`. `cancel-in-progress`, `permissions: contents: read`, no secrets, no matrix, no services. | The web gate, at the cheapest shape that still blocks a bad merge. |
| `.github/workflows/android-apk.yml` | Auto-triggers removed; **`workflow_dispatch` only**. No job was deleted or edited. | Native work is manual, so it can no longer start by accident. Jobs are kept because `android` declares `needs: web`, and `production-probe` is still the manual way to reproduce a production failure. |
| `.github/workflows/production-health.yml` | `pull_request` trigger removed. `push → main`, the daily 08:00 IST `schedule`, and manual dispatch remain. | Production health is measured against the deployed build on `main`, not against a PR. |
| `.github/workflows/android-evidence.yml` | **Untouched.** | Unrelated workflow; it only ever ran on a native build or by hand. |
| `tests/pwa-ci.test.ts` | Rewritten for the new layout; asserts the old triggers are **gone**, the web gate still runs on PRs/pushes to `main`, the native job is still dispatch-gated, and the probe is no longer a PR gate. | The old test asserted the expensive shape. Its intent ("retiring native automation must not silently remove release gates") is preserved and now asserted against `ci.yml`. |

No dependency, action version, script, lockfile, or job step was changed. The
workflow reuses the repository's own `package.json` scripts and the committed
`pnpm-lock.yaml` with `--frozen-lockfile`.

### Cost profile of normal developer activity, before → after

| Event | Before | After |
| --- | --- | --- |
| Push to a feature branch | 1 run: install + tests + build + probe (+ `workflow_run`) | **0** |
| Pull request opened/updated | 1 more run of the same, plus probe | 1 run: install + typecheck + lint + test + build |
| Push to `main` | web + probe + `workflow_run` | web + probe (both intentional, both on `main` only) |
| Daily schedule | probe | probe (unchanged) |
| Android build | skipped everywhere (already), but queued | nothing unless manually dispatched |
| Superseded push while a run is in flight | both ran to completion | previous run cancelled |

That is roughly **half** the jobs and **none** of the Android/duplicate cost — but
it is still real minute usage, which is why §4 matters.

---

## 4. Zero-cost options — what the free tier actually allows

Verified against GitHub's own billing documentation (read 2026-10-25):

* Private repositories on **GitHub Free: 2,000 Actions minutes per month**,
  500 MB artifact storage. Public repositories and **self-hosted runners are
  free of minute metering**. Minutes reset to zero at the start of each month and
  do not carry over. Without a payment method, jobs are blocked once the included
  minutes are used.
* Public repositories additionally get *larger* standard runners (4-core/16 GB)
  at no charge versus 2-core/8 GB for private.

| Option | Cost | Needs | Verdict |
| --- | --- | --- | --- |
| **A. Wait for the monthly reset** (1 Nov 2026) and keep the new cheap workflow | **₹0** | nothing | **Recommended now.** ~2,000 min/month with a 3-minute web gate is ~600 runs of headroom; the Android job can no longer touch it. |
| **B. Make the repository public** | **₹0** | explicit owner approval — the code, history and PR diffs become world-readable | Only if automatic PR checks are needed before the reset. **Not an agent decision.** |
| **C. Self-hosted runner** | **₹0** in Actions minutes | your own hardware + a repo admin registering the runner | Works on every plan, but it is infrastructure to maintain and a repo-settings change; also unusable from this sandbox. |
| **D. Card re-authorisation**, if the block is a failed payment rather than exhausted minutes | ₹0 if it is a stale card; **a purchase** if a paid plan is chosen | owner, in Billing | Out of scope by instruction. |
| **E. Buy minutes / upgrade to Pro** | **money** | owner | Rejected by instruction. |

**Recommended: A.** Keep the workflow as changed — it is strictly cheaper and it
removes the false-red production probe from pull requests. Revisit B only if
automatic checks are needed this week.

> Distinguishing D from A still requires the owner's *Settings → Billing and
> plans → Plans and usage → Actions* screen; §2.1's measurement makes exhausted
> minutes the strongly supported explanation, but does not prove it.

## 5. The free gate that actually runs today (local parity)

These are the exact commands `ci.yml` executes, in the same order, and they were
run on commit `af17247` + this change with **no Supabase credentials present**:

```bash
corepack pnpm install --frozen-lockfile
corepack pnpm run typecheck
corepack pnpm run lint
corepack pnpm test
corepack pnpm run build        # verified working with NEXT_PUBLIC_* unset
```

Measured on commit `78a6f05`, 2026-10-25, with no Supabase credentials present:

| Command | Exit code | Result |
| --- | --- | --- |
| `corepack pnpm install --frozen-lockfile` | **0** | lockfile matched |
| `corepack pnpm run typecheck` | **0** | 0 errors |
| `corepack pnpm run lint` | **0** | no warnings or errors |
| `corepack pnpm test` | **0** | **155 files / 2694 tests passed** |
| `corepack pnpm run build` | **0** | compiled, 133/133 static pages |

These are local results. **GitHub CI status remains BLOCKED and is not reported
as passing.**

Two caveats that make local a weaker signal than CI, stated plainly:

1. The runner's Node version, OS image and cold cache are not reproduced here.
2. Nothing in this sandbox can prove that the *workflow file itself* is accepted
   by GitHub — `ci.yml` has been parsed as YAML and reviewed, but its first real
   execution is the first run after the account block clears.

---

## 6. Manual next steps (in order)

1. Open *Settings → Billing and plans → Plans and usage → Actions* and read the
   included-minutes figure for the current month. Record it; this is the fact
   this document cannot obtain.
2. If a payment method shows as failed and you do **not** want to spend money,
   leave it: the block clears with the monthly reset.
3. Optionally, and only with explicit approval: make the repository public
   (option B) so Actions is free and the new `ci.yml` starts reporting.
4. Re-run the failing workflows once the block clears — Actions → *Web CI* →
   *Run workflow*. Expect one job, five steps, no credentials.
5. Do **not** re-point the production probe at pull requests. When it is needed,
   run *Production health* by hand; it is anonymous and read-only.

## 7. What was deliberately not touched

* `android-evidence.yml` — unrelated to the cost profile that matters.
* Any action version, runner label, or `ubuntu-latest` pin.
* Any production setting: no deployment, no cron, no secret, no storage bucket,
  no Supabase change, no migration applied, no PR merged.
* The PWA/Next.js architecture, tests, and the audit fixes already in this PR.
