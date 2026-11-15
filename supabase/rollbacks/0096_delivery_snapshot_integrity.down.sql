-- ============================================================================
-- ROLLBACK for 0096_delivery_snapshot_integrity.sql
-- REVIEW ONLY, NOT APPLIED ANYWHERE.
--
-- WARNING: re-opens SEC-16. After this rollback an assigned delivery person
-- can again alter quantity_ordered / order_item_id while a delivery is open.
-- Restores the 0094 trigger and the 0094 body of delivery_shortfall_paise().
-- No data is changed.
-- ============================================================================
begin;

drop trigger if exists trg_guard_order_delivery_completion_lines on public.order_deliveries;
drop function if exists public.guard_order_delivery_completion_lines();

drop trigger if exists trg_guard_order_delivery_item_snapshot on public.order_delivery_items;
drop function if exists public.guard_order_delivery_item_snapshot();

drop trigger if exists trg_guard_order_delivery_items_after_completion on public.order_delivery_items;
create trigger trg_guard_order_delivery_items_after_completion
  before insert or update or delete on public.order_delivery_items
  for each row execute function public.guard_order_delivery_items_after_completion();

create or replace function public.delivery_shortfall_paise(p_delivery_id uuid)
returns bigint
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce(sum(
    least(
      round(oi.line_total * 100)::bigint,
      floor(
        (round(oi.line_total * 100) * (di.quantity_missing + di.quantity_damaged))::numeric
        / di.quantity_ordered + 0.5
      )::bigint
    )
  ), 0)::bigint
  from public.order_delivery_items di
  join public.order_items oi on oi.id = di.order_item_id
  where di.delivery_id = p_delivery_id
    and di.quantity_ordered > 0
    and (di.quantity_missing + di.quantity_damaged) > 0
    and oi.line_total > 0
$$;
revoke all on function public.delivery_shortfall_paise(uuid) from public, anon, authenticated;
grant execute on function public.delivery_shortfall_paise(uuid) to service_role;

commit;
