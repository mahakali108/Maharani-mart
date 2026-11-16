import { describe, expect, it } from 'vitest';
import {
  OTP_DEFAULT_CODE_LENGTH,
  OTP_DEFAULT_EXPIRY_MINUTES,
  OTP_MAX_VERIFY_ATTEMPTS,
  OTP_RESEND_COOLDOWN_SECONDS,
  classifyOtpVerifyError,
  isOtpRateLimitError,
  maskEmail,
  normalizeOtpCode,
  otpCooldownRemaining,
  otpErrorMessage,
  otpSentMessage,
  resolveOtpCodeLength,
  resolveOtpExpiryMinutes,
} from '@/lib/auth/otp-rules';

describe('OTP code normalisation', () => {
  it('accepts a plain 6-digit code', () => {
    expect(normalizeOtpCode('123456', 6)).toBe('123456');
  });

  it('tolerates spaces, dashes and NBSP copied from an HTML email', () => {
    expect(normalizeOtpCode('123 456', 6)).toBe('123456');
    expect(normalizeOtpCode('123-456', 6)).toBe('123456');
    expect(normalizeOtpCode('123\u00a0456', 6)).toBe('123456');
    expect(normalizeOtpCode(' 123456 ', 6)).toBe('123456');
  });

  it('honours the project code length', () => {
    expect(normalizeOtpCode('12345678', 8)).toBe('12345678');
    expect(normalizeOtpCode('12345678', 6)).toBeNull();
  });

  it('rejects partial, over-long and non-numeric input', () => {
    expect(normalizeOtpCode('12345', 6)).toBeNull();
    expect(normalizeOtpCode('1234567', 6)).toBeNull();
    expect(normalizeOtpCode('12a456', 6)).toBeNull();
    expect(normalizeOtpCode('', 6)).toBeNull();
    expect(normalizeOtpCode(undefined, 6)).toBeNull();
    expect(normalizeOtpCode(123456 as unknown, 6)).toBeNull();
  });
});

describe('OTP length comes from configuration, never from user input', () => {
  it('defaults to 6', () => {
    expect(OTP_DEFAULT_CODE_LENGTH).toBe(6);
    expect(resolveOtpCodeLength(undefined)).toBe(6);
    expect(resolveOtpCodeLength('')).toBe(6);
    expect(resolveOtpCodeLength('abc')).toBe(6);
  });

  it('accepts the supported range and rejects anything else', () => {
    expect(resolveOtpCodeLength('6')).toBe(6);
    expect(resolveOtpCodeLength('8')).toBe(8);
    expect(resolveOtpCodeLength('4')).toBe(6);
    expect(resolveOtpCodeLength('99')).toBe(6);
    expect(resolveOtpCodeLength('-1')).toBe(6);
  });
});

describe('OTP expiry mirrors the Auth project, never a guess', () => {
  it('defaults to the live Supabase value (60 minutes)', () => {
    expect(OTP_DEFAULT_EXPIRY_MINUTES).toBe(60);
    expect(resolveOtpExpiryMinutes(undefined)).toBe(60);
  });

  it('shows a configured value', () => {
    expect(resolveOtpExpiryMinutes('10')).toBe(10);
  });

  it('falls back rather than showing a nonsense duration', () => {
    expect(resolveOtpExpiryMinutes('0')).toBe(60);
    expect(resolveOtpExpiryMinutes('-5')).toBe(60);
    expect(resolveOtpExpiryMinutes('99999')).toBe(60);
    expect(resolveOtpExpiryMinutes('soon')).toBe(60);
  });
});

describe('resend cooldown', () => {
  it('blocks a resend inside the window', () => {
    const now = 1_000_000_000_000;
    expect(otpCooldownRemaining(now - 10_000, now)).toBe(OTP_RESEND_COOLDOWN_SECONDS - 10);
  });

  it('allows a resend once the window has passed', () => {
    const now = 1_000_000_000_000;
    expect(otpCooldownRemaining(now - 90_000, now)).toBe(0);
    expect(otpCooldownRemaining(now - OTP_RESEND_COOLDOWN_SECONDS * 1000, now)).toBe(0);
  });

  it('treats a missing or unusable timestamp as expired', () => {
    expect(otpCooldownRemaining(null)).toBe(0);
    expect(otpCooldownRemaining(undefined)).toBe(0);
    expect(otpCooldownRemaining(Number.NaN)).toBe(0);
    expect(otpCooldownRemaining(0)).toBe(0);
  });
});

describe('error classification (no account detail leaks)', () => {
  it('maps throttling', () => {
    expect(isOtpRateLimitError({ status: 429 })).toBe(true);
    expect(isOtpRateLimitError({ message: 'email rate limit exceeded' })).toBe(true);
    expect(isOtpRateLimitError({ message: 'For security purposes, you can only request this after 38 seconds' })).toBe(
      true
    );
    expect(isOtpRateLimitError({ status: 403, message: 'Invalid token' })).toBe(false);
    expect(isOtpRateLimitError(null)).toBe(false);
  });

  it('distinguishes expiry from a wrong code', () => {
    expect(classifyOtpVerifyError({ message: 'Token has expired or is invalid', code: 'otp_expired' })).toBe(
      'expired_code'
    );
    expect(classifyOtpVerifyError({ message: 'Invalid token', code: 'otp_disabled' })).toBe('invalid_code');
    expect(classifyOtpVerifyError({ status: 429 })).toBe('rate_limited');
    expect(classifyOtpVerifyError(null)).toBe('verify_failed');
  });

  it('never says whether an account exists', () => {
    const messages = (['invalid_code', 'expired_code', 'rate_limited', 'send_failed', 'verify_failed', 'account_unavailable'] as const).map(
      otpErrorMessage
    );
    for (const message of messages) {
      expect(message).not.toMatch(/not found|no account|does not exist|unregistered|unknown email/i);
    }
  });

  it('keeps the attempt budget a positive bound', () => {
    expect(OTP_MAX_VERIFY_ATTEMPTS).toBeGreaterThanOrEqual(3);
    expect(OTP_MAX_VERIFY_ATTEMPTS).toBeLessThanOrEqual(10);
  });
});

describe('email masking', () => {
  it('reveals one character of the local part at most', () => {
    expect(maskEmail('rajesh.kumar@gmail.com')).toBe('r***@gmail.com');
    expect(maskEmail('a@b.com')).toBe('a***@b.com');
  });

  it('handles malformed input without throwing', () => {
    expect(maskEmail('')).toBe('');
    expect(maskEmail('no-at-sign')).toBe('n***');
  });

  it('is lossy — the original address cannot be reconstructed', () => {
    expect(maskEmail('owner@maharanitraders.in')).not.toContain('owner');
    expect(maskEmail('owner@maharanitraders.in')).toContain('***');
  });

  it('phrases the sent message identically for every address', () => {
    const a = otpSentMessage('a***@x.com');
    const b = otpSentMessage('z***@y.org');
    expect(a.replace('a***@x.com', 'ADDR')).toBe(b.replace('z***@y.org', 'ADDR'));
    expect(a).toMatch(/belongs to an account/i);
  });
});
