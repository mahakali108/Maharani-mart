-- ============================================================================
-- ROLLBACK for 0083 — REVIEW ONLY, NOT APPLIED ANYWHERE.
--
-- This RE-ENABLES the retired paid membership system. Doing so needs explicit
-- owner approval, because it would also re-introduce a paid subscription, its
-- checkout/marketing claims, and the membership loyalty multiplier.
-- ============================================================================

begin;

-- 1. Plans purchasable again (only the three documented plans).
update public.membership_plans set is_active = true, updated_at = now()
 where id in ('free', 'silver', 'gold');

-- 2. Restore the API grant on the assignment RPC.
grant execute on function public.admin_set_retailer_membership(uuid, text, text, text) to authenticated;

-- 3. Restore the membership-multiplier loyalty trigger: re-apply the
--    trg_order_delivered_loyalty() body from 0080 verbatim.
--    (Copy that function definition from
--     supabase/migrations/0080_retailer_memberships_and_loyalty.sql.)

commit;
