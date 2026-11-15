/**
 * Dispatch, failed delivery and return to warehouse run as single database
 * transactions (migration 0100): dispatch_order_atomic, fail_delivery_atomic
 * and return_delivery_to_warehouse_atomic. This module holds the pure parts —
 * result shapes and the mapping from a database refusal to a staff message.
 * In every refusal nothing was written.
 */

export interface DispatchResultRow {
  status: 'dispatched';
  order_id: string;
  order_number: string;
  retailer_id: string;
  delivery_id: string;
  redispatch: boolean;
  product_ids: string[];
}

export interface FailedDeliveryResultRow {
  status: 'failed';
  replayed: boolean;
  order_id: string;
  order_number: string;
  retailer_id: string;
  delivery_id: string;
  order_reopened: boolean;
}

export interface ReturnToWarehouseResultRow {
  status: 'returned';
  replayed: boolean;
  order_id: string;
  order_number: string;
  retailer_id: string;
  delivery_id: string;
  refunded_paise: number;
}

function hasStatus<T extends string>(value: unknown, status: T): boolean {
  return typeof value === 'object' && value !== null && (value as { status?: unknown }).status === status;
}

export function isDispatchResult(value: unknown): value is DispatchResultRow {
  return hasStatus(value, 'dispatched') && typeof (value as DispatchResultRow).delivery_id === 'string';
}

export function isFailedDeliveryResult(value: unknown): value is FailedDeliveryResultRow {
  return hasStatus(value, 'failed') && typeof (value as FailedDeliveryResultRow).delivery_id === 'string';
}

export function isReturnToWarehouseResult(value: unknown): value is ReturnToWarehouseResultRow {
  return hasStatus(value, 'returned') && typeof (value as ReturnToWarehouseResultRow).delivery_id === 'string';
}

/** True when the database does not have the function yet (0100 not applied). */
export function isFulfilmentRpcMissing(error: { message?: string; code?: string } | null | undefined): boolean {
  if (!error) return false;
  if (error.code === 'PGRST202' || error.code === '42883') return true;
  return /could not find the function|schema cache|function .* does not exist/i.test(error.message ?? '');
}

export const FULFILMENT_NOT_INSTALLED =
  'This step is not available yet — the database update for it has not been applied. Ask an administrator.';

const NOTHING_CHANGED = 'Nothing was changed. Refresh and try again.';

function readable(status: string | undefined): string {
  return (status ?? '').trim().replace(/_/g, ' ');
}

const BUSY = /DELIVERY_GUARD:BUSY|could not obtain lock|deadlock detected/i;

export function mapDispatchError(message: string | null | undefined): string {
  const text = message ?? '';
  const stock = /INSUFFICIENT_STOCK:\s*([^\n]+)/.exec(text);
  if (stock?.[1]) return stock[1].trim();
  if (BUSY.test(text)) return `This order is being updated by another request. ${NOTHING_CHANGED}`;
  const match = /DISPATCH:([A-Z_]+):\s*([^\n]*)/.exec(text);
  if (!match) return `This order could not be dispatched. ${NOTHING_CHANGED}`;
  const [, code, detail] = match;
  switch (code) {
    case 'FORBIDDEN':
    case 'NO_PERMISSION':
      return 'You do not have permission to dispatch orders.';
    case 'SCOPE':
      return 'This order is outside your warehouse or area.';
    case 'NOT_FOUND':
      return 'Order not found.';
    case 'NO_WAREHOUSE':
      return 'This order has no warehouse assigned.';
    case 'NO_ITEMS':
      return 'This order has no items.';
    case 'ALREADY_DISPATCHED':
      return 'This order is already dispatched. If the retailer did not receive the delivery OTP, ask an admin to regenerate it.';
    case 'ORDER_STATE':
      return `This order is ${readable(detail) || 'not ready'} — only confirmed, processing, or packed orders can be dispatched.`;
    case 'DELIVERY_EXISTS':
      return 'A delivery task already exists for this order and is not in a failed state.';
    default:
      return `This order could not be dispatched. ${NOTHING_CHANGED}`;
  }
}

export function mapFailedDeliveryError(message: string | null | undefined): string {
  const text = message ?? '';
  if (BUSY.test(text)) return `This delivery is being updated by another request. ${NOTHING_CHANGED}`;
  const match = /DELIVERY_FAIL:([A-Z_]+):\s*([^\n]*)/.exec(text);
  if (!match) return `This delivery could not be marked failed. ${NOTHING_CHANGED}`;
  const [, code, detail] = match;
  switch (code) {
    case 'FORBIDDEN':
    case 'NO_PERMISSION':
      return 'You do not have permission to execute deliveries.';
    case 'NOT_ASSIGNED':
      return 'Only the assigned delivery person can fail this delivery.';
    case 'REASON':
      return 'Describe the failure in 3–500 characters.';
    case 'NOT_FOUND':
      return 'Order not found.';
    case 'NO_DELIVERY':
      return 'No delivery task exists for this order.';
    case 'NOT_OPEN':
      return `This delivery is ${readable(detail) || 'closed'} — it can no longer be marked failed.`;
    case 'ORDER_STATE':
      return `This order is ${readable(detail) || 'not dispatched'} — a failed-delivery re-open is not possible.`;
    default:
      return `This delivery could not be marked failed. ${NOTHING_CHANGED}`;
  }
}

export function mapReturnToWarehouseError(message: string | null | undefined): string {
  const text = message ?? '';
  if (BUSY.test(text)) return `This delivery is being updated by another request. ${NOTHING_CHANGED}`;
  const match = /DELIVERY_RETURN:([A-Z_]+):\s*([^\n]*)/.exec(text);
  if (!match) {
    if (/reconciliation/i.test(text)) {
      return 'The wallet history for this order needs an Admin to reconcile it before the return. Nothing was changed.';
    }
    return `This order could not be returned to the warehouse. ${NOTHING_CHANGED}`;
  }
  const [, code, detail] = match;
  switch (code) {
    case 'FORBIDDEN':
    case 'NO_PERMISSION':
      return 'You do not have permission to manage returns.';
    case 'SCOPE':
      return 'This order is outside your warehouse or area.';
    case 'NOTES':
      return 'Notes must be 1000 characters or fewer.';
    case 'NOT_FOUND':
      return 'Order not found.';
    case 'NO_DELIVERY':
      return 'No delivery task exists for this order.';
    case 'NOT_RETURNABLE':
      return `This delivery is ${readable(detail) || 'not completed'} — only a completed delivery can be returned to the warehouse.`;
    case 'ORDER_STATE':
      return `This order is ${readable(detail) || 'not delivered'} — return to warehouse is not possible.`;
    case 'RECONCILE':
      return 'This delivery already has a shortfall credit. An Admin must reconcile the wallet before the order can be returned. Nothing was changed.';
    default:
      return `This order could not be returned to the warehouse. ${NOTHING_CHANGED}`;
  }
}
