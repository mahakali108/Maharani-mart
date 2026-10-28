-- ============================================================================
-- ROLLBACK for 0081 — REVIEW ONLY, NOT APPLIED ANYWHERE.
--
-- This restores the pre-0081 *API surface* (the five approval RPCs and the
-- retailers.retailer_category classification). It deliberately does NOT delete
-- the approval workflow tables or the audit trail: those rows are business
-- evidence and a rollback of the feature is not a licence to destroy records.
-- Removing them is a separate, owner-approved data-retention decision; the
-- draft statements are commented out below and are NOT part of the default run.
--
-- WHAT THE DEFAULT RUN DOES
--   1. drops the five 0081 RPCs (so no session can approve/reject/categorise);
--   2. drops the depth-2 trigger + function that guard retailers.status and
--      retailers.retailer_category (the function references the column, so it
--      cannot survive the column drop);
--   3. drops retailers.retailer_category.
--
-- WHAT THE DEFAULT RUN INTENTIONALLY KEEPS
--   * public.retailer_applications      (submitted/decision history)
--   * public.retailer_approval_events   (append-only audit trail)
--   * public.retailer_approval_settings (configured review SLA)
--   * trg_retailer_approval_events_immutable + its function, so retained audit
--     rows still cannot be rewritten by anyone, including a future migration;
--   * trg_ensure_retailer_application + its function, so signups keep producing
--     application evidence while those tables exist;
--   * the retailer_category enum type (dropping a type other objects reference
--     is riskier than leaving an unused type behind).
--   Keeping the tables is also what makes the script internally consistent:
--   dropping retailer_approval_settings would break ensure_retailer_application
--   on the very next retailer signup.
--
-- FAIL-CLOSED DEPENDENCY GUARD (SQLSTATE 55000)
--   Every destructive statement below is preceded by an explicit call to
--   pg_temp.assert_0081_rollback_safe(). The guard reads the LIVE catalog and
--   refuses to continue (raising SQLSTATE 55000, transaction aborted, nothing
--   changed) while any known Migration 0082 category-pricing dependency is
--   still present. It checks, as a complete inventory:
--     * public.product_tier_prices (table) and every policy on it, including
--       product_tier_prices_read (access rules are never guessed or recreated);
--     * public.pack_category_price_per_piece(uuid, uuid);
--     * public.validate_product_tier_prices() and public.guard_product_tier_prices_write();
--     * trg_validate_product_tier_prices / trg_guard_product_tier_prices_write
--       and any other non-internal trigger on public.product_tier_prices;
--     * both checkout bodies (create_order_atomic from 0056 and
--       create_order_atomic_v2 from 0065) while they still reference
--       pack_category_price_per_piece / product_tier_prices / retailer_category
--       after SQL comments are stripped (so a comment can never cause a
--       false positive, and a missing table can never be mistaken for a
--       completed 0082 reversal);
--     * every object in pg_depend that depends on the live
--       retailers.retailer_category column (policy expressions, views,
--       constraints, indexes, defaults, triggers), excluding only objects this
--       script itself removes;
--     * any *undocumented* column, in any public table, typed
--       public.retailer_category.
--
--   The guard also refuses to run when the migration ledger cannot prove the
--   chain was reversed. It reads supabase_migrations.schema_migrations when
--   that table is visible: if the ledger still records 0081/0082/0083/0084 as
--   applied the rollback is blocked outright. When the ledger is absent,
--   unreadable, or uses a version convention this script cannot correlate
--   (e.g. a scratch database created by replaying supabase/migrations), the
--   rollback stays blocked until an authorised operator attests the check:
--
--       select set_config('maharani.rollback_0081_ledger_ack',
--                         'ledger verified via <evidence ref> on <UTC date>', false);
--
--   An absent ledger is never treated as proof that the rollback is safe, and
--   the ack can never override a ledger that still records an applied version.
--   Full preconditions and evidence fields: docs/MIGRATION_ROLLBACK_0081_0084.md
--   Verdict while any of the above is unmet: NO-GO.
--
-- ORDER MATTERS: guard -> RPCs -> guard -> trigger -> function -> guard -> column.
-- ============================================================================

begin;

-- ---------------------------------------------------------------------------
-- 0. Fail-closed dependency guard
--    A pg_temp function: session-local, discarded with the connection, and
--    rolled back with the transaction if any check fails, so the guard itself
--    never becomes a permanent schema change.
-- ---------------------------------------------------------------------------
create or replace function pg_temp.assert_0081_rollback_safe(p_step text)
returns void
language plpgsql
as $guard$
declare
  v_ledger_state text := 'absent';
  v_ledger_versions text[];
  v_ack text := nullif(
    btrim(coalesce(current_setting('maharani.rollback_0081_ledger_ack', true), '')),
    ''
  );
  v_applied_versions text[] := array['0081', '0082', '0083', '0084'];
  v_blockers text[] := '{}'::text[];
  v_catalog text[];
begin
  -- -------------------------------------------------------------------------
  -- (a) Migration ledger. Never silently pass on an absent/unreadable ledger.
  -- -------------------------------------------------------------------------
  if to_regclass('supabase_migrations.schema_migrations') is null then
    v_ledger_state := 'absent';
  else
    begin
      select array_agg(m.version::text order by m.version::text)
        into v_ledger_versions
        from supabase_migrations.schema_migrations m
       where m.version::text = any (v_applied_versions);
      v_ledger_state := case
        when coalesce(cardinality(v_ledger_versions), 0) > 0 then 'applied'
        else 'clean'
      end;
    exception
      when insufficient_privilege or undefined_column or undefined_table or invalid_schema_name then
        v_ledger_state := 'unreadable';
        v_ledger_versions := null;
    end;
  end if;

  if v_ledger_state = 'applied' then
    v_blockers := v_blockers || format(
      'migration ledger: supabase_migrations.schema_migrations still records %s as applied; reverse the chain and repair the ledger first',
      array_to_string(v_ledger_versions, ', ')
    );
  elsif v_ack is null then
    v_blockers := v_blockers || format(
      'migration ledger: not verifiable from SQL here (state: %s); this is NOT proof that the 0082-0084 reversal is complete. Set maharani.rollback_0081_ledger_ack to an evidence reference after an authorised operator verifies supabase_migrations.schema_migrations',
      v_ledger_state
    );
  else
    raise notice '0081 rollback guard: migration-ledger check waived by operator acknowledgement: %', v_ack;
  end if;

  -- -------------------------------------------------------------------------
  -- (b) Complete known 0082 dependency inventory, read from the live catalog.
  --     Each present object is a blocker on its own: the absence of one object
  --     is never taken as evidence that the whole 0082 reversal is complete.
  -- -------------------------------------------------------------------------
  select array_agg(b.kind || ': ' || b.obj order by b.kind, b.obj)
    into v_catalog
    from (
      select 'table'::text as kind,
             'public.product_tier_prices exists (Migration 0082 pricing configuration)'::text as obj
       where to_regclass('public.product_tier_prices') is not null

      union all
      select 'policy',
             'policy ' || pol.polname || ' on public.product_tier_prices'
        from pg_policy pol
        join pg_class c on c.oid = pol.polrelid
        join pg_namespace n on n.oid = c.relnamespace
       where n.nspname = 'public'
         and c.relname = 'product_tier_prices'

      union all
      select 'function',
             'public.' || p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')'
        from pg_proc p
        join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public'
         and p.proname in (
           'pack_category_price_per_piece',
           'validate_product_tier_prices',
           'guard_product_tier_prices_write'
         )

      union all
      select 'trigger',
             'trigger ' || t.tgname || ' on ' || t.tgrelid::regclass::text
        from pg_trigger t
       where not t.tgisinternal
         and (
           t.tgname in ('trg_validate_product_tier_prices', 'trg_guard_product_tier_prices_write')
           or t.tgrelid = to_regclass('public.product_tier_prices')
         )

      union all
      -- Checkout bodies still pricing by category. SQL comments are stripped
      -- first so documentation text can never trip the guard, and only these
      -- two functions are inspected so unrelated functions cannot either.
      select 'checkout function',
             'public.' || p.proname || ' still contains category-pricing logic'
        from pg_proc p
        join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public'
         and p.proname in ('create_order_atomic', 'create_order_atomic_v2')
         and regexp_replace(
               regexp_replace(p.prosrc, '/\*.*?\*/', '', 'gs'),
               '--[^\n]*', '', 'g'
             ) ~* '(pack_category_price_per_piece|product_tier_prices|retailer_category)'

      union all
      -- Anything that depends on the live retailers.retailer_category column.
      -- The column's own default disappears with the column, and the depth-2
      -- guard trigger is removed by this script, so both are excluded.
      select 'column dependency',
             pg_describe_object(d.classid, d.objid, d.objsubid)
        from pg_depend d
       where d.refclassid = 'pg_class'::regclass
         and d.refobjid = to_regclass('public.retailers')
         and d.refobjsubid = (
           select a.attnum
             from pg_attribute a
            where a.attrelid = to_regclass('public.retailers')
              and a.attname = 'retailer_category'
              and not a.attisdropped
         )
         and d.deptype in ('n', 'a')
         and not (
           d.classid = 'pg_attrdef'::regclass
           and exists (
             select 1
               from pg_attrdef ad
              where ad.oid = d.objid
                and ad.adrelid = to_regclass('public.retailers')
                and ad.adnum = d.refobjsubid
           )
         )
         and not (
           d.classid = 'pg_trigger'::regclass
           and exists (
             select 1
               from pg_trigger t
              where t.oid = d.objid
                and t.tgname = 'trg_guard_retailer_sensitive_columns'
                and t.tgrelid = to_regclass('public.retailers')
           )
         )

      union all
      -- Undocumented *table* columns typed with the enum, outside 0081/0082
      -- themselves. Index columns are excluded: an index on a retained table
      -- is a derived copy of that table's column, not an independent holder.
      select 'undocumented dependency',
             'column ' || a.attname || ' of table ' || c.oid::regclass::text
             || ' uses public.retailer_category'
        from pg_attribute a
        join pg_class c on c.oid = a.attrelid
        join pg_namespace n on n.oid = c.relnamespace
       where n.nspname = 'public'
         and c.relkind in ('r', 'p')
         and a.attnum > 0
         and not a.attisdropped
         and a.atttypid = to_regtype('public.retailer_category')
         and not (
           c.oid = to_regclass('public.retailers')
           or c.oid = to_regclass('public.product_tier_prices')
         )
    ) b;

  if v_catalog is not null then
    v_blockers := v_blockers || v_catalog;
  end if;

  -- -------------------------------------------------------------------------
  -- (c) Fail closed. Nothing below has run, so the schema is untouched.
  -- -------------------------------------------------------------------------
  if cardinality(v_blockers) > 0 then
    raise exception 'MIGRATION_0081_ROLLBACK_BLOCKED: refusing to execute "%".', p_step
      using errcode = '55000',
            detail = 'Blocking dependency(ies):' || E'\n  - ' || array_to_string(v_blockers, E'\n  - '),
            hint = 'Reverse the chain in this order: 0084 -> 0083 -> 0082 (supabase/rollbacks/), re-verify '
                   'the inventory and the migration ledger, then retry this script. No object was changed by '
                   'this run. See docs/MIGRATION_ROLLBACK_0081_0084.md.';
  end if;

  raise notice '0081 rollback guard passed: %', p_step;
end;
$guard$;

-- Preflight: fail before any destructive statement is prepared.
select pg_temp.assert_0081_rollback_safe('preflight (no statement executed yet)');

-- ---------------------------------------------------------------------------
-- 1. Approval RPCs — one guarded call per destructive statement.
-- ---------------------------------------------------------------------------
select pg_temp.assert_0081_rollback_safe('drop function public.retailer_resubmit_application(text, text, text, uuid)');
drop function if exists public.retailer_resubmit_application(text, text, text, uuid);

select pg_temp.assert_0081_rollback_safe('drop function public.admin_set_retailer_access(uuid, text, text)');
drop function if exists public.admin_set_retailer_access(uuid, text, text);

select pg_temp.assert_0081_rollback_safe('drop function public.admin_set_retailer_category(uuid, text, text)');
drop function if exists public.admin_set_retailer_category(uuid, text, text);

select pg_temp.assert_0081_rollback_safe('drop function public.admin_review_retailer_application(uuid, text, text, text)');
drop function if exists public.admin_review_retailer_application(uuid, text, text, text);

select pg_temp.assert_0081_rollback_safe('drop function public.admin_update_approval_settings(int, int)');
drop function if exists public.admin_update_approval_settings(int, int);

-- ---------------------------------------------------------------------------
-- 2. Depth-2 guard on retailers (it reads the column being removed).
--    Dropping it also removes the depth-2 status guard; RLS still denies a
--    retailer self-update of retailers, which the operator must re-verify
--    (see the checklist in docs/MIGRATION_ROLLBACK_0081_0084.md).
-- ---------------------------------------------------------------------------
select pg_temp.assert_0081_rollback_safe('drop trigger trg_guard_retailer_sensitive_columns on public.retailers');
drop trigger if exists trg_guard_retailer_sensitive_columns on public.retailers;

select pg_temp.assert_0081_rollback_safe('drop function public.guard_retailer_sensitive_columns()');
drop function if exists public.guard_retailer_sensitive_columns();

-- ---------------------------------------------------------------------------
-- 3. Classification column.
--    The enum is left in place: dropping a type that retained objects may
--    reference is riskier than leaving an unused type behind.
--    product_tier_prices_read is NEVER dropped, recreated or replaced here.
-- ---------------------------------------------------------------------------
select pg_temp.assert_0081_rollback_safe('alter table public.retailers drop column retailer_category');
alter table public.retailers drop column if exists retailer_category;

-- ---------------------------------------------------------------------------
-- 4. OWNER DECISION ONLY — commented out, never part of the default run.
--    Dropping these destroys the approval history. If they are ever removed,
--    the triggers/functions that maintain them must be removed in the same
--    transaction (otherwise the next retailer signup fails), and the owner
--    must record the retention decision and the backup/PITR evidence.
--
--    drop trigger if exists trg_ensure_retailer_application on public.retailers;
--    drop trigger if exists trg_retailer_approval_events_immutable on public.retailer_approval_events;
--    drop function if exists public.ensure_retailer_application();
--    drop function if exists public.retailer_approval_events_immutable();
--    drop table if exists public.retailer_approval_events;
--    drop table if exists public.retailer_applications;
--    drop table if exists public.retailer_approval_settings;
--    drop type  if exists public.retailer_category;
--
--    delete from public.retailers where false; -- never mass-delete retailers
-- ---------------------------------------------------------------------------

commit;
