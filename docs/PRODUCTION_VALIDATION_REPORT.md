# Production Validation Report — Phase 4 (PR #54)

- **Date (UTC):** 2026-09-12
- **Validation target:** PR #54 branch `arena/01a0914f-maharani-mart` @ `27a64ee`
  ("Phase 2–4: admin core, staff permissions, warehouse ops, order lifecycle,
  deliveries & collections"). The validation subjects named in the task —
  migrations `0042–0045`, `supabase/smoke-test.sql`,
  `scripts/production-validate.sh`, `docs/PRODUCTION_VERIFICATION_CHECKLIST.md` —
  exist **only** on that branch, not on `main`. They were inspected from a
  read-only archive; nothing was merged.
- **Validator environment:** this sandbox (no `DATABASE_URL`, no Supabase
  credentials, no `psql`/Postgres/Docker, no Vercel access, no real devices,
  no real user accounts; outbound TLS to `*.vercel.app` is blocked, npm
  registry reachable).
- **This report lives on:** branch `arena/01a09329-maharani-mart` (validation
  report only — no app changes, no merge).

## VERDICT: NOT PRODUCTION-READY — DO NOT MERGE

Two **critical** defects were found that guarantee live-validation failure
(dispatch can never succeed; the smoke test can never run), plus four minor
issues. All live-database steps (§1–§7 of the task) remain **NOT DONE** —
blocked first by the two critical defects, second by missing credentials and
tooling in this sandbox. **No APK is claimed. Nothing was merged.**

---

## A. Checks EXECUTED here (exact results)

All run against the PR #54 tree (`27a64ee`), extracted read-only to scratch.

| # | Check | Exact command / method | Result |
|---|-------|------------------------|--------|
| A1 | Typecheck | `pnpm typecheck` (`tsc --noEmit`) | ✅ **PASS**, exit 0 |
| A2 | Lint | `pnpm lint` | ✅ **PASS**, exit 0 (1 pre-existing `<img>` warning in `components/admin/product-image-manager.tsx:110`, 0 errors) |
| A3 | Unit tests | `pnpm test` (vitest) | ✅ **PASS — 48 files / 899 tests, all green** (matches the checklist's claim exactly) |
| A4 | Production build | `pnpm build` | ✅ **PASS**, exit 0, middleware 83.9 kB |
| A5 | SQL grammar parse, migrations 0037–0045 | `pgsql-parser` (real `libpg_query` grammar) per file | ✅ **all 9 PARSE OK** |
| A6 | SQL grammar parse, `supabase/smoke-test.sql` | same parser, psql meta-lines stripped | ❌ **SYNTAX ERROR** — `syntax error at or near "("` (see F2) |
| A7 | Destructive-statement sweep, 0042–0045 | `grep -nE "drop (table\|column)\|truncate\|delete from"` | ✅ none found (additive claim holds) |
| A8 | `production-validate.sh` syntax | `bash -n` | ✅ OK |
| A9 | Validate-script probe objects exist | cross-checked probe targets against 0037–0041 sources | ✅ all 9 probe objects exist (`is_order_assigned_to_current_staff`, `staff_targets`, `follow_ups`, `trg_audit_schemes`, `inventory_area_totals`, `trg_enforce_order_status_transitions`, `order_deliveries`, `payment_collections`, `delivery-proofs`) |
| A10 | Migration dependency order | manual review of 0042–0045 + 0001/0009/0014/0037 | ✅ order correct; 0045-last rule holds (its storage policies query `order_deliveries`/`payment_collections`) |
| A11 | Preview deployment reachability | `curl` to `https://maharanitraders-git-arena-01a0914f-2c285b-mahakali108s-projects.vercel.app/` | ⚠️ **UNREACHABLE FROM SANDBOX** — `SSL_ERROR_SYSCALL` during TLS handshake (sandbox egress restriction; control `registry.npmjs.org` = HTTP 200). Checklist's "Preview Ready" claim **neither confirmed nor refuted** |
| A12 | New Phase-4 routes exist | file check | ✅ `/admin/delivered`, `/admin/collections`, `/staff/deliveries`, `/salesman/deliveries`, `/salesman/collections`, `/retailer/orders/[id]/delivery` all present |

---

## B. DEFECTS FOUND (must fix before any live run)

### F1 — CRITICAL: dispatch can never succeed (migration contradicts app code)

- **Migration** `supabase/migrations/0043_deliveries_module.sql:96-97`:
  ```sql
  constraint order_delivery_items_split
    check (quantity_delivered + quantity_missing + quantity_damaged = quantity_ordered)
  ```
- **App code** `lib/staff/dispatch-actions.ts:148-155` inserts the dispatch
  snapshot as `(delivery_id, order_item_id, quantity_ordered=N)` only, so
  `delivered/missing/damaged` default to `0/0/0`:
  ```ts
  const itemSnapshots = items.map((item) => ({
    delivery_id: deliveryId,
    order_item_id: item.id,
    quantity_ordered: item.quantity_pieces ?? item.quantity, // N > 0
  }));
  ```
- **Consequence:** `0 + 0 + 0 = 0 ≠ N` → every dispatch fails with a
  check-constraint violation. The completion path
  (`lib/delivery/delivery-actions.ts`, which `UPDATE`s these snapshot rows
  with the counted split) can never run either — its rows can never exist.
  **Checklist §6 step 1 and the whole dispatch→delivery→collection flow are
  unexecutable until this is fixed.** Unit tests pass only because they never
  execute SQL against the real constraint.
- **Suggested fix (not applied — out of scope for validation):** enforce the
  split only in terminal delivery states, e.g. replace the unconditional
  `CHECK` with `<=` plus a trigger (or completion-time enforcement) requiring
  `=` when the parent task is `delivered`/`partially_delivered`; then make the
  smoke fixture mirror the real dispatch insert.

### F2 — CRITICAL: `supabase/smoke-test.sql` cannot execute (Postgres syntax error, 6×)

- **Lines 151, 185, 221, 254, 314, 371** use:
  ```sql
  set local request.jwt.claims = format('{"sub":"%s",...}', (select ...))::jsonb;
  ```
- PostgreSQL `SET` accepts only literals — no function calls, subselects, or
  casts. Proven with the real grammar (`libpg_query` via `pgsql-parser`):
  - smoke-test pattern → `SYNTAX ERROR: syntax error at or near "("`
  - control `SET ... = '{"sub":"abc"}'` → PARSE OK
  - control `SELECT set_config('request.jwt.claims', format(...), true)` → PARSE OK
- **Consequence:** the script dies at the first impersonation line (§A). The
  RLS matrix (§A–§D) can never run.
- **Suggested fix:** replace all six lines with
  `SELECT set_config('request.jwt.claims', format(...), true);`
  (`SET LOCAL ROLE` lines are fine and unaffected).

### F3 — MEDIUM: smoke-test §0 fixture is self-contradictory

- `supabase/smoke-test.sql:117-121` inserts `quantity_ordered = 10` (hard
  literal) for **every** line of the smoke order — including the second line
  (`quantity = 4`) that the comment on lines ~104-107 says is "intentionally
  left OUT of the delivery snapshot". Both defects: (a) the insert violates
  the F1 split check (`0 ≠ 10`) so the script aborts in §0 even after F2 is
  fixed; (b) because the qty-4 line *is* attached, the §E split-invariant
  test (line 485) would be rejected by the `UNIQUE(delivery_id,
  order_item_id)` constraint instead of the split check — a pass for the
  wrong reason. The §E test only becomes meaningful once the fixture filters
  to the qty-10 line (`... and oi.quantity = 10`).

### F4 — LOW: checklist policy-count breakdown is wrong (total is right)

- `docs/PRODUCTION_VERIFICATION_CHECKLIST.md` §1 says
  `expect: 10 policies (3 + 5 + 2)`. Actual per-table counts from the
  migrations: `order_deliveries` 3 (read/insert/update),
  `order_delivery_items` **4** (read/write/update/delete), `payment_collections`
  **3** (read/salesman_insert/admin_update). Correct breakdown is **(3 + 4 + 3)**;
  the total (10) and the verification SQL itself are correct, so the check
  passes — only the parenthetical is wrong.

### F5 — LOW: smoke-test §B outsider-insert negative test can't detect an RLS hole

- The "out-of-scope staff cannot create delivery tasks" test inserts a task
  for an order that **already has one** (`smoke_orders`), so a `UNIQUE`
  violation would mask an RLS bypass — the test passes either way. It should
  target the task-less `SMOKE-TRANSITION` order to genuinely exercise the
  `order_deliveries_insert` policy.

### F6 — LOW: `production-validate.sh` can report false success on smoke failure

- `scripts/production-validate.sh:94` runs the smoke test as
  `psql "$DATABASE_URL" -f "$SMOKE"` **without** `-v ON_ERROR_STOP=1`
  (unlike the migration invocations, which use it). `psql` then exits 0
  despite errors and the script prints `== DONE ==`. Add `ON_ERROR_STOP=1`
  so a failing smoke test fails the script (the open transaction still rolls
  back server-side on exit).

---

## C. Task items NOT executed (with exact reason each)

| Task item | Status | Reason |
|-----------|--------|--------|
| 1. Apply migrations 0042–0045 to the real Supabase project | ⏳ **NOT DONE** | No `DATABASE_URL`/credentials in sandbox (none present; credentials are never requested in chat), no `psql`/CLI, no network route to the project. Must run on the owner's credentialed machine via §D below. |
| 2. Run `supabase/smoke-test.sql` with `DATABASE_URL` | ⏳ **NOT DONE** | Same blocker as (1), **plus** F2/F3 make the script unrunnable — it must be fixed first or the run is guaranteed to fail. |
| 3. Execute the production verification checklist | ⏳ **NOT DONE (live parts)** | Static claims re-verified green (A1–A4); every live section (§1 SQL counts, §2 matrix, §3 HTTP, §5, §6) requires the credentialed project + fixed defects. |
| 4. Test admin/staff/salesman/retailer access with real accounts | ⏳ **NOT DONE** | Requires real accounts + reachable deployment; neither exists in the sandbox. |
| 5. Dispatch→delivery→collection flow | ⏳ **NOT DONE** | Requires live system; additionally **F1 proves this flow cannot currently pass** — do not attempt until fixed. |
| 6. Private proof URLs + cross-user denial | ⏳ **NOT DONE** | Requires live storage + two retailer sessions (blocked on 1–2). Migration 0045 itself parses clean and its policies are owner-bound on read; the HTTP checks in checklist §3 are the outstanding proof. |
| 7. Deploy to Vercel + real-device testing | ⏳ **NOT DONE** | No Vercel access from sandbox; preview host unreachable from here (A11); no physical devices. Checklist asserts a PR #54 preview deployment exists and is Ready — unverified here. |
| 8. Report exact results | ✅ **THIS FILE** | |
| 9. Production-ready claim | ❌ **NOT CLAIMED** | Withheld: F1+F2 are launch-blocking and no live test has passed. |
| 10. Merge / APK | ❌ **NOT DONE, NOT CLAIMED** | No merge performed or requested; no APK attempted or claimed. |

---

## D. Owner runbook (exact steps, after F1–F3 are fixed on PR #54)

On a machine with `psql` and network access to the Supabase project, from the
repo root at the fixed PR #54 commit:

```bash
# 1) Apply migrations 0037–0045 (probes skip already-applied ones) + smoke test:
DATABASE_URL="postgres://postgres:<password>@db.<project-ref>.supabase.co:5432/postgres" \
  ./scripts/production-validate.sh
# Expect: "applied ✓" lines, "triggers: 5 · proof buckets private: 2",
# a series of PASS: notices, and SMOKE TEST COMPLETE with ROLLBACK.
# (Apply F6 first so failures exit non-zero.)

# 2) Standalone smoke re-run (if needed):
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/smoke-test.sql

# 3) §1 post-application verification SQL + §3 bucket SQL:
#    paste the blocks from docs/PRODUCTION_VERIFICATION_CHECKLIST.md §1/§3
#    into the Supabase SQL Editor. Expect: 3 functions, 5 triggers,
#    2 private buckets, 10 table policies (3+4+3, see F4), 4 storage policies.

# 4) §3 HTTP checks (replace <PROJECT>):
curl -s -o /dev/null -w '%{http_code}\n' \
  "https://<PROJECT>.supabase.co/storage/v1/object/public/delivery-proofs/deliveries/<orderId>/<file>.webp"
# expect: 400 or 403 — never 200. Then the two signed-URL checks in §3.

# 5) §5 per-role app testing + §6 end-to-end flow on the preview deployment
#    with one real account per role (checklist has the full box-by-box plan).

# 6) Sign off §7 only when every box is checked against the LIVE project.
```

## E. Sign-off status (checklist §7, against the live project)

- [ ] Migrations 0042–0045 applied in order; §1 SQL returns expected counts
- [ ] `supabase/smoke-test.sql` prints all `PASS:` lines and `SMOKE TEST COMPLETE`
- [ ] §3 private-bucket HTTP checks behave as specified
- [ ] Every box in §5 and §6 checked for all four roles
- [x] `pnpm typecheck && pnpm lint && pnpm build && pnpm test` green on the
      validated commit (`27a64ee`) — re-verified in this sandbox (A1–A4)

**Phase 4 is not production-ready. No APK build is claimed or in scope.**
