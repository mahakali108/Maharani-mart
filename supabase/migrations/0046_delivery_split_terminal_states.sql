-- ============================================================================
-- 0046: Delivery split invariant — terminal-state enforcement (Phase 4, F1 fix)
--
-- WHY
-- ---
-- 0043 installed an UNCONDITIONAL check on order_delivery_items:
--   delivered + missing + damaged = ordered   (at ALL times)
-- But dispatch snapshots lines as 0/0/0 — nothing has been counted yet
-- (the goods are on the truck, not in the customer's hands) — so EVERY
-- dispatch violated the check and the whole dispatch → delivery → collection
-- flow was unexecutable (production-validation finding F1).
--
-- NEW RULE (this migration)
-- ---
-- * Non-terminal parent (assigned / in_progress): lines may be partially
--   counted — delivered + missing + damaged <= ordered. Dispatch inserts
--   0/0/0 snapshots; counting happens at completion. Counts are NEVER faked
--   at dispatch.
-- * Terminal parent (delivered / partially_delivered / failed /
--   returned_to_warehouse): every line MUST balance exactly —
--   delivered + missing + damaged = ordered.
-- * Non-negativity is unchanged (0043's order_delivery_items_qty_check stays
--   in place and is NOT dropped here).
--
-- MECHANICS (a row CHECK cannot see the parent table, so a relaxed CHECK
-- plus two triggers implement the rule)
-- ---
-- * order_delivery_items_split (0043, unconditional `=`) is dropped and
--   replaced by order_delivery_items_split_partial (`<=`).
-- * trg_enforce_delivery_split (BEFORE INSERT OR UPDATE on
--   order_delivery_items): when the parent task is terminal, the written row
--   must balance exactly.
-- * trg_enforce_delivery_lines_complete (BEFORE INSERT OR UPDATE OF
--   delivery_status on order_deliveries): a task may only ENTER a terminal
--   state when every existing line balances exactly; tasks are always born
--   non-terminal (an INSERT with a terminal status is rejected — lines
--   cannot exist before their parent).
--
-- APP CONTRACT (asserted by tests/delivery-split-invariant.test.ts)
-- ---
-- * dispatch inserts 0/0/0 snapshots — never faked counts.
-- * completeDeliveryAction writes full splits line-by-line BEFORE flipping
--   the parent to delivered/partially_delivered (already lines-first).
-- * recordFailedDeliveryAction records every line as fully missing
--   (missing = ordered) BEFORE flipping the parent to failed — goods that
--   never reached the customer are missing-from-delivery, and re-dispatch
--   resets these rows anyway.
-- * RTO needs no line changes (reachable only from delivered /
--   partially_delivered, whose lines already balance).
--
-- ORDER: must run AFTER 0043 (it drops 0043's constraint). The filename
-- order guarantees this via the normal migration runner.
--
-- SAFETY: additive & re-runnable (drop constraint/trigger if exists +
-- create or replace). No table, column or data is modified; the only
-- behavioural change is WHEN the split must balance.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Relax the row CHECK: partial counts allowed pre-completion.
--    (Safe on existing rows: any row that satisfied `=` also satisfies `<=`.)
-- ----------------------------------------------------------------------------

alter table order_delivery_items
  drop constraint if exists order_delivery_items_split;

alter table order_delivery_items
  drop constraint if exists order_delivery_items_split_partial;

alter table order_delivery_items
  add constraint order_delivery_items_split_partial
    check (quantity_delivered + quantity_missing + quantity_damaged <= quantity_ordered);

-- ----------------------------------------------------------------------------
-- 2. Line trigger: in a terminal parent state, every written row must balance.
-- ----------------------------------------------------------------------------

create or replace function enforce_delivery_split_for_terminal_states() returns trigger as $$
declare
  v_status text;
begin
  select od.delivery_status into v_status
    from order_deliveries od
   where od.id = new.delivery_id;

  if v_status in ('delivered', 'partially_delivered', 'failed', 'returned_to_warehouse')
     and (new.quantity_delivered + new.quantity_missing + new.quantity_damaged
          is distinct from new.quantity_ordered) then
    raise exception 'DELIVERY_SPLIT_INCOMPLETE: line for delivery % (%) must balance (delivered + missing + damaged = ordered) once the task is %',
      new.delivery_id, new.order_item_id, v_status
      using errcode = 'check_violation';
  end if;

  return new;
end;
$$ language plpgsql;

drop trigger if exists trg_enforce_delivery_split on order_delivery_items;
create trigger trg_enforce_delivery_split
  before insert or update on order_delivery_items
  for each row execute function enforce_delivery_split_for_terminal_states();

-- ----------------------------------------------------------------------------
-- 3. Parent trigger: a task may only ENTER a terminal state with balanced
--    lines, and is always born non-terminal.
-- ----------------------------------------------------------------------------

create or replace function enforce_delivery_lines_complete_on_terminal() returns trigger as $$
begin
  -- INSERT: lines cannot exist before their parent, so a task must be born
  -- non-terminal (dispatch always creates 'assigned').
  if tg_op = 'INSERT' then
    if new.delivery_status in ('delivered', 'partially_delivered', 'failed', 'returned_to_warehouse') then
      raise exception 'DELIVERY_BORN_TERMINAL: a delivery task must be created non-terminal (got %)',
        new.delivery_status
        using errcode = 'check_violation';
    end if;
    return new;
  end if;

  -- UPDATE OF delivery_status: entering a terminal state requires every
  -- existing line to balance exactly.
  if new.delivery_status in ('delivered', 'partially_delivered', 'failed', 'returned_to_warehouse') then
    if exists (
      select 1
        from order_delivery_items li
       where li.delivery_id = new.id
         and (li.quantity_delivered + li.quantity_missing + li.quantity_damaged
              is distinct from li.quantity_ordered)
    ) then
      raise exception 'DELIVERY_LINES_INCOMPLETE: task % cannot move to % until every line balances (delivered + missing + damaged = ordered)',
        new.id, new.delivery_status
        using errcode = 'check_violation';
    end if;
  end if;

  return new;
end;
$$ language plpgsql;

drop trigger if exists trg_enforce_delivery_lines_complete on order_deliveries;
create trigger trg_enforce_delivery_lines_complete
  before insert or update of delivery_status on order_deliveries
  for each row execute function enforce_delivery_lines_complete_on_terminal();

-- ============================================================================
-- END OF MIGRATION — no business data inserted.
-- ============================================================================
