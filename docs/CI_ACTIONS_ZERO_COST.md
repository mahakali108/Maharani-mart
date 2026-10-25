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
  the timing API returns no billable duration.
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

## 4. Zero-cost options (owner decision — none executed here)

The block is at **account level**. Deleting workflow files does not lift it; it
only stops wasting runs once the block clears. With that understood:

| Option | Cost | What it needs | Trade-off |
| --- | --- | --- | --- |
| **A. Wait for the monthly reset** and keep the new cheap workflow | ₹0 | nothing | No CI until the reset date. Use §5's local gate in the meantime. |
| **B. Make the repository public** — Actions minutes are free/unlimited for public repositories on GitHub Free | ₹0 | explicit owner approval, because the source becomes world-readable | A public repo also exposes history and PR diffs. Not something an agent may decide. |
| **C. Check the payment method** if the annotation is caused by a failed payment rather than exhausted minutes | ₹0 if it is a stale/expired card needing re-authorisation; a purchase if a paid plan is chosen | owner, in Billing settings | This is a **billing action** and was explicitly out of scope for this task. |
| **D. Buy minutes / upgrade to Pro** | money | owner | Rejected by the instruction "no money, no paid plan". |
| **E. Local / free-runner CI** | ₹0 | see §5 | Evidence is real but is *not* GitHub CI, and must never be reported as "CI passed". |

Recommendation: **A now, B only if the owner wants automatic PR checks before
the reset.** In both cases keep the workflow as changed — it is strictly cheaper
and it removes the false-red production probe from PRs.

---

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

Measured on this change: typecheck **0 errors**, ESLint **clean**, vitest
**155 files / 2697 tests passed**, `next build` **compiled** with no
`NEXT_PUBLIC_*` variables set. These are local results. **GitHub CI status
remains BLOCKED and is not reported as passing.**

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
