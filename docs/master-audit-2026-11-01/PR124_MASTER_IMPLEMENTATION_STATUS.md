# PR 124 — master implementation status (2026-11-05)

**DRAFT / NOT READY.** This is partial implementation, not completion of the owner’s master request. Do not merge, deploy, run a production migration, or reset business data. The existing refund balance regression still fails. The additional wallet page change avoids calculating a balance from a truncated result but does **not** fix the underlying accounting defect.

## Changes in this update

- Admin wallet list and detail use the existing database balance RPC rather than aggregating an arbitrarily limited PostgREST response or the most recent 100 ledger entries. RPC errors and invalid/unsafe values fail closed. The account and profile reads are scoped to the displayed retailers.
- Prominent notices warn of the existing legacy reversal accounting defect. The detail page labels its recent-entry summaries and does not derive a due date from potentially truncated history. A successful RPC still uses the current flawed reversal semantics and is not evidence of accounting correctness.
- `tests/admin-wallet-balance-completeness.test.ts` tests validation and the real migrated balance RPC with 125 debit rows in disposable PGlite. The local PGlite harness is not Supabase Auth, Storage, or multi-session concurrency.
- No schema migration, reset implementation, bootstrap implementation or production data change is included in this update. Existing `0055_data_retention_cleanup.sql` is not a reset and its dry run writes audit records: **do not use it as a reset**.

## Actual verification

All results below are local to this checkout, not production.

| Check | Result |
|---|---|
| Frozen dependency install | Pass |
| TypeScript | Pass |
| Lint on the five files added/changed by this update | Pass |
| Full ESLint | Fail: 65 errors, 42 warnings; no suppression |
| Focused wallet suite | 21 pass / 1 fail (22 total); original refund regression expected 0, actual −50,000 paise |
| Full Vitest | 173 files pass / 19 fail; 2,780 tests pass, 13 fail, 213 skipped; 11 suite setup failures among failed files. Fixture compliance classification, seller compliance, catalog visibility/privileges, stale assertions and the financial regression remain. Not all failures have a proven pre-change baseline. |
| Next production build | Pass using synthetic Supabase URL/keys; not a live integration test |
| Production dependency audit | Fail: 5 high, 1 moderate; reachability and remedies require review |
| Android compile / unit tests | Attempted, blocked: no Java/JAVA_HOME; Android SDK/toolchain availability not established. No APK/AAB produced. |
| Full role-based website journeys / responsive browser retest | Not executed in this update; prior fake-Supabase browser evidence is in the existing PR body. |
| Real multi-session checkout/refund, production-like migration, reset and recovery | Not performed. Prior synthetic financial prototype is not the deployed schema and is not acceptance evidence. |

## Integration and recovery gates

- The owner-named Supabase project `fhrmsrumsraprvutrpeo` reported healthy DB/Auth/Storage/REST on 2026-11-05; read-only SQL previously succeeded. This does not identify the serving production application or verify migration history.
- Vercel credentials validate but project listing was denied, including for the returned default team. Owner must review team membership and the Arena integration's read scope. The preview project reference is not proof of production linkage. After access is granted, match the actual production project's Git repository, domain and non-secret Supabase project reference; do not disclose key values.
- The named Supabase project's read-only counts were zero Auth users and zero profiles, with 11 bucket definitions and zero Storage object metadata records. This does not establish the state of any other project or physical objects. Original owner recovery cannot be demonstrated from this project snapshot. Auth site URL is localhost and redirect allow-list is empty; verify actual production requirements before requesting any changes.
- No complete, encrypted, restorable backup exists as a result of this work. Database/Auth and Storage bytes require separate supported backups; record infrastructure configuration separately, and rehearse restoration in an isolated approved destination. See [Supabase backups](https://supabase.com/docs/guides/platform/backups), [Storage export](https://supabase.com/docs/guides/storage/management/download-objects), and [restore guidance](https://supabase.com/docs/guides/platform/migrating-within-supabase/dashboard-restore). Do not change billing without approval.
- A production reset mechanism is **not implemented or tested**. Required work includes a complete deployed-schema and storage inventory, dependency-safe deletion order, immutable audit, verified backup and independent restore, safeguards against unknown tables, and comprehensive isolated tests. No reset is authorized by this PR.
- A first Super Admin bootstrap is **not implemented or tested**. Resolve the original owner identity from verified records or approve a secure recreation process. Design an audited privileged-only procedure, exercise it on an isolated clone with real Auth/MFA and verify owner access; public signup must not confer privilege. Do not use a fixture's database-owner promotion as a production procedure.

## Remaining financial work / required sequence

The detailed static writer and reader inventory and history hazards are in [PR124_WALLET_IMPLEMENTATION_READINESS.md](PR124_WALLET_IMPLEMENTATION_READINESS.md) and [PR124_FINANCIAL_INVESTIGATION.md](PR124_FINANCIAL_INVESTIGATION.md). The source of truth must be an append-only, linked, idempotent model with bounded cumulative partial refunds and a shared locking/transaction hierarchy across checkout, cancellation, return, seller and administrative paths. Do not simply ignore or reinterpret historical `is_reversed` flags: flagged-only, partial and retention-folded history need reconciliation from verified source records. Seller settlement remains separate from retailer Coins.

Before release: resolve the financial regression and all relevant writer/readers; test full and multiple partial refunds, duplicate/mismatched keys, over-refunds, concurrent checkout/refunds and rollback with real independent DB sessions; inspect RLS and effective privileges; validate every client, including Android; independently review migrations, historic reconciliation, statutory retention, reset and recovery. Repeat all test/build/security checks and resolve failures. With verified backup, production identity and owner access in place, a future separately authorized operation must use the reviewed migration sequence, monitored verification and recovery plan. No production migration, business reset, deployment, real customer transaction, billing change or Android release is authorized by this PR.
