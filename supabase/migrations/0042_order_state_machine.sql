-- ============================================================================
-- 0042: Order status state machine (Phase 4 — order lifecycle)
--
-- WHY
-- ---
-- updateOrderStatusAction accepted ANY status value — the server validated
-- permissions but not transitions (pending → delivered was technically
-- possible through the API). The shared pure module
-- lib/orders/state-machine.ts now guards every action; this migration adds
-- the same table as a BEFORE UPDATE trigger so the database itself rejects
-- invalid transitions no matter which code path (or direct API call)
-- attempts them.
--
-- The transition table MUST stay in sync with ALLOWED_TRANSITIONS in
-- lib/orders/state-machine.ts (tests/order-state-machine.test.ts asserts
-- the module; tests/deliveries-workflow.test.ts asserts this trigger
-- matches it).
--
-- Notes:
-- * A same-status UPDATE is a legal no-op (the history trigger from 0008
--   only logs real changes).
-- * The retailer self-cancel path (pending → cancelled, RLS policy
--   orders_retailer_cancel from 0009) remains valid.
-- * dispatched → processing is the failed-delivery re-attempt (decision D3).
-- * delivered → returned is the full return-to-warehouse path (Phase 4);
--   per-item returns keep the order 'delivered' as before.
--
-- SAFETY: additive & re-runnable (create or replace + drop trigger if
-- exists). No table, column or data is modified.
-- ============================================================================

create or replace function enforce_order_status_transitions() returns trigger as $$
begin
  -- Same-status update: no-op, allowed.
  if new.status is not distinct from old.status then
    return new;
  end if;

  if not (
    (old.status = 'pending'    and new.status in ('confirmed', 'cancelled'))
    or (old.status = 'confirmed'  and new.status in ('processing', 'dispatched', 'cancelled'))
    or (old.status = 'processing' and new.status in ('packed', 'dispatched', 'cancelled'))
    or (old.status = 'packed'     and new.status in ('dispatched', 'cancelled'))
    or (old.status = 'dispatched' and new.status in ('delivered', 'processing', 'returned'))
    or (old.status = 'delivered'  and new.status in ('returned'))
  ) then
    raise exception 'INVALID_ORDER_STATUS_TRANSITION: % -> %', old.status, new.status
      using errcode = 'check_violation';
  end if;

  return new;
end;
$$ language plpgsql;

drop trigger if exists trg_enforce_order_status_transitions on orders;
create trigger trg_enforce_order_status_transitions
  before update of status on orders
  for each row execute function enforce_order_status_transitions();

-- ============================================================================
-- END OF MIGRATION — no business data inserted.
-- ============================================================================
