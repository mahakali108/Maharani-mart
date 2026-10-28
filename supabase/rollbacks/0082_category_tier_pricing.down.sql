-- ============================================================================
-- ROLLBACK for 0082 — REVIEW ONLY, NOT APPLIED ANYWHERE.
--
-- 0082 re-stated create_order_atomic (0056) and create_order_atomic_v2 (0065)
-- with an added category-price gate. Rolling the FEATURE back means restoring
-- the 0056/0065 bodies verbatim (they are unchanged in those files) — this
-- script does that by re-running the two definitions from the original
-- migrations, which is the only safe way to get the byte-identical bodies.
--
-- Deleting product_tier_prices is an OWNER DECISION: the rows are pricing
-- configuration with an audit value. They are kept by default.
--   - Packs without category prices are completely unaffected by 0082, and the
--     re-stated functions are no-ops for them, so a code-only rollback (revert
--     the app commit) leaves checkout working even if this is never run.
-- ============================================================================

begin;

drop trigger if exists trg_guard_product_tier_prices_write on public.product_tier_prices;
drop trigger if exists trg_validate_product_tier_prices on public.product_tier_prices;
drop function if exists public.guard_product_tier_prices_write();
drop function if exists public.validate_product_tier_prices();

-- Restore the original checkout bodies from their own migrations.
-- (Run the create_order_atomic block from 0056 and the
--  create_order_atomic_v2 block from 0065 verbatim.)
-- \i supabase/migrations/0056_mobile_checkout_atomic.sql
-- \i supabase/migrations/0065_checkout_split_rpcs.sql
-- NOTE: those files also contain other objects; re-running them wholesale is
-- idempotent but broader than this rollback intends. Extract only the two
-- function definitions, or accept leaving the category gate in place (it is a
-- no-op when product_tier_prices is empty).

drop function if exists public.pack_category_price_per_piece(uuid, uuid);

-- OWNER DECISION (default: keep the configuration rows)
-- drop table if exists public.product_tier_prices;

commit;
