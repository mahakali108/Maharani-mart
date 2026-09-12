# Fix Report — Production Validation Findings F1–F6

- **Date (UTC):** 2026-09-12
- **Base:** PR #54 head `27a64ee`, merged into this session branch
  (`arena/01a09329-maharani-mart`) purely as a working base. `main` is
  untouched, PR #54 is untouched and still open.
- **Scope:** fix F1–F6 exactly as specified. No other behaviour changed.

## VERDICT: ALL FINDINGS FIXED — LIVE VALIDATION STILL REQUIRED

Every finding is fixed and every sandbox-runnable check is green (see §C).
This is **not** a production-ready claim: the live steps from
`docs/PRODUCTION_VALIDATION_REPORT.md` §C (migrations on the real project,
smoke run, role testing, flow verification, Vercel, devices) are still
**NOT DONE** and remain blocked on owner credentials/access. **Not merged.
No APK built or claimed.**

---

## A. Fixes applied (exact)

### F1 — dispatch split invariant (critical)

**New migration `supabase/migrations/0046_delivery_split_terminal_states.sql`**
(additive, re-runnable; must run after 0043 — filename order guarantees it):

- Drops 0043's unconditional `order_delivery_items_split` (`=` at all times)
  and replaces it with `order_delivery_items_split_partial`
  (`delivered + missing + damaged <= ordered`) — dispatch snapshots with
  `0/0/0` are now storable. No counts are faked at dispatch.
- New `trg_enforce_delivery_split` (`BEFORE INSERT OR UPDATE` on
  `order_delivery_items`): when the parent task is terminal
  (`delivered`, `partially_delivered`, `failed`, `returned_to_warehouse`),
  the written row must balance exactly (`DELIVERY_SPLIT_INCOMPLETE`).
- New `trg_enforce_delivery_lines_complete` (`BEFORE INSERT OR UPDATE OF
  delivery_status` on `order_deliveries`): a task may only ENTER a terminal
  state when every existing line balances (`DELIVERY_LINES_INCOMPLETE`), and
  tasks are always born non-terminal (`DELIVERY_BORN_TERMINAL`).
- Non-negativity untouched: 0043's `order_delivery_items_qty_check` is not
  dropped or altered (asserted in tests).

**`lib/delivery/delivery-actions.ts`** — `recordFailedDeliveryAction` now
records every line as fully missing (`missing = ordered`) **before** flipping
the parent to `failed` (failed is terminal, so the parent trigger requires
balanced lines). No settlement/wallet logic changed — fail still credits
nothing, and re-dispatch resets these rows. Completion needed no change (it
was already lines-before-status); RTO needed no change (reachable only from
already-balanced `delivered`/`partially_delivered`).

**Regression tests** — new `tests/delivery-split-invariant.test.ts` (12 tests):
dispatch inserts 0/0/0 with no faked keys; re-dispatch resets to non-terminal;
both 0046 triggers enforce `=` in exactly the four terminal states;
completion writes full splits before the status flip; fail records
missing-before-flip; RTO reachability; partial/failed/RTO flow correctness
against `lib/delivery/state-machine.ts`. `tests/deliveries-workflow.test.ts`
updated: the old "unconditional `=`" test now asserts the 0046 supersession,
non-negativity preservation, and 0046 additive/re-runnable hygiene.

### F2 — smoke-test JWT impersonation (critical)

**`supabase/smoke-test.sql`** — all six
`SET LOCAL request.jwt.claims = format(...)` statements (Postgres syntax
error) replaced with transaction-local
`SELECT set_config('request.jwt.claims', format(...), true);`.

**Regression test** — `tests/smoke-test-sql.test.ts`: fails on any
`SET ... request.jwt.claims =` line; requires exactly six `set_config`
impersonations, one per persona, each ending `, true)`.

### F3 — smoke fixture

**`supabase/smoke-test.sql` §0** — the delivery-items insert now uses the
line's true quantity (`oi.quantity`) and filters to the qty-10 line only
(`and oi.quantity = 10`); the qty-4 line stays genuinely unattached, and the
`0/0/0` snapshot satisfies the new pre-completion invariant. A new §0 `DO`
block asserts both facts with a `PASS:` notice.

### F4 — checklist policy breakdown

**`docs/PRODUCTION_VERIFICATION_CHECKLIST.md` §1** — `(3 + 5 + 2)` corrected
to `(3 + 4 + 3)` (total 10 unchanged). The checklist also gained the 0046
table row, the 0046-after-0043 ordering rule, updated §1 verification counts
(5 functions, 7 triggers), `0037–0046` ranges, and strict smoke commands.

### F5 — unmasked RLS negative test

**`supabase/smoke-test.sql` §B** — the outsider-insert test now targets the
task-less `SMOKE-TRANSITION` order (no `UNIQUE` row can exist there yet) and
requires SQLSTATE `42501` (`exception when insufficient_privilege`) —
an insert that succeeds, or any other error, fails loudly instead of passing
for the wrong reason. (`smoke_transition_order` grant added for the
authenticated role.)

### F6 — strict error handling

- **`scripts/production-validate.sh`** — smoke run is now
  `psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f "$SMOKE"`; script also gained
  the 0046 probe/apply step and the `triggers: 7` sanity count.
- **`supabase/smoke-test.sql`** header and **checklist §0/§2** document the
  required `-v ON_ERROR_STOP=1` flag.
- **Regression test** — asserts the flag in all three places and that the
  smoke script contains no `COMMIT`.

---

## B. Changed files (exact)

| File | Change |
|------|--------|
| `supabase/migrations/0046_delivery_split_terminal_states.sql` | **NEW** — terminal-state split enforcement |
| `lib/delivery/delivery-actions.ts` | +21 — fail records `missing = ordered` before flip |
| `supabase/smoke-test.sql` | +180/−27 — F2/F3/F5/§E/header |
| `scripts/production-validate.sh` | 0046 step + `ON_ERROR_STOP` + trigger count 7 |
| `docs/PRODUCTION_VERIFICATION_CHECKLIST.md` | F4 + 0046 row/rule/counts + strict commands |
| `tests/delivery-split-invariant.test.ts` | **NEW** — 12 F1 regression tests |
| `tests/deliveries-workflow.test.ts` | 0046 supersession + non-negativity + hygiene tests |
| `tests/smoke-test-sql.test.ts` | F2/F3/F5/F6 regression tests |
| `docs/PRODUCTION_FIXES_F1_F6_REPORT.md` | **NEW** — this report |

No migration 0001–0045 file was modified. `main` untouched. No PR opened.

## C. Validation results (exact, this branch)

| # | Check | Result |
|---|-------|--------|
| 1 | `pnpm typecheck` | ✅ exit 0 |
| 2 | `pnpm lint` | ✅ exit 0 (1 pre-existing `<img>` warning, 0 errors) |
| 3 | `pnpm test` | ✅ **49 files / 916 tests, all pass** (was 48/899: +12 F1, +3 smoke, +2 workflow) |
| 4 | `pnpm build` | ✅ exit 0 |
| 5 | SQL parse sweep (`libpg_query`, all 46 migrations + smoke test) | ✅ **all 47 PARSE OK** (smoke test previously SYNTAX ERROR) |
| 6 | `bash -n scripts/production-validate.sh` | ✅ OK |

## D. What remains (unchanged from the validation report)

Apply 0037–0046 to the real project, run the smoke test with `DATABASE_URL`,
execute checklist §3/§5/§6 with real accounts, verify proof URLs, deploy,
real-device testing — all require owner credentials/access and are NOT DONE.
The owner runbook in `docs/PRODUCTION_VALIDATION_REPORT.md` §D still applies
(it now covers 0046 automatically via the updated script).

**Phase 4 is not production-ready until live tests pass. No APK claimed.**
