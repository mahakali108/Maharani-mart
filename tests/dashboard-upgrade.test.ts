/**
 * Admin Dashboard — aggregations, date range, visibility, and source guards.
 *
 * Compute functions are the production module (not re-implemented here).
 * Fetching is not exercised: there is no test DB. Source scans lock in
 * auth, RLS client, IST bounds, and "no fake data".
 */

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  buildSystemAlerts,
  computeCreditSummary,
  computeExpiringBatches,
  computeGstSummary,
  computeInventoryAlerts,
  computeOrderKpis,
  computePaymentSummary,
  computePendingApprovals,
  computeRecentOrders,
  computeRetailerKpis,
  computeSalesKpis,
  computeSupportSummary,
  computeTopProducts,
  computeTopRetailers,
} from '@/lib/admin/dashboard/compute';
import { formatCompact, formatPct } from '@/lib/admin/dashboard/format';
import { parseDashboardRange } from '@/lib/admin/dashboard/range';
import { dashboardVisibility } from '@/lib/admin/dashboard/visibility';
import { can } from '@/lib/permissions/permissions';
import type { DashboardOrder, DashboardOrderItem, DashboardRetailer } from '@/lib/admin/dashboard/types';

const root = join(__dirname, '..');
const read = (rel: string) => readFileSync(join(root, rel), 'utf8');

const NOW = new Date('2026-09-02T08:30:00.000Z'); // 02 Sep 2026, 14:00 IST

function order(overrides: Partial<DashboardOrder> & { id: string }): DashboardOrder {
  return {
    order_number: `MK-${overrides.id}`,
    retailer_id: 'r-1',
    status: 'confirmed',
    subtotal: 100,
    gst_total: 18,
    grand_total: 118,
    placed_at: '2026-09-02T08:00:00.000Z',
    ...overrides,
  };
}

function retailer(overrides: Partial<DashboardRetailer> & { id: string }): DashboardRetailer {
  return {
    shop_name: `Shop ${overrides.id}`,
    status: 'active',
    credit_limit: 0,
    outstanding_balance: 0,
    created_at: '2026-01-01T00:00:00.000Z',
    approved_at: '2026-01-02T00:00:00.000Z',
    ...overrides,
  };
}

describe('Dashboard date range (Asia/Kolkata)', () => {
  it('defaults unknown/missing preset to today (IST day bounds)', () => {
    const range = parseDashboardRange({}, NOW);
    expect(range.preset).toBe('today');
    expect(range.fromKey).toBe('2026-09-02');
    expect(range.toKey).toBe('2026-09-02');
    expect(range.fromIso).toBe('2026-09-01T18:30:00.000Z');
    expect(range.toIso).toBe('2026-09-02T18:29:59.999Z');
    expect(range.spanDays).toBe(1);
  });

  it('returns a 7-day IST window ending today', () => {
    const range = parseDashboardRange({ range: '7d' }, NOW);
    expect(range.fromKey).toBe('2026-08-27');
    expect(range.toKey).toBe('2026-09-02');
    expect(range.spanDays).toBe(7);
  });

  it('returns a 30-day IST window ending today', () => {
    const range = parseDashboardRange({ range: '30d' }, NOW);
    expect(range.fromKey).toBe('2026-08-04');
    expect(range.toKey).toBe('2026-09-02');
    expect(range.spanDays).toBe(30);
  });

  it('accepts a custom IST range and builds an equal-length previous window', () => {
    const range = parseDashboardRange({ range: 'custom', from: '2026-08-01', to: '2026-08-31' }, NOW);
    expect(range.preset).toBe('custom');
    expect(range.fromKey).toBe('2026-08-01');
    expect(range.toKey).toBe('2026-08-31');
    expect(range.previousToKey).toBe('2026-07-31');
    expect(range.previousFromKey).toBe('2026-07-01');
    expect(range.error).toBeNull();
  });

  it('falls back to today when custom dates are invalid — never fabricates a window', () => {
    const range = parseDashboardRange({ range: 'custom', from: 'nope', to: '2026-08-31' }, NOW);
    expect(range.preset).toBe('today');
    expect(range.fromKey).toBe('2026-09-02');
    expect(range.error).toMatch(/valid dates/i);
  });

  it('clamps a custom window to 90 India calendar days', () => {
    const range = parseDashboardRange({ range: 'custom', from: '2026-01-01', to: '2026-09-02' }, NOW);
    expect(range.truncatedWindow).toBe(true);
    expect(range.toKey).toBe('2026-09-02');
    expect(range.spanDays).toBe(90);
  });

  it('swaps inverted custom dates', () => {
    const range = parseDashboardRange({ range: 'custom', from: '2026-09-01', to: '2026-08-20' }, NOW);
    expect(range.fromKey).toBe('2026-08-20');
    expect(range.toKey).toBe('2026-09-01');
  });
});

describe('Dashboard formatCompact', () => {
  it('formats thousands, lakhs, crores and small numbers', () => {
    expect(formatCompact(1500)).toBe('1.5k');
    expect(formatCompact(50000)).toBe('50.0k');
    expect(formatCompact(1_00_000)).toBe('1.0L');
    expect(formatCompact(5_50_000)).toBe('5.5L');
    expect(formatCompact(1_00_00_000)).toBe('1.0Cr');
    expect(formatCompact(2_50_00_000)).toBe('2.5Cr');
    expect(formatCompact(0)).toBe('0');
    expect(formatCompact(999)).toBe('999');
  });
});

describe('Dashboard sales KPIs', () => {
  it('returns zeros and empty status with no orders', () => {
    const stats = computeSalesKpis([], []);
    expect(stats.status).toBe('empty');
    expect(stats.sales).toBe(0);
    expect(stats.orderCount).toBe(0);
    expect(stats.aov).toBeNull();
    expect(stats.growthPct).toBeNull();
  });

  it('excludes cancelled orders from sales, AOV and GST', () => {
    const stats = computeSalesKpis(
      [
        order({ id: '1', grand_total: 200, subtotal: 180, gst_total: 20, status: 'delivered' }),
        order({ id: '2', grand_total: 999, subtotal: 900, gst_total: 99, status: 'cancelled' }),
        order({ id: '3', grand_total: 100, subtotal: 90, gst_total: 10, status: 'pending' }),
      ],
      [order({ id: 'p', grand_total: 100, status: 'delivered' })]
    );
    expect(stats.sales).toBe(300);
    expect(stats.orderCount).toBe(2);
    expect(stats.aov).toBe(150);
    expect(stats.gst).toBe(30);
    expect(stats.taxable).toBe(270);
    expect(stats.growthPct).toBe(200);
  });

  it('does not invent 0% growth when the previous window has no sales', () => {
    const stats = computeSalesKpis([order({ id: '1', grand_total: 50 })], []);
    expect(stats.growthPct).toBeNull();
    expect(formatPct(stats.growthPct)).toBe('—');
  });
});

describe('Dashboard order KPIs', () => {
  it('counts every status including cancelled and reports fulfilment on billed orders', () => {
    const stats = computeOrderKpis([
      order({ id: 'a', status: 'pending' }),
      order({ id: 'b', status: 'confirmed' }),
      order({ id: 'c', status: 'processing' }),
      order({ id: 'd', status: 'packed' }),
      order({ id: 'e', status: 'dispatched' }),
      order({ id: 'f', status: 'delivered' }),
      order({ id: 'g', status: 'delivered' }),
      order({ id: 'h', status: 'cancelled' }),
      order({ id: 'i', status: 'returned' }),
    ]);
    expect(stats.total).toBe(9);
    expect(stats.billed).toBe(8);
    expect(stats.pending).toBe(1);
    expect(stats.cancelled).toBe(1);
    expect(stats.returned).toBe(1);
    expect(stats.delivered).toBe(2);
    expect(stats.fulfillmentPct).toBe(25);
  });

  it('returns null fulfilment when there are no billed orders', () => {
    expect(computeOrderKpis([]).fulfillmentPct).toBeNull();
  });
});

describe('Dashboard retailer KPIs', () => {
  it('counts snapshot statuses and new-in-range from approval (else created) timestamps', () => {
    const stats = computeRetailerKpis(
      [
        retailer({ id: '1', status: 'active', approved_at: '2026-09-02T08:00:00.000Z' }),
        retailer({ id: '2', status: 'pending_approval', approved_at: null, created_at: '2026-08-01T00:00:00.000Z' }),
        retailer({ id: '3', status: 'suspended', approved_at: '2025-01-01T00:00:00.000Z' }),
      ],
      '2026-09-01T18:30:00.000Z',
      '2026-09-02T18:29:59.999Z'
    );
    expect(stats.total).toBe(3);
    expect(stats.active).toBe(1);
    expect(stats.pendingApproval).toBe(1);
    expect(stats.suspended).toBe(1);
    expect(stats.newInRange).toBe(1);
  });
});

describe('Dashboard credit summary', () => {
  it('uses the shared credit calculator for over-limit and utilization', () => {
    const summary = computeCreditSummary([
      retailer({ id: '1', credit_limit: 10000, outstanding_balance: 12000, shop_name: 'Over' }),
      retailer({ id: '2', credit_limit: 8000, outstanding_balance: 1000 }),
      retailer({ id: '3', credit_limit: 0, outstanding_balance: 500 }),
    ]);
    expect(summary.overLimitCount).toBe(1);
    expect(summary.overLimitAmount).toBe(2000);
    expect(summary.totalOutstanding).toBe(13500);
    expect(summary.totalConfiguredLimit).toBe(18000);
    expect(summary.highRisk[0]?.shopName).toBe('Over');
    expect(summary.highRisk[0]?.exceedsLimit).toBe(true);
  });

  it('is empty when there are no retailers', () => {
    expect(computeCreditSummary([]).status).toBe('empty');
    expect(computeCreditSummary([]).utilizationPct).toBeNull();
  });
});

describe('Dashboard payment summary', () => {
  it('counts wallet PAYMENT_CREDIT as collected and does not add pending collections', () => {
    const summary = computePaymentSummary(
      [
        { amount_paise: 10_000, transaction_type: 'PAYMENT_CREDIT', is_reversed: false, created_at: 'x' },
        { amount_paise: 5_000, transaction_type: 'PAYMENT_CREDIT', is_reversed: true, created_at: 'x' },
        { amount_paise: 9_999, transaction_type: 'ORDER_DEBIT', is_reversed: false, created_at: 'x' },
      ],
      [
        { amount_paise: 2_000, status: 'pending', method: 'cash', created_at: 'x' },
        { amount_paise: 3_000, status: 'verified', method: 'upi', created_at: 'x' },
        { amount_paise: 1_000, status: 'rejected', method: 'cash', created_at: 'x' },
      ]
    );
    expect(summary.collected).toBe(100);
    expect(summary.collectedCount).toBe(1);
    expect(summary.pendingVerification).toBe(20);
    expect(summary.pendingCount).toBe(1);
    expect(summary.verifiedCollections).toBe(30);
    expect(summary.rejected).toBe(10);
    expect(summary.collected).not.toBe(summary.collected + summary.pendingVerification);
  });

  it('is empty with no ledger credits and no collections', () => {
    expect(computePaymentSummary([], []).status).toBe('empty');
  });
});

describe('Dashboard GST summary', () => {
  it('uses stored order gst_total as the KPI and extracts rate buckets from lines', () => {
    const orders = [
      order({ id: '1', subtotal: 200, gst_total: 36, grand_total: 236, status: 'delivered' }),
      order({ id: '2', subtotal: 50, gst_total: 9, grand_total: 59, status: 'cancelled' }),
    ];
    const items: DashboardOrderItem[] = [
      { order_id: '1', product_id: 'p', quantity: 2, line_total: 236, gst_percent: 18 },
      { order_id: '2', product_id: 'p', quantity: 1, line_total: 59, gst_percent: 18 },
    ];
    const gst = computeGstSummary(orders, items);
    expect(gst.gst).toBe(36);
    expect(gst.taxable).toBe(200);
    expect(gst.invoiceCount).toBe(1);
    expect(gst.rateBuckets).toHaveLength(1);
    expect(gst.rateBuckets[0]?.gstPercent).toBe(18);
    expect(gst.note).toMatch(/never guessed/i);
    expect(gst.note).not.toMatch(/CGST =|assume/i);
  });
});

describe('Dashboard top products / retailers', () => {
  it('aggregates product revenue and piece quantities (not cases)', () => {
    const orders = [order({ id: 'o1', status: 'delivered' }), order({ id: 'o2', status: 'cancelled' })];
    const items: DashboardOrderItem[] = [
      { order_id: 'o1', product_id: 'p1', quantity: 6, quantity_pieces: 6, quantity_unit: 'pieces', line_total: 180, gst_percent: 0 },
      { order_id: 'o1', product_id: 'p1', quantity: 2, quantity_pieces: 2, quantity_unit: 'pieces', line_total: 40, gst_percent: 0 },
      { order_id: 'o2', product_id: 'p1', quantity: 99, quantity_pieces: 99, quantity_unit: 'pieces', line_total: 999, gst_percent: 0 },
    ];
    const top = computeTopProducts(orders, items, new Map([['p1', 'Atta']]));
    expect(top.rows[0]?.name).toBe('Atta');
    expect(top.rows[0]?.value).toBe(220);
    expect(top.rows[0]?.secondary).toBe('8 pcs');
  });

  it('ranks retailers by non-cancelled grand totals', () => {
    const top = computeTopRetailers(
      [
        order({ id: 'a', retailer_id: 'r-1', grand_total: 100, status: 'delivered' }),
        order({ id: 'b', retailer_id: 'r-2', grand_total: 500, status: 'delivered' }),
        order({ id: 'c', retailer_id: 'r-2', grand_total: 50, status: 'cancelled' }),
      ],
      new Map([
        ['r-1', 'Small'],
        ['r-2', 'Big'],
      ])
    );
    expect(top.rows[0]?.name).toBe('Big');
    expect(top.rows[0]?.value).toBe(500);
  });
});

describe('Dashboard recent orders', () => {
  it('sorts newest first and maps retailer names', () => {
    const rows = computeRecentOrders(
      [
        order({ id: 'old', placed_at: '2026-09-01T00:00:00.000Z', retailer_id: 'r-1' }),
        order({ id: 'new', placed_at: '2026-09-02T10:00:00.000Z', retailer_id: 'r-2' }),
      ],
      new Map([['r-2', 'Kirana']])
    );
    expect(rows[0]?.id).toBe('new');
    expect(rows[0]?.retailerName).toBe('Kirana');
    expect(rows[1]?.retailerName).toBeNull();
  });
});

describe('Dashboard inventory / expiry / support / pending', () => {
  it('lists low and out-of-stock products from live totals', () => {
    const alerts = computeInventoryAlerts([
      {
        product_id: 'a',
        product_name: 'Oil',
        sku_code: 'O',
        quantity_on_hand: 0,
        reorder_level: 5,
        stock_status: 'out_of_stock',
      },
      {
        product_id: 'b',
        product_name: 'Soap',
        sku_code: 'S',
        quantity_on_hand: 3,
        reorder_level: 10,
        stock_status: 'low_stock',
      },
      {
        product_id: 'c',
        product_name: 'Rice',
        sku_code: 'R',
        quantity_on_hand: 40,
        reorder_level: 5,
        stock_status: 'healthy',
      },
    ]);
    expect(alerts.outOfStockCount).toBe(1);
    expect(alerts.lowStockCount).toBe(1);
    expect(alerts.onHandProducts).toBe(2);
    expect(alerts.lowStock[0]?.productName).toBe('Oil');
  });

  it('keeps healthy batches out of the expiring list', () => {
    const expiry = computeExpiringBatches([
      {
        batch_id: '1',
        product_id: 'p',
        product_name: 'Milk',
        batch_number: 'B1',
        warehouse_name: 'WH',
        expiry_date: '2026-08-01',
        available_quantity: 4,
        estimated_value: 200,
        days_remaining: -10,
        expiry_status: 'expired',
      },
      {
        batch_id: '2',
        product_id: 'p',
        product_name: 'Milk',
        batch_number: 'B2',
        warehouse_name: 'WH',
        expiry_date: '2027-01-01',
        available_quantity: 10,
        estimated_value: 500,
        days_remaining: 120,
        expiry_status: 'healthy',
      },
    ]);
    expect(expiry.expired).toBe(1);
    expect(expiry.rows).toHaveLength(1);
    expect(expiry.status).toBe('ok');
  });

  it('summarises support tickets without inventing SLA numbers', () => {
    const summary = computeSupportSummary([
      {
        id: 't1',
        ticket_number: 'MT-TKT-20260902-AAAA',
        subject: 'Where is my order?',
        status: 'open',
        priority: 'urgent',
        created_at: '2026-09-02T00:00:00.000Z',
      },
      {
        id: 't2',
        ticket_number: 'MT-TKT-20260901-BBBB',
        subject: 'Billing',
        status: 'resolved',
        priority: 'normal',
        created_at: '2026-09-01T00:00:00.000Z',
      },
    ]);
    expect(summary.open).toBe(1);
    expect(summary.urgentOpen).toBe(1);
    expect(summary.resolved).toBe(1);
    expect(summary.recent).toHaveLength(1);
  });

  it('pending approvals is empty when every queue is zero', () => {
    expect(
      computePendingApprovals({ pendingRetailers: 0, pendingReturns: 0, pendingCollections: 0, openTickets: 0 }).status
    ).toBe('empty');
    expect(
      computePendingApprovals({ pendingRetailers: 2, pendingReturns: 0, pendingCollections: 0, openTickets: 0 }).retailers
    ).toBe(2);
  });
});

describe('Dashboard system alerts', () => {
  it('emits nothing when there are no real signals', () => {
    expect(
      buildSystemAlerts({
        pendingRetailers: 0,
        pendingReturns: 0,
        pendingCollections: 0,
        openTickets: 0,
        urgentTickets: 0,
        lowStockCount: 0,
        outOfStockCount: 0,
        expiredBatches: 0,
        criticalBatches: 0,
        overLimitCount: 0,
        overLimitAmount: 0,
        failedNotifications7d: 0,
      })
    ).toEqual([]);
  });

  it('orders urgent credit/expiry/tickets ahead of medium stock notes', () => {
    const alerts = buildSystemAlerts({
      pendingRetailers: 1,
      pendingReturns: 0,
      pendingCollections: 0,
      openTickets: 2,
      urgentTickets: 1,
      lowStockCount: 3,
      outOfStockCount: 0,
      expiredBatches: 1,
      criticalBatches: 0,
      overLimitCount: 1,
      overLimitAmount: 500,
      failedNotifications7d: 0,
    });
    expect(alerts[0]?.severity).toBe('urgent');
    expect(alerts.map((a) => a.id)).toContain('credit-over-limit');
    expect(alerts.map((a) => a.href)).toContain('/admin/wallets');
  });
});

describe('Dashboard permissions and visibility', () => {
  it('grants dashboard.view to admin and super_admin only', () => {
    expect(can('super_admin', 'dashboard.view')).toBe(true);
    expect(can('admin', 'dashboard.view')).toBe(true);
    expect(can('staff', 'dashboard.view')).toBe(false);
    expect(can('salesman', 'dashboard.view')).toBe(false);
    expect(can('retailer', 'dashboard.view')).toBe(false);
  });

  it('shows Command Center only to super_admin', () => {
    expect(dashboardVisibility('super_admin').commandCenter).toBe(true);
    expect(dashboardVisibility('admin').commandCenter).toBe(false);
    expect(dashboardVisibility('admin').sales).toBe(true);
    expect(dashboardVisibility('admin').support).toBe(true);
    expect(dashboardVisibility('retailer').sales).toBe(false);
  });
});

describe('Dashboard source guards', () => {
  const page = read('app/admin/dashboard/page.tsx');
  const view = read('components/admin/dashboard-view.tsx');
  const data = read('lib/admin/dashboard/data.ts');
  const compute = read('lib/admin/dashboard/compute.ts');

  it('authorizes the page with dashboard.view and the cookie-bound client', () => {
    expect(page).toContain("requirePermission('dashboard.view')");
    expect(page).toContain('createClient()');
    expect(page).not.toMatch(/createServiceRoleClient|SUPABASE_SERVICE_ROLE_KEY/);
    expect(data).not.toMatch(/createServiceRoleClient|SUPABASE_SERVICE_ROLE_KEY/);
  });

  it('does not ship mock/fake/seed business records', () => {
    for (const source of [page, view, data, compute]) {
      expect(source).not.toMatch(/fakeSales|mockOrders|placeholderRetailer|demoData|DUMMY_/);
    }
  });

  it('keeps GST honest: stored gst_total, no invented CGST/SGST split', () => {
    expect(compute).toContain('orders.gst_total');
    expect(compute).toContain('never guessed');
    expect(view).toContain('GST summary');
    expect(view).not.toMatch(/CGST \+|assume intra-state/);
  });

  it('labels top-product quantity as pieces, not cases', () => {
    expect(compute).toContain('rowPieces');
    expect(compute).toContain('pcs');
    expect(view).not.toMatch(/cases sold/);
  });

  it('gates the Command Center CTA on command_center.view', () => {
    expect(view).toContain('visibility.commandCenter');
    expect(view).toContain('/admin/command-center');
  });

  it('renders loading / empty / error / range UI', () => {
    expect(read('app/admin/dashboard/loading.tsx')).toContain('DashboardSkeleton');
    expect(read('app/admin/error.tsx')).toContain('Couldn&apos;t load this page');
    expect(view).toContain('This section could not be loaded');
    expect(view).toContain('emptyTitle');
    expect(read('components/admin/dashboard-range-filter.tsx')).toContain('name="from"');
    expect(read('components/admin/dashboard-range-filter.tsx')).toContain('name="range"');
    expect(read('components/admin/dashboard-range-filter.tsx')).toContain('value="custom"');
  });

  it('uses IST helpers for the selected window', () => {
    expect(read('lib/admin/dashboard/range.ts')).toContain('indiaDayStartIso');
    expect(read('lib/admin/dashboard/range.ts')).toContain('indiaTodayDateKey');
    expect(data).toContain('range.fromIso');
  });
});
