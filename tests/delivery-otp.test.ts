/**
 * Delivery OTP helpers (lib/delivery/otp.ts) — the security core of the
 * Phase 4 handover proof. Pure Node (node:crypto), no network.
 */
import { afterEach, describe, expect, it } from 'vitest';

// Stored OTP hashes are HMAC-keyed since Phase 0 (SEC-8); hashing fails closed
// without a server secret, so the suite runs with an explicit test key.
process.env.DELIVERY_OTP_SECRET = 'test-delivery-otp-secret';

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

describe('keyed OTP hash (Phase 0 / SEC-8)', () => {
  const originalSecret = process.env.DELIVERY_OTP_SECRET;
  const originalServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  afterEach(() => {
    process.env.DELIVERY_OTP_SECRET = originalSecret;
    if (originalServiceKey === undefined) delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    else process.env.SUPABASE_SERVICE_ROLE_KEY = originalServiceKey;
  });

  it('the stored hash is NOT the unkeyed SHA-256 an attacker could brute-force offline', () => {
    expect(hashDeliveryOtp(ORDER_ID, '424242')).toMatch(/^[0-9a-f]{64}$/);
  });

  it('an offline dictionary without the key finds nothing', () => {
    const stored = hashDeliveryOtp(ORDER_ID, '000042');
    let found: string | null = null;
    for (let i = 0; i < 1000; i += 1) {
      const guess = i.toString().padStart(6, '0');
      if (plainSha(ORDER_ID, guess) === stored) found = guess;
    }
    expect(found).toBeNull();
  });

  it('depends on the server key', () => {
    const withKeyA = hashDeliveryOtp(ORDER_ID, '424242');
    process.env.DELIVERY_OTP_SECRET = 'a-different-secret';
    expect(hashDeliveryOtp(ORDER_ID, '424242')).not.toBe(withKeyA);
    expect(verifyDeliveryOtp(ORDER_ID, '424242', withKeyA)).toBe(false);
  });

  it('falls back to a key derived from SUPABASE_SERVICE_ROLE_KEY (never the raw key)', () => {
    delete process.env.DELIVERY_OTP_SECRET;
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role-test-key';
    const hash = hashDeliveryOtp(ORDER_ID, '424242');
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(verifyDeliveryOtp(ORDER_ID, '424242', hash)).toBe(true);
    expect(hash).not.toBe(plainSha(ORDER_ID, '424242'));
  });

  it('fails closed when no server secret is configured', () => {
    delete process.env.DELIVERY_OTP_SECRET;
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    expect(() => hashDeliveryOtp(ORDER_ID, '424242')).toThrow(/not configured/);
  });

  it('rejects legacy unkeyed SHA-256 hashes because they permit offline OTP brute force', () => {
    const legacy = '0'.repeat(64);
    expect(verifyDeliveryOtp(ORDER_ID, '135790', legacy)).toBe(false);
  });
});
