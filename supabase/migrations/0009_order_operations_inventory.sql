-- ============================================================================
-- 0009: Order operations (dispatch/cancel/assign) + stock reservation +
--       return requests
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. orders: dispatch tracking + cancellation reason
-- ----------------------------------------------------------------------------
alter table orders
  add column cancelled_reason text,
  add column dispatched_by uuid references profiles(id),
  add column dispatched_at timestamptz,
  add column delivered_at timestamptz;

-- ----------------------------------------------------------------------------
-- 2. inventory_stock: reservation (confirmed-but-not-yet-dispatched demand)
-- ----------------------------------------------------------------------------
alter table inventory_stock
  add column reserved_quantity int not null default 0 check (reserved_quantity >= 0);

comment on column inventory_stock.reserved_quantity is 'Quantity committed to confirmed/packed orders not yet dispatched. Available-to-sell = quantity - reserved_quantity.';

-- ----------------------------------------------------------------------------
-- 3. Return requests — retailer-initiated, staff/admin-resolved
-- ----------------------------------------------------------------------------
create type return_status as enum ('requested', 'approved', 'rejected', 'completed');

create table return_requests (
  id uuid primary key default uuid_generate_v4(),
  order_id uuid not null references orders(id),
  order_item_id uuid references order_items(id),
  retailer_id uuid not null references retailers(id),
  reason text not null,
  status return_status not null default 'requested',
  requested_at timestamptz not null default now(),
  resolved_by uuid references profiles(id),
  resolved_at timestamptz,
  resolution_note text
);

create index idx_return_requests_order on return_requests(order_id);
create index idx_return_requests_retailer on return_requests(retailer_id);

alter table return_requests enable row level security;

create policy "return_requests_retailer_select" on return_requests
  for select using (retailer_id = auth.uid() or is_staff_or_above());

create policy "return_requests_retailer_insert" on return_requests
  for insert with check (
    retailer_id = auth.uid()
    and exists (select 1 from orders o where o.id = order_id and o.retailer_id = auth.uid() and o.status = 'delivered')
  );

create policy "return_requests_staff_update" on return_requests
  for update using (is_staff_or_above());

create trigger trg_audit_return_requests after insert or update or delete on return_requests
  for each row execute function log_audit();

-- ----------------------------------------------------------------------------
-- 4. orders RLS: allow a retailer to cancel their OWN pending order
-- ----------------------------------------------------------------------------
create policy "orders_retailer_cancel" on orders
  for update
  using (retailer_id = auth.uid() and status = 'pending')
  with check (retailer_id = auth.uid() and status = 'cancelled');

-- ----------------------------------------------------------------------------
-- 5. orders RLS: allow a salesman to update status on orders belonging
--    to their assigned retailers (delivery status updates)
-- ----------------------------------------------------------------------------
create policy "orders_salesman_update" on orders
  for update
  using (
    current_user_role() = 'salesman'
    and (
      collected_by = auth.uid()
      or retailer_id in (select id from retailers where assigned_salesman_id = auth.uid())
    )
  );

-- ============================================================================
-- END OF MIGRATION — no business data inserted.
-- ============================================================================
