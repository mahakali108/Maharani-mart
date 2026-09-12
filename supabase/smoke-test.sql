-- ============================================================================
-- supabase/smoke-test.sql — Phase 4 live smoke test
-- (RLS role matrix · delivery/order transition triggers · private buckets ·
--  audit trail)
--
-- HOW TO RUN (against the real project):
--
--   psql "$DATABASE_URL" -f supabase/smoke-test.sql
--
--   $DATABASE_URL = the project's direct Postgres connection string
--   (Supabase dashboard → Project Settings → Database → Connection string).
--
-- REQUIREMENTS
--   * migrations 0037–0045 applied (see docs/PRODUCTION_VERIFICATION_CHECKLIST.md §1)
--   * run as the `postgres` role (the direct connection string role) so the
--     fixture can be created; RLS is then exercised by impersonating real
--     user roles with `set local role authenticated` + `set_config(...)` JWT
--     claims. (`SET x = <expression>` is NOT valid PostgreSQL — impersonation
--     must go through set_config, which this script does.)
--
-- SUPABASE SQL EDITOR: this script is editor-safe (no psql \echo
-- meta-commands, no client-side features). Paste and run as-is.
--
-- WHAT IT DOES
--   * Everything runs inside ONE transaction and ends with ROLLBACK —
--     no fixture data is kept. Personas are REAL profiles already in the
--     database; the only touched rows (one retailer's salesman assignment,
--     two throwaway orders) are undone by the rollback.
--   * Prints `PASS:` / `SKIP:` notices. Any `SMOKE FAIL` aborts the script
--     (the transaction is still rolled back by psql on exit).
--
-- NOTE: expected-error subtests deliberately raise Postgres errors that are
-- caught inside DO blocks; psql may print them as ERROR lines mid-run —
-- that is fine as long as each block ends with a `PASS:` notice.
-- ============================================================================

DO $$ BEGIN RAISE NOTICE '== Phase 4 smoke test (everything rolls back at the end) =='; END $$;

BEGIN;

-- ----------------------------------------------------------------------------
-- §0 Personas + fixture (created as the table owner, RLS-bypassed)
-- ----------------------------------------------------------------------------
create temp table smoke_personas as
select
  (select p.id from profiles p
    where p.role in ('admin','super_admin') and p.is_active
    order by p.id limit 1) as admin_id,
  (select p.id from profiles p
    where p.role = 'staff' and p.is_active
    order by p.id limit 1) as staff_assignee_id,
  (select p.id from profiles p
    where p.role = 'staff' and p.is_active
      and p.id <> (select p2.id from profiles p2
                    where p2.role = 'staff' and p2.is_active
                    order by p2.id limit 1)
      and not exists (select 1 from staff_assignments sa where sa.staff_id = p.id)
    order by p.id limit 1) as staff_outsider_id,
  (select p.id from profiles p
    where p.role = 'salesman' and p.is_active
    order by p.id limit 1) as salesman_id,
  (select r.id from retailers r
    join profiles p on p.id = r.id and p.is_active
    order by r.id limit 1) as retailer_id,
  (select r2.id from retailers r2
    where r2.id <> (select r.id from retailers r order by r.id limit 1)
    order by r2.id limit 1) as retailer_outsider_id,
  (select w.id from warehouses w where w.is_active order by w.id limit 1) as warehouse_id,
  (select pr.id from products pr where pr.is_active order by pr.id limit 1) as product_id;

DO $$
DECLARE
  v_admin uuid; v_staff uuid; v_salesman uuid; v_retailer uuid; v_product uuid;
BEGIN
  select admin_id, staff_assignee_id, salesman_id, retailer_id, product_id
    into v_admin, v_staff, v_salesman, v_retailer, v_product
    from smoke_personas;

  if v_admin is null then      raise exception 'SMOKE ABORT: no active admin/super_admin profile — create real team members first (no seed data).'; end if;
  if v_staff is null then      raise exception 'SMOKE ABORT: no active staff profile.'; end if;
  if v_salesman is null then   raise exception 'SMOKE ABORT: no active salesman profile.'; end if;
  if v_retailer is null then   raise exception 'SMOKE ABORT: no active retailer.'; end if;
  if v_product is null then    raise exception 'SMOKE ABORT: no active product.'; end if;

  raise notice 'PASS: §0 personas resolved (admin=%, staff=%, salesman=%, retailer=%)',
    v_admin, v_staff, v_salesman, v_retailer;
END $$;

DO $$ BEGIN RAISE NOTICE '-- §0 fixture: two throwaway orders + one delivery task (rolled back)'; END $$;

update retailers
   set assigned_salesman_id = (select salesman_id from smoke_personas)
 where id = (select retailer_id from smoke_personas);

insert into orders (order_number, retailer_id, warehouse_id, status, subtotal, gst_total, discount_total, grand_total)
values ('SMOKE-DELIVERY-' || right(gen_random_uuid()::text, 8),
        (select retailer_id from smoke_personas),
        (select warehouse_id from smoke_personas),
        'dispatched', 100, 0, 0, 100);

create temp table smoke_orders as
select id, order_number from orders where order_number like 'SMOKE-DELIVERY-%';

insert into order_items (order_id, product_id, quantity, unit_price, gst_percent, line_total, quantity_unit)
select o.id, (select product_id from smoke_personas), 10, 10.00, 0, 100.00, 'pieces'
  from smoke_orders o;
-- A second line on the same order, intentionally left OUT of the delivery
-- snapshot: the §E split-invariant test attaches THIS line (so the unique
-- (delivery_id, order_item_id) constraint is not what rejects the insert).
insert into order_items (order_id, product_id, quantity, unit_price, gst_percent, line_total, quantity_unit)
select o.id, (select product_id from smoke_personas), 4, 5.00, 0, 20.00, 'pieces'
  from smoke_orders o;

insert into order_deliveries (order_id, delivery_status, assigned_staff_id, assigned_at, assigned_by,
                              dispatched_at, otp_hash)
select o.id, 'assigned',
       (select staff_assignee_id from smoke_personas), now(),
       (select admin_id from smoke_personas), now(),
       md5(o.id::text || ':000000')
  from smoke_orders o;

-- Snapshot ONLY the qty=10 line (pending zeros for delivered/missing/damaged,
-- allowed by the 0043 split constraint). The qty=4 line stays unsnapshotted so
-- the §E split test below exercises the CHECK, not the unique constraint.
insert into order_delivery_items (delivery_id, order_item_id, quantity_ordered)
select d.id, oi.id, oi.quantity
  from order_deliveries d
  join order_items oi on oi.order_id = d.order_id
 where d.order_id in (select id from smoke_orders)
   and oi.quantity = 10;

insert into payment_collections (retailer_id, collected_by, amount_paise, method, status)
values ((select retailer_id from smoke_personas),
        (select salesman_id from smoke_personas), 5000, 'cash', 'pending');

grant select on smoke_personas, smoke_orders to authenticated;

-- A second throwaway order purely for order-status transition tests.
insert into orders (order_number, retailer_id, warehouse_id, status, subtotal, gst_total, discount_total, grand_total)
values ('SMOKE-TRANSITION-' || right(gen_random_uuid()::text, 8),
        (select retailer_id from smoke_personas),
        (select warehouse_id from smoke_personas),
        'pending', 50, 0, 0, 50);

create temp table smoke_transition_order as
select id from orders where order_number like 'SMOKE-TRANSITION-%';

-- RLS-blocked UPDATEs fail SILENTLY (0 rows), they do not raise — so the
-- negative UPDATE checks below compare row state before/after instead of
-- watching for exceptions. INSERT violations DO raise (with check).

-- ----------------------------------------------------------------------------
-- Helper: impersonate a real user under RLS
-- ----------------------------------------------------------------------------

-- ----------------------------------------------------------------------------
-- §A ADMIN — full visibility, can manage collections
-- ----------------------------------------------------------------------------
set local role authenticated;
select set_config('request.jwt.claims', format('{"sub":"%s","role":"authenticated"}',
  (select admin_id::text from smoke_personas))), true);

DO $$
BEGIN
  if not exists (select 1 from order_deliveries d
                  join smoke_orders so on so.id = d.order_id) then
    raise exception 'SMOKE FAIL: admin cannot see the delivery task';
  end if;
  if not exists (select 1 from payment_collections pc
                  where pc.retailer_id = (select retailer_id from smoke_personas)
                    and pc.status = 'pending') then
    raise exception 'SMOKE FAIL: admin cannot see the pending collection';
  end if;
  raise notice 'PASS: §A admin sees deliveries + collections';
END $$;

-- Admin CAN update the collection (verification path is admin-gated).
-- RLS blocks silently, so a positive test must prove the row CHANGED.
DO $$
DECLARE v_changed boolean := false;
BEGIN
  update payment_collections set notes = 'smoke-admin-touch'
   where retailer_id = (select retailer_id from smoke_personas)
     and status = 'pending';
  select exists (select 1 from payment_collections where notes = 'smoke-admin-touch') into v_changed;
  if not v_changed then raise exception 'SMOKE FAIL: admin update of payment_collections did not land (RLS blocked it)'; end if;
  raise notice 'PASS: §A admin can update payment_collections (verify/reject path)';
END $$;

-- ----------------------------------------------------------------------------
-- §B STAFF — assignee yes, out-of-scope staff no
-- ----------------------------------------------------------------------------
set local role authenticated;
select set_config('request.jwt.claims', format('{"sub":"%s","role":"authenticated"}',
  (select staff_assignee_id::text from smoke_personas))), true);

DO $$
BEGIN
  if not exists (select 1 from order_deliveries d
                  join smoke_orders so on so.id = d.order_id
                 where d.assigned_staff_id = auth.uid()) then
    raise exception 'SMOKE FAIL: assigned staff cannot see the delivery task';
  end if;
  raise notice 'PASS: §B assignee staff sees the task';
END $$;

DO $$
DECLARE v_changed boolean := false;
BEGIN
  update order_deliveries set delivery_notes = 'smoke-assignee-touch'
   where order_id in (select id from smoke_orders)
     and assigned_staff_id = auth.uid();
  select exists (select 1 from order_deliveries where delivery_notes = 'smoke-assignee-touch')
    into v_changed;
  if not v_changed then raise exception 'SMOKE FAIL: assignee update of the delivery did not land (RLS blocked it)'; end if;
  raise notice 'PASS: §B assignee can update the delivery (execution path)';
END $$;

DO $$
DECLARE v_outsider uuid := (select staff_outsider_id from smoke_personas);
BEGIN
  if v_outsider is null then
    raise notice 'SKIP: §B no second unassigned staff persona — add a real staff member without area/warehouse assignments to run this check';
    return;
  end if;
  raise notice 'PASS: §B outsider staff persona resolved (%)', v_outsider;
END $$;

set local role authenticated;
select set_config('request.jwt.claims', format('{"sub":"%s","role":"authenticated"}',
  (select staff_outsider_id::text from smoke_personas))), true);

DO $$
DECLARE v_outsider uuid := (select staff_outsider_id from smoke_personas);
BEGIN
  if v_outsider is null then raise notice 'SKIP: §B outsider visibility not tested (no persona)'; return; end if;
  if exists (select 1 from order_deliveries d join smoke_orders so on so.id = d.order_id) then
    raise exception 'SMOKE FAIL: out-of-scope staff can see the delivery (cross-area leak)';
  end if;
  raise notice 'PASS: §B out-of-scope staff sees nothing (cross-area access denied)';
END $$;

-- Out-of-scope staff cannot insert a delivery task for this order.
DO $$
DECLARE v_outsider uuid := (select staff_outsider_id from smoke_personas);
DECLARE v_allowed boolean := false;
BEGIN
  if v_outsider is null then raise notice 'SKIP: §B outsider insert not tested (no persona)'; return; end if;
  begin
    insert into order_deliveries (order_id, delivery_status)
    values ((select id from smoke_orders limit 1), 'assigned');
    v_allowed := true;
  exception when others then null;
  end;
  if v_allowed then raise exception 'SMOKE FAIL: out-of-scope staff inserted a delivery task'; end if;
  raise notice 'PASS: §B out-of-scope staff cannot create delivery tasks';
END $$;

-- ----------------------------------------------------------------------------
-- §C SALESMAN — assigned retailer only
-- ----------------------------------------------------------------------------
set local role authenticated;
select set_config('request.jwt.claims', format('{"sub":"%s","role":"authenticated"}',
  (select salesman_id::text from smoke_personas))), true);

DO $$
BEGIN
  -- Sees the delivery through the retailer assigned to them.
  if not exists (select 1 from order_deliveries d
                  join smoke_orders so on so.id = d.order_id) then
    raise exception 'SMOKE FAIL: salesman of the assigned retailer cannot see the delivery';
  end if;
  raise notice 'PASS: §C salesman sees deliveries of own assigned retailer';
END $$;

-- Can record a collection ONLY for the assigned retailer.
DO $$
DECLARE v_allowed boolean := false;
BEGIN
  begin
    insert into payment_collections (retailer_id, collected_by, amount_paise, method, status)
    values ((select retailer_id from smoke_personas), auth.uid(), 1000, 'upi', 'pending');
    v_allowed := true;
  exception when others then null;
  end;
  if not v_allowed then raise exception 'SMOKE FAIL: salesman cannot record a collection for own retailer'; end if;
  raise notice 'PASS: §C salesman can record a collection for the assigned retailer';
END $$;

DO $$
DECLARE v_allowed boolean := false;
DECLARE v_outsider uuid := (select retailer_outsider_id from smoke_personas);
BEGIN
  if v_outsider is null then raise notice 'SKIP: §C cross-retailer insert not tested (no second retailer)'; return; end if;
  begin
    insert into payment_collections (retailer_id, collected_by, amount_paise, method, status)
    values (v_outsider, auth.uid(), 1000, 'cash', 'pending');
    v_allowed := true;
  exception when others then null;
  end;
  if v_allowed then raise exception 'SMOKE FAIL: salesman recorded a collection for an UNASSIGNED retailer'; end if;
  raise notice 'PASS: §C salesman cannot record collections for unassigned retailers';
END $$;

-- Salesman cannot verify/reject (update) any collection. RLS blocks UPDATEs
-- silently, so PASS = the status is STILL 'pending' after the attempt.
DO $$
DECLARE v_still_pending boolean;
BEGIN
  update payment_collections set status = 'verified'
   where collected_by = auth.uid() and status = 'pending';
  select not exists (select 1 from payment_collections
                      where collected_by = auth.uid() and status = 'verified')
    into v_still_pending;
  if not v_still_pending then raise exception 'SMOKE FAIL: salesman was able to verify a collection'; end if;
  raise notice 'PASS: §C salesman cannot verify/reject collections';
END $$;

-- ----------------------------------------------------------------------------
-- §D RETAILER — read own, write nothing
-- ----------------------------------------------------------------------------
set local role authenticated;
select set_config('request.jwt.claims', format('{"sub":"%s","role":"authenticated"}',
  (select retailer_id::text from smoke_personas))), true);

DO $$
BEGIN
  if not exists (select 1 from order_deliveries d
                  join smoke_orders so on so.id = d.order_id) then
    raise exception 'SMOKE FAIL: retailer cannot see own delivery record';
  end if;
  if not exists (select 1 from payment_collections pc
                  where pc.retailer_id = auth.uid()) then
    raise exception 'SMOKE FAIL: retailer cannot see own collections';
  end if;
  raise notice 'PASS: §D retailer sees own delivery record + own collections';
END $$;

DO $$
DECLARE v_unchanged boolean;
BEGIN
  update order_deliveries set delivery_status = 'delivered'
   where order_id in (select id from smoke_orders);
  select not exists (select 1 from order_deliveries
                      where order_id in (select id from smoke_orders)
                        and delivery_status = 'delivered')
    into v_unchanged;
  if not v_unchanged then raise exception 'SMOKE FAIL: retailer updated a delivery status'; end if;
  raise notice 'PASS: §D retailer cannot update delivery status';
END $$;

DO $$
DECLARE v_allowed boolean := false;
BEGIN
  begin
    insert into payment_collections (retailer_id, collected_by, amount_paise, method, status)
    values (auth.uid(), auth.uid(), 100, 'cash', 'pending');
    v_allowed := true;
  exception when others then null;
  end;
  if v_allowed then raise exception 'SMOKE FAIL: retailer inserted a payment collection'; end if;
  raise notice 'PASS: §D retailer cannot insert collections';
END $$;

-- Retailer cannot flip a DISPATCHED order to delivered (only own pending→cancelled is allowed).
DO $$
DECLARE v_unchanged boolean;
BEGIN
  update orders set status = 'delivered'
   where id in (select id from smoke_orders) and retailer_id = auth.uid();
  select not exists (select 1 from orders o
                      join smoke_orders so on so.id = o.id
                     where o.status = 'delivered')
    into v_unchanged;
  if not v_unchanged then raise exception 'SMOKE FAIL: retailer changed a dispatched order to delivered'; end if;
  raise notice 'PASS: §D retailer cannot change order status on a dispatched order';
END $$;

set local role authenticated;
select set_config('request.jwt.claims', format('{"sub":"%s","role":"authenticated"}',
  (select retailer_outsider_id::text from smoke_personas))), true);

DO $$
DECLARE v_outsider uuid := (select retailer_outsider_id from smoke_personas);
BEGIN
  if v_outsider is null then raise notice 'SKIP: §D outsider retailer visibility not tested (no second retailer)'; return; end if;
  if exists (select 1 from order_deliveries d join smoke_orders so on so.id = d.order_id) then
    raise exception 'SMOKE FAIL: another retailer can see the delivery (data leak)';
  end if;
  if exists (select 1 from payment_collections pc
              where pc.retailer_id = (select retailer_id from smoke_personas)) then
    raise exception 'SMOKE FAIL: another retailer can see someone else''s collections';
  end if;
  raise notice 'PASS: §D another retailer sees nothing of the fixture';
END $$;

-- ----------------------------------------------------------------------------
-- §E TRANSITION TRIGGERS + CONSTRAINTS (owner role: triggers still fire)
-- ----------------------------------------------------------------------------
set local role postgres;

-- Order machine (fixture order 2 starts 'pending').
DO $$
DECLARE v_transition_order uuid; v_allowed boolean;
BEGIN
  select id into v_transition_order from smoke_transition_order;

  v_allowed := false;
  begin
    update orders set status = 'delivered' where id = v_transition_order;
    v_allowed := true;
  exception when others then null;
  end;
  if v_allowed then raise exception 'SMOKE FAIL: order pending -> delivered was allowed'; end if;
  raise notice 'PASS: §E order pending -> delivered rejected';

  update orders set status = 'confirmed' where id = v_transition_order;
  update orders set status = 'cancelled'  where id = v_transition_order;

  v_allowed := false;
  begin
    update orders set status = 'confirmed' where id = v_transition_order;
    v_allowed := true;
  exception when others then null;
  end;
  if v_allowed then raise exception 'SMOKE FAIL: order cancelled -> confirmed was allowed'; end if;
  raise notice 'PASS: §E order cancelled -> confirmed rejected (terminal)';
END $$;

-- Delivery machine (fixture task starts 'assigned').
DO $$
DECLARE v_allowed boolean;
BEGIN
  update order_deliveries set delivery_status = 'in_progress'
   where order_id in (select id from smoke_orders);
  update order_deliveries set delivery_status = 'delivered'
   where order_id in (select id from smoke_orders);

  v_allowed := false;
  begin
    update order_deliveries set delivery_status = 'failed'
     where order_id in (select id from smoke_orders);
    v_allowed := true;
  exception when others then null;
  end;
  if v_allowed then raise exception 'SMOKE FAIL: delivery delivered -> failed was allowed'; end if;
  raise notice 'PASS: §E delivery delivered -> failed rejected';

  v_allowed := false;
  begin
    update order_deliveries set delivery_status = 'assigned'
     where order_id in (select id from smoke_orders);
    v_allowed := true;
  exception when others then null;
  end;
  if v_allowed then raise exception 'SMOKE FAIL: delivery delivered -> assigned was allowed'; end if;
  raise notice 'PASS: §E delivery delivered -> assigned rejected';

  update order_deliveries set delivery_status = 'returned_to_warehouse'
   where order_id in (select id from smoke_orders);

  v_allowed := false;
  begin
    update order_deliveries set delivery_status = 'assigned'
     where order_id in (select id from smoke_orders);
    v_allowed := true;
  exception when others then null;
  end;
  if v_allowed then raise exception 'SMOKE FAIL: returned_to_warehouse -> assigned was allowed'; end if;
  raise notice 'PASS: §E returned_to_warehouse is terminal';
END $$;

-- One delivery task per order (unique constraint).
DO $$
DECLARE v_allowed boolean := false;
BEGIN
  begin
    insert into order_deliveries (order_id, delivery_status)
    values ((select id from smoke_orders limit 1), 'assigned');
    v_allowed := true;
  exception when others then null;
  end;
  if v_allowed then raise exception 'SMOKE FAIL: a second delivery task was created for one order'; end if;
  raise notice 'PASS: §E exactly one delivery task per order';
END $$;

-- Split invariant: delivered + missing + damaged = ordered. The insert
-- targets the second (un-snapshotted) order line, so only the SPLIT check
-- can reject it — the unique constraint would not apply.
DO $$
DECLARE v_allowed boolean := false;
BEGIN
  begin
    insert into order_delivery_items (delivery_id, order_item_id, quantity_ordered, quantity_delivered, quantity_missing, quantity_damaged)
    select d.id, oi.id, 4, 1, 1, 1  -- 1+1+1 = 3 <> 4
      from order_deliveries d
      join order_items oi on oi.order_id = d.order_id
     where d.order_id in (select id from smoke_orders)
       and oi.quantity = 4
     limit 1;
    v_allowed := true;
  exception when others then null;
  end;
  if v_allowed then raise exception 'SMOKE FAIL: delivery quantities that do not sum to ordered were accepted'; end if;
  raise notice 'PASS: §E quantity split invariant (delivered+missing+damaged = ordered) enforced';
END $$;

-- OTP attempt ceiling.
DO $$
DECLARE v_allowed boolean := false;
BEGIN
  begin
    update order_deliveries set otp_attempts = 11
     where order_id in (select id from smoke_orders);
    v_allowed := true;
  exception when others then null;
  end;
  if v_allowed then raise exception 'SMOKE FAIL: otp_attempts > 10 was accepted'; end if;
  raise notice 'PASS: §E OTP attempt ceiling (<= 10) enforced';
END $$;

-- ----------------------------------------------------------------------------
-- §F PRIVATE BUCKETS
-- ----------------------------------------------------------------------------
set local role postgres;

DO $$
DECLARE v_public boolean; v_count int;
BEGIN
  select public into v_public from storage.buckets where id = 'delivery-proofs';
  if v_public is null then raise exception 'SMOKE FAIL: bucket delivery-proofs missing (run 0045 first)'; end if;
  if v_public then raise exception 'SMOKE FAIL: bucket delivery-proofs is PUBLIC'; end if;

  select public into v_public from storage.buckets where id = 'payment-proofs';
  if v_public is null then raise exception 'SMOKE FAIL: bucket payment-proofs missing (run 0045 first)'; end if;
  if v_public then raise exception 'SMOKE FAIL: bucket payment-proofs is PUBLIC'; end if;
  raise notice 'PASS: §F both proof buckets exist and are private';

  select count(*) into v_count from pg_policies
   where schemaname = 'storage' and tablename = 'objects'
     and policyname like '%proof%';
  if v_count < 4 then raise exception 'SMOKE FAIL: expected >= 4 storage policies for the proof buckets, found %', v_count; end if;
  raise notice 'PASS: §F % storage policies present for the proof buckets', v_count;
END $$;

-- ----------------------------------------------------------------------------
-- §G AUDIT TRAIL (0043/0044 triggers wrote rows for our fixture changes)
-- ----------------------------------------------------------------------------
DO $$
DECLARE v_deliveries int; v_items int; v_collections int;
BEGIN
  select count(*) into v_deliveries from audit_logs
   where table_name = 'order_deliveries'
     and record_id in (select id from order_deliveries where order_id in (select id from smoke_orders));
  select count(*) into v_items from audit_logs
   where table_name = 'order_delivery_items';
  select count(*) into v_collections from audit_logs
   where table_name = 'payment_collections';

  if v_deliveries = 0 then raise exception 'SMOKE FAIL: no audit rows for order_deliveries changes'; end if;
  if v_collections = 0 then raise exception 'SMOKE FAIL: no audit rows for payment_collections changes'; end if;
  raise notice 'PASS: §G audit trail present (deliveries=%, items=%, collections=%)',
    v_deliveries, v_items, v_collections;
END $$;

-- ----------------------------------------------------------------------------
-- Done — undo everything.
-- ----------------------------------------------------------------------------
set local role postgres;

ROLLBACK;

DO $$ BEGIN RAISE NOTICE '== SMOKE TEST COMPLETE — all fixture data rolled back =='; END $$;
DO $$ BEGIN RAISE NOTICE 'If every section printed PASS (or documented SKIP for missing personas),'; END $$;
DO $$ BEGIN RAISE NOTICE 'the Phase 4 RLS / trigger / bucket checks are live-verified.'; END $$;
