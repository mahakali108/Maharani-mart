# Migrations — state, review and application checklist

## Live state (read from project `fhrmsrumsraprvutrpeo` on 14 Nov 2026)

Applied: 0001 … 0093. Numbers 0061, 0075 and 0076 do not exist in the
repository or in the live history (gaps, not missing work).

**Correction to the brief:** 0093 was described as pending. It is already
applied live, and PR #125 was already merged (2026-11-14 16:47 UTC) before this
work started. No applied migration file was edited.

## Pending (in this PR, applied nowhere)

| File | What it does | Risk | Rollback |
|---|---|---|---|
| `0094_delivery_trust_and_loyalty_integrity.sql` | Guard triggers on `order_deliveries`, `order_delivery_items`, `orders`; server-computed shortfall credit; loyalty on delivered value; real authorisation in `record_loyalty_points`; revokes TRUNCATE/REFERENCES/TRIGGER from API roles. | **Medium.** Changes behaviour of delivery completion: staff sessions can no longer write completion fields directly. Requires the app code in this PR to be deployed first. No data is changed. | `supabase/rollbacks/0094_….down.sql` — re-opens the vulnerabilities; emergency use only. Tested: applies cleanly and 0094 can be re-applied. |
| `0095_legal_acceptance_and_privacy_requests.sql` | New append-only table `legal_document_acceptances` + `record_legal_acceptance()`; adds request types `data_correction`, `consent_withdrawal`; adds ticket topics `grievance`, `privacy` and `acknowledged_at`. | **Low.** Additive. Replaces two check constraints with wider ones. | `supabase/rollbacks/0095_….down.sql` — refuses to run if it would discard user requests; dropping the table loses acceptance proof (export first). |
| `0096_delivery_snapshot_integrity.sql` | SEC-16 snapshot guard and completion check. | Delivery completion refused if a line is not fully accounted for. | `0096_….down.sql` |
| `0097_atomic_split_order_cancellation.sql` | SEC-06 atomic split cancel, `close_sub_order_atomic`, direct-cancel guards, 0069 trigger fix. | Any script writing `status='cancelled'` directly is refused. | `0097_….down.sql` (restores 0088 / 0066 / 0069 bodies) |
| `0098_seller_agreement_and_marketplace_gate.sql` | SEC-17 marketplace switch (OFF) and agreement gate. | Third-party offers cannot go live until the switch is on. | `0098_….down.sql` (approval log kept in an archive table) |

All five are idempotent (re-run tested). Rollback 0098 → 0094 and re-apply was tested on real PostgreSQL with data present.

## Order of application — for the owner's decision, not done here

1. Review and merge the PR. Deploy the application.
2. Take a database backup.
3. Apply 0094, 0095, 0096, 0097, 0098, in that order, in a quiet period.
4. Run the checks below. If delivery completion fails, roll back 0094 only.

Post-apply checks (read-only):

```sql
-- expect 0
select count(*) from information_schema.table_privileges
 where table_schema = 'public' and grantee in ('anon','authenticated') and privilege_type = 'TRUNCATE';
-- expect false
select position('current_user is distinct from ''postgres''' in pg_get_functiondef(
  'public.record_loyalty_points(uuid,integer,text,text,text,uuid,text)'::regprocedure)) > 0;
-- expect 3 rows
select tgname from pg_trigger where tgname like 'trg_guard_order_deliver%';
```

## What 0094 does not cover

SEC-10 to SEC-13 in `02_SECURITY_AUDIT.md`. A later migration should make
views `security_invoker`, add explicit `WITH CHECK` clauses and route retailer
cancellation only through the atomic function.
