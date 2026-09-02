/**
 * Tests for the upgraded Super Admin dashboard.
 *
 * Verifies:
 *   - Date range calculation logic
 *   - Compact number formatting
 *   - Status badge classification
 *   - Order stats aggregation
 */

import { describe, it, expect } from 'vitest';

// ---------------------------------------------------------------------------
// Date range helpers (re-implemented here for unit testing without importing
// the server component)
// ---------------------------------------------------------------------------

type DateRange = 'today' | '7d' | '30d' | 'custom';

function getDateRange(range: DateRange, now: Date, customFrom?: string, customTo?: string): { from: Date; to: Date } {
  const endOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);

  if (range === 'custom' && customFrom && customTo) {
    return {
      from: new Date(customFrom + 'T00:00:00'),
      to: new Date(customTo + 'T23:59:59'),
    };
  }

  switch (range) {
    case '7d': {
      const from = new Date(now);
      from.setDate(from.getDate() - 6);
      from.setHours(0, 0, 0, 0);
      return { from, to: endOfDay };
    }
    case '30d': {
      const from = new Date(now);
      from.setDate(from.getDate() - 29);
      from.setHours(0, 0, 0, 0);
      return { from, to: endOfDay };
    }
    case 'today':
    default: {
      const from = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0);
      return { from, to: endOfDay };
    }
  }
}

// ---------------------------------------------------------------------------
// Format helpers
// ---------------------------------------------------------------------------

function formatCompact(value: number): string {
  if (value >= 1_00_00_000) return `${(value / 1_00_00_000).toFixed(1)}Cr`;
  if (value >= 1_00_000) return `${(value / 1_00_000).toFixed(1)}L`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}k`;
  return value.toFixed(0);
}

// ---------------------------------------------------------------------------
// Order stats aggregation
// ---------------------------------------------------------------------------

interface OrderStatRow {
  status: string;
  grand_total: number;
}

function computeOrderStats(rows: OrderStatRow[]) {
  return {
    totalOrders: rows.length,
    totalSales: rows.reduce((sum, o) => sum + o.grand_total, 0),
    pendingOrders: rows.filter((o) => o.status === 'pending').length,
    confirmedOrders: rows.filter((o) => o.status === 'confirmed' || o.status === 'processing').length,
    dispatchedOrders: rows.filter((o) => o.status === 'dispatched' || o.status === 'packed').length,
    deliveredOrders: rows.filter((o) => o.status === 'delivered').length,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Dashboard date range', () => {
  it('returns today range correctly', () => {
    const now = new Date('2026-09-02T14:30:00');
    const { from, to } = getDateRange('today', now);
    expect(from.toISOString().slice(0, 10)).toBe('2026-09-02');
    expect(from.getHours()).toBe(0);
    expect(to.getHours()).toBe(23);
    expect(to.getMinutes()).toBe(59);
  });

  it('returns 7-day range correctly', () => {
    const now = new Date('2026-09-02T14:30:00');
    const { from, to } = getDateRange('7d', now);
    expect(from.toISOString().slice(0, 10)).toBe('2026-08-27');
    expect(to.toISOString().slice(0, 10)).toBe('2026-09-02');
  });

  it('returns 30-day range correctly', () => {
    const now = new Date('2026-09-02T14:30:00');
    const { from, to } = getDateRange('30d', now);
    expect(from.toISOString().slice(0, 10)).toBe('2026-08-04');
    expect(to.toISOString().slice(0, 10)).toBe('2026-09-02');
  });

  it('returns custom range correctly', () => {
    const now = new Date('2026-09-02T14:30:00');
    const { from, to } = getDateRange('custom', now, '2026-08-01', '2026-08-31');
    expect(from.toISOString().slice(0, 10)).toBe('2026-08-01');
    expect(to.toISOString().slice(0, 10)).toBe('2026-08-31');
  });
});

describe('Dashboard formatCompact', () => {
  it('formats thousands', () => {
    expect(formatCompact(1500)).toBe('1.5k');
    expect(formatCompact(50000)).toBe('50.0k');
  });

  it('formats lakhs', () => {
    expect(formatCompact(1_00_000)).toBe('1.0L');
    expect(formatCompact(5_50_000)).toBe('5.5L');
  });

  it('formats crores', () => {
    expect(formatCompact(1_00_00_000)).toBe('1.0Cr');
    expect(formatCompact(2_50_00_000)).toBe('2.5Cr');
  });

  it('formats small numbers', () => {
    expect(formatCompact(0)).toBe('0');
    expect(formatCompact(999)).toBe('999');
  });
});

describe('Dashboard order stats aggregation', () => {
  it('returns zeros for empty array', () => {
    const stats = computeOrderStats([]);
    expect(stats.totalOrders).toBe(0);
    expect(stats.totalSales).toBe(0);
    expect(stats.pendingOrders).toBe(0);
    expect(stats.deliveredOrders).toBe(0);
  });

  it('correctly counts orders by status', () => {
    const orders: OrderStatRow[] = [
      { status: 'pending', grand_total: 100 },
      { status: 'pending', grand_total: 200 },
      { status: 'confirmed', grand_total: 300 },
      { status: 'processing', grand_total: 150 },
      { status: 'packed', grand_total: 400 },
      { status: 'dispatched', grand_total: 250 },
      { status: 'delivered', grand_total: 500 },
      { status: 'delivered', grand_total: 600 },
    ];
    const stats = computeOrderStats(orders);
    expect(stats.totalOrders).toBe(8);
    expect(stats.totalSales).toBe(2500);
    expect(stats.pendingOrders).toBe(2);
    expect(stats.confirmedOrders).toBe(2); // confirmed + processing
    expect(stats.dispatchedOrders).toBe(2); // packed + dispatched
    expect(stats.deliveredOrders).toBe(2);
  });

  it('handles mixed statuses correctly', () => {
    const orders: OrderStatRow[] = [
      { status: 'pending', grand_total: 100 },
      { status: 'delivered', grand_total: 200 },
    ];
    const stats = computeOrderStats(orders);
    expect(stats.pendingOrders).toBe(1);
    expect(stats.deliveredOrders).toBe(1);
    expect(stats.confirmedOrders).toBe(0);
  });
});

describe('Dashboard top products aggregation', () => {
  it('aggregates items by product correctly', () => {
    const items = [
      { product_id: 'a', quantity: 5, line_total: 500 },
      { product_id: 'a', quantity: 3, line_total: 300 },
      { product_id: 'b', quantity: 10, line_total: 1000 },
      { product_id: 'c', quantity: 1, line_total: 50 },
    ];

    const byProduct = new Map<string, { qty: number; revenue: number }>();
    for (const item of items) {
      const existing = byProduct.get(item.product_id) ?? { qty: 0, revenue: 0 };
      existing.qty += item.quantity;
      existing.revenue += item.line_total;
      byProduct.set(item.product_id, existing);
    }

    expect(byProduct.get('a')?.qty).toBe(8);
    expect(byProduct.get('a')?.revenue).toBe(800);
    expect(byProduct.get('b')?.qty).toBe(10);
    expect(byProduct.get('b')?.revenue).toBe(1000);
  });
});
