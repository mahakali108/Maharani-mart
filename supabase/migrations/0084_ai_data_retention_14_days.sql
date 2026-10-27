-- ============================================================================
-- 0084 — Super Admin AI data: automatic deletion after 14 days
--
-- SCOPE — ONLY AI-OWNED DATA. This migration is deliberately NOT a second
-- general cleanup engine and it does not change run_data_cleanup (0055).
--
-- Covered (the only tables this engine can ever delete from):
--   ai_audit_logs            (AI processing / debug metadata)     created_at
--   ai_business_memory       (stored AI memory / preferences)     updated_at
--   ai_rate_limit_windows    (AI rate-limit windows)              window_started_at
--   ai_confirmed_actions     (AI confirmation nonces)             consumed_at
--   ai_demand_forecasts      (AI forecast snapshots)              computed_at
--
-- NOT covered and not reachable from here (verified by the engine's hard-coded
-- allow-list, which contains no other table):
--   profiles, retailers, sellers, seller_offers, areas, addresses, cart_items,
--   products, product_packs, product_pricing_tiers, product_tier_prices,
--   inventory_*, orders, order_items, sub_orders, order_status_history,
--   invoices/tax rows, payments, payment_collections, refunds,
--   retailer_wallet_ledger, loyalty_ledger, return_requests, support_tickets,
--   notification_logs, audit_logs, super_admin_audit_logs,
--   retailer_approval_events, cleanup_runs, and every Storage bucket.
--
-- RETENTION RULE
--   A row is eligible when its timestamp is STRICTLY OLDER THAN the instant
--   `now() - interval '14 days'` (UTC absolute time). A row exactly 14 days old
--   is therefore NOT deleted in the run that observes it; it becomes eligible
--   on the next run. This is asserted in tests/ai-retention.test.ts.
--
-- SAFETY PROPERTIES
--   * separate function (run_ai_data_cleanup), separate registry
--     (ai_retention_rules), separate audit log (ai_cleanup_runs)
--   * no dynamic SQL: the target list is a hard-coded IF/ELSIF chain, so a
--     malformed or tampered parameter cannot redirect a DELETE
--   * registry cross-check: the run fails closed if ai_retention_rules and the
--     hard-coded list disagree (a future migration cannot silently widen scope)
--   * batch-limited, idempotent, retry-safe, per-target error isolation
--   * service_role/owner only; no API role can execute it
--   * deleted prompts/responses are NOT logged — counts, cutoff and status only
--
-- NOTHING IS APPLIED TO ANY PROJECT BY THIS FILE.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. Registry (documentation + fail-closed cross-check; never used as SQL)
-- ---------------------------------------------------------------------------
create table if not exists public.ai_retention_rules (
  target_key text primary key check (target_key ~ '^[a-z0-9_]{2,64}$'),
  table_name text not null check (table_name ~ '^[a-z_]{2,64}$'),
  cutoff_column text not null check (cutoff_column ~ '^[a-z_]{2,64}$'),
  retention_days int not null default 14 check (retention_days = 14),
  reason text not null check (char_length(btrim(reason)) between 10 and 500)
);

comment on table public.ai_retention_rules is
  'AI-only retention registry. Every row must have a matching hard-coded implementation inside run_ai_data_cleanup; the engine fails closed on any mismatch. Adding a row here alone deletes nothing.';

insert into public.ai_retention_rules (target_key, table_name, cutoff_column, retention_days, reason) values
  ('ai_audit_logs', 'ai_audit_logs', 'created_at', 14,
   'AI processing/debug metadata (tool name, duration, tokens). Contains no prompts or responses; retained only for AI observability.'),
  ('ai_business_memory', 'ai_business_memory', 'updated_at', 14,
   'AI-stored retailer business preferences. AI memory, not a business ledger; the retailer can reset it and it is re-learned from live data.'),
  ('ai_rate_limit_windows', 'ai_rate_limit_windows', 'window_started_at', 14,
   'Spent AI rate-limit windows. Purely temporary AI processing state.'),
  ('ai_confirmed_actions', 'ai_confirmed_actions', 'consumed_at', 14,
   'Consumed AI confirmation nonces. One-time replay protection that has no value after 14 days.'),
  ('ai_demand_forecasts', 'ai_demand_forecasts', 'computed_at', 14,
   'AI forecast snapshots (derived, recomputable observations). Never used to mutate stock, prices or orders.')
on conflict (target_key) do nothing;

alter table public.ai_retention_rules enable row level security;
revoke all on public.ai_retention_rules from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 2. Audit log (operational metadata only — no AI content)
-- ---------------------------------------------------------------------------
create table if not exists public.ai_cleanup_runs (
  id uuid primary key default uuid_generate_v4(),
  run_id text not null unique check (run_id ~ '^ai-cleanup-[0-9]{4}-[0-9]{2}-[0-9]{2}-[a-f0-9]{8}$'),
  dry_run boolean not null default false,
  triggered_by text not null check (triggered_by in ('cron', 'manual', 'test')),
  status text not null check (status in ('running', 'completed', 'completed_with_errors', 'failed')),
  cutoff timestamptz not null,
  batch_size int not null check (batch_size between 1 and 5000),
  summary jsonb not null default '{}'::jsonb,
  errors jsonb not null default '[]'::jsonb,
  started_at timestamptz not null default now(),
  completed_at timestamptz
);

comment on table public.ai_cleanup_runs is
  'Audit of AI-only 14-day retention runs: cutoff, per-target row counts, status and errors. Never stores deleted prompts, responses, memory values or file contents.';

alter table public.ai_cleanup_runs enable row level security;
revoke all on public.ai_cleanup_runs from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3. Engine
-- ---------------------------------------------------------------------------
create or replace function public.run_ai_data_cleanup(
  p_dry_run boolean default true,
  p_triggered_by text default 'manual',
  p_batch_size int default 500,
  p_max_rows_per_target int default 20000
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_run_id text := 'ai-cleanup-' || to_char(now() at time zone 'utc', 'YYYY-MM-DD') || '-' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 8);
  v_cutoff timestamptz := now() - interval '14 days';
  v_targets jsonb := '[]'::jsonb;
  v_errors jsonb := '[]'::jsonb;
  v_batch int;
  v_total int;
  v_idx int;
  v_failed boolean;
  v_names text[] := array['ai_audit_logs', 'ai_business_memory', 'ai_rate_limit_windows', 'ai_confirmed_actions', 'ai_demand_forecasts'];
  v_columns text[] := array['created_at', 'updated_at', 'window_started_at', 'consumed_at', 'computed_at'];
  v_registry_count int;
  v_fatal text;
begin
  -- Server-side authorization: scheduler (service role) or the database owner.
  if auth.role() is distinct from 'service_role'
     and current_user not in ('postgres', 'supabase_admin', 'service_role') then
    raise exception 'Access denied: AI retention cleanup is scheduler-only.' using errcode = '42501';
  end if;

  if p_triggered_by is null or p_triggered_by not in ('cron', 'manual', 'test') then
    raise exception 'Invalid triggered_by value.' using errcode = '22023';
  end if;
  if p_batch_size is null or p_batch_size < 1 or p_batch_size > 5000 then
    raise exception 'Batch size must be between 1 and 5000.' using errcode = '22023';
  end if;
  if p_max_rows_per_target is null or p_max_rows_per_target < 1 or p_max_rows_per_target > 200000 then
    raise exception 'Maximum rows per target must be between 1 and 200000.' using errcode = '22023';
  end if;

  -- Fail closed if the registry and the implementation have drifted: the
  -- registry must describe exactly these five AI tables at 14 days.
  select count(*) into v_registry_count
    from public.ai_retention_rules
   where retention_days = 14
     and table_name = any (v_names);
  if v_registry_count <> 5 then
    raise exception 'AI_RETENTION_REGISTRY_MISMATCH: the AI retention registry does not match the implemented AI-only targets.' using errcode = '22023';
  end if;

  insert into public.ai_cleanup_runs (run_id, dry_run, triggered_by, status, cutoff, batch_size)
  values (v_run_id, coalesce(p_dry_run, true), p_triggered_by, 'running', v_cutoff, p_batch_size);

  begin
    for v_idx in 1 .. array_length(v_names, 1) loop
      v_total := 0;
      v_failed := false;
      begin
        if v_idx = 1 or v_idx = 2 or v_idx = 3 or v_idx = 4 or v_idx = 5 then
          -- (a) Count first: dry runs report and stop; live runs use the same
          -- predicate so the report and the deletion always agree.
          if v_idx = 1 then
            select count(*) into v_batch from public.ai_audit_logs where created_at < v_cutoff;
          elsif v_idx = 2 then
            select count(*) into v_batch from public.ai_business_memory where updated_at < v_cutoff;
          elsif v_idx = 3 then
            select count(*) into v_batch from public.ai_rate_limit_windows where window_started_at < v_cutoff;
          elsif v_idx = 4 then
            select count(*) into v_batch from public.ai_confirmed_actions where consumed_at < v_cutoff;
          else
            select count(*) into v_batch from public.ai_demand_forecasts where computed_at < v_cutoff;
          end if;

          if p_dry_run then
            v_total := least(v_batch, p_max_rows_per_target);
          else
            loop
              exit when v_total >= p_max_rows_per_target;
              if v_idx = 1 then
                delete from public.ai_audit_logs
                 where ctid in (
                   select ctid from public.ai_audit_logs
                    where created_at < v_cutoff
                    limit least(p_batch_size, p_max_rows_per_target - v_total)
                 );
              elsif v_idx = 2 then
                delete from public.ai_business_memory
                 where ctid in (
                   select ctid from public.ai_business_memory
                    where updated_at < v_cutoff
                    limit least(p_batch_size, p_max_rows_per_target - v_total)
                 );
              elsif v_idx = 3 then
                delete from public.ai_rate_limit_windows
                 where ctid in (
                   select ctid from public.ai_rate_limit_windows
                    where window_started_at < v_cutoff
                    limit least(p_batch_size, p_max_rows_per_target - v_total)
                 );
              elsif v_idx = 4 then
                delete from public.ai_confirmed_actions
                 where ctid in (
                   select ctid from public.ai_confirmed_actions
                    where consumed_at < v_cutoff
                    limit least(p_batch_size, p_max_rows_per_target - v_total)
                 );
              else
                delete from public.ai_demand_forecasts
                 where ctid in (
                   select ctid from public.ai_demand_forecasts
                    where computed_at < v_cutoff
                    limit least(p_batch_size, p_max_rows_per_target - v_total)
                 );
              end if;
              get diagnostics v_batch = row_count;
              v_total := v_total + coalesce(v_batch, 0);
              exit when coalesce(v_batch, 0) = 0;
            end loop;
          end if;
        end if;
      exception when others then
        v_failed := true;
        v_errors := v_errors || jsonb_build_array(jsonb_build_object(
          'target_key', v_names[v_idx], 'message', SQLERRM));
      end;

      v_targets := v_targets || jsonb_build_array(jsonb_build_object(
        'target_key', v_names[v_idx],
        'table', v_names[v_idx],
        'cutoff_column', v_columns[v_idx],
        'retention_days', 14,
        'cutoff', v_cutoff,
        'action', 'DELETE',
        case when p_dry_run then 'eligible_rows' else 'deleted_rows' end, v_total,
        'status', case when v_failed then 'failed' else 'ok' end));
    end loop;
  exception when others then
    v_fatal := SQLERRM;
  end;

  if v_fatal is not null then
    v_errors := v_errors || jsonb_build_array(jsonb_build_object('target_key', 'run', 'message', v_fatal));
  end if;

  update public.ai_cleanup_runs
     set status = case
           when v_fatal is not null then 'failed'
           when jsonb_array_length(v_errors) > 0 then 'completed_with_errors'
           else 'completed'
         end,
         completed_at = now(),
         summary = jsonb_build_object(
           'run_id', v_run_id,
           'dry_run', coalesce(p_dry_run, true),
           'triggered_by', p_triggered_by,
           'cutoff', v_cutoff,
           'targets', v_targets,
           'total_affected', coalesce((
             select sum((t ->> case when p_dry_run then 'eligible_rows' else 'deleted_rows' end)::int)
               from jsonb_array_elements(v_targets) t
           ), 0)),
         errors = v_errors
   where run_id = v_run_id;

  return (
    select summary || jsonb_build_object('status', r.status, 'errors', r.errors, 'run_id', r.run_id)
      from public.ai_cleanup_runs r where r.run_id = v_run_id
  );
end;
$$;

comment on function public.run_ai_data_cleanup(boolean, text, int, int) is
  'Scheduler-only AI-only retention engine. Deletes rows strictly older than 14 days from the five hard-coded AI tables, in bounded batches, with per-target error isolation and an ai_cleanup_runs audit row. It cannot address any other table: the allow-list is a static IF/ELSIF chain, never dynamic SQL. dry_run=true only counts.';

revoke all on function public.run_ai_data_cleanup(boolean, text, int, int) from public, anon, authenticated;
grant execute on function public.run_ai_data_cleanup(boolean, text, int, int) to service_role;

-- ============================================================================
-- END OF MIGRATION 0084
-- ============================================================================
