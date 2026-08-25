import { beforeEach, describe, expect, it } from 'vitest';
import { isRoleAuthorizedForAISurface, resolveRetailerTarget } from '@/lib/ai/safety/auth';
import { FixedWindowRateLimiter } from '@/lib/ai/safety/rate-limit';
import { createConfirmationToken, verifyConfirmationToken } from '@/lib/ai/safety/confirmation';
import { VERIFICATION_FAILURE_MESSAGE, verificationFailure } from '@/lib/ai/safety/constants';
import type { AIActor } from '@/lib/ai/types';

const retailer: AIActor = { id: '00000000-0000-4000-8000-000000000001', role: 'retailer', fullName: 'Retailer', surface: 'retailer' };

beforeEach(() => { process.env.AI_ACTION_SIGNING_SECRET = 'test-secret-that-is-at-least-thirty-two-characters'; });

describe('AI authorization and isolation', () => {
  it('denies mismatched and unauthorized role workspaces', () => {
    expect(isRoleAuthorizedForAISurface('retailer', 'admin')).toBe(false);
    expect(isRoleAuthorizedForAISurface('staff', 'staff')).toBe(true);
    expect(isRoleAuthorizedForAISurface('salesman', 'salesman')).toBe(true);
    expect(isRoleAuthorizedForAISurface('admin', 'admin')).toBe(true);
    expect(isRoleAuthorizedForAISurface('staff', 'admin')).toBe(false);
  });

  it('pins a retailer target to the authenticated actor', () => {
    expect(resolveRetailerTarget(retailer, '00000000-0000-4000-8000-000000000099')).toBe(retailer.id);
    expect(resolveRetailerTarget({ id: retailer.id, role: 'admin' })).toBeNull();
  });

  it('binds confirmations to actor, role, surface and expiry', () => {
    const token = createConfirmationToken(retailer, 'add_cart_item', { packId: retailer.id, quantity: 10 }, 1_000);
    expect(verifyConfirmationToken(token, retailer, 2_000).tool).toBe('add_cart_item');
    expect(() => verifyConfirmationToken(token, { ...retailer, id: '00000000-0000-4000-8000-000000000002' }, 2_000)).toThrow();
    expect(() => verifyConfirmationToken(token, retailer, 700_000)).toThrow(/expired/i);
  });

  it('rate limits at the configured boundary and resets the window', () => {
    const limiter = new FixedWindowRateLimiter(2, 1000);
    expect(limiter.consume('u', 0).allowed).toBe(true);
    expect(limiter.consume('u', 10).allowed).toBe(true);
    expect(limiter.consume('u', 20).allowed).toBe(false);
    expect(limiter.consume('u', 1000).allowed).toBe(true);
  });

  it('uses the required anti-hallucination fallback', () => {
    expect(verificationFailure()).toBe(VERIFICATION_FAILURE_MESSAGE);
    expect(verificationFailure('Data available nahi hai.')).toContain('Data available nahi hai.');
  });
});
