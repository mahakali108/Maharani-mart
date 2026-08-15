-- ============================================================================
-- 0014: Assigned-retailer access and salesman order-capture RLS
--
-- Reuses retailers.assigned_salesman_id and orders.collected_by. No table,
-- column, enum, or existing data is added/replaced by this migration.
-- ============================================================================

-- Central assignment predicate used by all related policies. SECURITY DEFINER
-- avoids policy recursion while the result always remains scoped to auth.uid().
create or replace function is_retailer_assigned_to_current_salesman(p_retailer_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from public.retailers r
    where r.id = p_retailer_id
      and r.assigned_salesman_id = auth.uid()
  );
$$;

create or replace function is_area_assigned_to_current_salesman(p_area_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from public.retailers r
    where r.area_id = p_area_id
      and r.assigned_salesman_id = auth.uid()
  );
$$;

-- Salesmen may read the contact profile only for retailers assigned to them.
create policy "profiles_assigned_retailer_select" on profiles
  for select using (
    current_user_role() = 'salesman'
    and is_retailer_assigned_to_current_salesman(id)
  );

-- Price overrides needed to quote an assigned retailer. Explicit target checks
-- prevent a salesman from reading another salesman's retailer-level pricing.
create policy "price_lists_salesman_assigned_read" on price_lists
  for select using (
    current_user_role() = 'salesman'
    and (
      scope in ('base', 'scheme', 'festival')
      or (scope = 'retailer' and is_retailer_assigned_to_current_salesman(retailer_id))
      or (scope = 'area' and is_area_assigned_to_current_salesman(area_id))
    )
  );

-- Replace the broad salesman INSERT condition from 0001. A salesman must both
-- be assigned to the retailer and identify themselves in collected_by.
drop policy if exists "orders_insert" on orders;
create policy "orders_insert" on orders
  for insert with check (
    (current_user_role() = 'retailer' and retailer_id = auth.uid() and collected_by is null)
    or is_staff_or_above()
    or (
      current_user_role() = 'salesman'
      and collected_by = auth.uid()
      and is_retailer_assigned_to_current_salesman(retailer_id)
    )
  );

-- Assigned-retailer orders and personally collected orders make up a
-- salesman's authorized "My Orders" set.
drop policy if exists "orders_select" on orders;
create policy "orders_select" on orders
  for select using (
    retailer_id = auth.uid()
    or collected_by = auth.uid()
    or is_retailer_assigned_to_current_salesman(retailer_id)
    or is_staff_or_above()
  );

-- New order line insertion was missing from the original schema. It is scoped
-- through the already-authorized parent order, so direct arbitrary inserts are
-- still denied. Existing SELECT behavior is expanded to assigned orders.
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
          or is_staff_or_above()
        )
    )
  );

create policy "order_items_authorized_insert" on order_items
  for insert with check (
    exists (
      select 1 from orders o
      where o.id = order_id
        and o.status = 'pending'
        and (
          (o.retailer_id = auth.uid() and o.collected_by is null)
          or o.collected_by = auth.uid()
          or is_staff_or_above()
        )
    )
  );

-- Assigned salesmen can read the status timeline of the same authorized order.
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
        )
    )
    or is_staff_or_above()
  );

-- Notification helpers use the caller's RLS-scoped client. These policies let
-- self-checkout notify the retailer and let a salesman notify only an assigned
-- retailer (including delivery updates), never an arbitrary profile.
create policy "notifications_authorized_insert" on notifications
  for insert with check (
    recipient_id = auth.uid()
    or is_staff_or_above()
    or (
      current_user_role() = 'salesman'
      and is_retailer_assigned_to_current_salesman(recipient_id)
    )
  );

create policy "notification_logs_salesman_assigned_insert" on notification_logs
  for insert with check (
    current_user_role() = 'salesman'
    and is_retailer_assigned_to_current_salesman(recipient_id)
  );

-- A direct PostgREST call must not be able to log a visit against an
-- unassigned retailer merely by setting salesman_id to auth.uid().
drop policy if exists "visits_owner_or_staff" on visits;
create policy "visits_owner_or_staff_read" on visits
  for select using (salesman_id = auth.uid() or is_staff_or_above());
create policy "visits_assigned_salesman_insert" on visits
  for insert with check (
    is_staff_or_above()
    or (
      current_user_role() = 'salesman'
      and salesman_id = auth.uid()
      and is_retailer_assigned_to_current_salesman(retailer_id)
    )
  );
create policy "visits_assigned_salesman_update" on visits
  for update
  using (
    is_staff_or_above()
    or (
      current_user_role() = 'salesman'
      and salesman_id = auth.uid()
      and is_retailer_assigned_to_current_salesman(retailer_id)
    )
  )
  with check (
    is_staff_or_above()
    or (
      current_user_role() = 'salesman'
      and salesman_id = auth.uid()
      and is_retailer_assigned_to_current_salesman(retailer_id)
    )
  );

-- ============================================================================
-- END OF MIGRATION — no existing business data modified.
-- ============================================================================
