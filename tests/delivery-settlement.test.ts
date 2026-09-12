/**
 * Partial-delivery settlement math (lib/delivery/settlement.ts, decision D4):
 * missing/damaged value is credited back to the retailer's wallet.
 */
import { describe, expect, it } from 'vitest';
import { computePartialSettlement } from '@/lib/delivery/settlement';

describe('computePartialSettlement', () => {
  it('full delivery: no credit back', () => {
    const result = computePartialSettlement([
      { lineTotalPaise: 100000, quantityOrdered: 10, quantityMissing: 0, quantityDamaged: 0 },
      { lineTotalPaise: 50000, quantityOrdered: 5, quantityMissing: 0, quantityDamaged: 0 },
    ]);
    expect(result.fullyDelivered).toBe(true);
    expect(result.creditBackPaise).toBe(0);
    expect(result.deliveredValuePaise).toBe(150000);
    expect(result.shortfallPieces).toBe(0);
  });

  it('missing quantity is credited proportionally (exact split)', () => {
    const result = computePartialSettlement([
      { lineTotalPaise: 100000, quantityOrdered: 10, quantityMissing: 2, quantityDamaged: 0 },
    ]);
    expect(result.fullyDelivered).toBe(false);
    expect(result.creditBackPaise).toBe(20000);
    expect(result.deliveredValuePaise).toBe(80000);
    expect(result.shortfallPieces).toBe(2);
  });

  it('damaged counts like missing for the credit', () => {
    const result = computePartialSettlement([
      { lineTotalPaise: 100000, quantityOrdered: 10, quantityMissing: 0, quantityDamaged: 3 },
    ]);
    expect(result.creditBackPaise).toBe(30000);
    expect(result.shortfallPieces).toBe(3);
  });

  it('mixes missing and damaged within one line', () => {
    const result = computePartialSettlement([
      { lineTotalPaise: 90000, quantityOrdered: 9, quantityMissing: 2, quantityDamaged: 1 },
    ]);
    expect(result.creditBackPaise).toBe(30000); // 3/9 of 90000
    expect(result.shortfallPieces).toBe(3);
  });

  it('rounds half-up when the split is not exact and never exceeds the line total', () => {
    const result = computePartialSettlement([
      { lineTotalPaise: 100, quantityOrdered: 3, quantityMissing: 1, quantityDamaged: 0 },
    ]);
    // 100/3 = 33.33… → 33
    expect(result.creditBackPaise).toBe(33);
    expect(result.creditBackPaise).toBeLessThanOrEqual(100);

    const rounded = computePartialSettlement([
      { lineTotalPaise: 101, quantityOrdered: 3, quantityMissing: 1, quantityDamaged: 0 },
    ]);
    // 101/3 = 33.67 → 34
    expect(rounded.creditBackPaise).toBe(34);
  });

  it('a fully short line credits back the whole line', () => {
    const result = computePartialSettlement([
      { lineTotalPaise: 75000, quantityOrdered: 6, quantityMissing: 6, quantityDamaged: 0 },
    ]);
    expect(result.creditBackPaise).toBe(75000);
    expect(result.deliveredValuePaise).toBe(0);
    expect(result.fullyDelivered).toBe(false);
  });

  it('aggregates across lines', () => {
    const result = computePartialSettlement([
      { lineTotalPaise: 100000, quantityOrdered: 10, quantityMissing: 1, quantityDamaged: 0 },
      { lineTotalPaise: 40000, quantityOrdered: 8, quantityMissing: 0, quantityDamaged: 4 },
    ]);
    expect(result.creditBackPaise).toBe(10000 + 20000);
    expect(result.deliveredValuePaise).toBe(110000);
    expect(result.shortfallPieces).toBe(5);
  });

  it('defends against nonsense input (negative/fractional/zero-value)', () => {
    const result = computePartialSettlement([
      { lineTotalPaise: -500, quantityOrdered: 4, quantityMissing: 2, quantityDamaged: 0 }, // negative total: pieces count, no credit
      { lineTotalPaise: 0, quantityOrdered: 3, quantityMissing: 3, quantityDamaged: 0 }, // zero value: pieces count, no credit
      { lineTotalPaise: 1000, quantityOrdered: 0, quantityMissing: 5, quantityDamaged: 0 }, // zero qty: skipped entirely
      { lineTotalPaise: 1000.7, quantityOrdered: 2.9, quantityMissing: 1.5, quantityDamaged: 0 }, // floored to whole numbers
    ]);
    // 2 (neg) + 3 (zero-value) + 1 (fractional→floor) — the zero-qty line is skipped.
    expect(result.shortfallPieces).toBe(6);
    // Only the fractional line carries value: floor(1000.7)=1001, 1 of 2 pieces → round(500.5) = 501.
    expect(result.creditBackPaise).toBe(501);
    expect(result.fullyDelivered).toBe(false);
  });

  it('empty order: trivially fully delivered', () => {
    const result = computePartialSettlement([]);
    expect(result.fullyDelivered).toBe(true);
    expect(result.creditBackPaise).toBe(0);
    expect(result.deliveredValuePaise).toBe(0);
  });
});
