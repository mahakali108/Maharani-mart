# Production Migration History Repair Runbook — OWNER-ONLY, APPROVAL-GATED

**Status:** Runbook only. **Nothing in this document has been executed.** Every
mutating step requires explicit owner approval, a fresh logical backup, and a
quiet maintenance window.
**Prepared:** 2026-11-17, from read-only inspection of the official project
`fhrmsrumsraprvutrpeo` (`Maharani-mart`, `ap-south-1`) and this repository.
**Never** run any of this against the legacy project `gbxhmffsbsfhdrfuwurx`
(`maharanimaa`).

---

## 1. Verified current state (read-only, 2026-11-17)

Production migration history (`supabase_migrations.schema_migrations`, read via
the management API) ends at:

```
... 0100 atomic_dispatch_failure_and_return
    0101 atomic_return_request_resolution
    0102 anonymous_read_policies_fail_closed
    20261115155706 0103_security_advisor_remediation   <-- out-of-band version
```

- `0103_security_advisor_remediation` was applied out-of-band (dashboard/MCP
  apply) on 2026-11-15 and recorded under the **timestamp** version
  `20261115155706`, **not** under its file version `0103`.
- `0104`–`0108` (merged to `main` via PR #136) are **not applied** in
  production. This is correct and intentional — they await owner approval —
  but it means production is five migrations behind `main`.
- `0109` (PR #137) is **not applied** and must not be applied until the PR is
  merged, approved, and `0104`–`0108` are live (0109's pre-flight block fails
  fast by design if any of `0001`–`0108` objects are missing).
- Number gaps `0061`, `0075`, `0076` are deliberate never-authored
  reservations, tracked in `tests/helpers/migration-reservations.ts`.

## 2. Why the Supabase branch reports `MIGRATIONS_FAILED`

The repository's `supabase/migrations/` contains a file versioned `0103`, but
the production history contains the same migration under version
`20261115155706`. Any Supabase tooling that reconciles the repo against the
project (preview branches, `supabase db push`) sees a **remote version with no
matching local file** plus pending files `0103`–`0109`, and refuses/fails:

- preview branches derived from production inherit the mismatched history, so
  the branch apply step fails — surfaced as `MIGRATIONS_FAILED`;
- on the Free plan preview branching is not even available, so the PR check
  currently reports **SKIPPED** — which is *not* a migration test and must
  never be read as one. The actual migration gate is the PGlite CI step
  (`Migration chain, rollback & security gate (PGlite)` in
  `.github/workflows/ci.yml`), which applies every migration file in order to
  a real PostgreSQL 16 and is green.

The exact dashboard failure log could not be retrieved programmatically
(read-only management token scope); the mechanism above follows from the
verified history table contents and the verified file set. Confirm against the
dashboard branch log before repairing (step 3.0).

## 3. Repair procedure (owner executes; agent does not)

### 3.0 Prechecks (read-only)

In the Supabase SQL editor (or `psql`), confirm 0103's *contents* really are
live before touching the history table:

```sql
-- (a) The four advisor-flagged views run as security_invoker:
select relname, reloptions
from pg_class
where relname in ('ai_product_demand_daily','inventory_product_totals',
                  'inventory_expiry_report','catalog_product_sales');
-- expect: every row's reloptions contains security_invoker=true

-- (b) The 14 advisor-flagged functions have a pinned search_path:
select p.proname, p.proconfig
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and p.proname in
  ('get_effective_price','sync_cart_item_product_id','generate_order_number',
   'current_jwt_role','generate_grn_number','normalize_batch_number',
   'prevent_ledger_mutation','apply_stock_movement','generate_transfer_number',
   'update_retailer_credit_account_updated_at','enforce_order_status_transitions',
   'enforce_delivery_status_transitions','update_support_ticket_updated_at',
   'compliance_boolean');
-- expect: 14 rows, each proconfig containing search_path=pg_catalog, public, pg_temp
```

If (a) or (b) does not match, **stop** — 0103 was not fully applied; do not
repair the history, investigate first.

### 3.1 Backup (mandatory on the Free plan — no automated backups)

Take a fresh logical dump before any history edit:

```bash
pg_dump --no-owner --no-privileges \
  "postgresql://postgres:[PASSWORD]@db.fhrmsrumsraprvutrpeo.supabase.co:5432/postgres" \
  > backup_pre_history_repair_$(date +%Y%m%d).sql
```

### 3.2 Re-key the 0103 history record (history-table-only change)

With the Supabase CLI linked to the official project
(`supabase link --project-ref fhrmsrumsraprvutrpeo`):

```bash
# Removes the out-of-band timestamp row (does NOT undo any SQL — repair edits
# only supabase_migrations.schema_migrations):
supabase migration repair --linked --status reverted 20261115155706

# Records file version 0103 as applied (does NOT re-run the file):
supabase migration repair --linked --status applied 0103

# Verify the reconciliation is now clean BEFORE pushing anything:
supabase migration list --linked
# expect: local == remote through 0103; remote missing only 0104..0108
```

Confirm the exact flags against `supabase migration repair --help` for the
installed CLI version before running. Dashboard-SQL equivalent, if preferred:

```sql
delete from supabase_migrations.schema_migrations where version = '20261115155706';
insert into supabase_migrations.schema_migrations (version, name)
values ('0103', '0103_security_advisor_remediation');
```

### 3.3 Apply the pending website-content migrations 0104–0108

```bash
supabase db push --linked
# The CLI lists pending migrations first — confirm it offers EXACTLY
# 0104, 0105, 0106, 0107, 0108 and nothing else before confirming.
```

Post-checks (read-only):

```sql
select version, name from supabase_migrations.schema_migrations
order by version desc limit 8;
-- expect: 0108, 0107, 0106, 0105, 0104, 0103, 0102, 0101
select to_regclass('public.site_content_sections') is not null as site_content_ok;  -- 0104
```

Then confirm the `/admin/content` routes and the bootstrap guide
(`docs/repair/SUPER_ADMIN_FIRST_BOOTSTRAP_GUIDE.md`) behave as documented.

### 3.4 0109 stays gated

`0109_phase3_business_control.sql` ships with PR #137 and is applied **only**
after: PR #137 is merged, the owner approves production application, and
3.2–3.3 are complete. Its rollback
(`supabase/rollbacks/0109_phase3_business_control.down.sql`) refuses to run
while any Phase 3 data exists unless explicitly armed inside one transaction
(`SET LOCAL maharani.allow_data_loss = 'true'`); the override is
transaction-local and self-disarming. See the rollback header for the full
contract.

## 4. What this runbook deliberately does NOT do

- Does not apply, re-run, or "fix" any migration SQL itself.
- Does not touch `0109` or any PR #137 object in production.
- Does not pause, upgrade, or modify either Supabase project.
- Does not authorize schema drift repairs beyond the single `0103` re-key.
