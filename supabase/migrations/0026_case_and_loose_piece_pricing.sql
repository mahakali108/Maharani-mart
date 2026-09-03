-- ============================================================================
-- 0026: Case price + LOOSE PIECE quantity tiers
--
-- WHAT CHANGES
--   A pack keeps its existing GST-INCLUSIVE `case_price` as the source of truth
--   for full cases, and gains a separate, independently configured set of
--   loose-piece tiers. A retailer can therefore order 6 pcs of a 40-pcs/case
--   product, 46 pcs (1 case + 6 loose) or 85 pcs (2 cases + 5 loose) without
--   ever being forced into a full case.
--
--   Pricing arithmetic is intentionally NOT stored in the database: the single
--   canonical implementation is `calculateCaseLoosePrice` in
--   lib/retailer/case-pricing.ts, used by the product page, the cart,
--   checkout, the server-side quote, order persistence, the invoice and the
--   admin preview. This migration only extends the model that function reads.
--
-- BACKWARD COMPATIBILITY (this is a live database)
--   * Nothing is dropped, renamed or re-typed. Existing columns keep their
--     meaning, and every statement is additive except where noted.
--   * `product_pricing_tiers.rule_type` gains the value 'loose'. Existing
--     'default' / 'case' / 'bulk' rows are untouched and keep pricing a pack
--     exactly as before, so no product's price changes on upgrade.
--   * `order_items.quantity` keeps its historical meaning. A marker column
--     `quantity_unit` records which unit each row was billed in ('packs' for
--     every row written before this migration, 'cases' / 'pieces' for new
--     mixed lines), so historical orders, invoices and returns keep rendering
--     the same numbers they always did.
--   * RLS is unchanged: no policy is dropped or relaxed, no new GRANT is
--     issued. New columns inherit the existing table policies, which already
--     confine retailers to their own orders and to active catalog rows.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. product_packs: loose pieces are allowed unless the business says otherwise
-- ----------------------------------------------------------------------------
alter table product_packs
  add column if not exists allow_loose_pieces boolean not null default true;

comment on column product_packs.allow_loose_pieces is
  'true (default): a retailer may order any piece quantity — full cases at case_price plus a loose remainder priced by the loose tiers. false: the pack is only sold in whole cases and any remainder is rejected at cart/checkout.';

-- `units_per_case` is the divisor of the whole pricing model, so it is now
-- constrained in the database too (the app validated it already; this closes
-- the direct-API path). Existing rows are normalised first so the constraint
-- can never fail on upgrade.
update product_packs set units_per_case = 1 where units_per_case is null or units_per_case < 1;

alter table product_packs
  drop constraint if exists product_packs_units_per_case_positive;
alter table product_packs
  add constraint product_packs_units_per_case_positive check (units_per_case >= 1);

-- MOQ is measured in PIECES now that a partial case is orderable. The column
-- and its existing > 0 check are unchanged — only the unit it is compared
-- against in the application is clarified.
comment on column product_packs.moq is
  'Minimum order quantity for this pack, measured in PIECES (0026 onward: cart/checkout compare the piece quantity, not the case count). MOQ never forces a full case: with a 40-pc case and MOQ 6, 6, 10, 25, 40 and 46 pcs are all valid.';

-- ----------------------------------------------------------------------------
-- 2. product_pricing_tiers: 'loose' becomes a first-class rule type
--
--    Stored ranges stay half-open [min_quantity, max_quantity) exactly like the
--    pre-existing slabs, so every existing reader keeps working. The admin
--    editor displays them inclusively (1–6 pcs = [1, 7)) and
--    `looseTierDraftToRow()` in lib/retailer/case-pricing.ts is the single
--    place that converts between the two.
-- ----------------------------------------------------------------------------
alter table product_pricing_tiers
  drop constraint if exists product_pricing_tiers_rule_type_check;
alter table product_pricing_tiers
  add constraint product_pricing_tiers_rule_type_check
  check (rule_type in ('default', 'case', 'bulk', 'loose'));

comment on column product_pricing_tiers.rule_type is
  '''loose'' = an admin-configured loose-piece slab applied to Q %% units_per_case. ''default''/''case''/''bulk'' are the pre-0026 slabs and stay readable by the same engine (they are used for the loose domain only while a pack has no ''loose'' rows).';

comment on column product_pricing_tiers.min_quantity is
  'Minimum pieces for this tier (inclusive). For ''loose'' rows this is evaluated on the loose REMAINDER (Q mod units_per_case), never on the total quantity, so a full case can never be repriced by a loose rate.';

comment on column product_pricing_tiers.max_quantity is
  'Upper exclusive bound (pieces). NULL = unbounded (legacy last tier). A loose tier stores an explicit bound of at most units_per_case so it can never reach full-case territory.';

-- A loose quantity must belong to exactly one slab. Partial unique indexes are
-- safe here: no 'loose' rows exist yet, so this can never fail on existing data
-- (legacy 'default'/'bulk' slabs are deliberately not covered).
create unique index if not exists product_pricing_tiers_loose_range_uq
  on product_pricing_tiers (product_pack_id, min_quantity)
  where is_active and rule_type = 'loose';

-- Read path for the engine: tiers of a pack, loose first, cheapest slab last.
create index if not exists idx_product_pricing_tiers_pack_rule
  on product_pricing_tiers (product_pack_id, rule_type, min_quantity);

-- ----------------------------------------------------------------------------
-- 3. order_items: each persisted line states the unit it is billed in
--
--    A mixed purchase (1 case + 6 loose pcs) is stored as two rows of the same
--    pack — one billed in cases at the case price, one in pieces at the loose
--    tier price. That is the only representation that keeps
--
--        unit_price × quantity = line_total        (exactly, in paise)
--
--    true for EVERY line, which the invoice, the returns flow and the
--    accounting reports all depend on. `quantity_pieces` snapshots the piece
--    count so displays and reorders never have to re-derive it from a pack
--    configuration that may change later.
-- ----------------------------------------------------------------------------
alter table order_items
  add column if not exists quantity_unit text not null default 'packs'
    check (quantity_unit in ('packs', 'cases', 'pieces'));

alter table order_items
  add column if not exists quantity_pieces int
    check (quantity_pieces is null or quantity_pieces > 0);

alter table order_items
  add column if not exists units_per_case int
    check (units_per_case is null or units_per_case > 0);

comment on column order_items.quantity_unit is
  '''packs'' = every row written before 0026 (quantity was a case/pack count). New rows: ''cases'' (quantity × case_price) or ''pieces'' (quantity × loose price). unit_price is always the GST-INCLUSIVE price of ONE row unit, so unit_price × quantity reconciles with line_total exactly.';
comment on column order_items.quantity_pieces is
  'Snapshot of how many pieces this line covers (cases row: cases × units_per_case; loose row: the quantity itself). Backfilled for history so totals, reorder and dispatch never re-derive piece counts from a later pack edit.';
comment on column order_items.units_per_case is
  'Pack case size at order time (snapshot). Historical invoices render from this instead of the live product_packs row.';

-- Backfill history: every pre-existing row was billed per pack/case. Use the
-- pack's case size when the row has a pack, the parent product's otherwise.
update order_items oi
set units_per_case = coalesce(pp.units_per_case, p.units_per_case, 1),
    quantity_pieces = greatest(oi.quantity, 1) * greatest(coalesce(pp.units_per_case, p.units_per_case, 1), 1)
from product_packs pp
join products p on p.id = pp.product_id
where pp.id = oi.pack_id
  and (oi.units_per_case is null or oi.quantity_pieces is null);

update order_items oi
set units_per_case = coalesce(p.units_per_case, 1),
    quantity_pieces = greatest(oi.quantity, 1) * greatest(coalesce(p.units_per_case, 1), 1)
from products p
where p.id = oi.product_id
  and (oi.units_per_case is null or oi.quantity_pieces is null);

-- Rows whose product row is gone (should not happen — FK) still need a value.
update order_items
set units_per_case = coalesce(units_per_case, 1),
    quantity_pieces = coalesce(quantity_pieces, greatest(quantity, 1))
where units_per_case is null or quantity_pieces is null;

-- ----------------------------------------------------------------------------
-- 4. Cart: the retailer's entered quantity is now a PIECE count
--
--    cart_items stores no money, so this is a pure unit conversion: an existing
--    "2 packs of a 40-pc case" cart line becomes "80 pcs" and is priced
--    identically (2 cases at the case price). No cart line is dropped and no
--    retailer's pending order changes value.
-- ----------------------------------------------------------------------------
update cart_items ci
set quantity = greatest(ci.quantity, 1) * greatest(pp.units_per_case, 1)
from product_packs pp
where pp.id = ci.pack_id
  and ci.quantity > 0;

comment on column cart_items.quantity is
  'Pieces the retailer wants (0026 onward). May be any valid quantity: 6 pcs, 46 pcs (1 case + 6 loose) or 80 pcs (2 cases). It is never a price and never trusted for money — quoteOrderForRetailer re-reads case_price, the loose tiers, GST and MOQ from the database.';

-- ============================================================================
-- END OF MIGRATION — no pricing rows are inserted or altered, so every product
-- keeps the exact prices it had before; admins opt packs into loose slabs from
-- /admin/products/<id>.
-- ============================================================================
