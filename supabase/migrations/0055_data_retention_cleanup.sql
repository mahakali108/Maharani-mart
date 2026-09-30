-- ============================================================================
-- 0055 — DATA RETENTION & CLEANUP (90-day temporary + 120-day business data)
-- ============================================================================
--
-- Automatic, scheduled, server-side retention cleanup for the categories
-- explicitly approved in the data-retention specification. Design rules:
--
--   * EXPLICIT classification only. `data_retention_rules` is the registry of
--     every cleanup target; the engine refuses any target that has no
--     hard-coded implementation. Nothing is ever inferred ("this table looks
--     old") — an unlisted table is simply never touched.
--   * PERMANENT data can never be deleted: products, product packs, pack
--     stock, product images, categories, brands, SKU/barcode, pricing, MOQ,
--     current stock, retailers and other master data have NO rule and are on
--     a hard deny-list inside the engine.
--   * Batch-based, bounded, deterministic, indexed, idempotent and
--     retry-safe. Every DELETE is a small bounded batch; a run never executes
--     an unbounded delete. Running the cleanup twice deletes nothing twice.
--   * Foreign-key safe: child-first deletion for the order tree (returns,
--     allocations, then the order — order_items / status history / deliveries
--     / coupon redemptions cascade from the approved `on delete cascade`
--     relationships), nullable-historical-reference for visits and wallet
--     reversal links. No existing relationship is changed to CASCADE.
--   * Coins/credit ledger rows are folded into the account's frozen
--     `opening_outstanding_paise` baseline BEFORE deletion, so live balances
--     are mathematically unchanged by purging history (0031 baseline model).
--   * Observable: every run (including dry runs) writes a `cleanup_runs`
--     audit row with per-target counts and per-target errors. One failing
--     category is recorded and the rest continue; the run reports
--     `completed_with_errors`, never a silent success.
--   * Dry-run mode (`p_dry_run => true`) ONLY counts eligible rows and plans
--     actions — it deletes and folds nothing.
--
-- Retention categories (see docs/retention-policy.md for the full matrix):
--
--   90 days  (temporary):     abandoned cart lines, expired notifications,
--                             delivery/system notification logs, expired
--                             staff-signup invites (tokens), AI rate-limit
--                             windows, completed cleanup audit logs.
--   120 days (business):      orders (+ order items, status history, deliveries
--                             via approved cascades), payment collections,
--                             return requests, coins/credit wallet ledger
--                             (incl. refund/reversal rows), legacy stock
--                             movements, FEFO stock allocations.
--
--   GST/tax records have no standalone table in this schema: they are the GST
--   columns on `orders` / `order_items` and are removed with their orders
--   (reported under the `orders` target as `gst_records`).
--   Refund records have no standalone table: they are `retailer_wallet_ledger`
--   rows (REFUND_CREDIT / ORDER_REVERSAL) and are removed with the ledger.
--
-- NEVER deleted by this system (no rules exist, engine deny-list protects):
--   products, product_packs (incl. stock_quantity), product_images,
--   product_pack_images, categories, brands, product_pricing_tiers,
--   price_lists, schemes, inventory_stock (current stock),
--   inventory_batches (current batch stock), retailers, profiles, warehouses,
--   banners and every permanent Storage object (product images!).
--   Legacy warehouse structures (warehouses, inventory_stock, stock_movements
--   table, batches, GRNs, transfers) keep their STRUCTURE and their current
--   data; only old movement/allocation HISTORY rows are eligible.
--
-- Scheduling: production runs this through the Vercel Cron endpoint
--   /api/cron/cleanup (CRON_SECRET-protected) which calls
--   run_data_cleanup(false, 'cron'). Admins can only request a dry run from
--   /admin/cleanup — there is deliberately NO "delete everything now" button.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. Retention rule registry — the explicit allow-list.
-- ---------------------------------------------------------------------------
create table if not exists public.data_retention_rules (
  target_key text primary key
    check (target_key ~ '^[a-z0-9_]{2,64}$'),
  category text not null check (category in ('temporary_90', 'business_120')),
  table_name text not null check (table_name ~ '^[a-z_]{2,64}$'),
  retention_days int not null check (retention_days between 1 and 3650),
  cutoff_column text not null check (cutoff_column ~ '^[a-z_]{2,64}$'),
  deletion_order int not null,
  enabled boolean not null default true,
  description text not null check (char_length(btrim(description)) between 1 and 500)
);

alter table public.data_retention_rules enable row level security;
revoke all on public.data_retention_rules from public, anon, authenticated;
-- The registry is managed by migrations only; the engine reads it as its owner.

comment on table public.data_retention_rules is
  'Explicit data-retention registry. A table is cleanup-eligible ONLY when it has a row here AND a hard-coded engine implementation (run_data_cleanup). Unlisted tables are never touched — classification is never inferred. Master/catalog data (products, packs, images, categories, brands, pricing, current stock) must never have a row here.';

-- Rule rows are inserted idempotently (safe re-run of this migration block).
insert into public.data_retention_rules
  (target_key, category, table_name, retention_days, cutoff_column, deletion_order, enabled, description)
values
  ('abandoned_carts', 'temporary_90', 'cart_items', 90, 'updated_at', 10, true,
   'Abandoned cart lines untouched for 90 days. Cart rows are session shopping state, not orders; the shop re-adds items whenever it wants to buy.'),
  ('expired_notifications', 'temporary_90', 'notifications', 90, 'created_at', 20, true,
   'Read/expired in-app notifications older than 90 days. Ephemeral messages, not business documents.'),
  ('notification_logs', 'temporary_90', 'notification_logs', 90, 'created_at', 21, true,
   'Delivery/provider attempt logs for notifications (temporary system logs) older than 90 days.'),
  ('expired_staff_invites', 'temporary_90', 'staff_account_invites', 90, 'expires_at', 22, true,
   'Expired staff-signup invite tokens. Invites live 15 minutes; anything past expiry is dead token material.'),
  ('ai_rate_limit_windows', 'temporary_90', 'ai_rate_limit_windows', 90, 'window_started_at', 23, true,
   'Spent AI rate-limit windows (temporary processing records) older than 90 days.'),
  ('cleanup_run_logs', 'temporary_90', 'cleanup_runs', 90, 'completed_at', 80, true,
   'Completed cleanup audit logs older than 90 days (log retention: logs must not grow forever, but a run is never deleted before it completed).'),
  ('historical_stock_allocations', 'business_120', 'order_stock_allocations', 120, 'created_at', 100, true,
   'Legacy FEFO batch allocation history older than 120 days. Also removed child-first with its order; this rule is the standalone safety net.'),
  ('return_records', 'business_120', 'return_requests', 120, 'requested_at', 110, true,
   'Return request records older than 120 days (also deleted child-first with their parent order).'),
  ('coins_ledger', 'business_120', 'retailer_wallet_ledger', 120, 'created_at', 120, true,
   'Coins ledger / historical credit / refund-reversal rows older than 120 days. Balance delta is folded into opening_outstanding_paise before deletion so live balances never change.'),
  ('payment_records', 'business_120', 'payment_collections', 120, 'created_at', 130, true,
   'Payment collection records older than 120 days.'),
  ('historical_inventory_movements', 'business_120', 'stock_movements', 120, 'created_at', 140, true,
   'Legacy warehouse movement history older than 120 days. Current inventory_stock / batch quantities are permanent and untouched.'),
  ('orders', 'business_120', 'orders', 120, 'placed_at', 150, true,
   'Orders older than 120 days with their order items, status history, deliveries and coupon redemptions (approved on-delete cascades), plus child-first return/allocation rows and nullable visit links.')
on conflict (target_key) do nothing;

-- ---------------------------------------------------------------------------
-- 2. Cleanup audit log.
-- ---------------------------------------------------------------------------
create table if not exists public.cleanup_runs (
  id uuid primary key default uuid_generate_v4(),
  run_id text not null unique
    check (run_id ~ '^cleanup-[0-9]{4}-[0-9]{2}-[0-9]{2}-[a-f0-9]{8}$'),
  dry_run boolean not null default false,
  triggered_by text not null check (triggered_by in ('cron', 'manual', 'test')),
  status text not null check (status in ('running', 'completed', 'completed_with_errors', 'failed')),
  batch_size int not null check (batch_size between 1 and 10000),
  max_rows_per_target int not null check (max_rows_per_target between 1 and 1000000),
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  summary jsonb not null default '{}'::jsonb,
  errors jsonb not null default '[]'::jsonb,
  constraint cleanup_runs_completed_at_set
    check (status = 'running' or completed_at is not null),
  constraint cleanup_runs_running_unfinished
    check (status <> 'running' or completed_at is null)
);

alter table public.cleanup_runs enable row level security;
revoke all on public.cleanup_runs from public, anon, authenticated;
-- Only the service role (cron route / server actions) ever reads or writes
-- cleanup_runs; the admin status page goes through server code.

comment on table public.cleanup_runs is
  'Lightweight audit log of every cleanup execution (including dry runs): run_id, status, timing, per-target rows deleted/eligible and per-target errors. Retained 90 days after completion by the cleanup_run_logs rule — a run is never deleted while still running.';

-- ---------------------------------------------------------------------------
-- 3. Timestamp indexes for the cutoff predicates (batch deletes use them).
-- ---------------------------------------------------------------------------
create index if not exists idx_cart_items_updated_at on public.cart_items (updated_at);
create index if not exists idx_notifications_created_at on public.notifications (created_at);
create index if not exists idx_notification_logs_created_at on public.notification_logs (created_at);
create index if not exists idx_ai_rate_limit_windows_started on public.ai_rate_limit_windows (window_started_at);
create index if not exists idx_cleanup_runs_started_at on public.cleanup_runs (started_at);
create index if not exists idx_cleanup_runs_completed_at on public.cleanup_runs (completed_at);
create index if not exists idx_orders_placed_at on public.orders (placed_at);
create index if not exists idx_payment_collections_created_at on public.payment_collections (created_at);
create index if not exists idx_return_requests_requested_at on public.return_requests (requested_at);
create index if not exists idx_osa_created_at on public.order_stock_allocations (created_at);
create index if not exists idx_stock_movements_created_at on public.stock_movements (created_at);
-- retailer_wallet_ledger(created_at) already exists from 0029
-- (idx_wallet_ledger_created_at). staff_account_invites is tiny (15-minute
-- invites) and already keyed by email — no extra index needed.

-- ---------------------------------------------------------------------------
-- 4. The cleanup engine.
-- ---------------------------------------------------------------------------
-- run_data_cleanup is the ONLY deletion entry point. It is:
--   * server-scheduler only (service_role; an authenticated browser session
--     can never execute it),
--   * allow-listed per target (hard-coded implementations below; a rule row
--     without an implementation is refused and reported as an error),
--   * bounded (batch_size x max_rows_per_target per target per run),
--   * idempotent (deleting already-gone rows is a no-op; the wallet fold
--     moves with the rows it deletes in one statement),
--   * per-batch failure isolated (a failing batch stops only that target,
--     is recorded in errors, and later targets continue).
create or replace function public.run_data_cleanup(
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
  v_run_id text;
  v_started timestamptz := now();
  v_rule record;
  v_cutoff timestamptz;
  v_expected_table text;
  v_expected_column text;
  v_batch int;
  v_deleted bigint := 0;
  v_total bigint := 0;
  v_eligible bigint;
  v_breakdown jsonb;
  v_target jsonb;
  v_targets jsonb := '[]'::jsonb;
  v_errors jsonb := '[]'::jsonb;
  v_order_items bigint := 0;
  v_order_history bigint := 0;
  v_order_deliveries bigint := 0;
  v_order_redemptions bigint := 0;
  v_order_returns bigint := 0;
  v_order_allocations bigint := 0;
  v_gst_records bigint := 0;
  v_ids uuid[];
  v_sum_tmp bigint := 0;
  v_sum_120 bigint := 0;
  v_target_failed boolean;
  v_fatal text;
begin
  -- Server-authoritative only: the production scheduler (service role) runs
  -- cleanup. No browser session — not even an admin — can execute deletion.
  if auth.role() is distinct from 'service_role' then
    raise exception 'Data cleanup is server-scheduler only.' using errcode = '42501';
  end if;

  if p_triggered_by is null or p_triggered_by not in ('cron', 'manual', 'test') then
    raise exception 'Invalid cleanup trigger source.' using errcode = '22023';
  end if;
  if p_batch_size is null or p_batch_size < 1 or p_batch_size > 10000 then
    raise exception 'batch_size must be between 1 and 10000.' using errcode = '22023';
  end if;
  if p_max_rows_per_target is null or p_max_rows_per_target < 1 or p_max_rows_per_target > 1000000 then
    raise exception 'max_rows_per_target must be between 1 and 1000000.' using errcode = '22023';
  end if;

  -- A run that crashed left a 'running' row behind. Mark it failed (so it is
  -- observable AND eligible for the 90-day log rule) before starting anew.
  update public.cleanup_runs
     set status = 'failed',
         completed_at = now(),
         errors = errors || jsonb_build_array(jsonb_build_object(
           'target_key', 'run', 'message', 'Run was interrupted before completion and has been marked failed.'))
   where status = 'running'
     and started_at < now() - interval '1 hour';

  v_run_id := 'cleanup-' || to_char(now(), 'YYYY-MM-DD') || '-' || substr(md5(random()::text || clock_timestamp()::text), 1, 8);

  insert into public.cleanup_runs (run_id, dry_run, triggered_by, status, batch_size, max_rows_per_target, started_at)
  values (v_run_id, p_dry_run, p_triggered_by, 'running', p_batch_size, p_max_rows_per_target, v_started);

  begin
    for v_rule in
      select target_key, category, table_name, retention_days, cutoff_column, deletion_order
        from public.data_retention_rules
       where enabled
       order by deletion_order asc, target_key asc
    loop
      v_cutoff := now() - make_interval(days => v_rule.retention_days);
      v_deleted := 0;
      v_total := 0;
      v_breakdown := null;
      v_target_failed := false;
      v_expected_table := null;
      v_expected_column := null;

      begin
        -- Each target's implementation is hard-coded. A rule row is only a
        -- configuration gate: without an implementation (or with a table that
        -- does not match the implementation's table) the target is REFUSED
        -- and reported — it is never executed against an arbitrary table.
        if v_rule.target_key = 'abandoned_carts' then
          v_expected_table := 'cart_items'; v_expected_column := 'updated_at';

        elsif v_rule.target_key = 'expired_notifications' then
          v_expected_table := 'notifications'; v_expected_column := 'created_at';

        elsif v_rule.target_key = 'notification_logs' then
          v_expected_table := 'notification_logs'; v_expected_column := 'created_at';

        elsif v_rule.target_key = 'expired_staff_invites' then
          v_expected_table := 'staff_account_invites'; v_expected_column := 'expires_at';

        elsif v_rule.target_key = 'ai_rate_limit_windows' then
          v_expected_table := 'ai_rate_limit_windows'; v_expected_column := 'window_started_at';

        elsif v_rule.target_key = 'cleanup_run_logs' then
          v_expected_table := 'cleanup_runs'; v_expected_column := 'completed_at';

        elsif v_rule.target_key = 'historical_stock_allocations' then
          v_expected_table := 'order_stock_allocations'; v_expected_column := 'created_at';

        elsif v_rule.target_key = 'return_records' then
          v_expected_table := 'return_requests'; v_expected_column := 'requested_at';

        elsif v_rule.target_key = 'coins_ledger' then
          v_expected_table := 'retailer_wallet_ledger'; v_expected_column := 'created_at';

        elsif v_rule.target_key = 'payment_records' then
          v_expected_table := 'payment_collections'; v_expected_column := 'created_at';

        elsif v_rule.target_key = 'historical_inventory_movements' then
          v_expected_table := 'stock_movements'; v_expected_column := 'created_at';

        elsif v_rule.target_key = 'orders' then
          v_expected_table := 'orders'; v_expected_column := 'placed_at';

        else
          raise exception 'No cleanup implementation registered for target "%". Refusing to touch table "%".',
            v_rule.target_key, v_rule.table_name;
        end if;

        if v_rule.table_name is distinct from v_expected_table
           or v_rule.cutoff_column is distinct from v_expected_column then
          raise exception 'Retention rule "%" points at %.% but its implementation uses %.%.',
            v_rule.target_key, v_rule.table_name, v_rule.cutoff_column, v_expected_table, v_expected_column;
        end if;

        -- ---------------------------------------------------------------
        -- Dry run: count eligible rows only. Nothing is modified.
        -- ---------------------------------------------------------------
        if p_dry_run then
          if v_rule.target_key = 'cleanup_run_logs' then
            execute format(
              'select count(*) from %I where %I < $1 and status <> ''running''',
              v_expected_table, v_expected_column)
              into v_eligible using v_cutoff;
          else
            execute format(
              'select count(*) from %I where %I < $1',
              v_expected_table, v_expected_column)
              into v_eligible using v_cutoff;
          end if;
          v_total := v_eligible;

          if v_rule.target_key = 'orders' then
            execute format(
              'select count(*) from order_items oi join orders o on o.id = oi.order_id where o.%I < $1',
              v_expected_column)
              into v_order_items using v_cutoff;
            execute format(
              'select count(*) from order_items oi join orders o on o.id = oi.order_id where o.%I < $1 and oi.gst_percent > 0',
              v_expected_column)
              into v_gst_records using v_cutoff;
            v_breakdown := jsonb_build_object('order_items', v_order_items, 'gst_records', v_gst_records);
          end if;

          if v_rule.target_key = 'coins_ledger' then
            execute format(
              'select coalesce(jsonb_object_agg(transaction_type, cnt), ''{}''::jsonb) from (select transaction_type, count(*) as cnt from %I where %I < $1 group by 1) s',
              v_expected_table, v_expected_column)
              into v_breakdown using v_cutoff;
          end if;

        -- ---------------------------------------------------------------
        -- cleanup_run_logs: never delete a run that has not completed.
        -- ---------------------------------------------------------------
        elsif v_rule.target_key = 'cleanup_run_logs' then
          loop
            exit when v_total >= p_max_rows_per_target;
            begin
              execute format(
                'with gone as (delete from %I where id in (select id from %I where %I < $1 and status <> ''running'' order by %I asc, id asc limit $2) returning 1) select count(*) from gone',
                v_expected_table, v_expected_table, v_expected_column, v_expected_column)
                into v_batch using v_cutoff, least(p_batch_size, p_max_rows_per_target - v_total);
            exception when others then
              v_target_failed := true;
              v_errors := v_errors || jsonb_build_array(jsonb_build_object(
                'target_key', v_rule.target_key, 'message', SQLERRM));
              exit;
            end;
            v_total := v_total + coalesce(v_batch, 0);
            exit when coalesce(v_batch, 0) = 0;
          end loop;

        -- ---------------------------------------------------------------
        -- coins_ledger: fold each batch's balance delta into the account's
        -- frozen opening baseline in the SAME statement that deletes it, so
        -- outstanding/coins balances are mathematically unchanged. Surviving
        -- rows that pointed at deleted rows via reversal_of are unlinked
        -- (nullable historical reference) before the delete lands.
        -- ---------------------------------------------------------------
        elsif v_rule.target_key = 'coins_ledger' then
          execute format(
            'select coalesce(jsonb_object_agg(transaction_type, cnt), ''{}''::jsonb) from (select transaction_type, count(*) as cnt from %I where %I < $1 group by 1) s',
            v_expected_table, v_expected_column)
            into v_breakdown using v_cutoff;

          loop
            exit when v_total >= p_max_rows_per_target;
            begin
              execute $batch$
                with batch as (
                  select id, retailer_id, amount_paise, direction, is_reversed, transaction_type
                    from retailer_wallet_ledger
                   where created_at < $1
                   order by created_at asc, id asc
                   limit $2
                   for update skip locked
                ),
                folded as (
                  update retailer_credit_accounts a
                     set opening_outstanding_paise = a.opening_outstanding_paise + coalesce(d.delta, 0)
                    from (
                      select retailer_id,
                             sum(case when direction = 'debit' then amount_paise else -amount_paise end)::bigint as delta
                        from batch
                       where is_reversed = false
                         and transaction_type <> 'CREDIT_LIMIT_CHANGE'
                       group by retailer_id
                    ) d
                   where a.retailer_id = d.retailer_id
                  returning 1
                ),
                unlinked as (
                  update retailer_wallet_ledger l
                     set reversal_of = null
                   where l.reversal_of in (select id from batch)
                     and l.id not in (select id from batch)
                  returning 1
                ),
                gone as (
                  delete from retailer_wallet_ledger where id in (select id from batch)
                  returning 1
                )
                select count(*) from gone
              $batch$ into v_batch using v_cutoff, least(p_batch_size, p_max_rows_per_target - v_total);
            exception when others then
              v_target_failed := true;
              v_errors := v_errors || jsonb_build_array(jsonb_build_object(
                'target_key', v_rule.target_key, 'message', SQLERRM));
              exit;
            end;
            v_total := v_total + coalesce(v_batch, 0);
            exit when coalesce(v_batch, 0) = 0;
          end loop;

        -- ---------------------------------------------------------------
        -- orders: child-first deletion of the order tree.
        --   1. visits.order_id          → nullable historical reference, set null
        --   2. return_requests          → child rows first (FK is NO ACTION)
        --   3. order_stock_allocations  → child rows first (kept explicit even
        --                                though the FK cascades)
        --   4. the order itself         → approved cascades remove order_items,
        --                                order_status_history, order_deliveries,
        --                                order_delivery_items and coupon_redemptions
        -- Young payments / follow-ups / support tickets referencing the order
        -- survive with their FK set to NULL (their own retention rules apply).
        -- ---------------------------------------------------------------
        elsif v_rule.target_key = 'orders' then
          loop
            exit when v_total >= p_max_rows_per_target;
            select array_agg(id) into v_ids
              from (
                select id from orders
                 where placed_at < v_cutoff
                 order by placed_at asc, id asc
                 limit least(p_batch_size, p_max_rows_per_target - v_total)
              ) s;
            exit when v_ids is null or cardinality(v_ids) = 0;

            begin
              select
                (select count(*) from order_items where order_id = any(v_ids)),
                (select count(*) from order_status_history where order_id = any(v_ids)),
                (select count(*) from order_deliveries where order_id = any(v_ids)),
                (select count(*) from coupon_redemptions where order_id = any(v_ids)),
                (select count(*) from return_requests where order_id = any(v_ids)),
                (select count(*) from order_stock_allocations where order_id = any(v_ids)),
                (select count(*) from order_items where order_id = any(v_ids) and gst_percent > 0)
                into v_order_items, v_order_history, v_order_deliveries, v_order_redemptions,
                     v_order_returns, v_order_allocations, v_gst_records;

              update visits set order_id = null where order_id = any(v_ids);

              delete from return_requests
               where order_id = any(v_ids)
                  or order_item_id in (select id from order_items where order_id = any(v_ids));

              delete from order_stock_allocations where order_id = any(v_ids);

              delete from orders where id = any(v_ids);
            exception when others then
              v_target_failed := true;
              v_errors := v_errors || jsonb_build_array(jsonb_build_object(
                'target_key', v_rule.target_key, 'message', SQLERRM));
              exit;
            end;

            v_total := v_total + cardinality(v_ids);
            v_breakdown := coalesce(v_breakdown, '{}'::jsonb)
              || jsonb_build_object(
                   'order_items', (coalesce(v_breakdown->>'order_items', '0'))::bigint + v_order_items,
                   'order_status_history', (coalesce(v_breakdown->>'order_status_history', '0'))::bigint + v_order_history,
                   'order_deliveries', (coalesce(v_breakdown->>'order_deliveries', '0'))::bigint + v_order_deliveries,
                   'coupon_redemptions', (coalesce(v_breakdown->>'coupon_redemptions', '0'))::bigint + v_order_redemptions,
                   'return_records_with_order', (coalesce(v_breakdown->>'return_records_with_order', '0'))::bigint + v_order_returns,
                   'stock_allocations_with_order', (coalesce(v_breakdown->>'stock_allocations_with_order', '0'))::bigint + v_order_allocations,
                   'gst_records', (coalesce(v_breakdown->>'gst_records', '0'))::bigint + v_gst_records);
          end loop;

        -- ---------------------------------------------------------------
        -- Everything else: generic bounded ctid batch delete on the rule's
        -- timestamp column. Deterministic order (cutoff column, ctid).
        -- ---------------------------------------------------------------
        else
          loop
            exit when v_total >= p_max_rows_per_target;
            begin
              execute format(
                'with gone as (delete from %I where ctid in (select ctid from %I where %I < $1 order by %I asc, ctid asc limit $2) returning 1) select count(*) from gone',
                v_expected_table, v_expected_table, v_expected_column, v_expected_column)
                into v_batch using v_cutoff, least(p_batch_size, p_max_rows_per_target - v_total);
            exception when others then
              v_target_failed := true;
              v_errors := v_errors || jsonb_build_array(jsonb_build_object(
                'target_key', v_rule.target_key, 'message', SQLERRM));
              exit;
            end;
            v_total := v_total + coalesce(v_batch, 0);
            exit when coalesce(v_batch, 0) = 0;
          end loop;
        end if;

      exception when others then
        -- One failing category must not sink the run and must not be a silent
        -- success: record it and continue with the remaining targets. The
        -- failed target's partial work is rolled back to this savepoint.
        v_target_failed := true;
        v_errors := v_errors || jsonb_build_array(jsonb_build_object(
          'target_key', v_rule.target_key, 'message', SQLERRM));
      end;

      -- Every target is reported — including partially-failed ones (their
      -- successful batches DID delete rows and must be audited honestly).
      v_target := jsonb_build_object(
        'target_key', v_rule.target_key,
        'category', v_rule.category,
        'table', v_rule.table_name,
        'retention_days', v_rule.retention_days,
        'cutoff', v_cutoff,
        'action', 'DELETE',
        'eligible_rows', case when p_dry_run then v_total else null end,
        'deleted_rows', case when p_dry_run then 0 else v_total end,
        'status', case when v_target_failed then 'failed' else 'ok' end);
      if v_breakdown is not null then
        v_target := v_target || jsonb_build_object('breakdown', v_breakdown);
      end if;
      v_targets := v_targets || jsonb_build_array(v_target);
      if v_rule.category = 'temporary_90' then
        v_sum_tmp := v_sum_tmp + v_total;
      else
        v_sum_120 := v_sum_120 + v_total;
      end if;
    end loop;

  exception when others then
    v_fatal := SQLERRM;
  end;

  if v_fatal is not null then
    v_errors := v_errors || jsonb_build_array(jsonb_build_object(
      'target_key', 'run', 'message', v_fatal));
  end if;

  update public.cleanup_runs
     set status = case
           when v_fatal is not null then 'failed'
           when jsonb_array_length(v_errors) > 0 then 'completed_with_errors'
           else 'completed'
         end,
         completed_at = now(),
         summary = jsonb_build_object(
           'run_id', v_run_id,
           'dry_run', p_dry_run,
           'triggered_by', p_triggered_by,
           'started_at', v_started,
           'batch_size', p_batch_size,
           'max_rows_per_target', p_max_rows_per_target,
           'targets', v_targets,
           'totals', jsonb_build_object(
             'temporary', v_sum_tmp,
             '120_day', v_sum_120,
             case when p_dry_run then 'eligible' else 'deleted' end, v_sum_tmp + v_sum_120)),
         errors = v_errors
   where run_id = v_run_id;

  return (
    select summary || jsonb_build_object('status', r.status, 'errors', r.errors)
      from public.cleanup_runs r where r.run_id = v_run_id
  );
end;
$$;

revoke all on function public.run_data_cleanup(boolean, text, int, int) from public, anon, authenticated;
grant execute on function public.run_data_cleanup(boolean, text, int, int) to service_role;

comment on function public.run_data_cleanup(boolean, text, int, int) is
  'Server-scheduler-only retention cleanup. p_dry_run=true counts eligible rows and plans actions without deleting anything. Executes the explicit data_retention_rules registry through hard-coded per-target implementations (allow-list), in bounded deterministic batches, with per-target error isolation and a cleanup_runs audit row per execution. Coins/credit ledger batches fold their balance delta into opening_outstanding_paise atomically with deletion.';

-- ---------------------------------------------------------------------------
-- 5. Hardening: cleanup tables cannot be modified through the client API at
--    all (no policies, privileges revoked). The rule registry is append-only
--    configuration owned by migrations; a trigger additionally blocks
--    destructive tampering with the enabled registry from non-owners.
-- ---------------------------------------------------------------------------
create or replace function public.guard_data_retention_rules_mutation()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  -- The registry is migration-managed configuration. Even the service role
  -- goes through deployments to change what retention cleanup may target —
  -- a compromised API key must not be able to add "products" as a target.
  if current_user not in ('postgres', 'supabase_admin') then
    raise exception 'data_retention_rules is migration-managed configuration.' using errcode = '42501';
  end if;
  -- coalesce(new, old): a BEFORE DELETE trigger must return OLD — returning
  -- NEW (null) would silently cancel the delete.
  return coalesce(new, old);
end;
$$;

drop trigger if exists trg_guard_data_retention_rules on public.data_retention_rules;
create trigger trg_guard_data_retention_rules
  before insert or update or delete on public.data_retention_rules
  for each row execute function public.guard_data_retention_rules_mutation();
revoke all on function public.guard_data_retention_rules_mutation() from public, anon, authenticated, service_role;

-- ============================================================================
-- END OF MIGRATION 0055
-- ============================================================================
