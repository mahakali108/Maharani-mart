/**
 * Delivery task state machine. Pure — imported by server actions, pages and
 * tests alike. The database mirrors the important legs through order status
 * transitions (0042) and the delivery actions pre-check with these guards;
 * `order_deliveries.delivery_status` itself is validated by its CHECK
 * constraint plus the action-layer guards below.
 *
 * Lifecycle (decision D3):
 *
 *   assigned ──▶ in_progress ──▶ delivered | partially_delivered
 *      │              │
 *      │              └──▶ failed ──▶ assigned   (re-attempt: order goes
 *      │                                    back to processing, the next
 *      │                                    dispatch resets the task)
 *      └──▶ failed
 *
 *   delivered / partially_delivered ──▶ returned_to_warehouse (terminal)
 *
 * Rules:
 *  - `assigned` is created at DISPATCH. It may sit unassigned (admin assigns
 *    later) — `assigned_staff_id` is nullable.
 *  - `failed` re-opens the order (dispatched → processing) so the warehouse
 *    can re-pick; the next dispatch flips the task back to `assigned`.
 *  - `returned_to_warehouse` is terminal: the order moves to `returned` and
 *    stock is restored via the return_order_stock RPC.
 */

export const DELIVERY_STATUSES = [
  'assigned',
  'in_progress',
  'delivered',
  'partially_delivered',
  'failed',
  'returned_to_warehouse',
] as const;

export type DeliveryStatus = (typeof DELIVERY_STATUSES)[number];

export function isDeliveryStatus(value: unknown): value is DeliveryStatus {
  return typeof value === 'string' && (DELIVERY_STATUSES as readonly string[]).includes(value);
}

/** Terminal delivery outcomes — no further transitions. */
const TERMINAL_DELIVERY_STATUSES: readonly DeliveryStatus[] = [
  'returned_to_warehouse',
];

export function isTerminalDeliveryStatus(status: DeliveryStatus): boolean {
  return TERMINAL_DELIVERY_STATUSES.includes(status);
}

/**
 * Legal transitions. Mirrors the lifecycle diagram above.
 * `failed → assigned` is the re-dispatch reset, performed only by the
 * dispatch action (never by a delivery staff member directly).
 */
const ALLOWED_DELIVERY_TRANSITIONS: Record<DeliveryStatus, readonly DeliveryStatus[]> = {
  // Completion is allowed straight from `assigned` — a delivery person on a
  // quick run should not be forced through a ceremonial "Start" tap first.
  assigned: ['in_progress', 'delivered', 'partially_delivered', 'failed'],
  in_progress: ['delivered', 'partially_delivered', 'failed'],
  delivered: ['returned_to_warehouse'],
  partially_delivered: ['returned_to_warehouse'],
  failed: ['assigned'],
  returned_to_warehouse: [],
};

export function allowedDeliveryTransitionsFrom(status: DeliveryStatus): readonly DeliveryStatus[] {
  return ALLOWED_DELIVERY_TRANSITIONS[status];
}

export function canTransitionDeliveryStatus(from: DeliveryStatus, to: DeliveryStatus): boolean {
  if (from === to) return true; // legal no-op
  return ALLOWED_DELIVERY_TRANSITIONS[from].includes(to);
}

export function describeDeliveryTransitionError(
  from: DeliveryStatus,
  to: DeliveryStatus
): string | null {
  if (canTransitionDeliveryStatus(from, to)) return null;
  const options = allowedDeliveryTransitionsFrom(from);
  if (options.length === 0) return `Delivery is ${from.replace(/_/g, ' ')} — no further changes are allowed.`;
  return `Cannot move delivery from "${from.replace(/_/g, ' ')}" to "${to.replace(/_/g, ' ')}". Allowed: ${options
    .map((s) => s.replace(/_/g, ' '))
    .join(', ')}.`;
}

/** Statuses at which the delivery task counts as completed (goods handed over). */
export const COMPLETED_DELIVERY_STATUSES: readonly DeliveryStatus[] = [
  'delivered',
  'partially_delivered',
];

export function isCompletedDeliveryStatus(status: DeliveryStatus): boolean {
  return COMPLETED_DELIVERY_STATUSES.includes(status);
}

/** Statuses that still represent an open task for the delivery staff. */
export const OPEN_DELIVERY_STATUSES: readonly DeliveryStatus[] = [
  'assigned',
  'in_progress',
];

export function isOpenDeliveryStatus(status: DeliveryStatus): boolean {
  return OPEN_DELIVERY_STATUSES.includes(status);
}
