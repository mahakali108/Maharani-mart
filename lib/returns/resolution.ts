/**
 * Return-request approval and rejection run as single database transactions
 * (migration 0101): approve_return_request_atomic and
 * reject_return_request_atomic. This module holds the pure parts — result
 * shapes and the mapping from a database refusal to an Admin message.
 * In every refusal nothing was written: no stock moved, no status changed.
 *
 * Approving a return request moves NO Coins and reverses NO loyalty points.
 * The refund rule for approved returns is an open owner decision; the database
 * records refund_paise = 0 in the history row.
 */

export interface ReturnApprovalResultRow {
  status: 'approved';
  replayed: boolean;
  return_request_id: string;
  order_id: string;
  order_number: string;
  retailer_id: string;
  order_item_id: string | null;
  units_restored: number;
  refund_paise: number;
}

export interface ReturnRejectionResultRow {
  status: 'rejected';
  replayed: boolean;
  return_request_id: string;
  order_id: string;
  order_number: string;
  retailer_id: string;
}

function hasStatus(value: unknown, status: string): boolean {
  return typeof value === 'object' && value !== null && (value as { status?: unknown }).status === status;
}

export function isReturnApprovalResult(value: unknown): value is ReturnApprovalResultRow {
  return (
    hasStatus(value, 'approved') &&
    typeof (value as ReturnApprovalResultRow).return_request_id === 'string' &&
    typeof (value as ReturnApprovalResultRow).units_restored === 'number'
  );
}

export function isReturnRejectionResult(value: unknown): value is ReturnRejectionResultRow {
  return hasStatus(value, 'rejected') && typeof (value as ReturnRejectionResultRow).return_request_id === 'string';
}

/** True when the database does not have the function yet (0101 not applied). */
export function isReturnRpcMissing(error: { message?: string; code?: string } | null | undefined): boolean {
  if (!error) return false;
  if (error.code === 'PGRST202' || error.code === '42883') return true;
  return /could not find the function|schema cache|function .* does not exist/i.test(error.message ?? '');
}

export const RETURNS_NOT_INSTALLED =
  'Return requests cannot be resolved yet — the database update for it has not been applied. Ask an administrator.';

export const RETURNS_WRITER_UNAVAILABLE =
  'Return requests cannot be resolved because the server is not fully configured. Ask an administrator.';

export const RETURNS_ADMIN_ONLY = 'Only an Admin or Super Admin can approve or reject a return request.';

const NOTHING_CHANGED = 'Nothing was changed.';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isReturnRequestId(value: unknown): value is string {
  return typeof value === 'string' && UUID.test(value);
}

function readable(status: string | undefined): string {
  return (status ?? '').trim().replace(/_/g, ' ');
}

function parse(prefix: string, message: string | null | undefined): { code: string; detail: string } | null {
  const match = new RegExp(`${prefix}:([A-Z_]+):?\\s*([^\\n]*)`).exec(message ?? '');
  if (!match) return null;
  return { code: match[1] ?? '', detail: (match[2] ?? '').trim() };
}

export function mapReturnApprovalError(message: string | null | undefined): string {
  if (/could not obtain lock|deadlock detected/i.test(message ?? '')) {
    return `This order is being updated by another request. ${NOTHING_CHANGED} Refresh and try again.`;
  }
  const parsed = parse('RETURN_APPROVE', message);
  if (!parsed) return `This return request could not be approved. ${NOTHING_CHANGED} Refresh and try again.`;
  switch (parsed.code) {
    case 'FORBIDDEN':
    case 'NO_PERMISSION':
      return RETURNS_ADMIN_ONLY;
    case 'NOT_FOUND':
      return 'Return request not found.';
    case 'NOTE':
      return 'The note must be 1000 characters or fewer.';
    case 'ALREADY_RESOLVED':
      return `This return request has already been ${readable(parsed.detail) || 'resolved'}.`;
    case 'ORDER_STATE':
      return parsed.detail === 'returned'
        ? `This order was already returned to the warehouse, so its stock is already back. ${NOTHING_CHANGED} Reject the request with a note if it is no longer needed.`
        : `Only a delivered order can have a return approved (this order is ${readable(parsed.detail) || 'in another state'}). ${NOTHING_CHANGED}`;
    case 'RECONCILE':
      return `This return covers goods that were short or damaged at delivery and were already settled in Coins. It cannot be approved here; it needs manual reconciliation. ${NOTHING_CHANGED}`;
    case 'SELLER_RETURN':
      return `This return includes goods fulfilled by a seller. They can be returned only after they are recorded as received back, and that step is not available yet. ${NOTHING_CHANGED}`;
    case 'ALREADY_RESTORED':
      return `The stock for this return is already back in inventory. ${NOTHING_CHANGED} Reject the request with a note if it is a duplicate.`;
    case 'QUANTITY':
    case 'INVALID_ITEM':
    case 'INVALID_REQUEST':
    case 'STOCK_MISMATCH':
      return `The quantities on this return do not match the order. ${NOTHING_CHANGED} Ask an administrator to check the order.`;
    default:
      return `This return request could not be approved. ${NOTHING_CHANGED} Refresh and try again.`;
  }
}

export function mapReturnRejectionError(message: string | null | undefined): string {
  const parsed = parse('RETURN_REJECT', message);
  if (!parsed) return `This return request could not be rejected. ${NOTHING_CHANGED} Refresh and try again.`;
  switch (parsed.code) {
    case 'FORBIDDEN':
    case 'NO_PERMISSION':
      return RETURNS_ADMIN_ONLY;
    case 'NOT_FOUND':
      return 'Return request not found.';
    case 'NOTE':
      return 'Please give a reason of 3 to 1000 characters for rejecting this return request.';
    case 'ALREADY_RESOLVED':
      return `This return request has already been ${readable(parsed.detail) || 'resolved'}.`;
    default:
      return `This return request could not be rejected. ${NOTHING_CHANGED} Refresh and try again.`;
  }
}
