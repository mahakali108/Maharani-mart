import { describe, expect, it } from 'vitest';
import {
  computeMembershipDiscount,
  calculateLoyaltyPointsEarned,
  loyaltyEarnKey,
  loyaltyReversalKey,
} from '@/lib/membership/math';

describe('Membership & Loyalty Business Logic', () => {
  describe('computeMembershipDiscount', () => {
    it('applies 0% discount for Free tier', () => {
      const result = computeMembershipDiscount({
        subtotalRupees: 1000,
        discountPercent: 0,
      });
      expect(result.discountRupees).toBe(0);
      expect(result.effectivePercent).toBe(0);
    });

    it('calculates 2% Silver membership discount accurately', () => {
      const result = computeMembershipDiscount({
        subtotalRupees: 2500,
        discountPercent: 2,
      });
      expect(result.discountRupees).toBe(50);
      expect(result.effectivePercent).toBe(2);
    });

    it('calculates 5% Gold membership discount accurately', () => {
      const result = computeMembershipDiscount({
        subtotalRupees: 10000,
        discountPercent: 5,
      });
      expect(result.discountRupees).toBe(500);
      expect(result.effectivePercent).toBe(5);
    });

    it('enforces configured maximum-discount caps', () => {
      const result = computeMembershipDiscount({
        subtotalRupees: 200000,
        discountPercent: 5,
        maxDiscountRupees: 5000,
      });
      expect(result.discountRupees).toBe(5000);
    });

    it('handles zero or negative subtotals safely without negative discount', () => {
      expect(computeMembershipDiscount({ subtotalRupees: 0, discountPercent: 5 }).discountRupees).toBe(0);
      expect(computeMembershipDiscount({ subtotalRupees: -100, discountPercent: 5 }).discountRupees).toBe(0);
    });
  });

  describe('calculateLoyaltyPointsEarned', () => {
    it('awards 1x points on base rate (₹100 per point) for Free tier', () => {
      const points = calculateLoyaltyPointsEarned({
        qualifyingOrderAmountRupees: 1550,
        pointsMultiplier: 1.0,
      });
      expect(points).toBe(15); // floor(1550 / 100) * 1.0 = 15
    });

    it('awards 1.5x points for Silver tier', () => {
      const points = calculateLoyaltyPointsEarned({
        qualifyingOrderAmountRupees: 2000,
        pointsMultiplier: 1.5,
      });
      expect(points).toBe(30); // 20 * 1.5 = 30
    });

    it('awards 2x points for Gold tier', () => {
      const points = calculateLoyaltyPointsEarned({
        qualifyingOrderAmountRupees: 3000,
        pointsMultiplier: 2.0,
      });
      expect(points).toBe(60); // 30 * 2.0 = 60
    });

    it('handles fractional qualifying amounts by flooring base points', () => {
      const points = calculateLoyaltyPointsEarned({
        qualifyingOrderAmountRupees: 99.99,
        pointsMultiplier: 2.0,
      });
      expect(points).toBe(0); // below 100 threshold
    });

    it('returns 0 points for zero or negative orders', () => {
      expect(calculateLoyaltyPointsEarned({ qualifyingOrderAmountRupees: 0 })).toBe(0);
      expect(calculateLoyaltyPointsEarned({ qualifyingOrderAmountRupees: -500 })).toBe(0);
    });
  });

  describe('Idempotency Keys', () => {
    it('generates deterministic idempotency keys for awards and reversals', () => {
      const orderId = 'a0000000-0000-0000-0000-000000000001';
      expect(loyaltyEarnKey(orderId)).toBe(`loyalty:earn:${orderId}`);
      expect(loyaltyReversalKey(orderId)).toBe(`loyalty:reversal:${orderId}`);
    });
  });
});
