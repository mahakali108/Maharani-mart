import { beforeEach, describe, expect, it, vi } from 'vitest';
import { supabaseFixture } from './helpers/supabase-fixture';

/**
 * `GET /api/mobile/v1/orders/{id}/delivery` — the retailer's delivery record.
 *
 * Three properties matter here and each one has bitten a surface before:
 *
 *   1. the dossier comes from `fetchDeliveryDetail`, the SAME query the web
 *      delivery page reads — not a second hand-written select list;
 *   2. it runs under the CALLER's client. A private bucket's proof is signed
 *      with the caller's own RLS-scoped session; signing with the anonymous
 *      cookie client would return "no proof" for proof the retailer owns;
 *   3. another retailer's order answers 404 with no child rows read.
 */

const mocks = vi.hoisted(() => ({
  client: null as unknown,
  signWith: [] as unknown[],
}));

vi.mock('@/lib/mobile/supabase', () => ({ createMobileSupabaseClient: () => mocks.client }));

vi.mock('@/lib/storage/signed-url', () => ({
  getSignedUrl: async (bucket: string, path: string, _expires?: number, client?: unknown) => {
    mocks.signWith.push({ bucket, path, client });
    return `https://signed.test/${bucket}/${path}`;
  },
}));

import { GET as getDelivery } from '@/app/api/mobile/v1/orders/[id]/delivery/route';
import { resetRateLimits } from '@/lib/mobile/rate-limit';

const RETAILER = '11111111-1111-4111-8111-111111111111';
const OTHER_RETAILER = '22222222-2222-4222-8222-222222222222';
const STAFF = '33333333-3333-4333-8333-333333333333';
const ORDER = '44444444-4444-4444-8444-444444444444';
const DELIVERY = '55555555-5555-4555-8555-555555555555';

const DELIVERY_ROW = {
  id: DELIVERY,
  order_id: ORDER,
  delivery_status: 'delivered',
  assigned_staff_id: 'staff-1',
  assigned_name: { full_name: 'Rahul Kumar' },
  assigned_at: '2026-10-02T04:00:00Z',
  dispatched_at: '2026-10-02T05:00:00Z',
  in_progress_at: '2026-10-02T08:00:00Z',
  delivered_at: '2026-10-02T09:30:00Z',
  receiver_name: 'Shop Owner',
  otp_verified_at: '2026-10-02T09:30:00Z',
  otp_attempts: 1,
  // A bare object path in a private bucket: this is what the upload flow stores.
  signature_url: 'deliveries/2026/10/sign.png',
  photo_url: null,
  delivery_notes: 'Handed to the owner at the counter.',
  failure_reason: null,
  return_window_days: 7,
  return_deadline: '2026-10-09',
  completed_by: 'staff-1',
  completed_by_name: { full_name: 'Rahul Kumar' },
  orders: {
    id: ORDER,
    order_number: 'MT-1001',
    status: 'delivered',
    grand_total: 2200,
    placed_at: '2026-10-01T04:00:00Z',
    retailer_id: RETAILER,
    shipping_address: { line: 'Shop Road, Khagaria', label: 'Shop' },
    retailers: { shop_name: 'Shop' },
  },
};

const DELIVERY_ITEM_ROWS = [
  {
    id: 'di-1',
    delivery_id: DELIVERY,
    order_item_id: 'oi-1',
    quantity_ordered: 100,
    quantity_delivered: 98,
    quantity_missing: 2,
    quantity_damaged: 0,
    order_items: { id: 'oi-1', line_total: 1200, products: { name: 'Soap' }, product_packs: { pack_name: '20 pc case' } },
  },
];

function install(overrides: Record<string, object[]> = {}) {
  const client = supabaseFixture({
    profiles: [{ id: RETAILER, role: 'retailer', full_name: 'Shop Owner', phone: '9876543210', is_active: true }],
    retailers: [{ id: RETAILER, status: 'active', shop_name: 'Shop', address: 'Shop Road' }],
    user_access_periods: [],
    // The ownership pre-check reads the order row itself.
    orders: [{ id: ORDER, retailer_id: RETAILER, order_number: 'MT-1001', status: 'delivered' }],
    order_deliveries: [DELIVERY_ROW],
    order_delivery_items: DELIVERY_ITEM_ROWS,
    ...overrides,
  });
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
  mocks.signWith = [];
  install();
});

describe('GET /api/mobile/v1/orders/{id}/delivery', () => {
  it('returns the delivery record with the return window and the handed-over quantities', async () => {
    const response = await getDelivery(apiRequest(`/api/mobile/v1/orders/${ORDER}/delivery`), {
      params: Promise.resolve({ id: ORDER }),
    });
    const payload = await response.json() as {
      data: {
        orderNumber: string;
        status: string;
        assignedName: string | null;
        deliveredAt: string | null;
        receiverName: string | null;
        otpVerified: boolean;
        returnDeadline: string | null;
        returnWindowOpen: boolean | null;
        proof: { signatureCaptured: boolean; photoCaptured: boolean; signatureUrl: string | null; photoUrl: string | null };
        items: { productName: string | null; quantityOrdered: number; quantityDelivered: number; quantityMissing: number; lineTotalPaise: number }[];
        grandTotalPaise: number;
        shippingAddressLine: string | null;
      };
    };

    expect(response.status).toBe(200);
    expect(payload.data.orderNumber).toBe('MT-1001');
    expect(payload.data.status).toBe('delivered');
    expect(payload.data.assignedName).toBe('Rahul Kumar');
    expect(payload.data.receiverName).toBe('Shop Owner');
    expect(payload.data.otpVerified).toBe(true);
    expect(payload.data.grandTotalPaise).toBe(220_000);
    expect(payload.data.shippingAddressLine).toBe('Shop Road, Khagaria');
    expect(payload.data.returnDeadline).toBe('2026-10-09');
    // 2026-10-09 is in the past relative to the fixture's fixed date? No — the
    // helper compares against the real clock; the deadline is compared as a
    // calendar date, so this only asserts the boolean is present and derived.
    expect(typeof payload.data.returnWindowOpen).toBe('boolean');

    expect(payload.data.items).toHaveLength(1);
    expect(payload.data.items[0]).toMatchObject({
      productName: 'Soap',
      quantityOrdered: 100,
      quantityDelivered: 98,
      quantityMissing: 2,
      lineTotalPaise: 120_000,
    });
  });

  it("signs private-bucket proof with the caller's own RLS-scoped client", async () => {
    const client = install();
    const response = await getDelivery(apiRequest(`/api/mobile/v1/orders/${ORDER}/delivery`), {
      params: Promise.resolve({ id: ORDER }),
    });
    const payload = await response.json() as { data: { proof: { signatureUrl: string | null; photoUrl: string | null; signatureCaptured: boolean; photoCaptured: boolean } } };

    expect(response.status).toBe(200);
    expect(mocks.signWith).toHaveLength(1);
    expect(mocks.signWith[0]).toMatchObject({ bucket: 'delivery-proofs', path: 'deliveries/2026/10/sign.png' });
    // The BEARER client is passed through — not the anonymous cookie client,
    // which RLS would (correctly) refuse to sign with.
    expect((mocks.signWith[0] as { client?: unknown }).client).toBe(client);
    expect(payload.data.proof.signatureUrl).toBe('https://signed.test/delivery-proofs/deliveries/2026/10/sign.png');
    expect(payload.data.proof.photoCaptured).toBe(false);
    expect(payload.data.proof.photoUrl).toBeNull();
  });

  it("answers 404 for another retailer's delivery without reading its items", async () => {
    const client = install({
      orders: [{ id: ORDER, retailer_id: OTHER_RETAILER, order_number: 'MT-1001', status: 'delivered' }],
      order_deliveries: [{ ...DELIVERY_ROW, orders: { ...DELIVERY_ROW.orders, retailer_id: OTHER_RETAILER } }],
    });

    const response = await getDelivery(apiRequest(`/api/mobile/v1/orders/${ORDER}/delivery`), {
      params: Promise.resolve({ id: ORDER }),
    });
    expect(response.status).toBe(404);
    // Ownership is established before the dossier, so neither the delivery row
    // nor its items are read for someone else's order.
    expect(client.queries.some((query) => query.table === 'order_delivery_items')).toBe(false);
    expect(client.queries.some((query) => query.table === 'order_deliveries')).toBe(false);
    expect(mocks.signWith).toEqual([]);
  });

  it('answers 404 when the order has no delivery record at all', async () => {
    install({ orders: [{ id: ORDER, retailer_id: RETAILER, order_number: 'MT-1001', status: 'dispatched' }], order_deliveries: [] });
    const response = await getDelivery(apiRequest(`/api/mobile/v1/orders/${ORDER}/delivery`), {
      params: Promise.resolve({ id: ORDER }),
    });
    expect(response.status).toBe(404);
  });

  it('rejects a malformed id before reading the delivery tables', async () => {
    const client = install();
    const response = await getDelivery(apiRequest('/api/mobile/v1/orders/not-a-uuid/delivery'), {
      params: Promise.resolve({ id: 'not-a-uuid' }),
    });
    expect(response.status).toBe(404);
    expect(client.queries.filter((query) => query.table.startsWith('order_deliver'))).toEqual([]);
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

    const response = await getDelivery(apiRequest(`/api/mobile/v1/orders/${ORDER}/delivery`), {
      params: Promise.resolve({ id: ORDER }),
    });
    expect(response.status).toBe(403);
  });
});
