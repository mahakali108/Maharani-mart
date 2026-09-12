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
 * Never imported from client components (node:crypto).
 */

import { createHash, randomInt, timingSafeEqual } from 'node:crypto';

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

/** SHA-256(orderId:otp) as lowercase hex. */
export function hashDeliveryOtp(orderId: string, otp: string): string {
  return createHash('sha256').update(`${orderId}:${otp}`, 'utf8').digest('hex');
}

/** Constant-time hash comparison. */
export function verifyDeliveryOtp(orderId: string, otp: string, expectedHash: string): boolean {
  const actual = Buffer.from(hashDeliveryOtp(orderId, otp), 'utf8');
  const expected = Buffer.from(expectedHash, 'utf8');
  if (actual.length !== expected.length) return false;
  return timingSafeEqual(actual, expected);
}
