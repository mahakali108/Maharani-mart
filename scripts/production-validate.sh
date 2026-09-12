#!/usr/bin/env bash
# ============================================================================
# scripts/production-validate.sh — Phase 4 production validation (ONE COMMAND)
#
# Applies every unapplied migration (0037–0046) in order, then runs the live
# RLS/trigger/bucket smoke test. Safe to re-run: every migration is additive
# and idempotent, and the smoke test rolls its fixture back completely.
#
# USAGE (from the repo root, on a machine with psql + network access to the
# Supabase project):
#
#   DATABASE_URL="postgres://postgres:<password>@db.<project-ref>.supabase.co:5432/postgres" \
#     ./scripts/production-validate.sh
#
# DATABASE_URL = Supabase dashboard → Project Settings → Database →
# Connection string (URI). It is only used locally by psql.
#
# Alternative (no psql): paste each migration listed below into the Supabase
# SQL Editor in the same order, then run supabase/smoke-test.sql there
# (remove the leading \echo / psql meta-commands if the editor rejects them).
# ============================================================================

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
MIGRATIONS="$REPO_ROOT/supabase/migrations"
SMOKE="$REPO_ROOT/supabase/smoke-test.sql"

if [[ -z "${DATABASE_URL:-}" ]]; then
  echo "ERROR: DATABASE_URL is not set."
  echo "  DATABASE_URL=\"postgres://postgres:<pw>@db.<ref>.supabase.co:5432/postgres\" $0"
  exit 1
fi
if ! command -v psql >/dev/null 2>&1; then
  echo "ERROR: psql not found. Install PostgreSQL client tools or use the"
  echo "Supabase SQL Editor route described at the top of this file."
  exit 1
fi

PSQL=(psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -q)

echo "== 1/4 Probing which migrations are already applied =="
probe() {  # probe <label> <sql-that-returns-1-if-applied>
  local label="$1" sql="$2" out
  out=$("${PSQL[@]}" -tAc "$sql")
  if [[ "$out" == "1" ]]; then echo "  $label: already applied"; return 1
  else echo "  $label: NOT applied yet"; return 0; fi
}

apply_if_needed() {  # apply_if_needed <file> <label> <probe-sql>
  local file="$1" label="$2" probe_sql="$3" out
  out=$("${PSQL[@]}" -tAc "$probe_sql")
  if [[ "$out" == "1" ]]; then
    echo "  $label: already applied — skipping"
  else
    echo "  $label: applying $file …"
    "${PSQL[@]}" -f "$MIGRATIONS/$file"
    echo "  $label: applied ✓"
  fi
}

# Signature objects per migration (any one proves the migration ran).
apply_if_needed "0037_staff_scope_policies.sql" "0037 staff scope" \
  "select case when exists (select 1 from pg_proc where proname = 'is_order_assigned_to_current_staff') then 1 else 0 end"
apply_if_needed "0038_staff_targets_commissions.sql" "0038 targets/commissions" \
  "select case when to_regclass('public.staff_targets') is not null then 1 else 0 end"
apply_if_needed "0039_follow_ups.sql" "0039 follow-ups" \
  "select case when to_regclass('public.follow_ups') is not null then 1 else 0 end"
apply_if_needed "0040_schemes_audit.sql" "0040 schemes audit" \
  "select case when exists (select 1 from pg_trigger where tgname = 'trg_audit_schemes' and not tgisinternal) then 1 else 0 end"
apply_if_needed "0041_area_stock_view.sql" "0041 area stock view" \
  "select case when to_regclass('public.inventory_area_totals') is not null then 1 else 0 end"
apply_if_needed "0042_order_state_machine.sql" "0042 order state machine" \
  "select case when exists (select 1 from pg_trigger where tgname = 'trg_enforce_order_status_transitions' and not tgisinternal) then 1 else 0 end"
apply_if_needed "0043_deliveries_module.sql" "0043 deliveries module" \
  "select case when to_regclass('public.order_deliveries') is not null then 1 else 0 end"
apply_if_needed "0044_payment_collections.sql" "0044 payment collections" \
  "select case when to_regclass('public.payment_collections') is not null then 1 else 0 end"
apply_if_needed "0045_delivery_payment_proof_buckets.sql" "0045 proof buckets" \
  "select case when exists (select 1 from storage.buckets where id = 'delivery-proofs') then 1 else 0 end"
apply_if_needed "0046_delivery_split_terminal_states.sql" "0046 terminal split" \
  "select case when exists (select 1 from pg_trigger where tgname = 'trg_enforce_delivery_lines_complete' and not tgisinternal) then 1 else 0 end"

echo "== 2/4 Post-application sanity checks =="
"${PSQL[@]}" -tAc "
select 'triggers: ' || count(*) from pg_trigger where tgname in (
  'trg_enforce_order_status_transitions','trg_enforce_delivery_status_transitions',
  'trg_audit_order_deliveries','trg_audit_order_delivery_items','trg_audit_payment_collections',
  'trg_enforce_delivery_split','trg_enforce_delivery_lines_complete')
  and not tgisinternal;
select 'proof buckets private: ' || count(*) from storage.buckets
  where id in ('delivery-proofs','payment-proofs') and public = false;
"
echo "  (expect: triggers: 7 · proof buckets private: 2)"

echo "== 3/4 Live RLS / transition / bucket smoke test =="
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f "$SMOKE"

echo "== 4/4 Next steps (docs/PRODUCTION_VERIFICATION_CHECKLIST.md) =="
cat <<'EOF'
  [ ] §3  private-bucket HTTP checks (public object URL must fail)
  [ ] §5  per-role smoke test with real accounts on the preview deployment
  [ ] §6  dispatch → task → assignment → completion → collection flow
  [ ] §7  sign-off — only then merge the PR
EOF
echo "== DONE =="
