import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { supabaseFixture } from './helpers/supabase-fixture';

/**
 * `GET /api/mobile/v1/orders/{id}/invoice` and the order-detail extras.
 *
 * WHY THIS FILE EXISTS
 * The invoice is the one surface where a second implementation of tax
 * arithmetic would be invisible until a retailer compared an app invoice with a
 * web invoice. These tests pin the two properties that prevent that:
 *
 *   1. the endpoint folds the stored rows with the SAME shared helpers the web
 *      invoice uses (`toInvoiceDisplayLines` + `classifyTaxSplit` +
 *      `computeInvoiceTaxLines`) — reimplementing GST would fail the source
 *      assertion below;
 *   2. the figures it returns are the stored ones, expressed in integer paise.
 *
 * The detail extras (status history, Coins movement) are asserted here too:
 * they are additive keys on the same order, and the list payload must stay
 * exactly as it was.
 */

const mocks = vi.hoisted(() => ({ client: null as unknown }));

vi.mock('@/lib/mobile/supabase', () => ({ createMobileSupabaseClient: () => mocks.client }));

import { GET as getOrderDetail } from '@/app/api/mobile/v1/orders/[id]/route';
import { GET as listOrders } from '@/app/api/mobile/v1/orders/route';
import { GET as getOrderInvoice } from '@/app/api/mobile/v1/orders/[id]/invoice/route';
import { resetRateLimits } from '@/lib/mobile/rate-limit';

const RETAILER = '11111111-1111-4111-8111-111111111111';
const OTHER_RETAILER = '22222222-2222-4222-8222-222222222222';
const STAFF = '33333333-3333-4333-8333-333333333333';
const ORDER = '44444444-4444-4444-8444-444444444444';
const LINE_ONE = '55555555-5555-4555-8555-555555555555';
const LINE_TWO = '66666666-6666-4666-8666-666666666666';

/** 100 pieces at ₹12.00 = ₹1200.00; 40 pieces at ₹25.50 = ₹1020.00. */
const ORDER_ROW = {
  id: ORDER,
  retailer_id: RETAILER,
  order_number: 'MT-1001',
  status: 'delivered',
  subtotal: 2220,
  gst_total: 111,
  discount_total: 20,
  grand_total: 2200,
  placed_at: '2026-10-01T04:00:00Z',
  updated_at: '2026-10-03T04:00:00Z',
  notes: 'Leave at the shop',
  shipping_address: { line: 'Shop Road, Khagaria', label: 'Shop', receiverName: 'Owner', phone: '9876543210' },
  coins_balance_after_paise: 8000,
};

const ITEM_ROWS = [
  {
    id: LINE_ONE,
    order_id: ORDER,
    product_id: 'product-1',
    pack_id: 'pack-1',
    quantity: 100,
    quantity_unit: 'pieces',
    quantity_pieces: 100,
    units_per_case: 20,
    unit_price: 12,
    gst_percent: 18,
    line_total: 1200,
    products: { name: 'Soap', hsn_code: '3401', brands: { name: 'Maharani' } },
    product_packs: { pack_name: '20 pc case', units_per_case: 20 },
  },
  {
    id: LINE_TWO,
    order_id: ORDER,
    product_id: 'product-2',
    pack_id: 'pack-2',
    quantity: 40,
    quantity_unit: 'pieces',
    quantity_pieces: 40,
    units_per_case: 10,
    unit_price: 25.5,
    gst_percent: 18,
    line_total: 1020,
    products: { name: 'Powder', hsn_code: '3304', brands: { name: 'Maharani' } },
    product_packs: { pack_name: '10 pc case', units_per_case: 10 },
  },
];

function install(overrides: Record<string, object[]> = {}, errors: Record<string, string> = {}) {
  const client = supabaseFixture(
    {
      profiles: [
        { id: RETAILER, role: 'retailer', full_name: 'Shop Owner', phone: '9876543210', is_active: true },
      ],
      retailers: [
        { id: RETAILER, status: 'active', shop_name: 'Shop', address: 'Shop Road', gstin: '10ABCDE1234F1Z5', areas: { name: 'Khagaria' } },
      ],
      user_access_periods: [],
      orders: [ORDER_ROW],
      order_items: ITEM_ROWS,
      order_status_history: [
        { id: 'h1', order_id: ORDER, status: 'pending', note: null, created_at: '2026-10-01T04:00:00Z' },
        { id: 'h2', order_id: ORDER, status: 'dispatched', note: 'Out for delivery', created_at: '2026-10-02T04:00:00Z' },
        { id: 'h3', order_id: ORDER, status: 'delivered', note: null, created_at: '2026-10-03T04:00:00Z' },
      ],
      retailer_wallet_ledger: [
        { id: 'l1', retailer_id: RETAILER, reference_id: ORDER, transaction_type: 'ORDER_DEBIT', amount_paise: 5000, is_reversed: false, reversal_of: null },
      ],
      ...overrides,
    },
    errors
  );
  Object.assign(client, {
    auth: { getUser: async () => ({ data: { user: { id: RETAILER, email: 'shop@example.test' } }, error: null }) },
  });
  mocks.client = client;
  return client;
}

function apiRequest(path: string) {
  const headers = new Headers();
  headers.set('authorization', 'Bearer verified-token');
  return new Request(`https://api.test${path}`, { method: 'GET', headers });
}

beforeEach(() => {
  resetRateLimits();
  install();
  process.env.COMPANY_NAME = 'Maharani Traders';
  process.env.COMPANY_GSTIN = '10ZYXWV9876A1Z2';
  process.env.COMPANY_ADDRESS = 'Khagaria, Bihar';
  process.env.COMPANY_PHONE = '9000000000';
});

afterEach(() => {
  delete process.env.COMPANY_NAME;
  delete process.env.COMPANY_GSTIN;
  delete process.env.COMPANY_ADDRESS;
  delete process.env.COMPANY_PHONE;
});

describe('GET /api/mobile/v1/orders/{id}/invoice', () => {
  it('folds the stored order rows with the shared invoice helpers and returns integer paise', async () => {
    const response = await getOrderInvoice(apiRequest(`/api/mobile/v1/orders/${ORDER}/invoice`), {
      params: { id: ORDER },
    });
    const payload = await response.json() as {
      data: {
        orderNumber: string;
        taxMode: string;
        lines: { key: string; displayName: string; quantityLabel: string; lineTotalPaise: number; gstPercent: number; cgstPaise: number; sgstPaise: number; unitPrices: { unitPricePaise: number; unit: string }[] }[];
        totals: Record<string, number>;
        biller: { name: string | null; gstin: string | null };
        billedTo: { shopName: string | null; gstin: string | null; areaName: string | null };
      };
    };

    expect(response.status).toBe(200);
    expect(payload.data.orderNumber).toBe('MT-1001');
    // Both GSTINs are Bihar (state code 10) → CGST + SGST, never IGST.
    expect(payload.data.taxMode).toBe('intra');
    expect(payload.data.biller.name).toBe('Maharani Traders');
    expect(payload.data.billedTo.shopName).toBe('Shop');
    expect(payload.data.billedTo.areaName).toBe('Khagaria');

    expect(payload.data.lines).toHaveLength(2);
    const first = payload.data.lines[0]!;
    // The canonical name is built by the shared display mapper, exactly as the
    // web invoice prints it.
    expect(first.displayName).toContain('Soap');
    expect(first.lineTotalPaise).toBe(120_000);
    expect(first.unitPrices).toEqual([{ unitPricePaise: 1_200, unit: 'pc' }]);
    // GST is EXTRACTED from the inclusive line total: ₹1200 − 1200/1.18 =
    // ₹183.0508 → 18305 paise, split 9153 / 9152 (the half-paisa remainder
    // always lands on SGST, so a line never drifts).
    expect(first.cgstPaise).toBe(9_153);
    expect(first.sgstPaise).toBe(9_152);
    expect(first.cgstPaise + first.sgstPaise).toBe(18_305);

    // Totals are the stored order values in paise — the endpoint never re-adds
    // the cart, and the stored GST wins over a re-computation.
    expect(payload.data.totals.subtotalPaise).toBe(222_000);
    expect(payload.data.totals.gstTotalPaise).toBe(11_100);
    expect(payload.data.totals.discountPaise).toBe(2_000);
    expect(payload.data.totals.grandTotalPaise).toBe(220_000);
    for (const value of Object.values(payload.data.totals)) {
      expect(Number.isInteger(value)).toBe(true);
    }
  });

  it('re-derives no tax arithmetic of its own — it imports the shared helpers', () => {
    const route = readFileSync(
      join(process.cwd(), 'app/api/mobile/v1/orders/[id]/invoice/route.ts'),
      'utf8'
    );
    expect(route).toContain("from '@/lib/retailer/invoice-tax'");
    expect(route).toContain("from '@/lib/retailer/invoice-display'");
    expect(route).toContain('toInvoiceDisplayLines');
    expect(route).toContain('computeInvoiceTaxLines');
    // A GST percentage or a division by a tax rate written here would be a
    // second implementation; neither may appear.
    expect(route).not.toMatch(/\/\s*\(\s*1\s*\+/);
    expect(route).not.toContain('0.18');
  });

  it("answers 404 for another retailer's order without exposing that it exists", async () => {
    const client = install({ orders: [{ ...ORDER_ROW, retailer_id: OTHER_RETAILER }] });

    const response = await getOrderInvoice(apiRequest(`/api/mobile/v1/orders/${ORDER}/invoice`), {
      params: { id: ORDER },
    });
    expect(response.status).toBe(404);
    // Ownership is a query filter, not a post-hoc comparison.
    const orderQuery = client.queries.find(
      (query) => query.table === 'orders' && query.filters.some((filter) => filter.column === 'retailer_id')
    );
    expect(orderQuery?.filters).toContainEqual({ op: 'eq', column: 'retailer_id', value: RETAILER });
    // The item read only runs once ownership is established, so it is never
    // even attempted for someone else's order.
    expect(client.queries.some((query) => query.table === 'order_items')).toBe(false);
    expect(client.queries.some((query) => query.table === 'retailer_wallet_ledger')).toBe(false);
  });

  it('rejects a malformed id before touching the database', async () => {
    const client = install();
    const response = await getOrderInvoice(apiRequest('/api/mobile/v1/orders/not-a-uuid/invoice'), {
      params: { id: 'not-a-uuid' },
    });
    expect(response.status).toBe(404);
    // Session resolution is free to read the caller's own rows; the order and
    // its children must not be touched at all.
    expect(client.queries.filter((query) => query.table.startsWith('order'))).toEqual([]);
  });

  it('refuses a non-retailer role', async () => {
    const client = install({
      profiles: [{ id: STAFF, role: 'staff', full_name: 'Staff', phone: '9876543210', is_active: true }],
      retailers: [],
    });
    Object.assign(client, {
      auth: { getUser: async () => ({ data: { user: { id: STAFF, email: 'staff@example.test' } }, error: null }) },
    });
    mocks.client = client;

    const response = await getOrderInvoice(apiRequest(`/api/mobile/v1/orders/${ORDER}/invoice`), {
      params: { id: ORDER },
    });
    expect(response.status).toBe(403);
  });

  it('refuses a request with no bearer token', async () => {
    const response = await getOrderInvoice(
      new Request(`https://api.test/api/mobile/v1/orders/${ORDER}/invoice`, { method: 'GET' }),
      { params: { id: ORDER } }
    );
    expect(response.status).toBe(401);
  });
});

describe('GET /api/mobile/v1/orders/{id} — detail extras', () => {
  it('returns the order status history in ascending order', async () => {
    const response = await getOrderDetail(apiRequest(`/api/mobile/v1/orders/${ORDER}`), {
      params: { id: ORDER },
    });
    const payload = await response.json() as {
      data: { id: string; statusHistory: { status: string; note: string | null; createdAt: string }[] };
    };

    expect(response.status).toBe(200);
    expect(payload.data.statusHistory.map((entry) => entry.status)).toEqual([
      'pending',
      'dispatched',
      'delivered',
    ]);
    expect(payload.data.statusHistory[1]!.note).toBe('Out for delivery');
  });

  it("reports this order's own Coins movement from the ledger", async () => {
    const response = await getOrderDetail(apiRequest(`/api/mobile/v1/orders/${ORDER}`), {
      params: { id: ORDER },
    });
    const payload = await response.json() as {
      data: { coinsSpentPaise: number; coinsRefundedPaise: number; coinsRefunded: boolean; balanceAfterCoinsPaise: number };
    };

    expect(payload.data.coinsSpentPaise).toBe(5_000);
    expect(payload.data.coinsRefundedPaise).toBe(0);
    expect(payload.data.coinsRefunded).toBe(false);
    expect(payload.data.balanceAfterCoinsPaise).toBe(8_000);
  });

  it('reports a refunded order as refunded, with no remaining spend', async () => {
    install({
      retailer_wallet_ledger: [
        { id: 'l1', retailer_id: RETAILER, reference_id: ORDER, transaction_type: 'ORDER_DEBIT', amount_paise: 5000, is_reversed: true, reversal_of: null },
        { id: 'l2', retailer_id: RETAILER, reference_id: ORDER, transaction_type: 'ORDER_REVERSAL', amount_paise: 5000, is_reversed: false, reversal_of: 'l1' },
        { id: 'l3', retailer_id: OTHER_RETAILER, reference_id: ORDER, transaction_type: 'ORDER_DEBIT', amount_paise: 9999, is_reversed: false, reversal_of: null },
      ],
    });

    const response = await getOrderDetail(apiRequest(`/api/mobile/v1/orders/${ORDER}`), {
      params: { id: ORDER },
    });
    const payload = await response.json() as {
      data: { coinsSpentPaise: number; coinsRefundedPaise: number; coinsRefunded: boolean };
    };

    // The reversed debit is excluded (not double-counted against the refund),
    // and another retailer's ledger row can never appear.
    expect(payload.data.coinsSpentPaise).toBe(0);
    expect(payload.data.coinsRefundedPaise).toBe(5_000);
    expect(payload.data.coinsRefunded).toBe(true);
  });

  it('still returns the order when the ledger read fails, without movement keys', async () => {
    install({}, { retailer_wallet_ledger: 'ledger unavailable' });

    const response = await getOrderDetail(apiRequest(`/api/mobile/v1/orders/${ORDER}`), {
      params: { id: ORDER },
    });
    const payload = await response.json() as { data: Record<string, unknown> };

    expect(response.status).toBe(200);
    expect(payload.data.orderNumber).toBe('MT-1001');
    expect('coinsSpentPaise' in payload.data).toBe(false);
    // The history is a different read and is still present.
    expect(Array.isArray(payload.data.statusHistory)).toBe(true);
  });

  it('keeps the list payload free of detail-only keys', async () => {
    const response = await listOrders(apiRequest('/api/mobile/v1/orders'));
    const payload = await response.json() as { data: Record<string, unknown>[] };

    expect(response.status).toBe(200);
    expect(payload.data).toHaveLength(1);
    for (const key of ['statusHistory', 'coinsSpentPaise', 'coinsRefundedPaise', 'coinsRefunded']) {
      expect(key in payload.data[0]!).toBe(false);
    }
  });
});
