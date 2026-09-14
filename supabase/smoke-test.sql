-- ============================================================================
-- supabase/smoke-test.sql — Phase 4 live smoke test
-- (RLS role matrix · delivery/order transition triggers · private buckets ·
--  audit trail)
--
-- HOW TO RUN (against the real project) — pick ONE:
--
--   A. Supabase SQL Editor (recommended — no local tooling needed):
--        Open ONE new query tab, paste this ENTIRE file into it and press
--        Run ONCE. Every statement is plain SQL — there are no psql
--        meta-commands (no \echo, no \set), so the editor accepts the file
--        as-is.
--
--   B. psql (one execution, same single-transaction guarantee):
--        psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/smoke-test.sql
--
--   $DATABASE_URL = the project's direct Postgres connection string
--   (Supabase dashboard → Project Settings → Database → Connection string).
--
--   The sections share ONE transaction (every fixture change is undone as a
--   unit), so run the whole file in one go and do not run single sections on
--   their own. That is enforced, not just documented: every section re-checks
--   the fixture row before touching anything and aborts loudly otherwise.
--
-- REQUIREMENTS
--   * migrations 0042–0046 applied (see docs/PRODUCTION_VERIFICATION_CHECKLIST.md §1).
--     0046 creates smoke_fixture.smoke_personas — the fixture table this
--     script writes its single resolved-persona row into. Running
--     `scripts/production-validate.sh` applies everything that is missing
--     (0046 included) before this file, so that path needs no extra step.
--   * run as the `postgres` role (the direct connection string role) so the
--     fixture row and the throwaway orders can be written; RLS is then
--     exercised by impersonating real user roles with
--     `set local role authenticated` + JWT claims.
--
-- WHAT IT DOES
--   * Everything runs inside ONE transaction and ends with ROLLBACK —
--     no fixture data is kept. Personas are REAL profiles already in the
--     database; the only touched rows (one retailer's salesman assignment,
--     two throwaway orders) are undone by the rollback, and the single
--     fixture row is deleted as well.
--   * Prints `PASS:` / `SKIP:` notices. Any `SMOKE FAIL` / `SMOKE ABORT`
--     aborts the run; the trailing ROLLBACK still undoes every fixture
--     change (in psql the -v ON_ERROR_STOP=1 flag stops at the first error
--     and the session exit rolls the open transaction back).
--
-- WHY THE FIXTURE IS A REAL TABLE (the 42P01 fix)
--   * The fixture used to live in TEMPORARY tables, and a temp table exists
--     only inside the session that made it. Any execution that does not keep
--     every statement in one session — a highlighted selection, a second Run
--     in another tab, a pool that routes statements to different backends, a
--     partially applied file — therefore died with
--         ERROR 42P01: relation "smoke_personas" does not exist
--     Guarding individual statements cannot fix that: the fixture itself has
--     to survive the executor. It now lives in smoke_fixture.smoke_personas
--     (migration 0046) — a committed single-row scratch table that ships
--     empty, is written inside this script's transaction and is rolled back
--     (plus one explicit DELETE) at the end, so the relation always exists no
--     matter what runs the file.
--   * The script still opens its transaction FIRST: a leading ROLLBACK clears
--     any aborted transaction left by a previous partial run in the same tab,
--     then BEGIN starts the one transaction every section shares.
--   * A pre-flight check aborts with the migration name when 0046 has not been
--     applied, so the only reachable relation error names the file to run.
--   * Every section re-verifies the fixture row before touching it and aborts
--     the transaction (fail-fast) when the row is missing or was not written
--     by THIS execution, so a partial run can never quietly test a fixture
--     left behind by an earlier run.
--
-- NOTE: expected-error subtests deliberately raise Postgres errors that are
-- caught inside DO blocks; psql may print them as ERROR lines mid-run —
-- that is fine as long as each block ends with a `PASS:` notice.
-- A leading `WARNING: there is no transaction in progress` from the very
-- first ROLLBACK is also fine — it just means there was no leftover
-- transaction to clear.
-- ============================================================================

-- The leading ROLLBACK clears any open/aborted transaction left behind by a
-- previous partial run in this same tab/session (safe no-op warning when
-- there is nothing to clear). The BEGIN right after it opens the ONE
-- transaction shared by the fixture and every dependent statement below.
ROLLBACK;

BEGIN;

-- (Banner as RAISE NOTICE, not \echo: \echo is psql-only and the SQL
-- Editor rejects it with `syntax error at or near "\"`. NOTICE works in
-- both the editor and psql. It runs INSIDE the transaction so the whole
-- script, banner included, is one single execution.)
DO $$ BEGIN RAISE NOTICE '== Phase 4 smoke test (everything rolls back at the end) =='; END $$;

-- Pre-flight: the fixture TABLE must exist before anything is written to it —
-- it ships with migration 0046. to_regclass() returns NULL instead of raising
-- 42P01, so a project that has not applied 0046 gets an actionable abort
-- rather than `relation "smoke_fixture.smoke_personas" does not exist`.
DO $$ BEGIN
  IF to_regclass('smoke_fixture.smoke_personas') IS NULL THEN
    RAISE EXCEPTION 'SMOKE ABORT: smoke_fixture.smoke_personas is missing — apply supabase/migrations/0046_smoke_fixture.sql first (scripts/production-validate.sh applies it automatically)';
  END IF;
END $$;

-- ----------------------------------------------------------------------------
-- §0 Personas + fixture (written as the table owner, RLS-bypassed)
-- ----------------------------------------------------------------------------
-- smoke_fixture.smoke_personas is an ordinary committed table (migration
-- 0046), so this row is visible to every section below however the file is
-- executed — the old TEMPORARY fixture tables were session-scoped and are
-- exactly what produced `ERROR 42P01: relation "smoke_personas" does not
-- exist`.
-- UPSERT (never a plain insert): ONE fixture row (id = 1) that every run
-- overwrites with freshly resolved personas. Personas are REAL rows from the
-- actual schema — profiles.role (`user_role` enum: admin/super_admin, staff,
-- salesman), retailers joined to their active profile, and staff_assignments
-- to pick a staff member with no area/warehouse scope.
insert into smoke_fixture.smoke_personas (
  id, admin_id, staff_assignee_id, staff_outsider_id, salesman_id,
  retailer_id, retailer_outsider_id, warehouse_id, product_id, updated_at
)
values (
  1,
  (select p.id from profiles p
    where p.role in ('admin','super_admin') and p.is_active
    order by p.id limit 1),
  (select p.id from profiles p
    where p.role = 'staff' and p.is_active
    order by p.id limit 1),
  (select p.id from profiles p
    where p.role = 'staff' and p.is_active
      and p.id <> (select p2.id from profiles p2
                    where p2.role = 'staff' and p2.is_active
                    order by p2.id limit 1)
      and not exists (select 1 from staff_assignments sa where sa.staff_id = p.id)
    order by p.id limit 1),
  (select p.id from profiles p
    where p.role = 'salesman' and p.is_active
    order by p.id limit 1),
  (select r.id from retailers r
    join profiles p on p.id = r.id and p.is_active
    order by r.id limit 1),
  -- Prefer a retailer that is NOT assigned to the smoke salesman, so the
  -- negative collection test genuinely uses an unassigned retailer. If no
  -- such retailer exists, fall back to any second retailer — the fixture
  -- below will forcibly unassign it.
  (select r2.id from retailers r2
    where r2.id <> (select r.id from retailers r order by r.id limit 1)
    order by
      case when r2.assigned_salesman_id is null
                or r2.assigned_salesman_id <> (select p.id from profiles p where p.role = 'salesman' and p.is_active order by p.id limit 1)
           then 0 else 1 end,
      r2.id
    limit 1),
  (select w.id from warehouses w where w.is_active order by w.id limit 1),
  (select pr.id from products pr where pr.is_active order by pr.id limit 1),
  now()
)
on conflict (id) do update set
  admin_id             = excluded.admin_id,
  staff_assignee_id    = excluded.staff_assignee_id,
  staff_outsider_id    = excluded.staff_outsider_id,
  salesman_id          = excluded.salesman_id,
  retailer_id          = excluded.retailer_id,
  retailer_outsider_id = excluded.retailer_outsider_id,
  warehouse_id         = excluded.warehouse_id,
  product_id           = excluded.product_id,
  updated_at           = excluded.updated_at;

-- ----------------------------------------------------------------------------
-- §0 pre-flight: the fixture row MUST have been written by THIS execution
-- before anything reads it. `updated_at = now()` only holds inside the
-- transaction that wrote the row, so a partial / out-of-order / multi-session
-- run raises a clear SMOKE ABORT (never a bare 42P01) instead of testing a
-- stale fixture. The exception aborts the transaction (fail-fast): no later
-- section can run on a missing or stale fixture.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM smoke_fixture.smoke_personas
     WHERE id = 1 AND updated_at = now()
  ) THEN
    RAISE EXCEPTION 'SMOKE ABORT: smoke fixture row was not written by THIS execution — migration 0046 creates the fixture table; apply it and run this file as ONE execution (see the header)';
  END IF;
  RAISE NOTICE 'PASS: §0 pre-flight — smoke fixture row present (written by this execution)';
END $$;

DO $$
DECLARE
  v_admin uuid; v_staff uuid; v_salesman uuid; v_retailer uuid; v_product uuid;
BEGIN
  select admin_id, staff_assignee_id, salesman_id, retailer_id, product_id
    into v_admin, v_staff, v_salesman, v_retailer, v_product
    from smoke_fixture.smoke_personas;

  if v_admin is null then      raise exception 'SMOKE ABORT: no active admin/super_admin profile — create real team members first (no seed data).'; end if;
  if v_staff is null then      raise exception 'SMOKE ABORT: no active staff profile.'; end if;
  if v_salesman is null then   raise exception 'SMOKE ABORT: no active salesman profile.'; end if;
  if v_retailer is null then   raise exception 'SMOKE ABORT: no active retailer.'; end if;
  if v_product is null then    raise exception 'SMOKE ABORT: no active product.'; end if;

  raise notice 'PASS: §0 personas resolved (admin=%, staff=%, salesman=%, retailer=%)',
    v_admin, v_staff, v_salesman, v_retailer;
END $$;

DO $$ BEGIN RAISE NOTICE '-- §0 fixture: two throwaway orders + one delivery task (rolled back)'; END $$;

-- Explicitly assign the primary retailer to the smoke salesman (positive path)
update retailers
   set assigned_salesman_id = (select salesman_id from smoke_fixture.smoke_personas)
 where id = (select retailer_id from smoke_fixture.smoke_personas);

-- Explicitly ensure the outsider retailer is NOT assigned to the smoke salesman.
-- This is the core fix for the "UNASSIGNED retailer" negative test: previously
-- retailer_outsider_id could already be assigned to the same salesman in prod
-- data, causing the negative insert to succeed. We force it to NULL (unassigned)
-- so the negative test genuinely uses an unassigned retailer.
update retailers
   set assigned_salesman_id = null
 where id = (select retailer_outsider_id from smoke_fixture.smoke_personas)
   and id is not null;

-- If no second retailer exists that is naturally unassigned, try to find any
-- retailer that is not the primary one and not assigned to the smoke salesman,
-- and use that as outsider instead (update the fixture row). This makes the
-- test resilient even when prod has only 2 retailers both assigned to the same
-- salesman.
DO $$
DECLARE
  v_salesman uuid := (select salesman_id from smoke_fixture.smoke_personas);
  v_primary uuid := (select retailer_id from smoke_fixture.smoke_personas);
  v_outsider uuid := (select retailer_outsider_id from smoke_fixture.smoke_personas);
  v_better uuid;
BEGIN
  -- Re-verify freshness right where the fixture is about to be mutated: if the
  -- executor moved to another session (pooled / statement-split connection)
  -- between the pre-flight check above and here, the row written earlier is
  -- gone or stale — abort with the actionable message instead of silently
  -- mis-testing a fixture that belongs to an earlier run.
  if not exists (
    select 1 from smoke_fixture.smoke_personas where id = 1 and updated_at = now()
  ) then
    raise exception 'SMOKE ABORT: smoke fixture row missing or stale — run supabase/smoke-test.sql as ONE execution (apply migration 0046 first; see the file header)';
  end if;

  if v_outsider is null then
    select r.id into v_better
      from retailers r
      where r.id <> v_primary
        and (r.assigned_salesman_id is null or r.assigned_salesman_id <> v_salesman)
      order by r.id limit 1;
    if v_better is not null then
      update smoke_fixture.smoke_personas set retailer_outsider_id = v_better;
      update retailers set assigned_salesman_id = null where id = v_better;
      raise notice 'FIXTURE: retailer_outsider_id was null, promoted % as unassigned outsider', v_better;
    end if;
  else
    -- Double-check outsider is truly unassigned after our NULL update
    if exists (select 1 from retailers where id = v_outsider and assigned_salesman_id = v_salesman) then
      select r.id into v_better
        from retailers r
        where r.id <> v_primary
          and (r.assigned_salesman_id is null or r.assigned_salesman_id <> v_salesman)
        order by r.id limit 1;
      if v_better is not null then
        update smoke_fixture.smoke_personas set retailer_outsider_id = v_better;
        update retailers set assigned_salesman_id = null where id = v_better;
        raise notice 'FIXTURE: corrected retailer_outsider_id to % (unassigned)', v_better;
      end if;
    end if;
  end if;

  -- Final verification of assignments before any RLS tests
  if not exists (select 1 from retailers where id = v_primary and assigned_salesman_id = v_salesman) then
    raise exception 'SMOKE ABORT: fixture failed to assign primary retailer % to salesman %', v_primary, v_salesman;
  end if;

  if exists (select 1 from retailers where id = (select retailer_outsider_id from smoke_fixture.smoke_personas) and assigned_salesman_id = v_salesman) then
    raise exception 'SMOKE ABORT: fixture failed to unassign outsider retailer % from salesman %', (select retailer_outsider_id from smoke_fixture.smoke_personas), v_salesman;
  end if;

  raise notice 'PASS: §0 fixture assignments verified (primary=% assigned to salesman=%, outsider=% unassigned)',
    v_primary, v_salesman, (select retailer_outsider_id from smoke_fixture.smoke_personas);
END $$;

insert into orders (order_number, retailer_id, warehouse_id, status, subtotal, gst_total, discount_total, grand_total)
values ('SMOKE-DELIVERY-' || right(gen_random_uuid()::text, 8),
        (select retailer_id from smoke_fixture.smoke_personas),
        (select warehouse_id from smoke_fixture.smoke_personas),
        'dispatched', 100, 0, 0, 100);

-- Record the order just created as THIS run's delivery fixture. Ordering by
-- placed_at desc picks the newest SMOKE-DELIVERY order, so a leftover row from
-- an aborted run can never be mistaken for this run's order.
update smoke_fixture.smoke_personas
   set delivery_order_id = (select o.id from orders o
                             where o.order_number like 'SMOKE-DELIVERY-%'
                             order by o.placed_at desc, o.id desc limit 1),
       updated_at = now();

insert into order_items (order_id, product_id, quantity, unit_price, gst_percent, line_total, quantity_unit)
select o.delivery_order_id, (select product_id from smoke_fixture.smoke_personas), 10, 10.00, 0, 100.00, 'pieces'
  from smoke_fixture.smoke_personas o;
-- A second line on the same order, intentionally left OUT of the delivery
-- snapshot: the §E split-invariant test attaches THIS line (so the unique
-- (delivery_id, order_item_id) constraint is not what rejects the insert).
insert into order_items (order_id, product_id, quantity, unit_price, gst_percent, line_total, quantity_unit)
select o.delivery_order_id, (select product_id from smoke_fixture.smoke_personas), 4, 5.00, 0, 20.00, 'pieces'
  from smoke_fixture.smoke_personas o;

insert into order_deliveries (order_id, delivery_status, assigned_staff_id, assigned_at, assigned_by,
                              dispatched_at, otp_hash)
select o.delivery_order_id, 'assigned',
       (select staff_assignee_id from smoke_fixture.smoke_personas), now(),
       (select admin_id from smoke_fixture.smoke_personas), now(),
       md5(o.delivery_order_id::text || ':000000')
  from smoke_fixture.smoke_personas o;

-- Snapshot ONLY the first line (qty 10): the qty-4 line stays
-- un-snapshotted for the §E split tests below.
insert into order_delivery_items (delivery_id, order_item_id, quantity_ordered)
select d.id, oi.id, oi.quantity
  from order_deliveries d
  join order_items oi on oi.order_id = d.order_id
 where d.order_id = (select delivery_order_id from smoke_fixture.smoke_personas)
   and oi.quantity = 10;

insert into payment_collections (retailer_id, collected_by, amount_paise, method, status)
values ((select retailer_id from smoke_fixture.smoke_personas),
        (select salesman_id from smoke_fixture.smoke_personas), 5000, 'cash', 'pending');

-- No GRANTs here: SELECT on the fixture table for `authenticated` (the roles
-- impersonated below) ships with migration 0046, so every execution has it.

-- A second throwaway order purely for order-status transition tests.
insert into orders (order_number, retailer_id, warehouse_id, status, subtotal, gst_total, discount_total, grand_total)
values ('SMOKE-TRANSITION-' || right(gen_random_uuid()::text, 8),
        (select retailer_id from smoke_fixture.smoke_personas),
        (select warehouse_id from smoke_fixture.smoke_personas),
        'pending', 50, 0, 0, 50);

update smoke_fixture.smoke_personas
   set transition_order_id = (select o.id from orders o
                               where o.order_number like 'SMOKE-TRANSITION-%'
                               order by o.placed_at desc, o.id desc limit 1),
       updated_at = now();

-- The fixture row (both throwaway orders included) is readable under every
-- impersonated role through migration 0046's grant + RLS read policy.

-- RLS-blocked UPDATEs fail SILENTLY (0 rows), they do not raise — so the
-- negative UPDATE checks below compare row state before/after instead of
-- watching for exceptions. INSERT violations DO raise (with check).

-- ----------------------------------------------------------------------------
-- Helper: impersonate a real user under RLS
-- ----------------------------------------------------------------------------

-- ----------------------------------------------------------------------------
-- §A ADMIN — full visibility, can manage collections
-- ----------------------------------------------------------------------------
-- Fail-fast gate for §A: re-verify the fixture row was written by THIS
-- execution (and that both throwaway orders exist) before touching anything.
DO $$ BEGIN
  -- Fail-fast: the row must have been written by THIS execution
  -- (updated_at = now() only holds inside the transaction that wrote it) and
  -- both throwaway orders must already exist. A partial, out-of-order or
  -- multi-session run therefore aborts loudly instead of quietly testing a
  -- stale fixture — the failure mode that used to surface as
  -- `42P01: relation "smoke_personas" does not exist`.
  IF NOT EXISTS (
    SELECT 1 FROM smoke_fixture.smoke_personas
     WHERE id = 1 AND updated_at = now()
       AND delivery_order_id IS NOT NULL
       AND transition_order_id IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'SMOKE ABORT: smoke fixture row missing or stale — run supabase/smoke-test.sql as ONE execution (apply migration 0046 first; see the file header)';
  END IF;
END $$;

set local role authenticated;
-- set_config(), not `set local ... = <expression>`: SET only accepts a
-- literal, so the expression form is a syntax error in both the SQL
-- Editor and psql. The `true` flag keeps the value transaction-local.
select set_config('request.jwt.claims',
  format('{"sub":"%s","role":"authenticated"}', (select admin_id::text from smoke_fixture.smoke_personas)),
  true);

DO $$
BEGIN
  if not exists (select 1 from order_deliveries d
                  join smoke_fixture.smoke_personas so on so.delivery_order_id = d.order_id) then
    raise exception 'SMOKE FAIL: admin cannot see the delivery task';
  end if;
  if not exists (select 1 from payment_collections pc
                  where pc.retailer_id = (select retailer_id from smoke_fixture.smoke_personas)
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
   where retailer_id = (select retailer_id from smoke_fixture.smoke_personas)
     and status = 'pending';
  select exists (select 1 from payment_collections where notes = 'smoke-admin-touch') into v_changed;
  if not v_changed then raise exception 'SMOKE FAIL: admin update of payment_collections did not land (RLS blocked it)'; end if;
  raise notice 'PASS: §A admin can update payment_collections (verify/reject path)';
END $$;

-- ----------------------------------------------------------------------------
-- §B STAFF — assignee yes, out-of-scope staff no
-- ----------------------------------------------------------------------------
-- Fail-fast gate for §B: re-verify the fixture row was written by THIS
-- execution (and that both throwaway orders exist) before touching anything.
DO $$ BEGIN
  -- Fail-fast: the row must have been written by THIS execution
  -- (updated_at = now() only holds inside the transaction that wrote it) and
  -- both throwaway orders must already exist. A partial, out-of-order or
  -- multi-session run therefore aborts loudly instead of quietly testing a
  -- stale fixture — the failure mode that used to surface as
  -- `42P01: relation "smoke_personas" does not exist`.
  IF NOT EXISTS (
    SELECT 1 FROM smoke_fixture.smoke_personas
     WHERE id = 1 AND updated_at = now()
       AND delivery_order_id IS NOT NULL
       AND transition_order_id IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'SMOKE ABORT: smoke fixture row missing or stale — run supabase/smoke-test.sql as ONE execution (apply migration 0046 first; see the file header)';
  END IF;
END $$;

set local role authenticated;
select set_config('request.jwt.claims',
  format('{"sub":"%s","role":"authenticated"}', (select staff_assignee_id::text from smoke_fixture.smoke_personas)),
  true);

DO $$
BEGIN
  if not exists (select 1 from order_deliveries d
                  join smoke_fixture.smoke_personas so on so.delivery_order_id = d.order_id
                 where d.assigned_staff_id = auth.uid()) then
    raise exception 'SMOKE FAIL: assigned staff cannot see the delivery task';
  end if;
  raise notice 'PASS: §B assignee staff sees the task';
END $$;

DO $$
DECLARE v_changed boolean := false;
BEGIN
  update order_deliveries set delivery_notes = 'smoke-assignee-touch'
   where order_id = (select delivery_order_id from smoke_fixture.smoke_personas)
     and assigned_staff_id = auth.uid();
  select exists (select 1 from order_deliveries where delivery_notes = 'smoke-assignee-touch')
    into v_changed;
  if not v_changed then raise exception 'SMOKE FAIL: assignee update of the delivery did not land (RLS blocked it)'; end if;
  raise notice 'PASS: §B assignee can update the delivery (execution path)';
END $$;

DO $$
DECLARE v_outsider uuid := (select staff_outsider_id from smoke_fixture.smoke_personas);
BEGIN
  if v_outsider is null then
    raise notice 'SKIP: §B no second unassigned staff persona — add a real staff member without area/warehouse assignments to run this check';
    return;
  end if;
  raise notice 'PASS: §B outsider staff persona resolved (%)', v_outsider;
END $$;

set local role authenticated;
select set_config('request.jwt.claims',
  format('{"sub":"%s","role":"authenticated"}', (select staff_outsider_id::text from smoke_fixture.smoke_personas)),
  true);

DO $$
DECLARE v_outsider uuid := (select staff_outsider_id from smoke_fixture.smoke_personas);
BEGIN
  if v_outsider is null then raise notice 'SKIP: §B outsider visibility not tested (no persona)'; return; end if;
  if exists (select 1 from order_deliveries d join smoke_fixture.smoke_personas so on so.delivery_order_id = d.order_id) then
    raise exception 'SMOKE FAIL: out-of-scope staff can see the delivery (cross-area leak)';
  end if;
  raise notice 'PASS: §B out-of-scope staff sees nothing (cross-area access denied)';
END $$;

-- Out-of-scope staff cannot insert a delivery task for this order.
DO $$
DECLARE v_outsider uuid := (select staff_outsider_id from smoke_fixture.smoke_personas);
DECLARE v_allowed boolean := false;
BEGIN
  if v_outsider is null then raise notice 'SKIP: §B outsider insert not tested (no persona)'; return; end if;
  begin
    insert into order_deliveries (order_id, delivery_status)
    values ((select delivery_order_id from smoke_fixture.smoke_personas), 'assigned');
    v_allowed := true;
  exception when others then null;
  end;
  if v_allowed then raise exception 'SMOKE FAIL: out-of-scope staff inserted a delivery task'; end if;
  raise notice 'PASS: §B out-of-scope staff cannot create delivery tasks';
END $$;

-- ----------------------------------------------------------------------------
-- §C SALESMAN — assigned retailer only
-- ----------------------------------------------------------------------------
-- Fail-fast gate for §C: re-verify the fixture row was written by THIS
-- execution (and that both throwaway orders exist) before touching anything.
DO $$ BEGIN
  -- Fail-fast: the row must have been written by THIS execution
  -- (updated_at = now() only holds inside the transaction that wrote it) and
  -- both throwaway orders must already exist. A partial, out-of-order or
  -- multi-session run therefore aborts loudly instead of quietly testing a
  -- stale fixture — the failure mode that used to surface as
  -- `42P01: relation "smoke_personas" does not exist`.
  IF NOT EXISTS (
    SELECT 1 FROM smoke_fixture.smoke_personas
     WHERE id = 1 AND updated_at = now()
       AND delivery_order_id IS NOT NULL
       AND transition_order_id IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'SMOKE ABORT: smoke fixture row missing or stale — run supabase/smoke-test.sql as ONE execution (apply migration 0046 first; see the file header)';
  END IF;
END $$;

set local role authenticated;
select set_config('request.jwt.claims',
  format('{"sub":"%s","role":"authenticated"}', (select salesman_id::text from smoke_fixture.smoke_personas)),
  true);

DO $$
BEGIN
  -- Sees the delivery through the retailer assigned to them.
  if not exists (select 1 from order_deliveries d
                  join smoke_fixture.smoke_personas so on so.delivery_order_id = d.order_id) then
    raise exception 'SMOKE FAIL: salesman of the assigned retailer cannot see the delivery';
  end if;
  raise notice 'PASS: §C salesman sees deliveries of own assigned retailer';
END $$;

-- Can record a collection ONLY for the assigned retailer.
-- Fixture must explicitly verify the salesman-retailer assignment before the positive insert.
DO $$
BEGIN
  if not exists (select 1 from retailers where id = (select retailer_id from smoke_fixture.smoke_personas) and assigned_salesman_id = (select salesman_id from smoke_fixture.smoke_personas)) then
    raise exception 'SMOKE ABORT: salesman-retailer assignment missing for positive test — retailer % not assigned to salesman %', (select retailer_id from smoke_fixture.smoke_personas), (select salesman_id from smoke_fixture.smoke_personas);
  end if;
  raise notice 'PASS: §C fixture verified: retailer % is assigned to salesman % (positive path)', (select retailer_id from smoke_fixture.smoke_personas), (select salesman_id from smoke_fixture.smoke_personas);
END $$;

DO $$
DECLARE v_allowed boolean := false;
BEGIN
  begin
    insert into payment_collections (retailer_id, collected_by, amount_paise, method, status)
    values ((select retailer_id from smoke_fixture.smoke_personas), auth.uid(), 1000, 'upi', 'pending');
    v_allowed := true;
  exception when others then null;
  end;
  if not v_allowed then raise exception 'SMOKE FAIL: salesman cannot record a collection for own retailer'; end if;
  raise notice 'PASS: §C salesman can record a collection for the assigned retailer';
END $$;

-- Negative test: uses a retailer genuinely unassigned to the salesman.
-- Must fail with RLS error. Do NOT swallow or convert failure to PASS.
DO $$
DECLARE v_allowed boolean := false;
DECLARE v_outsider uuid := (select retailer_outsider_id from smoke_fixture.smoke_personas);
DECLARE v_salesman uuid := (select salesman_id from smoke_fixture.smoke_personas);
BEGIN
  if v_outsider is null then raise notice 'SKIP: §C cross-retailer insert not tested (no second retailer)'; return; end if;

  -- Explicitly verify outsider is genuinely unassigned before attempting insert
  if exists (select 1 from retailers where id = v_outsider and assigned_salesman_id = v_salesman) then
    raise exception 'SMOKE ABORT: negative test fixture invalid — outsider retailer % is still assigned to salesman %', v_outsider, v_salesman;
  end if;
  raise notice 'PASS: §C fixture verified: retailer_outsider_id=% is NOT assigned to salesman=% (negative path)', v_outsider, v_salesman;

  begin
    insert into payment_collections (retailer_id, collected_by, amount_paise, method, status)
    values (v_outsider, auth.uid(), 1000, 'cash', 'pending');
    v_allowed := true;
  exception when others then
    -- Expected RLS failure — keep v_allowed false and surface the SQLSTATE for debugging
    raise notice 'EXPECTED RLS REJECTION for unassigned retailer %: %', v_outsider, SQLERRM;
    v_allowed := false;
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
-- Fail-fast gate for §D: re-verify the fixture row was written by THIS
-- execution (and that both throwaway orders exist) before touching anything.
DO $$ BEGIN
  -- Fail-fast: the row must have been written by THIS execution
  -- (updated_at = now() only holds inside the transaction that wrote it) and
  -- both throwaway orders must already exist. A partial, out-of-order or
  -- multi-session run therefore aborts loudly instead of quietly testing a
  -- stale fixture — the failure mode that used to surface as
  -- `42P01: relation "smoke_personas" does not exist`.
  IF NOT EXISTS (
    SELECT 1 FROM smoke_fixture.smoke_personas
     WHERE id = 1 AND updated_at = now()
       AND delivery_order_id IS NOT NULL
       AND transition_order_id IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'SMOKE ABORT: smoke fixture row missing or stale — run supabase/smoke-test.sql as ONE execution (apply migration 0046 first; see the file header)';
  END IF;
END $$;

set local role authenticated;
select set_config('request.jwt.claims',
  format('{"sub":"%s","role":"authenticated"}', (select retailer_id::text from smoke_fixture.smoke_personas)),
  true);

DO $$
BEGIN
  if not exists (select 1 from order_deliveries d
                  join smoke_fixture.smoke_personas so on so.delivery_order_id = d.order_id) then
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
   where order_id = (select delivery_order_id from smoke_fixture.smoke_personas);
  select not exists (select 1 from order_deliveries
                      where order_id = (select delivery_order_id from smoke_fixture.smoke_personas)
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
   where id = (select delivery_order_id from smoke_fixture.smoke_personas) and retailer_id = auth.uid();
  select not exists (select 1 from orders o
                      join smoke_fixture.smoke_personas so on so.delivery_order_id = o.id
                     where o.status = 'delivered')
    into v_unchanged;
  if not v_unchanged then raise exception 'SMOKE FAIL: retailer changed a dispatched order to delivered'; end if;
  raise notice 'PASS: §D retailer cannot change order status on a dispatched order';
END $$;

set local role authenticated;
select set_config('request.jwt.claims',
  format('{"sub":"%s","role":"authenticated"}', (select retailer_outsider_id::text from smoke_fixture.smoke_personas)),
  true);

DO $$
DECLARE v_outsider uuid := (select retailer_outsider_id from smoke_fixture.smoke_personas);
BEGIN
  if v_outsider is null then raise notice 'SKIP: §D outsider retailer visibility not tested (no second retailer)'; return; end if;
  if exists (select 1 from order_deliveries d join smoke_fixture.smoke_personas so on so.delivery_order_id = d.order_id) then
    raise exception 'SMOKE FAIL: another retailer can see the delivery (data leak)';
  end if;
  if exists (select 1 from payment_collections pc
              where pc.retailer_id = (select retailer_id from smoke_fixture.smoke_personas)) then
    raise exception 'SMOKE FAIL: another retailer can see someone else''s collections';
  end if;
  raise notice 'PASS: §D another retailer sees nothing of the fixture';
END $$;

-- ----------------------------------------------------------------------------
-- §E TRANSITION TRIGGERS + CONSTRAINTS (owner role: triggers still fire)
-- ----------------------------------------------------------------------------
-- Fail-fast gate for §E: re-verify the fixture row was written by THIS
-- execution (and that both throwaway orders exist) before touching anything.
DO $$ BEGIN
  -- Fail-fast: the row must have been written by THIS execution
  -- (updated_at = now() only holds inside the transaction that wrote it) and
  -- both throwaway orders must already exist. A partial, out-of-order or
  -- multi-session run therefore aborts loudly instead of quietly testing a
  -- stale fixture — the failure mode that used to surface as
  -- `42P01: relation "smoke_personas" does not exist`.
  IF NOT EXISTS (
    SELECT 1 FROM smoke_fixture.smoke_personas
     WHERE id = 1 AND updated_at = now()
       AND delivery_order_id IS NOT NULL
       AND transition_order_id IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'SMOKE ABORT: smoke fixture row missing or stale — run supabase/smoke-test.sql as ONE execution (apply migration 0046 first; see the file header)';
  END IF;
END $$;

set local role postgres;

-- Order machine (fixture order 2 starts 'pending').
DO $$
DECLARE v_transition_order uuid; v_allowed boolean;
BEGIN
  select transition_order_id into v_transition_order from smoke_fixture.smoke_personas;

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
   where order_id = (select delivery_order_id from smoke_fixture.smoke_personas);
  update order_deliveries set delivery_status = 'delivered'
   where order_id = (select delivery_order_id from smoke_fixture.smoke_personas);

  v_allowed := false;
  begin
    update order_deliveries set delivery_status = 'failed'
     where order_id = (select delivery_order_id from smoke_fixture.smoke_personas);
    v_allowed := true;
  exception when others then null;
  end;
  if v_allowed then raise exception 'SMOKE FAIL: delivery delivered -> failed was allowed'; end if;
  raise notice 'PASS: §E delivery delivered -> failed rejected';

  v_allowed := false;
  begin
    update order_deliveries set delivery_status = 'assigned'
     where order_id = (select delivery_order_id from smoke_fixture.smoke_personas);
    v_allowed := true;
  exception when others then null;
  end;
  if v_allowed then raise exception 'SMOKE FAIL: delivery delivered -> assigned was allowed'; end if;
  raise notice 'PASS: §E delivery delivered -> assigned rejected';

  update order_deliveries set delivery_status = 'returned_to_warehouse'
   where order_id = (select delivery_order_id from smoke_fixture.smoke_personas);

  v_allowed := false;
  begin
    update order_deliveries set delivery_status = 'assigned'
     where order_id = (select delivery_order_id from smoke_fixture.smoke_personas);
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
    values ((select delivery_order_id from smoke_fixture.smoke_personas), 'assigned');
    v_allowed := true;
  exception when others then null;
  end;
  if v_allowed then raise exception 'SMOKE FAIL: a second delivery task was created for one order'; end if;
  raise notice 'PASS: §E exactly one delivery task per order';
END $$;

-- Split invariant: a snapshot row is either FRESH (0/0/0 outcomes, as
-- written by the dispatch action) or fully accounted
-- (delivered + missing + damaged = ordered). The first insert targets the
-- second (un-snapshotted) order line, so only the SPLIT check can reject
-- it — the unique constraint would not apply.
DO $$
DECLARE v_allowed boolean := false;
BEGIN
  begin
    insert into order_delivery_items (delivery_id, order_item_id, quantity_ordered, quantity_delivered, quantity_missing, quantity_damaged)
    select d.id, oi.id, 4, 1, 1, 1  -- 1+1+1 = 3 <> 4
      from order_deliveries d
      join order_items oi on oi.order_id = d.order_id
     where d.order_id = (select delivery_order_id from smoke_fixture.smoke_personas)
       and oi.quantity = 4
     limit 1;
    v_allowed := true;
  exception when others then null;
  end;
  if v_allowed then raise exception 'SMOKE FAIL: delivery quantities that do not sum to ordered were accepted'; end if;
  raise notice 'PASS: §E quantity split invariant (delivered+missing+damaged = ordered) enforced';
END $$;

-- Dispatch regression: a fresh snapshot (ordered only, outcomes 0/0/0)
-- MUST be accepted — every real dispatch inserts exactly this shape.
DO $$
DECLARE v_allowed boolean := false;
BEGIN
  begin
    insert into order_delivery_items (delivery_id, order_item_id, quantity_ordered)
    select d.id, oi.id, oi.quantity
      from order_deliveries d
      join order_items oi on oi.order_id = d.order_id
     where d.order_id = (select delivery_order_id from smoke_fixture.smoke_personas)
       and oi.quantity = 4
     limit 1;
    v_allowed := true;
  exception when others then null;
  end;
  if not v_allowed then raise exception 'SMOKE FAIL: a fresh 0/0/0 line snapshot was rejected (no dispatch could succeed)'; end if;
  raise notice 'PASS: §E fresh 0/0/0 snapshots accepted (dispatch shape)';
END $$;

-- Partial accounting is rejected: once outcomes move off 0/0/0 they must
-- sum to ordered.
DO $$
DECLARE v_allowed boolean := false;
BEGIN
  begin
    update order_delivery_items set quantity_delivered = 1, quantity_missing = 1, quantity_damaged = 0
     where delivery_id in (select d.id from order_deliveries d where d.order_id = (select delivery_order_id from smoke_fixture.smoke_personas))
       and quantity_ordered = 4;
    v_allowed := true;
  exception when others then null;
  end;
  if v_allowed then raise exception 'SMOKE FAIL: partially-accounted outcomes (1+1+0 <> 4) were accepted'; end if;
  raise notice 'PASS: §E partial outcome accounting rejected';
END $$;

-- Full accounting is accepted: the completion shape (2+1+1 = 4).
DO $$
BEGIN
  update order_delivery_items set quantity_delivered = 2, quantity_missing = 1, quantity_damaged = 1
   where delivery_id in (select d.id from order_deliveries d where d.order_id = (select delivery_order_id from smoke_fixture.smoke_personas))
     and quantity_ordered = 4;
  if not found then raise exception 'SMOKE FAIL: completion-shaped update touched 0 rows'; end if;
  raise notice 'PASS: §E fully-accounted outcomes accepted (completion shape)';
END $$;

-- OTP attempt ceiling.
DO $$
DECLARE v_allowed boolean := false;
BEGIN
  begin
    update order_deliveries set otp_attempts = 11
     where order_id = (select delivery_order_id from smoke_fixture.smoke_personas);
    v_allowed := true;
  exception when others then null;
  end;
  if v_allowed then raise exception 'SMOKE FAIL: otp_attempts > 10 was accepted'; end if;
  raise notice 'PASS: §E OTP attempt ceiling (<= 10) enforced';
END $$;

-- ----------------------------------------------------------------------------
-- §F PRIVATE BUCKETS
-- ----------------------------------------------------------------------------
-- Fail-fast gate for §F: re-verify the fixture row was written by THIS
-- execution (and that both throwaway orders exist) before touching anything.
DO $$ BEGIN
  -- Fail-fast: the row must have been written by THIS execution
  -- (updated_at = now() only holds inside the transaction that wrote it) and
  -- both throwaway orders must already exist. A partial, out-of-order or
  -- multi-session run therefore aborts loudly instead of quietly testing a
  -- stale fixture — the failure mode that used to surface as
  -- `42P01: relation "smoke_personas" does not exist`.
  IF NOT EXISTS (
    SELECT 1 FROM smoke_fixture.smoke_personas
     WHERE id = 1 AND updated_at = now()
       AND delivery_order_id IS NOT NULL
       AND transition_order_id IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'SMOKE ABORT: smoke fixture row missing or stale — run supabase/smoke-test.sql as ONE execution (apply migration 0046 first; see the file header)';
  END IF;
END $$;

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
-- Fail-fast gate for §G: re-verify the fixture row was written by THIS
-- execution (and that both throwaway orders exist) before touching anything.
DO $$ BEGIN
  -- Fail-fast: the row must have been written by THIS execution
  -- (updated_at = now() only holds inside the transaction that wrote it) and
  -- both throwaway orders must already exist. A partial, out-of-order or
  -- multi-session run therefore aborts loudly instead of quietly testing a
  -- stale fixture — the failure mode that used to surface as
  -- `42P01: relation "smoke_personas" does not exist`.
  IF NOT EXISTS (
    SELECT 1 FROM smoke_fixture.smoke_personas
     WHERE id = 1 AND updated_at = now()
       AND delivery_order_id IS NOT NULL
       AND transition_order_id IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'SMOKE ABORT: smoke fixture row missing or stale — run supabase/smoke-test.sql as ONE execution (apply migration 0046 first; see the file header)';
  END IF;
END $$;

DO $$
DECLARE v_deliveries int; v_items int; v_collections int;
BEGIN
  select count(*) into v_deliveries from audit_logs
   where table_name = 'order_deliveries'
     and record_id in (select id from order_deliveries where order_id = (select delivery_order_id from smoke_fixture.smoke_personas));
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

-- Belt-and-braces cleanup for an executor that commits per statement instead
-- of honouring the one transaction: the fixture row is deleted explicitly, so
-- the scratch table is empty again either way. In a normal run the ROLLBACK
-- below undoes this DELETE together with every other fixture change.
delete from smoke_fixture.smoke_personas;

ROLLBACK;

-- Completion marker as a plain SELECT (not \echo, which is psql-only):
-- visible as a result grid in the SQL Editor and as rows in psql, even
-- when NOTICE output is hidden. Reached only if no check raised.
select notice_line as smoke_test_complete
from (values
  ('== SMOKE TEST COMPLETE — all fixture data rolled back =='),
  ('If every section printed PASS (or documented SKIP for missing personas),'),
  ('the Phase 4 RLS / trigger / bucket checks are live-verified.')
) as t(notice_line);
