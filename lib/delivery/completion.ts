import 'server-only';

import { createHash } from 'node:crypto';

/**
 * Contract of `complete_delivery_atomic` (migration 0099): the one database
 * transaction that completes a delivery. This module holds the pure pieces the
 * server action needs around that call — the idempotency key and the mapping
 * from database refusals to the messages staff see.
 */

export const COMPLETE_DELIVERY_RPC = 'complete_delivery_atomic';

export interface CompletionLine {
  orderItemId: string;
  delivered: number;
  missing: number;
  damaged: number;
}

export interface CompletionResult {
  status: 'completed';
  replayed: boolean;
  delivery_id: string;
  order_id: string;
  order_number: string;
  retailer_id: string;
  delivery_status: 'delivered' | 'partially_delivered';
  fully_delivered: boolean;
  shortfall_pieces: number;
  credit_back_paise: number;
  return_window_days: number;
  return_deadline: string;
  delivered_at: string;
}

export interface OtpIncorrectResult {
  status: 'otp_incorrect';
  attempts_remaining: number;
}

/**
 * The same request always produces the same key, so a retry after a lost
 * response is recognised by the database and returns the first result instead
 * of settling again. The key covers the actor, the OTP digest (which changes
 * on every re-dispatch) and the whole payload; a different payload is a
 * different request and is refused once the delivery is complete.
 */
export function completionIdempotencyKey(input: {
  orderId: string;
  actorId: string;
  otpDigest: string;
  receiverName: string;
  notes: string;
  signatureRef: string | null;
  photoRef: string | null;
  items: readonly CompletionLine[];
}): string {
  const items = [...input.items]
    .map((i) => [i.orderItemId, i.delivered, i.missing, i.damaged] as const)
    .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
  const canonical = JSON.stringify([
    input.orderId,
    input.actorId,
    input.otpDigest,
    input.receiverName,
    input.notes,
    input.signatureRef,
    input.photoRef,
    items,
  ]);
  return `dc1:${createHash('sha256').update(canonical, 'utf8').digest('hex')}`;
}

export function isCompletionResult(value: unknown): value is CompletionResult {
  return typeof value === 'object' && value !== null && (value as { status?: unknown }).status === 'completed';
}

export function isOtpIncorrect(value: unknown): value is OtpIncorrectResult {
  return typeof value === 'object' && value !== null && (value as { status?: unknown }).status === 'otp_incorrect';
}

/** True when the database does not have the function yet (0099 not applied). */
export function isCompletionRpcMissing(error: { message?: string; code?: string } | null | undefined): boolean {
  if (!error) return false;
  if (error.code === 'PGRST202' || error.code === '42883') return true;
  return /could not find the function|schema cache|function .* does not exist/i.test(error.message ?? '');
}

export const COMPLETION_NOT_INSTALLED =
  'Delivery completion is not available yet — the database update for it has not been applied. Ask an administrator.';

const GENERIC = 'This delivery could not be completed, so nothing was changed. Refresh and try again.';

/** Database refusal -> the message shown to staff. Nothing was written in any of these cases. */
export function mapCompletionError(message: string | null | undefined): string {
  const text = message ?? '';
  const match = /DELIVERY_COMPLETE:([A-Z_]+):\s*([^\n]*)/.exec(text);
  if (!match) {
    if (/DELIVERY_GUARD:BUSY|could not obtain lock/.test(text)) {
      return 'This delivery is being updated by another request. Nothing was changed — refresh and try again.';
    }
    if (/DELIVERY_GUARD:/.test(text)) {
      return 'This delivery task does not match the order. Ask an admin to re-dispatch it.';
    }
    return GENERIC;
  }
  const [, code, detail] = match;
  switch (code) {
    case 'FORBIDDEN':
    case 'NO_PERMISSION':
      return 'You do not have permission to execute deliveries.';
    case 'NOT_ASSIGNED':
      return 'Only the assigned delivery person can complete this delivery.';
    case 'NOT_FOUND':
      return 'Order not found.';
    case 'NO_DELIVERY':
      return 'No delivery task exists for this order.';
    case 'ALREADY_COMPLETED':
      return 'This delivery was already completed — refresh to see the result.';
    case 'NOT_OPEN':
      return 'This delivery is not open — it was already completed or failed.';
    case 'ORDER_STATE':
      return `This order is ${(detail ?? '').trim().replace(/_/g, ' ') || 'not dispatched'} — it cannot be completed as a delivery.`;
    case 'NO_OTP':
      return 'This delivery has no OTP — ask an admin to regenerate it.';
    case 'OTP_LOCKED':
      return 'Too many wrong OTP attempts. Ask an admin to regenerate the OTP.';
    case 'RECEIVER':
      return 'Receiver name must be 2–120 characters.';
    case 'NOTES':
      return 'Delivery notes must be 1000 characters or fewer.';
    case 'PROOF':
      return 'Proof files must belong to this order — re-capture and try again.';
    case 'PROOF_MISSING':
      return 'A proof file could not be found in storage — re-capture it and try again.';
    case 'PROOF_OWNER':
      return 'A proof file was not uploaded by the delivery person for this order — re-capture it and try again.';
    case 'LINES_REQUIRED':
      return 'Delivery quantities for every order line are required.';
    case 'QUANTITY':
      return 'Quantities must be whole numbers of 0 or more.';
    case 'DUPLICATE_LINES':
      return 'Duplicate order lines in the submission.';
    case 'UNKNOWN_LINE':
      return 'A submitted line does not belong to this delivery.';
    case 'MISSING_LINES':
      return `Quantities are required for all ${(detail ?? '').trim() || ''} order lines.`.replace('all  order', 'all order');
    case 'QUANTITY_SPLIT':
      return 'Delivered + missing + damaged must equal the ordered quantity for every line.';
    case 'NO_LINES':
      return 'This delivery task has no line snapshots.';
    case 'SNAPSHOT_MISMATCH':
      return 'This delivery task does not match the order lines. Ask an admin to re-dispatch it.';
    case 'SNAPSHOT_TAMPERED':
      return 'This delivery task no longer matches the original order quantities. Ask an admin to re-dispatch it.';
    default:
      return GENERIC;
  }
}
