-- ============================================================================
-- 0037: Staff assignment scoping (Phase 2, confirmed decision D1)
--
-- WHY
-- ---
-- `staff_assignments` (0001, RLS in 0013) records each staff member's area
-- and/or warehouse, but no read path ever enforced it: every operational
-- policy used `is_staff_or_above()`, giving ANY staff member network-wide
-- visibility of orders, retailers, inventory and returns.
--
-- This migration replaces the staff branch of those policies with
-- assignment-scoped predicates:
--   * orders / order_items / order_status_history / return_requests:
--       the order's warehouse OR the order retailer's area is assigned
--   * retailers / profiles (retailer rows) / visits / notifications insert:
--       the retailer's area is assigned
--   * inventory_stock / stock_movements / inventory_batches / grns /
--     grn_items / stock_transfers (+items) / order_stock_allocations:
--       the warehouse is assigned
--   * routes / route_customers: the route's area is assigned
--
-- A staff member with NO staff_assignments row sees nothing (confirmed).
-- Admin/super_admin keep full access via `is_admin_or_above()`; every
-- retailer and salesman branch from 0001/0008/0009/0014 is preserved
-- verbatim.
--
-- Hardening bonus (additive): `areas` and `warehouses` shipped without RLS
-- in 0001 — any anon key could list them. They now require an authenticated
-- session to read and admin+ to write.
--
-- SAFETY
-- ------
-- * Additive & re-runnable: policies are drop-if-exists + create (the
--   pattern used by 0013/0014); helper functions are CREATE OR REPLACE.
--   No table, column, enum or data is modified or removed.
-- * Helper functions are SECURITY DEFINER + STABLE with a pinned
--   search_path (the 0014 pattern) so policies cannot recurse and callers
--   cannot influence resolution. They only ever answer "is this id assigned
--   to the current user" — never exposing another user's assignments.
-- * Deliberate exceptions (documented, unchanged):
--     - `products`/`brands`/`categories`/`price_lists` stay readable to
--       staff — the shared catalog is not area-scoped and staff need it to
--       pick, pack and create orders.
--     - `attendance` stays owner-or-staff+ — HR data, and the only page
--       that lists it is admin-only.
--     - `audit_logs` stays admin-only (unchanged since 0013).
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Assignment helpers (SECURITY DEFINER, STABLE, pinned search_path)
-- ----------------------------------------------------------------------------

create or replace function is_area_assigned_to_current_staff(p_area_id uuid)
returns boolean
language sql stable security definer set search_path = public, pg_temp
as $$
  select p_area_id is not null
    and exists (
      select 1 from staff_assignments sa
      where sa.staff_id = auth.uid()
        and sa.area_id = p_area_id
    );
$$;

create or replace function is_warehouse_assigned_to_current_staff(p_warehouse_id uuid)
returns boolean
language sql stable security definer set search_path = public, pg_temp
as $$
  select p_warehouse_id is not null
    and exists (
      select 1 from staff_assignments sa
      where sa.staff_id = auth.uid()
        and sa.warehouse_id = p_warehouse_id
    );
$$;

-- The retailer sits in an area assigned to the current staff member.
create or replace function is_retailer_area_assigned_to_current_staff(p_retailer_id uuid)
returns boolean
language sql stable security definer set search_path = public, pg_temp
as $$
  select p_retailer_id is not null
    and exists (
      select 1
        from retailers r
        join staff_assignments sa on sa.area_id = r.area_id
       where r.id = p_retailer_id
         and sa.staff_id = auth.uid()
    );
$$;

-- The order is warehouse-assigned OR its retailer sits in an assigned area.
create or replace function is_order_assigned_to_current_staff(p_order_id uuid)
returns boolean
language sql stable security definer set search_path = public, pg_temp
as $$
  select p_order_id is not null
    and exists (
      select 1
        from orders o
        left join staff_assignments wh on wh.warehouse_id = o.warehouse_id
                                       and wh.staff_id = auth.uid()
       where o.id = p_order_id
         and (
           wh.staff_id is not null
           or is_retailer_area_assigned_to_current_staff(o.retailer_id)
         )
    );
$$;

-- The GRN belongs to a warehouse assigned to the current staff member.
create or replace function is_grn_warehouse_assigned_to_current_staff(p_grn_id uuid)
returns boolean
language sql stable security definer set search_path = public, pg_temp
as $$
  select p_grn_id is not null
    and exists (
      select 1
        from grns g
        join staff_assignments sa on sa.warehouse_id = g.warehouse_id
       where g.id = p_grn_id
         and sa.staff_id = auth.uid()
    );
$$;

-- The transfer touches (source or destination) a warehouse assigned to the
-- current staff member.
create or replace function is_transfer_warehouse_assigned_to_current_staff(p_transfer_id uuid)
returns boolean
language sql stable security definer set search_path = public, pg_temp
as $$
  select p_transfer_id is not null
    and exists (
      select 1
        from stock_transfers t
       where t.id = p_transfer_id
         and (
           is_warehouse_assigned_to_current_staff(t.from_warehouse_id)
           or is_warehouse_assigned_to_current_staff(t.to_warehouse_id)
         )
    );
$$;

-- Profiles: staff may read fellow staff/salesman/admin profiles (needed for
-- team context) and ONLY the profiles of retailers in their assigned areas.
-- SECURITY DEFINER avoids the self-referential profiles policy recursion.
create or replace function can_current_staff_read_profile(p_profile_id uuid)
returns boolean
language sql stable security definer set search_path = public, pg_temp
as $$
  select p_profile_id is not null
    and exists (
      select 1 from profiles p
       where p.id = p_profile_id
         and (
           p.role in ('super_admin', 'admin', 'staff', 'salesman')
           or is_retailer_area_assigned_to_current_staff(p.id)
         )
    );
$$;

-- ----------------------------------------------------------------------------
-- 2. orders / order_items / order_status_history — staff scoped to
--    assigned warehouse or assigned retailer area
-- ----------------------------------------------------------------------------

drop policy if exists "orders_select" on orders;
create policy "orders_select" on orders
  for select using (
    retailer_id = auth.uid()
    or collected_by = auth.uid()
    or is_retailer_assigned_to_current_salesman(retailer_id)
    or is_admin_or_above()
    or (
      current_user_role() = 'staff'
      and (
        is_warehouse_assigned_to_current_staff(warehouse_id)
        or is_retailer_area_assigned_to_current_staff(retailer_id)
      )
    )
  );

drop policy if exists "orders_insert" on orders;
create policy "orders_insert" on orders
  for insert with check (
    (current_user_role() = 'retailer' and retailer_id = auth.uid() and collected_by is null)
    or is_admin_or_above()
    or (
      current_user_role() = 'staff'
      and is_retailer_area_assigned_to_current_staff(retailer_id)
    )
    or (
      current_user_role() = 'salesman'
      and collected_by = auth.uid()
      and is_retailer_assigned_to_current_salesman(retailer_id)
    )
  );

drop policy if exists "orders_update_staff" on orders;
create policy "orders_update_staff" on orders
  for update using (
    is_admin_or_above()
    or (
      current_user_role() = 'staff'
      and (
        is_warehouse_assigned_to_current_staff(warehouse_id)
        or is_retailer_area_assigned_to_current_staff(retailer_id)
      )
    )
  );

drop policy if exists "order_items_select" on order_items;
create policy "order_items_select" on order_items
  for select using (
    exists (
      select 1 from orders o
      where o.id = order_id
        and (
          o.retailer_id = auth.uid()
          or o.collected_by = auth.uid()
          or is_retailer_assigned_to_current_salesman(o.retailer_id)
          or is_admin_or_above()
          or (current_user_role() = 'staff' and is_order_assigned_to_current_staff(o.id))
        )
    )
  );

drop policy if exists "order_items_authorized_insert" on order_items;
create policy "order_items_authorized_insert" on order_items
  for insert with check (
    exists (
      select 1 from orders o
      where o.id = order_id
        and o.status = 'pending'
        and (
          (o.retailer_id = auth.uid() and o.collected_by is null)
          or o.collected_by = auth.uid()
          or is_admin_or_above()
          or (current_user_role() = 'staff' and is_order_assigned_to_current_staff(o.id))
        )
    )
  );

drop policy if exists "order_status_history_retailer_read" on order_status_history;
create policy "order_status_history_retailer_read" on order_status_history
  for select using (
    exists (
      select 1 from orders o
      where o.id = order_id
        and (
          o.retailer_id = auth.uid()
          or o.collected_by = auth.uid()
          or is_retailer_assigned_to_current_salesman(o.retailer_id)
          or is_admin_or_above()
          or (current_user_role() = 'staff' and is_order_assigned_to_current_staff(o.id))
        )
    )
  );

drop policy if exists "order_status_history_staff_write" on order_status_history;
create policy "order_status_history_staff_write" on order_status_history
  for insert with check (
    is_admin_or_above()
    or (current_user_role() = 'staff' and is_order_assigned_to_current_staff(order_id))
  );

-- ----------------------------------------------------------------------------
-- 3. retailers / profiles — staff scoped to assigned areas
-- ----------------------------------------------------------------------------

drop policy if exists "retailers_select" on retailers;
create policy "retailers_select" on retailers
  for select using (
    id = auth.uid()
    or is_admin_or_above()
    or assigned_salesman_id = auth.uid()
    or (current_user_role() = 'staff' and is_retailer_area_assigned_to_current_staff(id))
  );

drop policy if exists "profiles_self_select" on profiles;
create policy "profiles_self_select" on profiles
  for select using (
    id = auth.uid()
    or is_admin_or_above()
    or (current_user_role() = 'staff' and can_current_staff_read_profile(id))
  );

-- ----------------------------------------------------------------------------
-- 4. inventory — staff scoped to assigned warehouses
-- ----------------------------------------------------------------------------

drop policy if exists "inventory_staff" on inventory_stock;
create policy "inventory_staff" on inventory_stock
  for select using (
    is_admin_or_above()
    or (current_user_role() = 'staff' and is_warehouse_assigned_to_current_staff(warehouse_id))
  );

drop policy if exists "inventory_staff_insert" on inventory_stock;
create policy "inventory_staff_insert" on inventory_stock
  for insert with check (
    is_admin_or_above()
    or (current_user_role() = 'staff' and is_warehouse_assigned_to_current_staff(warehouse_id))
  );

drop policy if exists "inventory_staff_update" on inventory_stock;
create policy "inventory_staff_update" on inventory_stock
  for update using (
    is_admin_or_above()
    or (current_user_role() = 'staff' and is_warehouse_assigned_to_current_staff(warehouse_id))
  );

drop policy if exists "stock_movements_staff_read" on stock_movements;
create policy "stock_movements_staff_read" on stock_movements
  for select using (
    is_admin_or_above()
    or (current_user_role() = 'staff' and is_warehouse_assigned_to_current_staff(warehouse_id))
  );

drop policy if exists "stock_movements_staff_write" on stock_movements;
create policy "stock_movements_staff_write" on stock_movements
  for insert with check (
    is_admin_or_above()
    or (current_user_role() = 'staff' and is_warehouse_assigned_to_current_staff(warehouse_id))
  );

drop policy if exists "inventory_batches_staff_read" on inventory_batches;
create policy "inventory_batches_staff_read" on inventory_batches
  for select using (
    is_admin_or_above()
    or (current_user_role() = 'staff' and is_warehouse_assigned_to_current_staff(warehouse_id))
  );

drop policy if exists "inventory_batches_staff_insert" on inventory_batches;
create policy "inventory_batches_staff_insert" on inventory_batches
  for insert with check (
    is_admin_or_above()
    or (current_user_role() = 'staff' and is_warehouse_assigned_to_current_staff(warehouse_id))
  );

drop policy if exists "inventory_batches_staff_update" on inventory_batches;
create policy "inventory_batches_staff_update" on inventory_batches
  for update using (
    is_admin_or_above()
    or (current_user_role() = 'staff' and is_warehouse_assigned_to_current_staff(warehouse_id))
  );

drop policy if exists "grns_staff_read" on grns;
create policy "grns_staff_read" on grns
  for select using (
    is_admin_or_above()
    or (current_user_role() = 'staff' and is_grn_warehouse_assigned_to_current_staff(id))
  );

drop policy if exists "grns_staff_insert" on grns;
create policy "grns_staff_insert" on grns
  for insert with check (
    is_admin_or_above()
    or (current_user_role() = 'staff' and is_warehouse_assigned_to_current_staff(warehouse_id))
  );

drop policy if exists "grns_staff_update" on grns;
create policy "grns_staff_update" on grns
  for update using (
    is_admin_or_above()
    or (current_user_role() = 'staff' and is_grn_warehouse_assigned_to_current_staff(id))
  );

drop policy if exists "grn_items_staff_read" on grn_items;
create policy "grn_items_staff_read" on grn_items
  for select using (
    is_admin_or_above()
    or (current_user_role() = 'staff' and is_grn_warehouse_assigned_to_current_staff(grn_id))
  );

drop policy if exists "grn_items_staff_insert" on grn_items;
create policy "grn_items_staff_insert" on grn_items
  for insert with check (
    is_admin_or_above()
    or (current_user_role() = 'staff' and is_grn_warehouse_assigned_to_current_staff(grn_id))
  );

drop policy if exists "grn_items_staff_update" on grn_items;
create policy "grn_items_staff_update" on grn_items
  for update using (
    is_admin_or_above()
    or (current_user_role() = 'staff' and is_grn_warehouse_assigned_to_current_staff(grn_id))
  );

drop policy if exists "grn_items_staff_delete" on grn_items;
create policy "grn_items_staff_delete" on grn_items
  for delete using (
    is_admin_or_above()
    or (current_user_role() = 'staff' and is_grn_warehouse_assigned_to_current_staff(grn_id))
  );

drop policy if exists "osa_staff_read" on order_stock_allocations;
create policy "osa_staff_read" on order_stock_allocations
  for select using (
    is_admin_or_above()
    or (
      current_user_role() = 'staff'
      and exists (
        select 1 from order_items oi
        where oi.id = order_item_id
          and is_order_assigned_to_current_staff(oi.order_id)
      )
    )
  );

drop policy if exists "stock_transfers_staff_read" on stock_transfers;
create policy "stock_transfers_staff_read" on stock_transfers
  for select using (
    is_admin_or_above()
    or (current_user_role() = 'staff' and is_transfer_warehouse_assigned_to_current_staff(id))
  );

drop policy if exists "stock_transfers_staff_insert" on stock_transfers;
create policy "stock_transfers_staff_insert" on stock_transfers
  for insert with check (
    is_admin_or_above()
    or (
      current_user_role() = 'staff'
      and (
        is_warehouse_assigned_to_current_staff(from_warehouse_id)
        or is_warehouse_assigned_to_current_staff(to_warehouse_id)
      )
    )
  );

drop policy if exists "stock_transfers_staff_update" on stock_transfers;
create policy "stock_transfers_staff_update" on stock_transfers
  for update using (
    is_admin_or_above()
    or (current_user_role() = 'staff' and is_transfer_warehouse_assigned_to_current_staff(id))
  );

drop policy if exists "stock_transfer_items_staff_read" on stock_transfer_items;
create policy "stock_transfer_items_staff_read" on stock_transfer_items
  for select using (
    is_admin_or_above()
    or (current_user_role() = 'staff' and is_transfer_warehouse_assigned_to_current_staff(transfer_id))
  );

drop policy if exists "stock_transfer_items_staff_insert" on stock_transfer_items;
create policy "stock_transfer_items_staff_insert" on stock_transfer_items
  for insert with check (
    is_admin_or_above()
    or (current_user_role() = 'staff' and is_transfer_warehouse_assigned_to_current_staff(transfer_id))
  );

drop policy if exists "stock_transfer_items_staff_delete" on stock_transfer_items;
create policy "stock_transfer_items_staff_delete" on stock_transfer_items
  for delete using (
    is_admin_or_above()
    or (current_user_role() = 'staff' and is_transfer_warehouse_assigned_to_current_staff(transfer_id))
  );

-- ----------------------------------------------------------------------------
-- 5. returns / visits / notifications / routes — staff scoped
-- ----------------------------------------------------------------------------

drop policy if exists "return_requests_retailer_select" on return_requests;
create policy "return_requests_retailer_select" on return_requests
  for select using (
    retailer_id = auth.uid()
    or is_admin_or_above()
    or (current_user_role() = 'staff' and is_order_assigned_to_current_staff(order_id))
  );

drop policy if exists "return_requests_staff_update" on return_requests;
create policy "return_requests_staff_update" on return_requests
  for update using (
    is_admin_or_above()
    or (current_user_role() = 'staff' and is_order_assigned_to_current_staff(order_id))
  );

drop policy if exists "visits_owner_or_staff" on visits;
create policy "visits_owner_or_staff" on visits
  for all using (
    salesman_id = auth.uid()
    or is_admin_or_above()
    or (current_user_role() = 'staff' and is_retailer_area_assigned_to_current_staff(retailer_id))
  );

drop policy if exists "notifications_authorized_insert" on notifications;
create policy "notifications_authorized_insert" on notifications
  for insert with check (
    recipient_id = auth.uid()
    or is_admin_or_above()
    or (
      current_user_role() = 'staff'
      and is_retailer_area_assigned_to_current_staff(recipient_id)
    )
    or (
      current_user_role() = 'salesman'
      and is_retailer_assigned_to_current_salesman(recipient_id)
    )
  );

drop policy if exists "routes_owner_or_staff" on routes;
create policy "routes_owner_or_staff" on routes
  for select using (
    salesman_id = auth.uid()
    or is_admin_or_above()
    or (current_user_role() = 'staff' and is_area_assigned_to_current_staff(area_id))
  );

drop policy if exists "routes_staff_write" on routes;
create policy "routes_staff_write" on routes
  for insert with check (is_admin_or_above());

drop policy if exists "routes_staff_update" on routes;
create policy "routes_staff_update" on routes
  for update using (
    is_admin_or_above()
    or (current_user_role() = 'staff' and is_area_assigned_to_current_staff(area_id))
  );

drop policy if exists "route_customers_staff_write" on route_customers;
create policy "route_customers_staff_write" on route_customers
  for insert with check (
    is_admin_or_above()
    or (
      current_user_role() = 'staff'
      and exists (
        select 1 from routes r
        where r.id = route_id
          and is_area_assigned_to_current_staff(r.area_id)
      )
    )
  );

drop policy if exists "route_customers_staff_update" on route_customers;
create policy "route_customers_staff_update" on route_customers
  for update using (
    is_admin_or_above()
    or (
      current_user_role() = 'staff'
      and exists (
        select 1 from routes r
        where r.id = route_id
          and is_area_assigned_to_current_staff(r.area_id)
      )
    )
  );

drop policy if exists "route_customers_staff_delete" on route_customers;
create policy "route_customers_staff_delete" on route_customers
  for delete using (
    is_admin_or_above()
    or (
      current_user_role() = 'staff'
      and exists (
        select 1 from routes r
        where r.id = route_id
          and is_area_assigned_to_current_staff(r.area_id)
      )
    )
  );

-- ----------------------------------------------------------------------------
-- 6. areas / warehouses — enable RLS (they shipped without it in 0001)
--    Authenticated read (retailers need area names for the catalog and
--    banners; staff need warehouse names); admin+ write.
-- ----------------------------------------------------------------------------

alter table areas enable row level security;

drop policy if exists "areas_authenticated_read" on areas;
create policy "areas_authenticated_read" on areas
  for select using (auth.uid() is not null);

drop policy if exists "areas_admin_write" on areas;
create policy "areas_admin_write" on areas
  for insert with check (is_admin_or_above());

drop policy if exists "areas_admin_update" on areas;
create policy "areas_admin_update" on areas
  for update using (is_admin_or_above());

drop policy if exists "areas_admin_delete" on areas;
create policy "areas_admin_delete" on areas
  for delete using (is_admin_or_above());

alter table warehouses enable row level security;

drop policy if exists "warehouses_authenticated_read" on warehouses;
create policy "warehouses_authenticated_read" on warehouses
  for select using (auth.uid() is not null);

drop policy if exists "warehouses_admin_write" on warehouses;
create policy "warehouses_admin_write" on warehouses
  for insert with check (is_admin_or_above());

drop policy if exists "warehouses_admin_update" on warehouses;
create policy "warehouses_admin_update" on warehouses
  for update using (is_admin_or_above());

drop policy if exists "warehouses_admin_delete" on warehouses;
create policy "warehouses_admin_delete" on warehouses
  for delete using (is_admin_or_above());

-- ============================================================================
-- END OF MIGRATION — no business data inserted, nothing destructively changed.
-- ============================================================================
