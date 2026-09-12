/**
 * Deliveries workflow (Phase 4) — static verification of the migration RLS,
 * the state-machine trigger, the dispatch → task → completion → RTO flows
 * and the private proof buckets. Live row-level behaviour needs a real
 * Supabase project; everything that CAN be verified statically is verified
 * here, following tests/staff-scope-rls.test.ts.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { ORDER_STATUSES, allowedTransitionsFrom } from '@/lib/orders/state-machine';

const ROOT = join(__dirname, '..');
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8');

const sql42 = read('supabase/migrations/0042_order_state_machine.sql');
const sql43 = read('supabase/migrations/0043_deliveries_module.sql');
const sql44 = read('supabase/migrations/0044_payment_collections.sql');
const sql45 = read('supabase/migrations/0045_delivery_payment_proof_buckets.sql');
const dispatchSrc = read('lib/staff/dispatch-actions.ts');
const deliverySrc = read('lib/delivery/delivery-actions.ts');
const retailerOrderSrc = read('lib/retailer/order-actions.ts');
const salesmanActions = read('lib/salesman/collection-actions.ts');
const adminActions = read('lib/admin/collections-actions.ts');
const signedUrlSrc = read('lib/storage/signed-url.ts');
const mediaTypesSrc = read('lib/media/types.ts');
const mediaAccessSrc = read('lib/media/access.ts');

const stripComments = (text: string) =>
  text
    .split('\n')
    .filter((line) => !line.trimStart().startsWith('--'))
    .join('\n');

// ---------------------------------------------------------------------------
// 0042 — order status transition trigger mirrors the pure state machine
// ---------------------------------------------------------------------------

describe('0042 order status trigger mirrors lib/orders/state-machine', () => {
  const allowedPairs: [string, string][] = [];
  for (const from of ORDER_STATUSES) {
    for (const to of allowedTransitionsFrom(from)) allowedPairs.push([from, to]);
  }

  it('covers every allowed transition from the shared table', () => {
    expect(allowedPairs.length).toBeGreaterThan(10);
    for (const [from, to] of allowedPairs) {
      expect(sql42).toContain(`old.status = '${from}'`);
      expect(sql42).toContain(`'${to}'`);
    }
    // Spot-check the shape of each from-branch: the trigger must list every
    // allowed target for the source status.
    for (const from of ORDER_STATUSES) {
      const targets = allowedTransitionsFrom(from);
      const branch = sql42.match(new RegExp(`old\\.status = '${from}'\\s+and new\\.status in \\(([^)]+)\\)`));
      if (targets.length === 0) {
        expect(branch).toBeNull(); // terminal: no branch at all
      } else {
        expect(branch).not.toBeNull();
        for (const to of targets) {
          expect(branch?.[1]).toContain(`'${to}'`);
        }
      }
    }
  });

  it('raises a typed error on illegal transitions', () => {
    expect(sql42).toContain('INVALID_ORDER_STATUS_TRANSITION');
  });

  it('treats same-status updates as no-ops', () => {
    expect(sql42).toContain('is not distinct from old.status');
  });

  it('is additive and re-runnable', () => {
    const body = stripComments(sql42).toLowerCase();
    expect(body).not.toMatch(/drop table\b/);
    expect(body).not.toMatch(/\bdelete from\b/);
    expect(body).not.toMatch(/\binsert into\b/);
    expect(sql42).toContain('create or replace function enforce_order_status_transitions');
    expect(sql42).toContain('drop trigger if exists trg_enforce_order_status_transitions');
  });
});

// ---------------------------------------------------------------------------
// 0043 — deliveries module schema
// ---------------------------------------------------------------------------

describe('0043 delivery tasks', () => {
  it('enforces exactly one task per order', () => {
    expect(sql43).toContain('unique (order_id)');
  });

  it('mirrors the pure delivery state machine in a BEFORE UPDATE trigger', () => {
    const trigger = sql43.match(
      /create or replace function enforce_delivery_status_transitions\(\)[\s\S]*?language plpgsql;/
    )?.[0];
    expect(trigger).toBeDefined();
    expect(trigger).toContain("old.delivery_status = 'assigned' and new.delivery_status in ('in_progress', 'delivered', 'partially_delivered', 'failed')");
    expect(trigger).toContain("old.delivery_status = 'in_progress' and new.delivery_status in ('delivered', 'partially_delivered', 'failed')");
    expect(trigger).toContain("old.delivery_status = 'delivered' and new.delivery_status in ('returned_to_warehouse')");
    expect(trigger).toContain("old.delivery_status = 'partially_delivered' and new.delivery_status in ('returned_to_warehouse')");
    expect(trigger).toContain("old.delivery_status = 'failed' and new.delivery_status in ('assigned')");
    expect(trigger).toContain('INVALID_DELIVERY_STATUS_TRANSITION');
    // returned_to_warehouse has NO outgoing branch — it is terminal in SQL too.
    expect(trigger).not.toContain("old.delivery_status = 'returned_to_warehouse' and new.delivery_status");
    expect(sql43).toContain('drop trigger if exists trg_enforce_delivery_status_transitions on order_deliveries');
  });

  it('pins the six delivery statuses', () => {
    expect(sql43).toContain(
      "check (delivery_status in ('assigned', 'in_progress', 'delivered', 'partially_delivered', 'failed', 'returned_to_warehouse'))"
    );
  });

  it('caps OTP brute force at 10 attempts', () => {
    expect(sql43).toContain('check (otp_attempts >= 0 and otp_attempts <= 10)');
  });

  it('keeps the split invariant: fresh 0/0/0 snapshots or fully-accounted outcomes', () => {
    // The dispatch action inserts quantity_ordered only (outcomes 0/0/0),
    // so the fresh state must be legal — otherwise no dispatch could run.
    expect(sql43).toContain(
      '(quantity_delivered = 0 and quantity_missing = 0 and quantity_damaged = 0)'
    );
    // Once outcomes are recorded they must fully account for the line.
    expect(sql43).toContain(
      'or (quantity_delivered + quantity_missing + quantity_damaged = quantity_ordered)'
    );
  });

  it('validates receiver name and note lengths', () => {
    expect(sql43).toContain("check (receiver_name is null or char_length(btrim(receiver_name)) between 2 and 120)");
    expect(sql43).toContain('check (delivery_notes is null or char_length(btrim(delivery_notes)) <= 1000)');
    expect(sql43).toContain(
      'check (failure_reason is null or char_length(btrim(failure_reason)) between 3 and 500)'
    );
  });

  it('snapshots the return window (days + deadline) on the task', () => {
    expect(sql43).toContain('return_window_days int');
    expect(sql43).toContain('return_deadline date');
  });

  it('audits every change on both tables', () => {
    expect(sql43).toContain('trg_audit_order_deliveries');
    expect(sql43).toContain('trg_audit_order_delivery_items');
    expect(sql43).toMatch(/after insert or update or delete on order_deliveries/);
  });
});

// ---------------------------------------------------------------------------
// 0043 — RLS: who may see/touch a delivery (gates 1–5)
// ---------------------------------------------------------------------------

describe('0043 delivery RLS', () => {
  it('has NO delete policy on order_deliveries — the record is permanent proof', () => {
    // (order_delivery_items MAY be deleted — the re-dispatch snapshot reset.)
    const deliveryDeletes = stripComments(sql43).match(
      /create policy "order_deliveries[^"]*"\s+on order_deliveries\s+for delete/gi
    );
    expect(deliveryDeletes ?? []).toHaveLength(0);
  });

  it('retailers are read-only: no insert or update policy grants retailer writes', () => {
    const insertPolicy = sql43.match(/create policy "order_deliveries_insert"[\s\S]*?;\n\ncreate policy "order_deliveries_update"/)?.[0] ?? '';
    const updatePolicy = sql43.match(/create policy "order_deliveries_update"[\s\S]*?\n\n-- No DELETE/)?.[0] ?? '';
    expect(insertPolicy).not.toContain('retailer');
    expect(updatePolicy).not.toContain('retailer_id = auth.uid()');
    // The visibility helper grants retailers visibility of their OWN orders only.
    const helper = sql43.match(
      /create or replace function can_current_user_view_delivery[\s\S]*?language sql[\s\S]*?\$\$\s*;/
    )?.[0] ?? '';
    expect(helper).toContain('o.retailer_id = auth.uid()');
  });

  it('staff see/touch deliveries only through their assignment scope (0037 helper) or as assignee', () => {
    const body = stripComments(sql43);
    expect(body).toContain('is_order_assigned_to_current_staff(o.id)');
    expect(body).toContain('od.assigned_staff_id = auth.uid()');
    // No bare staff grant: is_staff_or_above() must NOT open deliveries.
    expect(body).not.toContain('is_staff_or_above()');
  });

  it('salesmen are limited to assigned deliveries / collected orders / own retailers', () => {
    const body = stripComments(sql43);
    expect(body).toContain('o.collected_by = auth.uid()');
    expect(body).toContain('is_retailer_assigned_to_current_salesman(o.retailer_id)');
    expect(body).toContain('od.assigned_staff_id = auth.uid()');
  });

  it('admin/super_admin keep full access via is_admin_or_above()', () => {
    expect(stripComments(sql43)).toContain('is_admin_or_above()');
  });

  it('salesmen can never insert a delivery task (dispatch is staff/admin)', () => {
    const insertPolicy = sql43.match(/create policy "order_deliveries_insert"[\s\S]*?;/)?.[0] ?? '';
    expect(insertPolicy).not.toContain("current_user_role() = 'salesman'");
  });
});

// ---------------------------------------------------------------------------
// Dispatch: exactly one task, idempotent, OTP hashed at creation
// ---------------------------------------------------------------------------

describe('dispatch creates exactly one delivery task (idempotent)', () => {
  it('creates the task in the same action as the dispatch transition', () => {
    expect(dispatchSrc).toContain("from('order_deliveries')");
    expect(dispatchSrc).toContain("delivery_status: 'assigned'");
  });

  it('hashes the OTP before storing — the plain OTP is never persisted', () => {
    expect(dispatchSrc).toContain('otp_hash: otpHash');
    expect(dispatchSrc).toContain('hashDeliveryOtp(orderId, otp)');
    expect(dispatchSrc).not.toContain('otp: otp'); // no plaintext column anywhere
  });

  it('sends the OTP only to the retailer', () => {
    const notify = dispatchSrc.match(/notifyOrderEvent\(\{[\s\S]*?\}\)/)?.[0] ?? '';
    expect(notify).toContain('recipientId: order.retailer_id');
    expect(notify).toContain('delivery OTP');
  });

  it('re-dispatch RESETS the failed task instead of creating a second one', () => {
    expect(dispatchSrc).toContain(".eq('delivery_status', 'failed')");
    expect(dispatchSrc).toContain('A delivery task already exists for this order and is not in a failed state.');
  });

  it('re-snapshots the line quantities on re-dispatch (delete + insert)', () => {
    expect(dispatchSrc).toContain("from('order_delivery_items').delete()");
    expect(dispatchSrc).toContain('quantity_ordered: item.quantity_pieces ?? item.quantity');
  });
});

// ---------------------------------------------------------------------------
// Delivery actions: state machine + claim guards + validation (gates 1, 7, 8)
// ---------------------------------------------------------------------------

describe('delivery actions enforce the workflow', () => {
  it('completion verifies the OTP against the stored hash', () => {
    expect(deliverySrc).toContain('verifyDeliveryOtp(orderId, input.otp, delivery.otp_hash)');
  });

  it('counts wrong attempts and locks at the ceiling', () => {
    expect(deliverySrc).toContain('otp_attempts: attempts');
    expect(deliverySrc).toContain('delivery.otp_attempts >= MAX_OTP_ATTEMPTS');
  });

  it('validates the receiver name server-side', () => {
    expect(deliverySrc).toContain("receiver.length < 2 || receiver.length > 120");
  });

  it('rejects proof refs that point outside this order\u2019s folder (anti cross-order attach)', () => {
    expect(deliverySrc).toContain('isValidDeliveryProofRef(input.signatureUrl, orderId)');
    expect(deliverySrc).toContain('isValidDeliveryProofRef(input.photoUrl, orderId)');
    expect(deliverySrc).toContain("value.startsWith(`deliveries/${orderId}/`)");
    expect(deliverySrc).toContain('!value.includes(\'..\')');
  });

  it('validates per-line quantities: non-negative integers that sum to ordered', () => {
    expect(deliverySrc).toContain('Number.isInteger(delivered)');
    expect(deliverySrc).toContain('delivered < 0 || missing < 0 || damaged < 0');
    expect(deliverySrc).toContain('delivered + missing + damaged !== line.quantity_ordered');
    expect(deliverySrc).toContain('Quantities are required for all');
  });

  it('requires quantities for EVERY order line (no partial submissions)', () => {
    expect(deliverySrc).toContain('byItemId.size !== lines.length');
  });

  it('guards the order state before completing/failing/returning', () => {
    expect(deliverySrc).toContain("order.status !== 'dispatched' && order.status !== 'delivered'");
    expect(deliverySrc).toContain("order.status !== 'dispatched' && order.status !== 'processing'");
    expect(deliverySrc).toContain("order.status !== 'delivered' && order.status !== 'returned'");
  });

  it('uses atomic claim guards (.select after guarded update) on every status flip', () => {
    const claims = deliverySrc.match(/\.in\('delivery_status'[^)]*\)\s*\n\s*\.select\('id'\)/g) ?? [];
    const claimEq = deliverySrc.match(/\.eq\('delivery_status', '[a-z_]+'\)\s*\n\s*\.select\('id'\)/g) ?? [];
    expect(claims.length + claimEq.length).toBeGreaterThanOrEqual(5);
  });

  it('credits missing/damaged value back as a REFUND_CREDIT with an idempotency key', () => {
    expect(deliverySrc).toContain("'REFUND_CREDIT'");
    expect(deliverySrc).toContain('`delivery-shortfall:${delivery.id}`');
    expect(deliverySrc).toContain('computePartialSettlement');
  });

  it('failed delivery re-opens the order for a re-attempt (decision D3)', () => {
    expect(deliverySrc).toContain("update({ status: 'processing' }");
    expect(deliverySrc).toContain(".eq('status', 'dispatched')");
  });

  it('return-to-warehouse books stock back and reverses the wallet (RTO)', () => {
    expect(deliverySrc).toContain("rpc('return_order_stock'");
    expect(deliverySrc).toContain('reverseOrderWalletDebit(orderId, order.retailer_id');
    // A shortfall refund already credited is reversed too — no double credit.
    expect(deliverySrc).toContain("eq('transaction_type', 'REFUND_CREDIT')");
    expect(deliverySrc).toContain('is_reversed: true');
  });

  it('snapshots the return window from platform_settings at completion', () => {
    expect(deliverySrc).toContain("eq('key', 'orders.return_window_days')");
    expect(deliverySrc).toContain('computeReturnDeadline(nowIso, returnWindowDays)');
    expect(deliverySrc).toContain('return_window_days: returnWindowDays');
  });

  it('assignment validates the target is an active staff member or salesman', () => {
    expect(deliverySrc).toContain("profile.role !== 'staff' && profile.role !== 'salesman'");
    expect(deliverySrc).toContain('!profile.is_active');
  });
});

// ---------------------------------------------------------------------------
// Return-window enforcement on the retailer return request (gate 11)
// ---------------------------------------------------------------------------

describe('return window is enforced in requestReturnAction', () => {
  it('checks the snapshotted deadline before creating a return request', () => {
    expect(retailerOrderSrc).toContain('isReturnWindowOpen');
    expect(retailerOrderSrc).toContain('return_deadline');
    expect(retailerOrderSrc).toContain('return window for this order closed on');
  });

  it('keeps legacy orders (no delivery row) returnable', () => {
    expect(retailerOrderSrc).toContain('delivery?.return_deadline &&');
  });
});

// ---------------------------------------------------------------------------
// 0045 — private proof buckets + signed URLs only (gate 6)
// ---------------------------------------------------------------------------

describe('0045 proof buckets are private', () => {
  it('creates both buckets with public = false', () => {
    expect(sql45).toContain("'delivery-proofs'");
    expect(sql45).toContain("'payment-proofs'");
    const bucketInserts = sql45.match(/\)\s*\n\s*values \(\s*'delivery-proofs',\s*\n?\s*'delivery-proofs',\s*\n?\s*false,/i);
    expect(bucketInserts).not.toBeNull();
    expect(sql45).toMatch(/'payment-proofs',\s*\n\s*'payment-proofs',\s*\n\s*false,/);
  });

  it('reconciles the public flag on conflict (idempotent)', () => {
    expect(sql45).toContain('on conflict (id) do update');
    expect(sql45).toContain('set public = false');
  });

  it('bucket read policies bind proof objects to the owning delivery/payment row', () => {
    expect(sql45).toContain('od.signature_url = storage.objects.name or od.photo_url = storage.objects.name');
    expect(sql45).toContain('pc.proof_url = storage.objects.name');
  });

  it('bucket write policies require the assigned delivery person / assigned salesman', () => {
    expect(sql45).toContain('od.assigned_staff_id = auth.uid()');
    expect(sql45).toContain('is_retailer_assigned_to_current_salesman((storage.foldername(name))[1]::uuid)');
  });

  it('has no public read grant anywhere', () => {
    expect(stripComments(sql45).toLowerCase()).not.toContain('public read');
    expect(stripComments(sql45).toLowerCase()).not.toContain('true');
  });
});

describe('proof viewing uses signed URLs only', () => {
  it('getSignedUrl serves exactly the three private buckets', () => {
    expect(signedUrlSrc).toContain("export type PrivateBucket = 'retailer-documents' | 'delivery-proofs' | 'payment-proofs'");
  });

  it('the upload pipeline can never mint a public URL for a private kind', () => {
    const uploadSrc = read('lib/media/supabase.ts');
    expect(uploadSrc).toContain('if (!config.private) {');
    expect(uploadSrc).toContain('ref: config.private ? path : (url ?? path)');
  });

  it('no code constructs a public URL for the proof buckets', () => {
    for (const source of [signedUrlSrc, mediaTypesSrc, mediaAccessSrc, read('lib/media/supabase.ts'), read('lib/delivery/proof-url.ts')]) {
      expect(source).not.toMatch(/getPublicUrl\([^)]*proof/i);
    }
  });

  it('resolveProofUrl routes object paths to the right bucket and never exposes others', () => {
    const proofSrc = read('lib/delivery/proof-url.ts');
    expect(proofSrc).toContain("prefix: 'deliveries/'");
    expect(proofSrc).toContain("prefix: 'payments/'");
    expect(proofSrc).toContain('getSignedUrl(match.bucket, parsed.value)');
  });

  it('media kinds mark both proof kinds private with the right folders', () => {
    expect(mediaTypesSrc).toContain("'delivery-proof': {");
    expect(mediaTypesSrc).toContain("'payment-proof': {");
    const deliveryKind = mediaTypesSrc.match(/'delivery-proof': \{[\s\S]*?\},/)?.[0] ?? '';
    const paymentKind = mediaTypesSrc.match(/'payment-proof': \{[\s\S]*?\},/)?.[0] ?? '';
    expect(deliveryKind).toContain('private: true');
    expect(paymentKind).toContain('private: true');
    expect(deliveryKind).toContain('deliveries/${ownerId');
    expect(paymentKind).toContain('payments/${ownerId');
  });

  it('media permissions require delivery execution / collection recording', () => {
    expect(mediaAccessSrc).toContain("'delivery-proof': 'deliveries.execute'");
    expect(mediaAccessSrc).toContain("'payment-proof': 'collections.record'");
  });
});

// ---------------------------------------------------------------------------
// Collections: one-way states, salesman scoping, verification-only crediting
// ---------------------------------------------------------------------------

describe('0044 payment collections schema', () => {
  it('pins the one-way statuses', () => {
    expect(sql44).toContain("check (status in ('pending', 'verified', 'rejected'))");
  });

  it('requires a positive amount', () => {
    expect(sql44).toContain('check (amount_paise > 0');
  });

  it('has NO delete policy — money history is immutable', () => {
    expect(stripComments(sql44)).not.toMatch(/for delete/i);
  });

  it('retailer access is read-only (own rows, no write policy)', () => {
    const body = stripComments(sql44);
    expect(body).toContain('retailer_id = auth.uid()');
    expect(body).not.toMatch(/create policy "payment_collections[^"]*(insert|update|delete)[^"]*"\s+for (insert|update|delete)[\s\S]*?retailer_id = auth\.uid\(\)/);
  });

  it('salesman insert policy is scoped to retailers assigned to them', () => {
    const policy = sql44.match(/create policy "payment_collections_salesman_insert"[\s\S]*?;/)?.[0] ?? '';
    expect(policy).toContain('is_retailer_assigned_to_current_salesman(retailer_id)');
    expect(policy).toContain('collected_by = auth.uid()');
  });

  it('only admin+ can update (verify/reject)', () => {
    const policy = sql44.match(/create policy "payment_collections_admin_update"[\s\S]*?;/)?.[0] ?? '';
    expect(policy).toContain('is_admin_or_above()');
  });

  it('audits every change', () => {
    expect(sql44).toContain('trg_audit_payment_collections');
  });
});

// ---------------------------------------------------------------------------
// End-to-end chain: dispatch → task → assignment → completion → collection
// (gate 6 — static trace of the exact call order; the live run is
// docs/PRODUCTION_VERIFICATION_CHECKLIST.md §6)
// ---------------------------------------------------------------------------

describe('dispatch → delivery → collection chain', () => {
  it('step 1 — dispatch creates the task WITH the OTP hash before the retailer notification', () => {
    expect(dispatchSrc.indexOf('generateDeliveryOtp()')).toBeLessThan(dispatchSrc.indexOf('otp_hash: otpHash'));
    // The OTP hash is stored before the OTP text is sent to the retailer.
    expect(dispatchSrc.indexOf('otp_hash: otpHash')).toBeLessThan(dispatchSrc.indexOf('Your delivery OTP is'));
  });

  it('step 2 — assignment re-scopes execution and notifies the new assignee', () => {
    expect(deliverySrc).toContain('Delivery assigned to you');
    expect(deliverySrc).toContain('staffDeliveryLink');
    // Reassignment is refused once the task is completed.
    expect(deliverySrc).toContain('already completed — it can no longer be reassigned');
  });

  it('step 3 — completion is the only path to delivered/partially_delivered, and it notifies the retailer', () => {
    expect(deliverySrc).toContain('Order delivered');
    expect(deliverySrc).toContain('Order partially delivered');
    expect(deliverySrc).toContain('credited back to your wallet');
    // The order flip to delivered lives in the SAME action, after the claim.
    expect(deliverySrc.indexOf("delivery_status: finalStatus")).toBeLessThan(
      deliverySrc.indexOf("status: 'delivered', delivered_at: nowIso")
    );
  });

  it('step 4 — a collection is recorded pending, scoped to the salesman\u2019s retailer', () => {
    expect(salesmanActions).toContain("status: 'pending'");
    expect(salesmanActions).toContain('retailers assigned to you');
  });

  it('step 5 — only verification credits the wallet, and it links the ledger entry', () => {
    expect(adminActions).toContain("'PAYMENT_CREDIT'");
    expect(adminActions).toContain('ledger_entry_id: ledgerEntry?.id ?? null');
  });

  it('the retailer OTP notification and the completion summary link to the retailer delivery record', () => {
    expect(dispatchSrc).toContain('linkUrl: `/retailer/orders/${orderId}/delivery`');
    expect(deliverySrc).toContain('linkUrl: `/retailer/orders/${orderId}/delivery`');
  });
});

// ---------------------------------------------------------------------------
// Retailer cannot mutate delivery/payment/order state (gate 4) — policy text
// ---------------------------------------------------------------------------

describe('no retailer write path exists for delivery/payment state', () => {
  it('retailer-facing pages render the delivery record read-only', () => {
    const page = read('app/retailer/orders/[id]/delivery/page.tsx');
    expect(page).toContain('Read-only');
    expect(page).not.toContain('completeDeliveryAction');
    expect(page).not.toContain('assignDeliveryStaffAction');
    expect(page).not.toContain('verifyCollectionAction');
  });

  it('retailer order actions file exposes no delivery/payment mutation', () => {
    // Reads are fine (the return-window check selects the deadline); the
    // file must never WRITE to delivery, payment or order-state tables.
    const actions = retailerOrderSrc;
    for (const forbidden of [
      "from('order_deliveries').update",
      "from('order_deliveries').insert",
      "from('payment_collections')",
      "status: 'delivered'",
      "status: 'dispatched'",
      'retailer_wallet_ledger',
    ]) {
      expect(actions).not.toContain(forbidden);
    }
    // And the one order_deliveries reference is a read-only deadline check.
    expect(actions).toContain("from('order_deliveries')");
    expect(actions).toContain('.select(');
  });
});
