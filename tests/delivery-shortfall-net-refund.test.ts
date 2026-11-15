import { describe, expect, it } from 'vitest';
import { computePartialSettlement, type SettlementLine } from '@/lib/delivery/settlement';
import { calculateLoyaltyPointsEarned } from '@/lib/membership/math';

describe('Delivery Shortfall & Discounted Net Refund Calculations', () => {
  it('refunds missing items at the exact net discounted rate, not gross catalog price', () => {
    // Scenario: Retailer bought 10 units of Face Cream with MRP ₹200 (Total Gross ₹2,000)
    // Retailer had Gold Membership (5% discount = ₹100 discount)
    // Plus a ₹100 coupon applied to the line.
    // Net amount paid for 10 units = ₹1,800 (180,000 paise).
    // Effective net price per piece = ₹180 (18,000 paise).
    // Upon delivery, 2 units are damaged, 1 unit is missing.
    // Delivered = 7, Damaged = 2, Missing = 1.
    // Expected refund must be for 3 units at net rate = 3 * 18,000 = 54,000 paise (₹540).
    // Gross refund would have been 3 * 20,000 = 60,000 paise (₹600) — an over-refund of ₹60!

    const netLineTotalPaise = 180000;
    const quantityOrdered = 10;
    const quantityMissing = 1;
    const quantityDamaged = 2;

    const line: SettlementLine = {
      lineTotalPaise: netLineTotalPaise,
      quantityOrdered,
      quantityMissing,
      quantityDamaged,
    };

    const settlement = computePartialSettlement([line]);

    expect(settlement.fullyDelivered).toBe(false);
    expect(settlement.shortfallPieces).toBe(3);
    // Verified: Refund is strictly 54,000 paise (₹540)
    expect(settlement.creditBackPaise).toBe(54000);
    // Delivered value of retained goods = 126,000 paise (₹1,260)
    expect(settlement.deliveredValuePaise).toBe(126000);
    expect(settlement.creditBackPaise + settlement.deliveredValuePaise).toBe(netLineTotalPaise);
  });

  it('awards loyalty points only for the actual delivered net value, excluding shortfalls', () => {
    // Gross order amount: ₹2,000
    // Net paid after discounts: ₹1,800
    // Shortfall refund credited back: ₹540
    // Actual delivered net order value: ₹1,260
    // With Gold VIP multiplier (2.0x, 1 point per ₹100):
    // Full gross points would have been: floor(2000 / 100) * 2 = 40 points (LEAKAGE)
    // Correct delivered net points: floor(1260 / 100) * 2 = 24 points

    const deliveredNetRupees = 1260;
    const pointsAwarded = calculateLoyaltyPointsEarned({
      qualifyingOrderAmountRupees: deliveredNetRupees,
      pointsMultiplier: 2.0,
      baseRateRupeesPerPoint: 100,
    });

    expect(pointsAwarded).toBe(24);
  });

  it('handles zero-value or free promotional items without division-by-zero or negative refunds', () => {
    const freeLine: SettlementLine = {
      lineTotalPaise: 0,
      quantityOrdered: 5,
      quantityMissing: 2,
      quantityDamaged: 1,
    };

    const settlement = computePartialSettlement([freeLine]);
    expect(settlement.fullyDelivered).toBe(false);
    expect(settlement.shortfallPieces).toBe(3);
    expect(settlement.creditBackPaise).toBe(0);
    expect(settlement.deliveredValuePaise).toBe(0);
  });

  it('handles multi-item basket where only some lines experience delivery shortfalls', () => {
    const lines: SettlementLine[] = [
      // Line 1: 5 units @ ₹100 net = 50,000 paise. 5 delivered, 0 shortfall.
      { lineTotalPaise: 50000, quantityOrdered: 5, quantityMissing: 0, quantityDamaged: 0 },
      // Line 2: 10 units @ ₹50 net = 50,000 paise. 8 delivered, 2 missing.
      { lineTotalPaise: 50000, quantityOrdered: 10, quantityMissing: 2, quantityDamaged: 0 },
    ];

    const settlement = computePartialSettlement(lines);
    expect(settlement.fullyDelivered).toBe(false);
    expect(settlement.shortfallPieces).toBe(2);
    // Line 2 refund: (50000 * 2) / 10 = 10,000 paise (₹100)
    expect(settlement.creditBackPaise).toBe(10000);
    // Total delivered value: 50,000 + 40,000 = 90,000 paise
    expect(settlement.deliveredValuePaise).toBe(90000);
  });
});
