/**
 * Order status state machine — the single source of truth for valid status
 * transitions, shared by every server action that moves an order forward.
 * Pure and unit-tested (tests/order-state-machine.test.ts). Phase 4 adds a
 * database trigger (enforce_order_status_transitions) that enforces the
 * SAME table, so neither a UI bug nor a direct API call can skip a state.
 */

export const ORDER_STATUSES = [
  'pending',
  'confirmed',
  'processing',
  'packed',
  'dispatched',
  'delivered',
  'cancelled',
  'returned',
] as const;

export type OrderStatus = (typeof ORDER_STATUSES)[number];

export function isOrderStatus(value: unknown): value is OrderStatus {
  return typeof value === 'string' && (ORDER_STATUSES as readonly string[]).includes(value);
}

/**
 * Valid transitions. Notes:
 * - `confirmed/processing/packed → dispatched`: the FEFO dispatch RPC accepts
 *   all three (lib/staff/dispatch-actions.ts), so all three stay legal.
 * - `dispatched → processing`: failed-delivery re-attempt (decision D3).
 * - `dispatched → returned`: return-to-warehouse (Phase 4).
 * - `delivered → returned`: full return-to-warehouse after delivery (Phase 4);
 *   per-item returns keep the order `delivered` (existing returns flow).
 * - Retailer self-cancel (`pending → cancelled`) is additionally constrained
 *   by its own RLS policy (orders_retailer_cancel, 0009).
 */
const ALLOWED_TRANSITIONS: Record<OrderStatus, readonly OrderStatus[]> = {
  pending: ['confirmed', 'cancelled'],
  confirmed: ['processing', 'dispatched', 'cancelled'],
  processing: ['packed', 'dispatched', 'cancelled'],
  packed: ['dispatched', 'cancelled'],
  dispatched: ['delivered', 'processing', 'returned'],
  delivered: ['returned'],
  cancelled: [],
  returned: [],
};

/** A same-status update is always a legal no-op (the DB history trigger only logs real changes). */
export function canTransitionOrderStatus(from: OrderStatus, to: OrderStatus): boolean {
  if (from === to) return true;
  return ALLOWED_TRANSITIONS[from]?.includes(to) ?? false;
}

export function allowedTransitionsFrom(from: OrderStatus): OrderStatus[] {
  return [...(ALLOWED_TRANSITIONS[from] ?? [])];
}

export function isTerminalOrderStatus(status: OrderStatus): boolean {
  return allowedTransitionsFrom(status).length === 0;
}

/** Human explanation used in action error messages. */
export function describeTransitionError(from: OrderStatus, to: OrderStatus): string {
  if (canTransitionOrderStatus(from, to)) return '';
  const options = allowedTransitionsFrom(from);
  if (options.length === 0) {
    return `An order that is ${from} can no longer change status.`;
  }
  return `An order that is ${from} can only move to ${options.join(', ')} — not to ${to}.`;
}
