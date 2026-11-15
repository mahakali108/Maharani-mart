-- Rollback for 0101_atomic_return_request_resolution.sql
--
-- Removes the two atomic functions, the private helper and the guards, and
-- restores the 0054 body and grants of return_order_stock.
-- No row is lost: the history is copied into return_request_events_rollback_archive
-- (row-level security on, no grant to any API role) before the live table is removed.
--
-- Roll the application back FIRST: the return actions of this release call
-- these functions and fail closed without them.
begin;

drop function if exists public.approve_return_request_atomic(uuid, uuid, text);
drop function if exists public.reject_return_request_atomic(uuid, uuid, text);
drop function if exists public._return_request_restorable_lines(uuid, uuid);

drop trigger if exists trg_guard_return_request_write on public.return_requests;
drop function if exists public.guard_return_request_write();

-- History is kept: copied row for row into an archive, then the live table goes.
do $$
begin
  if to_regclass('public.return_request_events') is not null then
    create table if not exists public.return_request_events_rollback_archive as
      select *, now() as archived_at from public.return_request_events with no data;
    insert into public.return_request_events_rollback_archive
      select e.*, now() from public.return_request_events e
       where not exists (select 1 from public.return_request_events_rollback_archive x where x.id = e.id);
    alter table public.return_request_events_rollback_archive enable row level security;
    revoke all on table public.return_request_events_rollback_archive from public, anon, authenticated, service_role;
    drop table if exists public.return_request_events;
  end if;
end $$;
drop function if exists public.guard_return_request_events_append_only();

-- 0054 body, verbatim.
create or replace function public.return_order_stock(p_order_id uuid, p_order_item_id uuid default null)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_simple boolean;
  v_status public.order_status;
  v_units integer;
begin
  perform public.require_inventory_role();

  select simple_stock_mode, status into v_simple, v_status
    from public.orders
   where id = p_order_id
   for update;
  if not found then raise exception 'Order not found.' using errcode = 'P0002'; end if;

  if v_simple then
    if v_status not in ('delivered', 'returned') then
      raise exception 'Stock can only be returned for a delivered or returned order.' using errcode = 'check_violation';
    end if;
    v_units := public.restore_simple_order_stock(p_order_id, p_order_item_id);
    return jsonb_build_object('status', 'returned', 'order_id', p_order_id, 'units', v_units);
  end if;

  return public.return_legacy_order_stock(p_order_id, p_order_item_id);
end;
$$;
revoke all on function public.return_order_stock(uuid, uuid) from public, anon;
grant execute on function public.return_order_stock(uuid, uuid) to authenticated, service_role;
comment on function public.return_order_stock(uuid, uuid) is null;

commit;
