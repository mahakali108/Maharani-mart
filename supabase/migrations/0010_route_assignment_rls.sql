-- ============================================================================
-- 0010: Route assignment write policies
--
-- routes had SELECT + INSERT policies from 0001_init.sql but no
-- UPDATE/DELETE policy, and route_customers had only SELECT — meaning
-- staff/admin could create a route but could never edit it, deactivate
-- it, or actually assign retailers to it (route_customers had zero
-- write policies at all). This closes that gap; Phase 3's Route
-- Assignment UI depends on it.
-- ============================================================================

create policy "routes_staff_update" on routes
  for update using (is_staff_or_above());

create policy "routes_staff_delete" on routes
  for delete using (is_admin_or_above());

create policy "route_customers_staff_write" on route_customers
  for insert with check (is_staff_or_above());

create policy "route_customers_staff_update" on route_customers
  for update using (is_staff_or_above());

create policy "route_customers_staff_delete" on route_customers
  for delete using (is_staff_or_above());

-- Salesman "Route Planning" (reordering their own day's visit sequence)
-- is a distinct, narrower capability from Admin/Staff "Route Assignment"
-- (creating routes, assigning which retailers belong to them, above).
create policy "route_customers_salesman_reorder" on route_customers
  for update using (
    exists (select 1 from routes r where r.id = route_id and r.salesman_id = auth.uid())
  );

-- ============================================================================
-- END OF MIGRATION — no business data inserted.
-- ============================================================================
