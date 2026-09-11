-- ============================================================================
-- 0036: orders.shipping_address — delivery address snapshot on the order
--
-- WHY
-- ---
-- With the address book (0032) a retailer can deliver to more than one
-- location, so the address chosen at checkout must be frozen onto the order:
-- order documents (invoice, delivery slip, tracking) must show the address
-- that was true AT ORDER TIME, not whatever the profile says later.
--
-- SAFETY
-- ------
-- - One additive, nullable jsonb column; re-runnable; no default, no
--   constraint on existing rows, no RLS change (orders RLS already scopes
--   rows by retailer and the snapshot is written server-side from verified
--   data only — never from untrusted client JSON: createOrderForRetailer
--   accepts only a verified address id or the profile address).
-- - Existing readers/writers select explicit columns, so adding a column
--   cannot break admin/staff/salesman order screens.
-- - A CHECK keeps the snapshot shape honest: it must carry the address text.
-- ============================================================================

alter table orders add column if not exists shipping_address jsonb;

-- The snapshot is written only by the server order-creation path and must
-- include, at minimum, the formatted one-line address used on documents.
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'orders_shipping_address_shape'
  ) then
    alter table orders add constraint orders_shipping_address_shape
      check (shipping_address is null or shipping_address ? 'line');
  end if;
end $$;

-- ============================================================================
-- END OF MIGRATION — no business data inserted, existing RLS untouched.
-- ============================================================================
