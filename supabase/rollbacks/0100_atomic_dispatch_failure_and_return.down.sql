-- Rollback for 0100_atomic_dispatch_failure_and_return.sql
--
-- Removes the three atomic functions, the private actor helper and the direct
-- fulfilment-transition guards and the settled-lines guard. No table, column or row is removed.
--
-- Roll the application back FIRST: the server actions of this release call
-- these functions and fail closed without them.
begin;

drop trigger if exists trg_guard_direct_order_fulfilment_transition on public.orders;
drop function if exists public.guard_direct_order_fulfilment_transition();
drop trigger if exists trg_guard_direct_delivery_fulfilment_transition on public.order_deliveries;
drop function if exists public.guard_direct_delivery_fulfilment_transition();
drop trigger if exists trg_guard_settled_delivery_lines on public.order_delivery_items;
drop function if exists public.guard_settled_delivery_lines();
drop function if exists public.return_delivery_to_warehouse_atomic(uuid, uuid, text);
drop function if exists public.fail_delivery_atomic(uuid, uuid, text);
drop function if exists public.dispatch_order_atomic(uuid, uuid, text);
drop function if exists public._fulfilment_actor_role(uuid, text[], text);

commit;
