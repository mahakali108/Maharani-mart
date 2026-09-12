import { describe, expect, it } from 'vitest';
import {
  computeCommissionPaise,
  nextCommissionStatus,
  resolveMonthPeriod,
  resolveQuarterPeriod,
  summarizeSalesBasis,
  targetAttainmentPercent,
  validateTargetPeriod,
  isTargetMetric,
  TARGET_METRICS,
} from '@/lib/admin/targets-shared';
import { can } from '@/lib/permissions/permissions';

describe('target period resolution', () => {
  it('resolves calendar months including leap February', () => {
    expect(resolveMonthPeriod('2025-02-14')).toEqual({ start: '2025-02-01', end: '2025-02-28' });
    expect(resolveMonthPeriod('2024-02-29')).toEqual({ start: '2024-02-01', end: '2024-02-29' });
    expect(resolveMonthPeriod('2025-12-31')).toEqual({ start: '2025-12-01', end: '2025-12-31' });
  });

  it('resolves calendar quarters', () => {
    expect(resolveQuarterPeriod('2025-01-15')).toEqual({ start: '2025-01-01', end: '2025-03-31' });
    expect(resolveQuarterPeriod('2025-11-30')).toEqual({ start: '2025-10-01', end: '2025-12-31' });
  });

  it('rejects malformed anchors', () => {
    expect(resolveMonthPeriod('not-a-date')).toBeNull();
    expect(resolveMonthPeriod('2025-13-01')).toBeNull();
    expect(resolveQuarterPeriod('')).toBeNull();
  });
});

describe('target period validation', () => {
  it('accepts real month and quarter spans', () => {
    expect(validateTargetPeriod('month', '2025-07-01', '2025-07-31')).toMatchObject({ ok: true });
    expect(validateTargetPeriod('quarter', '2025-07-01', '2025-09-30')).toMatchObject({ ok: true });
  });

  it('rejects end before start and wrong-sized spans', () => {
    expect(validateTargetPeriod('month', '2025-07-31', '2025-07-01')).toMatchObject({ ok: false });
    expect(validateTargetPeriod('month', '2025-07-01', '2025-07-05')).toMatchObject({ ok: false });
    expect(validateTargetPeriod('quarter', '2025-07-01', '2025-07-31')).toMatchObject({ ok: false });
    expect(validateTargetPeriod('month', 'garbage', '2025-07-31')).toMatchObject({ ok: false });
  });
});

describe('target attainment', () => {
  it('computes clamped percentages and guards zero targets', () => {
    expect(targetAttainmentPercent(50, 100)).toBe(50);
    // Over-achievement is real information (125%); the progress bar clamps visually.
    expect(targetAttainmentPercent(250, 100)).toBe(250);
    expect(targetAttainmentPercent(0, 100)).toBe(0);
    expect(targetAttainmentPercent(100, 0)).toBeNull();
  });
});

describe('commission math', () => {
  it('computes integer paise and never floats', () => {
    expect(computeCommissionPaise(100_000, 2.5)).toBe(250_000);
    expect(computeCommissionPaise(333.33, 3)).toBe(1000); // 999.99 paise rounds to 1000
    expect(computeCommissionPaise(1000, 0)).toBe(0);
  });

  it('rejects invalid basis amounts and rates', () => {
    expect(computeCommissionPaise(-5, 10)).toBe(0);
    expect(computeCommissionPaise(1000, -1)).toBe(0);
    expect(computeCommissionPaise(1000, 101)).toBe(0);
    expect(computeCommissionPaise(Number.NaN, 10)).toBe(0);
  });

  it('summarizes sales basis from real order rows, excluding cancelled/returned', () => {
    const orders = [
      { grand_total: 1000, status: 'pending' },
      { grand_total: 2000, status: 'delivered' },
      { grand_total: 9999, status: 'cancelled' },
      { grand_total: 8888, status: 'returned' },
      { grand_total: -50, status: 'confirmed' },
    ];
    expect(summarizeSalesBasis(orders)).toBe(3000);
    expect(summarizeSalesBasis([])).toBe(0);
  });

  it('enforces the draft → approved → paid lifecycle only', () => {
    expect(nextCommissionStatus('draft')).toBe('approved');
    expect(nextCommissionStatus('approved')).toBe('paid');
    expect(nextCommissionStatus('paid')).toBeNull();
  });
});

describe('target metrics catalogue', () => {
  it('accepts only the five real metrics', () => {
    for (const metric of TARGET_METRICS) expect(isTargetMetric(metric.value)).toBe(true);
    expect(isTargetMetric('revenue')).toBe(false);
    expect(isTargetMetric(undefined)).toBe(false);
  });
});

describe('permission wiring for targets and commissions (Phase 2)', () => {
  it('grants target/commission management to admins only, never staff/salesman/retailer', () => {
    expect(can('super_admin', 'targets.manage')).toBe(true);
    expect(can('admin', 'targets.manage')).toBe(true);
    expect(can('staff', 'targets.manage')).toBe(false);
    expect(can('salesman', 'targets.manage')).toBe(false);
    expect(can('retailer', 'targets.manage')).toBe(false);

    expect(can('super_admin', 'commissions.manage')).toBe(true);
    expect(can('admin', 'commissions.manage')).toBe(true);
    expect(can('staff', 'commissions.manage')).toBe(false);
    expect(can('salesman', 'commissions.manage')).toBe(false);
    expect(can('retailer', 'commissions.manage')).toBe(false);
  });
});
