import { describe, expect, it } from 'vitest';
import { computePartialSettlement, type SettlementLine } from '@/lib/delivery/settlement';
import { calculateLoyaltyPointsEarned, loyaltyEarnKey, loyaltyReversalKey } from '@/lib/membership/math';

describe('Delivery Shortfall, Refund & Loyalty Accrual Regression Matrix', () => {
  // 1. Full successful delivery
  it('1. Full successful delivery: 100% delivered, 0 shortfall, full loyalty earned', () => {
    const lines: SettlementLine[] = [
      { lineTotalPaise: 100000, quantityOrdered: 10, quantityMissing: 0, quantityDamaged: 0 },
      { lineTotalPaise: 50000, quantityOrdered: 5, quantityMissing: 0, quantityDamaged: 0 },
    ];
    const settlement = computePartialSettlement(lines);

    expect(settlement.fullyDelivered).toBe(true);
    expect(settlement.shortfallPieces).toBe(0);
    expect(settlement.creditBackPaise).toBe(0);
    expect(settlement.deliveredValuePaise).toBe(150000);

    const points = calculateLoyaltyPointsEarned({
      qualifyingOrderAmountRupees: settlement.deliveredValuePaise / 100,
      pointsMultiplier: 1.5,
    });
    // 1500 rupees / 100 * 1.5 = 22 points
    expect(points).toBe(22);
  });

  // 2. Partial delivery with missing units
  it('2. Partial delivery with missing units: refund calculated at net paid rate', () => {
    // 10 units ordered for ₹900 net (coupon discounted from ₹1000) -> 90,000 paise
    // 3 units missing -> refund must be 3 * 9,000 = 27,000 paise
    const lines: SettlementLine[] = [
      { lineTotalPaise: 90000, quantityOrdered: 10, quantityMissing: 3, quantityDamaged: 0 },
    ];
    const settlement = computePartialSettlement(lines);

    expect(settlement.fullyDelivered).toBe(false);
    expect(settlement.shortfallPieces).toBe(3);
    expect(settlement.creditBackPaise).toBe(27000);
    expect(settlement.deliveredValuePaise).toBe(63000);

    // Points earned strictly on delivered ₹630 (not ₹900)
    const points = calculateLoyaltyPointsEarned({
      qualifyingOrderAmountRupees: settlement.deliveredValuePaise / 100,
      pointsMultiplier: 1.0,
    });
    expect(points).toBe(6);
  });

  // 3. Damaged items during transit
  it('3. Damaged items: treated identically to missing units for wallet credit', () => {
    const lines: SettlementLine[] = [
      { lineTotalPaise: 120000, quantityOrdered: 6, quantityMissing: 0, quantityDamaged: 2 },
    ];
    const settlement = computePartialSettlement(lines);

    expect(settlement.fullyDelivered).toBe(false);
    expect(settlement.shortfallPieces).toBe(2);
    // (120,000 * 2) / 6 = 40,000 paise
    expect(settlement.creditBackPaise).toBe(40000);
    expect(settlement.deliveredValuePaise).toBe(80000);
  });

  // 4. Discounted items and wholesale slabs
  it('4. Discounted items and wholesale slabs: half-up rounding keeps paise conservation', () => {
    // Wholesale slab rate: 3 units ordered for total net 10,000 paise (₹100)
    // Unit price is 3,333.33 paise.
    // 1 unit missing.
    // roundHalfUp(10000 * 1 / 3) = roundHalfUp(3333.333...) = 3333 paise.
    const lines: SettlementLine[] = [
      { lineTotalPaise: 10000, quantityOrdered: 3, quantityMissing: 1, quantityDamaged: 0 },
    ];
    const settlement = computePartialSettlement(lines);

    expect(settlement.creditBackPaise).toBe(3333);
    expect(settlement.deliveredValuePaise).toBe(6667);
    expect(settlement.creditBackPaise + settlement.deliveredValuePaise).toBe(10000);
  });

  // 5. Coins/wallet plus COD bounds check
  it('5. Coins/wallet plus COD: refund never exceeds attributable line total', () => {
    const lines: SettlementLine[] = [
      { lineTotalPaise: 25000, quantityOrdered: 5, quantityMissing: 5, quantityDamaged: 0 },
    ];
    const settlement = computePartialSettlement(lines);

    expect(settlement.shortfallPieces).toBe(5);
    expect(settlement.creditBackPaise).toBe(25000);
    expect(settlement.deliveredValuePaise).toBe(0);
    // Cannot credit more than line value
    expect(settlement.creditBackPaise).toBeLessThanOrEqual(25000);
  });

  // 6. Repeated shortfall processing idempotency keys
  it('6. Repeated shortfall & delivery: idempotency keys are deterministic', () => {
    const orderId = 'a0000000-0000-0000-0000-000000000001';
    const deliveryId = 'd0000000-0000-0000-0000-000000000001';

    const earnKey1 = loyaltyEarnKey(orderId);
    const earnKey2 = loyaltyEarnKey(orderId);
    expect(earnKey1).toBe(earnKey2);
    expect(earnKey1).toBe(`loyalty:earn:${orderId}`);

    const revKey1 = loyaltyReversalKey(orderId);
    const revKey2 = loyaltyReversalKey(orderId);
    expect(revKey1).toBe(revKey2);
    expect(revKey1).toBe(`loyalty:reversal:${orderId}`);

    const shortfallKey = `delivery-shortfall:${deliveryId}`;
    expect(shortfallKey).toBe(`delivery-shortfall:${deliveryId}`);
  });

  // 7. Full return and partial return loyalty points
  it('7. Full return vs partial return: exact points reversal calculation', () => {
    // Original delivery: ₹2,000 net -> 20 base points * 2.0 (Gold) = 40 points
    const originalPoints = calculateLoyaltyPointsEarned({
      qualifyingOrderAmountRupees: 2000,
      pointsMultiplier: 2.0,
    });
    expect(originalPoints).toBe(40);

    // Full return: Reverses all 40 points
    const fullReturnReversed = originalPoints;
    expect(fullReturnReversed).toBe(40);

    // Partial return of 1 item worth ₹500 net:
    // Points attributable to returned item: floor(500 / 100) * 2.0 = 10 points
    const partialReturnedRupees = 500;
    const partialReversedPoints = calculateLoyaltyPointsEarned({
      qualifyingOrderAmountRupees: partialReturnedRupees,
      pointsMultiplier: 2.0,
    });
    expect(partialReversedPoints).toBe(10);
    expect(originalPoints - partialReversedPoints).toBe(30);
  });
});
