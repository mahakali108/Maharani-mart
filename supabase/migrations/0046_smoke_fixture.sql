-- ============================================================================
-- 0046: Smoke-test fixture table used by supabase/smoke-test.sql
--
-- WHY
-- ---
-- The live smoke test needs a few resolved values — the real admin / staff /
-- salesman / retailer personas plus the two throwaway orders it creates — that
-- its later sections read while impersonating real roles. It used to keep them
-- in TEMPORARY tables, and temporary tables are SESSION-scoped: any execution
-- that does not keep every statement in the same session (a highlighted
-- selection in the SQL Editor, a second Run in another tab, a pool that routes
-- statements to different backends, a partially applied file) lost the fixture
-- and died with
--     ERROR: 42P01: relation "smoke_personas" does not exist
-- A temporary table cannot be made to survive that, so the fixture now lives
-- in this ONE committed table instead. The table ships EMPTY: the smoke test
-- writes its single row (id = 1) inside its own transaction and rolls it back
-- (plus an explicit delete for executors that commit per statement), so no
-- fixture data is ever kept.
--
-- WHAT IT IS
-- ----------
-- * Scratch storage for `supabase/smoke-test.sql` only — never business data.
-- * Private by construction: the `smoke_fixture` schema is NOT exposed through
--   PostgREST (Supabase exposes `public`), so nothing here is reachable from
--   the app API and no `types/database.types.ts` entry is needed.
-- * SELECT-only for `authenticated`: the smoke test's impersonated sections
--   must be able to read the resolved persona ids, and nothing else may write.
-- * RLS is enabled; the single read policy is the only access path.
--
-- SAFETY: additive & re-runnable (`if not exists` / `drop policy if exists`).
-- One schema, one table, one policy, two grants. No existing object is altered
-- and no data is inserted. 0046 must run AFTER 0001 (profiles/retailers) — the
-- pre-flight block below fails fast with an actionable message otherwise.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- Pre-flight: the fixture mirrors the 0001 core schema (profiles, retailers,
-- staff_assignments, warehouses, products, orders). Pure catalog check,
-- re-runnable, no exception swallowing.
-- ----------------------------------------------------------------------------
do $$
begin
  if to_regclass('public.profiles') is null or to_regclass('public.orders') is null then
    raise exception 'MIGRATION ORDER VIOLATION: 0046 requires the 0001 core schema — profiles / orders do not exist. Apply the earlier migrations first, then re-run 0046.'
      using errcode = 'undefined_table';
  end if;
end $$;

create schema if not exists smoke_fixture;

comment on schema smoke_fixture is
  'Private scratch schema for supabase/smoke-test.sql — not exposed through the PostgREST API (only `public` is).';

create table if not exists smoke_fixture.smoke_personas (
  id smallint primary key default 1,
  -- Personas resolved from the real tables (profiles / retailers / staff_assignments).
  admin_id uuid,
  staff_assignee_id uuid,
  staff_outsider_id uuid,
  salesman_id uuid,
  retailer_id uuid,
  retailer_outsider_id uuid,
  warehouse_id uuid,
  product_id uuid,
  -- The two throwaway orders the smoke test creates (all fixture rows are
  -- rolled back at the end of the run).
  delivery_order_id uuid,
  transition_order_id uuid,
  updated_at timestamptz not null default now(),
  constraint smoke_personas_single_row check (id = 1)
);

comment on table smoke_fixture.smoke_personas is
  'Single-row fixture for supabase/smoke-test.sql: personas resolved from real profiles/retailers plus the two throwaway orders that run creates. Written at the start of the smoke test''s transaction, deleted at the end and rolled back — never holds committed production data.';

alter table smoke_fixture.smoke_personas enable row level security;

drop policy if exists smoke_personas_read on smoke_fixture.smoke_personas;
create policy smoke_personas_read on smoke_fixture.smoke_personas
  for select to authenticated using (true);

-- The smoke test connects as the database owner (postgres) and impersonates
-- real roles with `set local role authenticated` + JWT claims; those sections
-- read the fixture row. Only the owner writes it, so SELECT is all that is
-- granted — the table is append-once-per-run scratch storage.
grant usage on schema smoke_fixture to authenticated;
grant select on smoke_fixture.smoke_personas to authenticated;

-- ============================================================================
-- END OF MIGRATION — no business data inserted, no fixture row created.
-- ============================================================================
