// Dependency-free, non-migration safety checks. Run with:
//   node --test tests/legal-safety-smoke.node.test.mjs
// This is NOT a database, route, UI, Android, or production acceptance test.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { displayOfferPreference, isOfferEligible } from '../lib/notifications/offer-eligibility.ts';
import {
  classifyStorageBucket, isEligibleTemporaryStorageObject,
  sweepTemporaryStorage, sweepTemporaryStorageBucket, temporaryStorageBuckets,
} from '../lib/retention/storage-cleanup.ts';
import { ORDER_SUMMARY_NOTICE, orderSummaryTaxMode } from '../lib/retailer/order-document.ts';
import { homeServices } from '../lib/retailer/home-services.ts';
import { canTransitionDeliveryStatus } from '../lib/delivery/state-machine.ts';

const rollout = { approved: true, noticePublishedAt: '2026-10-01T00:00:00Z' };
const choice = { offer_updates: true, offer_preference_recorded_at: '2026-10-02T10:30:00Z' };

test('legacy preference, unpublished notice, withdrawn choice and invalid dates cannot enable offers', () => {
  assert.equal(isOfferEligible({ ...choice, offer_preference_recorded_at: null }, rollout), false);
  assert.equal(displayOfferPreference({ ...choice, offer_preference_recorded_at: null }, rollout), false);
  assert.equal(isOfferEligible(choice, { ...rollout, approved: false }), false);
  assert.equal(isOfferEligible(choice, { ...rollout, noticePublishedAt: null }), false);
  assert.equal(isOfferEligible(choice, { ...rollout, noticePublishedAt: 'invalid' }), false);
  assert.equal(isOfferEligible({ ...choice, offer_preference_recorded_at: '2026-09-30T23:59:59Z' }, rollout), false);
  assert.equal(isOfferEligible({ ...choice, offer_updates: false }, rollout), false);
  assert.equal(isOfferEligible(choice, rollout), true);
});

test('unapplied SQL and cron source hold financial and evidence rules before any cleanup RPC', () => {
  // Structural regression only: never execute a migration or cleanup RPC here.
  const sql = readFileSync(new URL('../supabase/migrations/0059_india_compliance_safety.sql', import.meta.url), 'utf8');
  const cron = readFileSync(new URL('../app/api/cron/cleanup/route.ts', import.meta.url), 'utf8');
  assert.match(sql, /set enabled = false\s+where category = 'business_120'/);
  assert.match(sql, /check \(category <> 'business_120' or enabled = false\)/);
  for (const key of ['expired_notifications', 'notification_logs', 'cleanup_run_logs']) {
    assert.ok(sql.includes(key), `${key} must be held in proposed SQL`);
    assert.ok(cron.includes(key), `${key} must be preflighted before the cron RPC`);
  }
  assert.match(sql, /constraint data_retention_evidence_hold/);
  assert.match(cron, /business\.error \|\| evidence\.error \|\| !business\.data \|\| !evidence\.data/);
  assert.match(cron, /business\.data\.length > 0 \|\| evidence\.data\.length > 0/);
  assert.ok(cron.indexOf("rpc('run_data_cleanup'") > cron.indexOf('business.data.length > 0'));
});

test('proof buckets cannot be swept, even with very old objects', async () => {
  assert.deepEqual(temporaryStorageBuckets(), []);
  const storage = { from() { throw new Error('No proof bucket should be visited'); } };
  assert.deepEqual(await sweepTemporaryStorage(storage), []);
  for (const bucket of ['payment-proofs', 'delivery-proofs', 'product-images', 'retailer-documents', 'unknown']) {
    assert.equal(classifyStorageBucket(bucket), 'permanent');
    assert.equal(isEligibleTemporaryStorageObject(bucket, '2000-01-01T00:00:00Z'), false);
    const result = await sweepTemporaryStorageBucket(storage, bucket);
    assert.equal(result.deleted, 0);
    assert.match(result.error, /not classified temporary/);
  }
});

test('failed delivery cannot be reset in the shared interim state machine', () => {
  assert.equal(canTransitionDeliveryStatus('assigned', 'failed'), true);
  assert.equal(canTransitionDeliveryStatus('failed', 'assigned'), false);
});

test('unverified order documents and home card cannot claim GST invoice or disclose configured GSTIN', () => {
  assert.equal(orderSummaryTaxMode(), 'unsplit');
  assert.match(ORDER_SUMMARY_NOTICE, /not a GST tax invoice/);
  const services = homeServices({ hasWholesalePrices: true, gstin: 'UNVERIFIED-TEST-VALUE' });
  assert.equal(services.find((service) => service.id === 'invoice')?.title, 'Order summaries');
  assert.doesNotMatch(JSON.stringify(services), /UNVERIFIED-TEST-VALUE/);
});
