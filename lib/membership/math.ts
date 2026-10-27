import type { MembershipTier } from './types';

export interface MembershipDiscountRule {
  tier: MembershipTier;
  discountPercent: number;
  maxDiscountPaise?: number;
}

export function computeMembershipDiscount({
  subtotalRupees,
  discountPercent,
  maxDiscountRupees = 5000,
}: {
  subtotalRupees: number;
  discountPercent: number;
  maxDiscountRupees?: number;
}): {
  discountRupees: number;
  effectivePercent: number;
} {
  if (subtotalRupees <= 0 || discountPercent <= 0) {
    return { discountRupees: 0, effectivePercent: 0 };
  }

  const rawDiscount = (subtotalRupees * discountPercent) / 100;
  const cappedDiscount = Math.min(rawDiscount, maxDiscountRupees);
  const roundedDiscount = Math.round(cappedDiscount * 100) / 100;

  return {
    discountRupees: roundedDiscount,
    effectivePercent: discountPercent,
  };
}

export function calculateLoyaltyPointsEarned({
  qualifyingOrderAmountRupees,
  pointsMultiplier = 1.0,
  baseRateRupeesPerPoint = 100, // 1 point per ₹100 spent
}: {
  qualifyingOrderAmountRupees: number;
  pointsMultiplier?: number;
  baseRateRupeesPerPoint?: number;
}): number {
  if (qualifyingOrderAmountRupees <= 0 || baseRateRupeesPerPoint <= 0) {
    return 0;
  }

  const basePoints = Math.floor(qualifyingOrderAmountRupees / baseRateRupeesPerPoint);
  const effectiveMultiplier = Math.max(1.0, pointsMultiplier);
  return Math.floor(basePoints * effectiveMultiplier);
}

export function loyaltyEarnKey(orderId: string): string {
  return `loyalty:earn:${orderId}`;
}

export function loyaltyReversalKey(orderId: string): string {
  return `loyalty:reversal:${orderId}`;
}
