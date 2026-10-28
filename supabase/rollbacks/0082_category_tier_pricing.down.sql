-- ============================================================================
-- ROLLBACK for 0082 — REVIEW ONLY, NOT APPLIED ANYWHERE.
--
-- 0082 re-stated create_order_atomic (0056) and create_order_atomic_v2 (0065)
-- with an added category-price gate. Rolling the FEATURE back means restoring
-- the 0056/0065 bodies verbatim — those two files are the authoritative source,
-- and a diff of the four function bodies (0056:479 vs 0082:250, 0065:503 vs
-- 0082:831) shows the ONLY differences are one `v_category_piece_price numeric;`
-- declaration and the added gate block, so the originals restore exactly.
--
-- ORDER: restore the two checkout bodies FIRST, then run this script. The
-- precondition below refuses to continue otherwise, because dropping
-- pack_category_price_per_piece while create_order_atomic still calls it would
-- leave checkout raising "function does not exist" on every order.
--
--   How to restore, without inventing a body and without re-running whole files:
--     1. open supabase/migrations/0056_mobile_checkout_atomic.sql and copy the
--        complete `create or replace function public.create_order_atomic(`
--        statement (line 479 through its closing `$$;`);
--     2. open supabase/migrations/0065_checkout_split_rpcs.sql and copy the
--        complete `create or replace function public.create_order_atomic_v2(`
--        statement (line 503 through its closing `$$;`);
--     3. execute both statements, then run this script.
--   Both files pin `security definer` + `set search_path = public, pg_temp`, and
--   the EXECUTE grants from 0056/0065 are preserved by CREATE OR REPLACE, so no
--   ACL statement is needed or re-issued here.
--
-- Deleting product_tier_prices is an OWNER DECISION: the rows are pricing
-- configuration with an audit value. They are kept by default, commented out
-- below. If they are dropped, product_tier_prices_read goes with the table —
-- never recreate that policy with guessed access rules.
-- ============================================================================

begin;

-- ---------------------------------------------------------------------------
-- 0. Fail-closed precondition (SQLSTATE 55000): no live function outside this
--    rollback may still reference 0082 category pricing. `retailer_category` is
--    deliberately NOT matched here — the 0081 RPCs legitimately use that column
--    until 0081 itself is rolled back, and blocking on them would make the
--    required order (0082 before 0081) impossible.
-- ---------------------------------------------------------------------------
do $pre$
declare
  v_callers text[];
begin
  select array_agg(p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')' order by p.proname)
    into v_callers
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and p.proname not in (
       'pack_category_price_per_piece',
       'validate_product_tier_prices',
       'guard_product_tier_prices_write'
     )
     and regexp_replace(
           regexp_replace(p.prosrc, '/\*.*?\*/', '', 'gs'),
           '--[^\n]*', '', 'g'
         ) ~* '(pack_category_price_per_piece|product_tier_prices)';

  if v_callers is not null then
    raise exception 'MIGRATION_0082_ROLLBACK_BLOCKED: checkout/quote functions still reference category pricing.'
      using errcode = '55000',
            detail = 'Restore the authentic 0056/0065 bodies first; still calling: '
                     || array_to_string(v_callers, ', '),
            hint = 'Copy the create_order_atomic block from supabase/migrations/0056_mobile_checkout_atomic.sql '
                   'and the create_order_atomic_v2 block from supabase/migrations/0065_checkout_split_rpcs.sql '
                   'verbatim, then rerun this script. No object was changed by this run.';
  end if;
end;
$pre$;

-- ---------------------------------------------------------------------------
-- 1. Triggers and their functions (the ordering invariant belongs to 0082).
--    Dropping them frees the retained table from the gold<=silver<=general
--    constraint; that is acceptable only because the feature is off. If the
--    table is kept, its rows are historical configuration and the order is not
--    re-validated — record that in the change evidence.
-- ---------------------------------------------------------------------------
drop trigger if exists trg_guard_product_tier_prices_write on public.product_tier_prices;
drop trigger if exists trg_validate_product_tier_prices on public.product_tier_prices;
drop function if exists public.guard_product_tier_prices_write();
drop function if exists public.validate_product_tier_prices();

-- ---------------------------------------------------------------------------
-- 2. Authoritative resolution helper. Safe to drop ONLY after step 0 passed.
-- ---------------------------------------------------------------------------
drop function if exists public.pack_category_price_per_piece(uuid, uuid);

-- ---------------------------------------------------------------------------
-- 3. OWNER DECISION (default: keep the configuration rows).
--    Dropping the table also removes its policies, indexes, constraints and
--    triggers; no CASCADE is used anywhere. product_tier_prices_read must never
--    be recreated from guessed rules — it is either the 0082 policy or absent.
--
--    drop table if exists public.product_tier_prices;
-- ---------------------------------------------------------------------------

commit;
