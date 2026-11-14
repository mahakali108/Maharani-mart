/**
 * Delivery OTP helpers. Pure Node — no network, no database.
 *
 * Flow (decision D5):
 *  1. `generateDeliveryOtp()` — 6 digits from crypto-secure randomness —
 *     runs at DISPATCH time. Only the SHA-256 hash is stored
 *     (`order_deliveries.otp_hash`); the plain OTP is sent ONCE to the
 *     RETAILER via an in-app notification.
 *  2. At delivery, the staff/salesman asks the retailer for the OTP and
 *     submits it with the completion form. `verifyDeliveryOtp` compares
 *     hashes; each wrong attempt increments `otp_attempts` (max 10 — the
 *     DB CHECK enforces the ceiling; after 10 the task is locked to
 *     manual admin action).
 *
 * The hash binds the OTP to the order id, so a hash leaked from one order
 * can never be replayed against another.
 *
 * KEYED (Phase 0 / SEC-8): a 6-digit OTP has only 10^6 values, so a plain
 * SHA-256 stored in `order_deliveries.otp_hash` (readable by delivery staff)
 * could be brute-forced offline in well under a second. The stored value is
 * therefore HMAC-SHA256 under a server-only key: DELIVERY_OTP_SECRET when set,
 * otherwise a key derived from SUPABASE_SERVICE_ROLE_KEY (already a required
 * server-only secret). Without either, hashing fails closed. Hashes written
 * before this change (plain SHA-256) are still ACCEPTED by verify so
 * in-flight deliveries keep working; every new or regenerated OTP is keyed.
 * Rotating the key invalidates open OTPs (regenerate them).
 *
 * Never imported from client components (node:crypto).
 */

import { createHmac, randomInt, timingSafeEqual } from 'node:crypto';

export const OTP_LENGTH = 6;
export const MAX_OTP_ATTEMPTS = 10;

/** A random 6-digit numeric OTP, uniform digits, leading zeros possible. */
export function generateDeliveryOtp(): string {
  let otp = '';
  for (let i = 0; i < OTP_LENGTH; i += 1) {
    otp += randomInt(0, 10).toString();
  }
  return otp;
}

export function isValidOtpFormat(value: unknown): value is string {
  return typeof value === 'string' && new RegExp(`^\\d{${OTP_LENGTH}}$`).test(value);
}

function otpKey(): Buffer {
  const dedicated = process.env.DELIVERY_OTP_SECRET?.trim();
  if (dedicated) return Buffer.from(dedicated, 'utf8');
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (serviceKey) {
    // Domain-separated derivation: the service key itself is never the MAC key.
    return createHmac('sha256', serviceKey).update('maharani:delivery-otp:v1', 'utf8').digest();
  }
  throw new Error('Delivery OTP key is not configured (set DELIVERY_OTP_SECRET or SUPABASE_SERVICE_ROLE_KEY).');
}

/** HMAC-SHA256(key, orderId:otp) as lowercase hex — the value to store. */
export function hashDeliveryOtp(orderId: string, otp: string): string {
  return createHmac('sha256', otpKey()).update(`${orderId}:${otp}`, 'utf8').digest('hex');
}

function safeEqualHex(actualHex: string, expectedHex: string): boolean {
  const actual = Buffer.from(actualHex, 'utf8');
  const expected = Buffer.from(expectedHex, 'utf8');
  if (actual.length !== expected.length) return false;
  return timingSafeEqual(actual, expected);
}

/** Constant-time comparison against the keyed hash only. */
export function verifyDeliveryOtp(orderId: string, otp: string, expectedHash: string): boolean {
  const keyed = safeEqualHex(hashDeliveryOtp(orderId, otp), expectedHash);
  const legacy = safeEqualHex(legacyHashDeliveryOtp(orderId, otp), expectedHash);
  return keyed || legacy;
}
