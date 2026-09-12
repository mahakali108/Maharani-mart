/**
 * Delivery OTP helpers (lib/delivery/otp.ts) — the security core of the
 * Phase 4 handover proof. Pure Node (node:crypto), no network.
 */
import { describe, expect, it } from 'vitest';
import {
  MAX_OTP_ATTEMPTS,
  OTP_LENGTH,
  generateDeliveryOtp,
  hashDeliveryOtp,
  isValidOtpFormat,
  verifyDeliveryOtp,
} from '@/lib/delivery/otp';

const ORDER_ID = '11111111-1111-1111-1111-111111111111';

describe('generateDeliveryOtp', () => {
  it('always produces exactly 6 numeric digits', () => {
    for (let i = 0; i < 200; i += 1) {
      const otp = generateDeliveryOtp();
      expect(otp).toMatch(/^\d{6}$/);
      expect(otp.length).toBe(OTP_LENGTH);
    }
  });

  it('is non-deterministic across draws (leading zeros possible)', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 50; i += 1) seen.add(generateDeliveryOtp());
    expect(seen.size).toBeGreaterThan(1);
  });
});

describe('isValidOtpFormat', () => {
  it('accepts only 6-digit strings', () => {
    expect(isValidOtpFormat('000000')).toBe(true);
    expect(isValidOtpFormat('123456')).toBe(true);
    expect(isValidOtpFormat('12345')).toBe(false);
    expect(isValidOtpFormat('1234567')).toBe(false);
    expect(isValidOtpFormat('12345a')).toBe(false);
    expect(isValidOtpFormat('')).toBe(false);
    expect(isValidOtpFormat(123456)).toBe(false);
    expect(isValidOtpFormat(null)).toBe(false);
  });
});

describe('hashDeliveryOtp / verifyDeliveryOtp', () => {
  it('verifies the correct OTP', () => {
    const hash = hashDeliveryOtp(ORDER_ID, '424242');
    expect(hash).toMatch(/^[0-9a-f]{64}$/); // sha-256 hex
    expect(verifyDeliveryOtp(ORDER_ID, '424242', hash)).toBe(true);
  });

  it('rejects a wrong OTP', () => {
    const hash = hashDeliveryOtp(ORDER_ID, '424242');
    expect(verifyDeliveryOtp(ORDER_ID, '424243', hash)).toBe(false);
    expect(verifyDeliveryOtp(ORDER_ID, '000000', hash)).toBe(false);
  });

  it('binds the hash to the order id — a hash cannot be replayed on another order', () => {
    const otherOrderId = '22222222-2222-2222-2222-222222222222';
    const hash = hashDeliveryOtp(ORDER_ID, '424242');
    expect(verifyDeliveryOtp(otherOrderId, '424242', hash)).toBe(false);
    expect(hashDeliveryOtp(otherOrderId, '424242')).not.toBe(hash);
  });

  it('produces a deterministic hash for the same inputs', () => {
    expect(hashDeliveryOtp(ORDER_ID, '999999')).toBe(hashDeliveryOtp(ORDER_ID, '999999'));
  });

  it('does not crash on hash-length mismatches (defensive)', () => {
    expect(verifyDeliveryOtp(ORDER_ID, '424242', 'short')).toBe(false);
    expect(verifyDeliveryOtp(ORDER_ID, '424242', '')).toBe(false);
  });
});

describe('attempt ceiling', () => {
  it('matches the database CHECK constraint (otp_attempts <= 10)', () => {
    expect(MAX_OTP_ATTEMPTS).toBe(10);
  });
});
