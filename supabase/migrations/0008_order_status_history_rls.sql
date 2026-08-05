-- ============================================================================
-- 0008: order_status_history RLS + auto-logging trigger
--
-- order_status_history has existed since 0001_init.sql but never had RLS
-- enabled (flagged as a known gap in 0005's comments, never closed).
-- Phase 2B's retailer-facing order status timeline reads this table
-- directly, so this must be fixed now.
--
-- Also adds a trigger that automatically logs every status a new order
-- is created with, and every status it's later updated to — so no
-- future code path (retailer checkout today, Staff dispatch workflow
-- later) can forget to write a history row.
-- ============================================================================

alter table order_status_history enable row level security;

create policy "order_status_history_retailer_read" on order_status_history
  for select using (
    exists (
      select 1 from orders o
      where o.id = order_id and (o.retailer_id = auth.uid() or o.collected_by = auth.uid())
    )
    or is_staff_or_above()
  );

create policy "order_status_history_staff_write" on order_status_history
  for insert with check (is_staff_or_above());

create or replace function log_order_status_change() returns trigger as $$
begin
  if (tg_op = 'INSERT') or (new.status is distinct from old.status) then
    insert into order_status_history (order_id, status, changed_by)
    values (new.id, new.status, auth.uid());
  end if;
  return new;
end;
$$ language plpgsql security definer;

drop trigger if exists trg_log_order_status_insert on orders;
create trigger trg_log_order_status_insert
  after insert on orders
  for each row execute function log_order_status_change();

drop trigger if exists trg_log_order_status_update on orders;
create trigger trg_log_order_status_update
  after update of status on orders
  for each row execute function log_order_status_change();

-- ============================================================================
-- END OF MIGRATION — no business data inserted.
-- ============================================================================
