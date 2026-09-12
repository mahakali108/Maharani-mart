'use server';

/**
 * Delivery workflow server actions (Phase 4).
 *
 * Lifecycle decisions (docs/PHASE1_AUDIT_FEATURE_MATRIX.md D1–D7):
 *  - The delivery task is created at DISPATCH (see lib/staff/dispatch-actions.ts),
 *    defaulting to the dispatching staff member; admins can (re)assign it to
 *    any active staff member or salesman afterwards.
 *  - The OTP is generated at dispatch, stored ONLY as a SHA-256 hash and sent
 *    once to the RETAILER via an in-app notification. The delivery staff
 *    member obtains it from the retailer and submits it at completion.
 *    Wrong attempts are counted (max 10, DB-enforced); admins can regenerate.
 *  - Completion records receiver name, per-line delivered/missing/damaged
 *    quantities, optional signature/photo proof (private buckets) and notes.
 *    Missing/damaged value is credited back to the retailer's wallet as a
 *    REFUND_CREDIT (decision D4) — the retailer never pays for undelivered
 *    goods.
 *  - A FAILED delivery re-opens the order (dispatched → processing,
 *    decision D3) so the warehouse can re-pick; the next dispatch resets
 *    the same task row.
 *  - RETURN TO WAREHOUSE is terminal: stock is booked back via
 *    return_order_stock, the order moves to `returned` and the wallet
 *    debit (minus any shortfall already refunded) is reversed.
 *
 * Every mutation is permission-checked, state-machine-checked and guarded
 * with an optimistic `.eq('<current status>')` so a concurrent double-submit
 * can never skip a state.
 */

import { revalidatePath } from 'next/cache';

import { requireUser, type CurrentUser } from '@/lib/auth/session';
import { can } from '@/lib/permissions/permissions';
import { createInAppNotification, notifyOrderEvent } from '@/lib/notifications/notify';
import { createClient } from '@/lib/supabase/server';
import { reverseOrderWalletDebit } from '@/lib/orders/wallet-reversal';

import {
  canTransitionDeliveryStatus,
  describeDeliveryTransitionError,
  type DeliveryStatus,
} from './state-machine';
import { generateDeliveryOtp, hashDeliveryOtp, isValidOtpFormat, verifyDeliveryOtp, MAX_OTP_ATTEMPTS } from './otp';
import { computePartialSettlement, type SettlementLine } from './settlement';
import { computeReturnDeadline, parseReturnWindowDays } from './return-window';

// ---------------------------------------------------------------------------
// Types (server action results)
// ---------------------------------------------------------------------------

export type DeliveryActionResult = { error: string } | { success: true; message?: string };

export interface DeliveryItemInput {
  orderItemId: string;
  delivered: number;
  missing: number;
  damaged: number;
}

export interface DeliveryCompletionInput {
  otp: string;
  receiverName: string;
  notes?: string;
  signatureUrl?: string | null;
  photoUrl?: string | null;
  items: DeliveryItemInput[];
}

// ---------------------------------------------------------------------------
// Internal helpers (NOT exported — 'use server' modules export actions only)
// ---------------------------------------------------------------------------

interface DeliveryRow {
  id: string;
  order_id: string;
  delivery_status: string;
  assigned_staff_id: string | null;
  otp_hash: string | null;
  otp_verified_at: string | null;
  otp_attempts: number;
}

interface OrderRow {
  id: string;
  status: string;
  order_number: string;
  retailer_id: string;
}

function revalidateDeliveryPaths(orderId: string) {
  revalidatePath('/admin/delivered');
  revalidatePath(`/admin/orders/${orderId}`);
  revalidatePath('/admin/orders');
  revalidatePath('/staff/deliveries');
  revalidatePath(`/staff/deliveries/${orderId}`);
  revalidatePath('/staff/orders');
  revalidatePath(`/staff/orders/${orderId}`);
  revalidatePath('/salesman/deliveries');
  revalidatePath(`/salesman/deliveries/${orderId}`);
  revalidatePath('/retailer/orders');
  revalidatePath(`/retailer/orders/${orderId}`);
  revalidatePath(`/retailer/orders/${orderId}/delivery`);
}

async function fetchDeliveryWithOrder(
  supabase: ReturnType<typeof createClient>,
  orderId: string
): Promise<{ delivery: DeliveryRow; order: OrderRow } | { error: string }> {
  const { data: delivery } = await supabase
    .from('order_deliveries')
    .select('id, order_id, delivery_status, assigned_staff_id, otp_hash, otp_verified_at, otp_attempts')
    .eq('order_id', orderId)
    .maybeSingle<DeliveryRow>();
  if (!delivery) return { error: 'No delivery task exists for this order.' };

  const { data: order } = await supabase
    .from('orders')
    .select('id, status, order_number, retailer_id')
    .eq('id', delivery.order_id)
    .maybeSingle<OrderRow>();
  if (!order) return { error: 'Order not found.' };

  return { delivery, order };
}

function isAdminLike(user: CurrentUser): boolean {
  return user.role === 'admin' || user.role === 'super_admin';
}

/**
 * A proof ref is valid only when it points INSIDE this order's folder in the
 * delivery-proofs bucket (`deliveries/{orderId}/…`) — a tampered client must
 * not be able to attach another order's (or a foreign) object as "proof".
 * `undefined`/empty is fine: proofs are optional.
 */
function isValidDeliveryProofRef(ref: string | null | undefined, orderId: string): boolean {
  if (!ref || ref.trim() === '') return true;
  const value = ref.trim();
  return (
    value.startsWith(`deliveries/${orderId}/`) &&
    value.length <= 300 &&
    !value.includes('..') &&
    !value.includes('://')
  );
}

function staffDeliveryLink(userRole: string, orderId: string): string {
  return userRole === 'salesman' ? `/salesman/deliveries/${orderId}` : `/staff/deliveries/${orderId}`;
}

/** Value paise per order line + the pieces snapshot, for settlement math. */
interface OrderLineValue {
  id: string;
  line_total: number;
  quantity: number;
  quantity_pieces: number | null;
}

// ---------------------------------------------------------------------------
// Assignment & OTP management (admin/dispatch desk)
// ---------------------------------------------------------------------------

/**
 * Assign or reassign the delivery task. Requires `deliveries.assign`
 * (admin+, staff). The task must still be open (assigned / in_progress).
 */
export async function assignDeliveryStaffAction(
  orderId: string,
  staffId: string | null
): Promise<DeliveryActionResult> {
  const user = await requireUser();
  if (!can(user.role, 'deliveries.assign')) {
    return { error: 'You do not have permission to assign deliveries.' };
  }

  const supabase = createClient();
  const found = await fetchDeliveryWithOrder(supabase, orderId);
  if ('error' in found) return { error: found.error };
  const { delivery } = found;

  if (delivery.delivery_status !== 'assigned' && delivery.delivery_status !== 'in_progress') {
    return { error: 'This delivery is already completed — it can no longer be reassigned.' };
  }
  if (delivery.assigned_staff_id === staffId) {
    return { success: true, message: staffId ? 'Assignment unchanged.' : 'Task left unassigned.' };
  }

  let staffRole: string | null = null;
  let staffName: string | null = null;
  if (staffId) {
    const { data: profile } = await supabase
      .from('profiles')
      .select('role, full_name, is_active')
      .eq('id', staffId)
      .maybeSingle<{ role: string; full_name: string; is_active: boolean }>();
    if (!profile || !profile.is_active) return { error: 'That team member is not active.' };
    if (profile.role !== 'staff' && profile.role !== 'salesman') {
      return { error: 'Deliveries can only be assigned to staff members or sales executives.' };
    }
    staffRole = profile.role;
    staffName = profile.full_name;
  }

  const now = new Date().toISOString();
  // The .in() guard makes this claim atomic against a concurrent reassignment
  // or completion; a 0-row update returns NO error, so the returned row is
  // the proof the claim landed.
  const { data: claimed, error } = await supabase
    .from('order_deliveries')
    .update({
      assigned_staff_id: staffId,
      assigned_at: staffId ? now : null,
      assigned_by: staffId ? user.id : null,
    } as never)
    .eq('id', delivery.id)
    .in('delivery_status', ['assigned', 'in_progress'])
    .select('id')
    .maybeSingle<{ id: string }>();

  if (error) return { error: error.message };
  if (!claimed) return { error: 'This delivery changed while you were saving — refresh and try again.' };

  if (staffId && staffRole) {
    await createInAppNotification({
      recipientId: staffId,
      title: 'Delivery assigned to you',
      body: `Order ${found.order.order_number} has been assigned to you for delivery.`,
      linkUrl: staffDeliveryLink(staffRole, orderId),
    });
  }

  revalidateDeliveryPaths(orderId);
  return {
    success: true,
    message: staffId ? `Delivery assigned to ${staffName ?? 'team member'}.` : 'Delivery unassigned.',
  };
}

/**
 * Regenerate the delivery OTP (e.g. the retailer lost the notification).
 * Admin/dispatch desk only. The task must be open and unverified.
 */
export async function regenerateDeliveryOtpAction(orderId: string): Promise<DeliveryActionResult> {
  const user = await requireUser();
  if (!can(user.role, 'deliveries.assign')) {
    return { error: 'You do not have permission to regenerate delivery OTPs.' };
  }

  const supabase = createClient();
  const found = await fetchDeliveryWithOrder(supabase, orderId);
  if ('error' in found) return { error: found.error };
  const { delivery, order } = found;

  if (delivery.delivery_status !== 'assigned' && delivery.delivery_status !== 'in_progress') {
    return { error: 'This delivery is already completed — no new OTP is needed.' };
  }
  if (delivery.otp_verified_at) return { error: 'This delivery was already verified with an OTP.' };

  const otp = generateDeliveryOtp();
  const { data: claimed, error } = await supabase
    .from('order_deliveries')
    .update({
      otp_hash: hashDeliveryOtp(orderId, otp),
      otp_attempts: 0,
    } as never)
    .eq('id', delivery.id)
    .in('delivery_status', ['assigned', 'in_progress'])
    .select('id')
    .maybeSingle<{ id: string }>();

  if (error) return { error: error.message };
  if (!claimed) return { error: 'This delivery changed while regenerating — refresh and try again.' };

  await notifyOrderEvent({
    recipientId: order.retailer_id,
    title: 'New delivery OTP',
    body: `Your delivery OTP for order ${order.order_number} is ${otp}. Share it with the delivery person only after receiving your goods.`,
    linkUrl: `/retailer/orders/${orderId}/delivery`,
  });

  revalidateDeliveryPaths(orderId);
  return { success: true, message: 'A new OTP was sent to the retailer.' };
}

// ---------------------------------------------------------------------------
// Delivery execution (assigned staff / salesman)
// ---------------------------------------------------------------------------

/** Mark the task in progress (assigned → in_progress). */
export async function startDeliveryAction(orderId: string): Promise<DeliveryActionResult> {
  const user = await requireUser();
  if (!can(user.role, 'deliveries.execute')) {
    return { error: 'You do not have permission to execute deliveries.' };
  }

  const supabase = createClient();
  const found = await fetchDeliveryWithOrder(supabase, orderId);
  if ('error' in found) return { error: found.error };
  const { delivery, order } = found;

  if (delivery.assigned_staff_id !== user.id && !isAdminLike(user)) {
    return { error: 'Only the assigned delivery person can start this delivery.' };
  }
  if (delivery.delivery_status !== 'assigned') {
    return { error: describeDeliveryTransitionError(delivery.delivery_status as DeliveryStatus, 'in_progress') ?? 'Cannot start this delivery.' };
  }

  const { data: claimed, error } = await supabase
    .from('order_deliveries')
    .update({ delivery_status: 'in_progress', in_progress_at: new Date().toISOString() } as never)
    .eq('id', delivery.id)
    .eq('delivery_status', 'assigned')
    .select('id')
    .maybeSingle<{ id: string }>();

  if (error) return { error: error.message };
  if (!claimed) return { error: 'This delivery is no longer in the assigned state — refresh the page.' };

  revalidateDeliveryPaths(orderId);
  return { success: true, message: `Delivery of ${order.order_number} started.` };
}

/**
 * Complete a delivery: OTP verification, receiver, per-line quantities,
 * proofs, shortfall credit-back, return-window snapshot, order → delivered.
 */
export async function completeDeliveryAction(
  orderId: string,
  input: DeliveryCompletionInput
): Promise<DeliveryActionResult> {
  const user = await requireUser();
  if (!can(user.role, 'deliveries.execute')) {
    return { error: 'You do not have permission to execute deliveries.' };
  }

  const receiver = (input.receiverName ?? '').trim();
  if (receiver.length < 2 || receiver.length > 120) {
    return { error: 'Receiver name must be 2–120 characters.' };
  }
  if (!isValidOtpFormat(input.otp)) {
    return { error: 'Enter the 6-digit OTP shown to the retailer.' };
  }
  const notes = (input.notes ?? '').trim();
  if (notes.length > 1000) return { error: 'Delivery notes must be 1000 characters or fewer.' };
  if (!isValidDeliveryProofRef(input.signatureUrl, orderId) || !isValidDeliveryProofRef(input.photoUrl, orderId)) {
    return { error: 'Proof files must belong to this order — re-capture and try again.' };
  }
  if (!Array.isArray(input.items) || input.items.length === 0) {
    return { error: 'Delivery quantities for every order line are required.' };
  }

  const supabase = createClient();
  const found = await fetchDeliveryWithOrder(supabase, orderId);
  if ('error' in found) return { error: found.error };
  const { delivery, order } = found;

  if (delivery.assigned_staff_id !== user.id && !isAdminLike(user)) {
    return { error: 'Only the assigned delivery person can complete this delivery.' };
  }
  if (delivery.delivery_status !== 'assigned' && delivery.delivery_status !== 'in_progress') {
    return { error: 'This delivery is not open — it was already completed or failed.' };
  }
  if (order.status !== 'dispatched' && order.status !== 'delivered') {
    return { error: `This order is ${order.status.replace(/_/g, ' ')} — it cannot be completed as a delivery.` };
  }
  if (delivery.otp_attempts >= MAX_OTP_ATTEMPTS) {
    return { error: 'Too many wrong OTP attempts. Ask an admin to regenerate the OTP.' };
  }
  if (!delivery.otp_hash) {
    return { error: 'This delivery has no OTP — ask an admin to regenerate it.' };
  }

  // --- OTP check (count the attempt BEFORE deciding, like a real terminal) ---
  if (!verifyDeliveryOtp(orderId, input.otp, delivery.otp_hash)) {
    const attempts = delivery.otp_attempts + 1;
    await supabase
      .from('order_deliveries')
      .update({ otp_attempts: attempts } as never)
      .eq('id', delivery.id)
      .eq('otp_attempts', delivery.otp_attempts);
    const remaining = MAX_OTP_ATTEMPTS - attempts;
    return {
      error:
        remaining > 0
          ? `Incorrect OTP. ${remaining} attempt${remaining === 1 ? '' : 's'} remaining before the task is locked.`
          : 'Incorrect OTP. The task is now locked — ask an admin to regenerate the OTP.',
    };
  }

  // --- Load the line snapshots for validation + settlement ---
  const { data: lineRows } = await supabase
    .from('order_delivery_items')
    .select('id, order_item_id, quantity_ordered')
    .eq('delivery_id', delivery.id);
  const lines = (lineRows ?? []) as { id: string; order_item_id: string; quantity_ordered: number }[];
  if (lines.length === 0) return { error: 'This delivery task has no line snapshots.' };

  const { data: valueRows } = await supabase
    .from('order_items')
    .select('id, line_total, quantity, quantity_pieces')
    .eq('order_id', orderId);
  const values = new Map(
    ((valueRows ?? []) as OrderLineValue[]).map((v) => [v.id, v])
  );

  const byItemId = new Map(input.items.map((i) => [i.orderItemId, i]));
  if (byItemId.size !== input.items.length) return { error: 'Duplicate order lines in the submission.' };
  if (byItemId.size !== lines.length) {
    return { error: `Quantities are required for all ${lines.length} order lines.` };
  }

  const settlementLines: SettlementLine[] = [];
  for (const line of lines) {
    const submitted = byItemId.get(line.order_item_id);
    if (!submitted) return { error: 'Missing quantities for one or more order lines.' };

    const delivered = Number(submitted.delivered);
    const missing = Number(submitted.missing);
    const damaged = Number(submitted.damaged);
    if (
      !Number.isInteger(delivered) || !Number.isInteger(missing) || !Number.isInteger(damaged) ||
      delivered < 0 || missing < 0 || damaged < 0
    ) {
      return { error: 'Quantities must be whole numbers of 0 or more.' };
    }
    if (delivered + missing + damaged !== line.quantity_ordered) {
      return { error: 'Delivered + missing + damaged must equal the ordered quantity for every line.' };
    }
    if (delivered + missing + damaged === 0 && line.quantity_ordered === 0) continue;

    const value = values.get(line.order_item_id);
    settlementLines.push({
      lineTotalPaise: value?.line_total ?? 0,
      quantityOrdered: line.quantity_ordered,
      quantityMissing: missing,
      quantityDamaged: damaged,
    });

    const { error: itemError } = await supabase
      .from('order_delivery_items')
      .update({
        quantity_delivered: delivered,
        quantity_missing: missing,
        quantity_damaged: damaged,
      } as never)
      .eq('id', line.id);
    if (itemError) return { error: itemError.message };
  }

  const settlement = computePartialSettlement(settlementLines);
  const finalStatus: DeliveryStatus = settlement.fullyDelivered ? 'delivered' : 'partially_delivered';

  // --- Return window snapshot (platform default 7 days) ---
  const { data: setting } = await supabase
    .from('platform_settings')
    .select('value')
    .eq('key', 'orders.return_window_days')
    .maybeSingle<{ value: unknown }>();
  const returnWindowDays = parseReturnWindowDays(setting?.value);

  const nowIso = new Date().toISOString();
  // Atomic claim: only an open task can transition to a completed status.
  const { data: claimedDelivery, error: deliveryError } = await supabase
    .from('order_deliveries')
    .update({
      delivery_status: finalStatus,
      delivered_at: nowIso,
      receiver_name: receiver,
      otp_verified_at: nowIso,
      signature_url: input.signatureUrl?.trim() || null,
      photo_url: input.photoUrl?.trim() || null,
      delivery_notes: notes || null,
      return_window_days: returnWindowDays,
      return_deadline: computeReturnDeadline(nowIso, returnWindowDays),
      completed_by: user.id,
    } as never)
    .eq('id', delivery.id)
    .in('delivery_status', ['assigned', 'in_progress'])
    .select('id')
    .maybeSingle<{ id: string }>();

  if (deliveryError) return { error: deliveryError.message };
  if (!claimedDelivery) {
    return { error: 'This delivery was completed concurrently — refresh to see the result.' };
  }

  // --- Order → delivered (guarded; 0042 trigger also validates). When the
  // order is already 'delivered' (manual admin path), the update is skipped —
  // the delivery record is the missing piece, not the status. ---
  if (order.status === 'dispatched') {
    const { data: claimedOrder, error: orderError } = await supabase
      .from('orders')
      .update({ status: 'delivered', delivered_at: nowIso } as unknown as never)
      .eq('id', orderId)
      .eq('status', 'dispatched')
      .select('id')
      .maybeSingle<{ id: string }>();
    if (orderError) return { error: orderError.message };
    if (!claimedOrder) {
      return { error: 'The order changed state while completing — refresh and re-check before retrying.' };
    }
  }

  // --- Shortfall credit-back (decision D4) ---
  if (settlement.creditBackPaise > 0) {
    const { data: account } = await supabase
      .from('retailer_credit_accounts')
      .select('id')
      .eq('retailer_id', order.retailer_id)
      .maybeSingle<{ id: string }>();

    const { error: creditError } = await supabase
      .from('retailer_wallet_ledger')
      .insert({
        retailer_id: order.retailer_id,
        account_id: account?.id ?? null,
        transaction_type: 'REFUND_CREDIT',
        amount_paise: settlement.creditBackPaise,
        direction: 'credit',
        reference_type: 'delivery',
        reference_id: delivery.id,
        description: `Shortfall credit for order ${order.order_number}`,
        reason: `${settlement.shortfallPieces} item(s) missing or damaged at delivery`,
        created_by: user.id,
        idempotency_key: `delivery-shortfall:${delivery.id}`,
        metadata: {
          delivery_id: delivery.id,
          order_id: orderId,
          shortfall_pieces: settlement.shortfallPieces,
          credit_rupees: settlement.creditBackPaise / 100,
        },
      } as never);
    if (creditError && creditError.code !== '23505') return { error: creditError.message };
  }

  await notifyOrderEvent({
    recipientId: order.retailer_id,
    title: settlement.fullyDelivered ? 'Order delivered' : 'Order partially delivered',
    body: settlement.fullyDelivered
      ? `Your order ${order.order_number} was delivered to ${receiver}. Return window: ${returnWindowDays} day(s).`
      : `Your order ${order.order_number} was partially delivered to ${receiver}. ₹${(settlement.creditBackPaise / 100).toLocaleString('en-IN', { maximumFractionDigits: 2 })} was credited back to your wallet for missing/damaged items.`,
    linkUrl: `/retailer/orders/${orderId}/delivery`,
  });

  revalidateDeliveryPaths(orderId);
  revalidatePath('/retailer/account/ledger');
  revalidatePath(`/admin/retailers/${order.retailer_id}`);
  return {
    success: true,
    message: settlement.fullyDelivered
      ? `Delivery of ${order.order_number} recorded.`
      : `Partial delivery recorded — ₹${(settlement.creditBackPaise / 100).toLocaleString('en-IN', { maximumFractionDigits: 2 })} credited back to the retailer's wallet.`,
  };
}

/** Record a failed delivery attempt (decision D3: order re-opens for re-pick). */
export async function recordFailedDeliveryAction(
  orderId: string,
  reason: string
): Promise<DeliveryActionResult> {
  const user = await requireUser();
  if (!can(user.role, 'deliveries.execute')) {
    return { error: 'You do not have permission to execute deliveries.' };
  }

  const failureReason = (reason ?? '').trim();
  if (failureReason.length < 3 || failureReason.length > 500) {
    return { error: 'Describe the failure in 3–500 characters.' };
  }

  const supabase = createClient();
  const found = await fetchDeliveryWithOrder(supabase, orderId);
  if ('error' in found) return { error: found.error };
  const { delivery, order } = found;

  if (delivery.assigned_staff_id !== user.id && !isAdminLike(user)) {
    return { error: 'Only the assigned delivery person can fail this delivery.' };
  }
  if (!canTransitionDeliveryStatus(delivery.delivery_status as DeliveryStatus, 'failed')) {
    return {
      error:
        describeDeliveryTransitionError(delivery.delivery_status as DeliveryStatus, 'failed') ??
        'Cannot fail this delivery.',
    };
  }
  if (order.status !== 'dispatched' && order.status !== 'processing') {
    return { error: `This order is ${order.status.replace(/_/g, ' ')} — a failed-delivery re-open is not possible.` };
  }

  const { data: claimed, error } = await supabase
    .from('order_deliveries')
    .update({
      delivery_status: 'failed',
      failure_reason: failureReason,
    } as never)
    .eq('id', delivery.id)
    .in('delivery_status', ['assigned', 'in_progress'])
    .select('id')
    .maybeSingle<{ id: string }>();
  if (error) return { error: error.message };
  if (!claimed) return { error: 'This delivery changed while saving — refresh and try again.' };

  // Re-open the order for a re-attempt (guarded; 0042 trigger validates).
  // Skipped when the order already re-opened concurrently.
  if (order.status === 'dispatched') {
    const { data: claimedOrder, error: orderError } = await supabase
      .from('orders')
      .update({ status: 'processing' } as unknown as never)
      .eq('id', orderId)
      .eq('status', 'dispatched')
      .select('id')
      .maybeSingle<{ id: string }>();
    if (orderError) return { error: orderError.message };
    if (!claimedOrder) {
      return { error: 'The order changed state while failing this delivery — refresh and re-check.' };
    }
  }

  await notifyOrderEvent({
    recipientId: order.retailer_id,
    title: 'Delivery could not be completed',
    body: `Your order ${order.order_number} could not be delivered (${failureReason}). It has been returned to the warehouse queue and will be re-attempted.`,
    linkUrl: `/retailer/orders/${orderId}`,
  });

  revalidateDeliveryPaths(orderId);
  revalidatePath('/admin/orders');
  return { success: true, message: `Delivery attempt failed — order ${order.order_number} re-opened for re-pick.` };
}

/**
 * Terminal return-to-warehouse: stock is booked back, the order moves to
 * `returned`, and the wallet debit (minus any shortfall already refunded)
 * is reversed.
 */
export async function recordReturnToWarehouseAction(
  orderId: string,
  notes?: string
): Promise<DeliveryActionResult> {
  const user = await requireUser();
  if (!can(user.role, 'orders.return.manage')) {
    return { error: 'You do not have permission to manage returns.' };
  }

  const supabase = createClient();
  const found = await fetchDeliveryWithOrder(supabase, orderId);
  if ('error' in found) return { error: found.error };
  const { delivery, order } = found;

  if (!canTransitionDeliveryStatus(delivery.delivery_status as DeliveryStatus, 'returned_to_warehouse')) {
    return {
      error:
        describeDeliveryTransitionError(
          delivery.delivery_status as DeliveryStatus,
          'returned_to_warehouse'
        ) ?? 'Cannot return this delivery to the warehouse.',
    };
  }
  if (order.status !== 'delivered' && order.status !== 'returned') {
    return { error: `This order is ${order.status.replace(/_/g, ' ')} — return to warehouse is not possible.` };
  }

  // Book the stock back into the warehouse.
  const { error: stockError } = await supabase.rpc('return_order_stock' as never, {
    p_order_id: orderId,
  } as never);
  if (stockError) return { error: `Stock could not be returned: ${stockError.message}` };

  const { data: claimed, error } = await supabase
    .from('order_deliveries')
    .update({
      delivery_status: 'returned_to_warehouse',
      delivery_notes: (notes ?? '').trim() || null,
    } as never)
    .eq('id', delivery.id)
    .in('delivery_status', ['delivered', 'partially_delivered'])
    .select('id')
    .maybeSingle<{ id: string }>();
  if (error) return { error: error.message };
  if (!claimed) return { error: 'This delivery changed while saving — refresh and try again.' };

  if (order.status === 'delivered') {
    const { data: claimedOrder, error: orderError } = await supabase
      .from('orders')
      .update({ status: 'returned' } as unknown as never)
      .eq('id', orderId)
      .eq('status', 'delivered')
      .select('id')
      .maybeSingle<{ id: string }>();
    if (orderError) return { error: orderError.message };
    if (!claimedOrder) {
      return { error: 'The order changed state while returning to warehouse — refresh and re-check.' };
    }
  }

  // Reverse the wallet debit for the FULL order; if a shortfall refund was
  // already credited at partial delivery, reverse that too so the retailer
  // is not credited twice for the same goods.
  await reverseOrderWalletDebit(orderId, order.retailer_id, 'returned to warehouse', user.id);
  const { data: refund } = await supabase
    .from('retailer_wallet_ledger')
    .select('id, is_reversed')
    .eq('transaction_type', 'REFUND_CREDIT')
    .eq('reference_id', delivery.id)
    .maybeSingle<{ id: string; is_reversed: boolean }>();
  if (refund && !refund.is_reversed) {
    await supabase
      .from('retailer_wallet_ledger')
      .update({ is_reversed: true, reversed_at: new Date().toISOString(), reversed_by: user.id } as never)
      .eq('id', refund.id);
  }

  await notifyOrderEvent({
    recipientId: order.retailer_id,
    title: 'Order returned to warehouse',
    body: `Your order ${order.order_number} was returned to the warehouse. The order amount has been credited back to your wallet.`,
    linkUrl: `/retailer/orders/${orderId}`,
  });

  revalidateDeliveryPaths(orderId);
  revalidatePath('/retailer/account/ledger');
  revalidatePath(`/admin/retailers/${order.retailer_id}`);
  return { success: true, message: `Order ${order.order_number} returned to the warehouse.` };
}
