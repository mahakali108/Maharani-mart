-- ============================================================================
-- 0043: Deliveries module (Phase 4 — order lifecycle & delivered module)
--
-- WHY
-- ---
-- "Delivered" was a bare status flip with a free-text note. Real delivery
-- operations need: WHO is delivering, WHEN it was assigned/dispatched/
-- delivered, WHO received it, OTP verification, signature/photo proof,
-- per-line delivered/missing/damaged quantities, structured notes, a
-- return window, and explicit failed / return-to-warehouse outcomes.
--
-- MODEL
-- ---
-- * ONE delivery task per order (unique order_id). A failed attempt
--   re-opens the order (dispatched → processing, decision D3) and the next
--   dispatch RESETS the same task row — attempt history stays in
--   order_status_history and audit_logs, so no duplicate tasks exist.
-- * `assigned_staff_id` may be a staff OR a salesman (decision D2).
-- * The OTP is generated at dispatch, stored ONLY as a SHA-256 hash
--   (otp + ':' + order_id), and sent to the RETAILER — the delivery staff
--   must obtain it from the retailer and submit it at completion.
--   6 wrong attempts lock the task (otp_attempts check <= 10) so brute
--   force is structurally bounded.
-- * order_delivery_items snapshots each line's ordered quantity at dispatch
--   and records delivered/missing/damaged at completion; the split
--   constraint guarantees delivered + missing + damaged = ordered.
-- * Delivery proofs live in the private `delivery-proofs` bucket
--   (migration 0045); signature_url/photo_url store OBJECT PATHS, never
--   public URLs.
--
-- RLS (decision D1 + D2):
--   admin+      full access
--   retailer    read-only, own orders only — NO insert/update/delete
--   staff       orders in their assigned warehouse/area (0037 helpers) or
--               assigned_staff_id = auth.uid()
--   salesman    assigned_staff_id = auth.uid(), or orders they collected,
--               or orders of retailers assigned to them (0014 helper)
--
-- SAFETY: additive & re-runnable; append-only (no DELETE policy); audit
-- triggers on both tables via the existing log_audit() function.
-- ============================================================================

create table if not exists order_deliveries (
  id uuid primary key default uuid_generate_v4(),
  order_id uuid not null references orders(id) on delete cascade,
  delivery_status text not null default 'assigned',
  assigned_staff_id uuid references profiles(id),
  assigned_at timestamptz,
  assigned_by uuid references profiles(id),
  dispatched_at timestamptz,
  in_progress_at timestamptz,
  delivered_at timestamptz,
  receiver_name text,
  otp_hash text,
  otp_verified_at timestamptz,
  otp_attempts int not null default 0,
  signature_url text,
  photo_url text,
  delivery_notes text,
  failure_reason text,
  return_window_days int,
  return_deadline date,
  completed_by uuid references profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint order_deliveries_order_unique unique (order_id),
  constraint order_deliveries_status_check
    check (delivery_status in ('assigned', 'in_progress', 'delivered', 'partially_delivered', 'failed', 'returned_to_warehouse')),
  constraint order_deliveries_receiver_len
    check (receiver_name is null or char_length(btrim(receiver_name)) between 2 and 120),
  constraint order_deliveries_notes_len
    check (delivery_notes is null or char_length(btrim(delivery_notes)) <= 1000),
  constraint order_deliveries_failure_len
    check (failure_reason is null or char_length(btrim(failure_reason)) between 3 and 500),
  constraint order_deliveries_otp_attempts
    check (otp_attempts >= 0 and otp_attempts <= 10),
  constraint order_deliveries_return_window
    check (return_window_days is null or (return_window_days >= 0 and return_window_days <= 365))
);

create index if not exists idx_order_deliveries_assignee on order_deliveries(assigned_staff_id, delivery_status);
create index if not exists idx_order_deliveries_status on order_deliveries(delivery_status);

create table if not exists order_delivery_items (
  id uuid primary key default uuid_generate_v4(),
  delivery_id uuid not null references order_deliveries(id) on delete cascade,
  order_item_id uuid not null references order_items(id) on delete cascade,
  quantity_ordered int not null,
  quantity_delivered int not null default 0,
  quantity_missing int not null default 0,
  quantity_damaged int not null default 0,
  created_at timestamptz not null default now(),
  constraint order_delivery_items_unique unique (delivery_id, order_item_id),
  constraint order_delivery_items_qty_check
    check (quantity_ordered >= 0 and quantity_delivered >= 0 and quantity_missing >= 0 and quantity_damaged >= 0),
  constraint order_delivery_items_split
    check (quantity_delivered + quantity_missing + quantity_damaged = quantity_ordered)
);

create index if not exists idx_order_delivery_items_delivery on order_delivery_items(delivery_id);

-- ----------------------------------------------------------------------------
-- RLS
-- ----------------------------------------------------------------------------

alter table order_deliveries enable row level security;
alter table order_delivery_items enable row level security;

-- Shared visibility predicate: the delivery is visible to the retailer, the
-- assignee, the collecting salesman, the retailer's assigned salesman, admin+,
-- and staff whose assignment covers the order (0037 helpers).
create or replace function can_current_user_view_delivery(p_delivery_id uuid)
returns boolean
language sql stable security definer set search_path = public, pg_temp
as $$
  select p_delivery_id is not null
    and exists (
      select 1
        from order_deliveries od
        join orders o on o.id = od.order_id
       where od.id = p_delivery_id
         and (
           o.retailer_id = auth.uid()
           or od.assigned_staff_id = auth.uid()
           or o.collected_by = auth.uid()
           or is_retailer_assigned_to_current_salesman(o.retailer_id)
           or is_admin_or_above()
           or (current_user_role() = 'staff' and is_order_assigned_to_current_staff(o.id))
         )
    );
$$;

drop policy if exists "order_deliveries_read" on order_deliveries;
create policy "order_deliveries_read" on order_deliveries
  for select using (
    can_current_user_view_delivery(id)
  );

-- Insert happens at dispatch: the dispatching staff member (whose assignment
-- covers the order) or admin+; salesmen never dispatch.
drop policy if exists "order_deliveries_insert" on order_deliveries;
create policy "order_deliveries_insert" on order_deliveries
  for insert with check (
    is_admin_or_above()
    or (current_user_role() = 'staff' and is_order_assigned_to_current_staff(order_id))
  );

-- Updates: admin+, the ASSIGNED delivery staff/salesman (execution), or a
-- staff member whose assignment covers the order (dispatch-time reset,
-- assignment). Finer rules (who may change which field) live in the server
-- actions on top.
drop policy if exists "order_deliveries_update" on order_deliveries;
create policy "order_deliveries_update" on order_deliveries
  for update using (
    is_admin_or_above()
    or assigned_staff_id = auth.uid()
    or (current_user_role() = 'staff' and is_order_assigned_to_current_staff(order_id))
  )
  with check (
    is_admin_or_above()
    or assigned_staff_id = auth.uid()
    or (current_user_role() = 'staff' and is_order_assigned_to_current_staff(order_id))
  );

-- No DELETE policy: the delivery record is the permanent proof of what
-- happened; corrections are status changes, never deletions.

drop policy if exists "order_delivery_items_read" on order_delivery_items;
create policy "order_delivery_items_read" on order_delivery_items
  for select using (
    can_current_user_view_delivery(delivery_id)
  );

drop policy if exists "order_delivery_items_write" on order_delivery_items;
create policy "order_delivery_items_write" on order_delivery_items
  for insert with check (
    is_admin_or_above()
    or (current_user_role() = 'staff' and exists (
      select 1 from order_deliveries od
      where od.id = delivery_id
        and (od.assigned_staff_id = auth.uid() or is_order_assigned_to_current_staff(od.order_id))
    ))
    or (current_user_role() = 'salesman' and exists (
      select 1 from order_deliveries od
      where od.id = delivery_id and od.assigned_staff_id = auth.uid()
    ))
  );

drop policy if exists "order_delivery_items_update" on order_delivery_items;
create policy "order_delivery_items_update" on order_delivery_items
  for update using (
    is_admin_or_above()
    or exists (
      select 1 from order_deliveries od
      where od.id = delivery_id and od.assigned_staff_id = auth.uid()
    )
  );

-- Rows are replaced wholesale at re-dispatch (snapshot of the fresh pick
-- list) — allowed only for admin+ / staff whose assignment covers the order,
-- i.e. the dispatch flow itself.
drop policy if exists "order_delivery_items_delete" on order_delivery_items;
create policy "order_delivery_items_delete" on order_delivery_items
  for delete using (
    is_admin_or_above()
    or (current_user_role() = 'staff' and exists (
      select 1 from order_deliveries od
      where od.id = delivery_id and is_order_assigned_to_current_staff(od.order_id)
    ))
  );

-- ----------------------------------------------------------------------------
-- State machine: the delivery task follows the same table as
-- lib/delivery/state-machine.ts (tests assert the mirror). Same-status
-- updates are no-ops; every illegal jump is rejected by the database no
-- matter which code path attempts it. The re-dispatch reset
-- (failed -> assigned) is performed by the dispatch action only.
-- ----------------------------------------------------------------------------

create or replace function enforce_delivery_status_transitions() returns trigger as $$
begin
  if new.delivery_status is not distinct from old.delivery_status then
    return new;
  end if;

  if not (
    (old.delivery_status = 'assigned' and new.delivery_status in ('in_progress', 'delivered', 'partially_delivered', 'failed'))
    or (old.delivery_status = 'in_progress' and new.delivery_status in ('delivered', 'partially_delivered', 'failed'))
    or (old.delivery_status = 'delivered' and new.delivery_status in ('returned_to_warehouse'))
    or (old.delivery_status = 'partially_delivered' and new.delivery_status in ('returned_to_warehouse'))
    or (old.delivery_status = 'failed' and new.delivery_status in ('assigned'))
  ) then
    raise exception 'INVALID_DELIVERY_STATUS_TRANSITION: % -> %', old.delivery_status, new.delivery_status
      using errcode = 'check_violation';
  end if;

  return new;
end;
$$ language plpgsql;

drop trigger if exists trg_enforce_delivery_status_transitions on order_deliveries;
create trigger trg_enforce_delivery_status_transitions
  before update of delivery_status on order_deliveries
  for each row execute function enforce_delivery_status_transitions();

-- ----------------------------------------------------------------------------
-- Audit
-- ----------------------------------------------------------------------------

drop trigger if exists trg_audit_order_deliveries on order_deliveries;
create trigger trg_audit_order_deliveries after insert or update or delete on order_deliveries
  for each row execute function log_audit();

drop trigger if exists trg_audit_order_delivery_items on order_delivery_items;
create trigger trg_audit_order_delivery_items after insert or update or delete on order_delivery_items
  for each row execute function log_audit();

-- ============================================================================
-- END OF MIGRATION — no business data inserted.
-- ============================================================================
