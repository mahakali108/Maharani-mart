import { beforeEach, describe, expect, it, vi } from 'vitest';
import { supabaseFixture } from './helpers/supabase-fixture';

const mocks = vi.hoisted(() => ({
  client: null as unknown,
  getUser: vi.fn(),
  loadMobileCart: vi.fn(),
  loadRetailerCartRows: vi.fn(),
  resolveMobileAddress: vi.fn(),
  quoteMobileCheckout: vi.fn(),
  loadActiveCoupon: vi.fn(),
  createOrder: vi.fn(),
  replayOrder: vi.fn(),
}));

vi.mock('@/lib/mobile/supabase', () => ({ createMobileSupabaseClient: () => mocks.client }));
vi.mock('@/lib/coupons/validate', () => ({ loadActiveCouponForRetailer: (...args: unknown[]) => mocks.loadActiveCoupon(...args) }));
vi.mock('@/lib/mobile/commerce-service', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/mobile/commerce-service')>();
  return {
    ...actual,
    loadMobileCart: (...args: unknown[]) => mocks.loadMobileCart(...args),
    loadRetailerCartRows: (...args: unknown[]) => mocks.loadRetailerCartRows(...args),
    resolveMobileAddress: (...args: unknown[]) => mocks.resolveMobileAddress(...args),
    quoteMobileCheckout: (...args: unknown[]) => mocks.quoteMobileCheckout(...args),
  };
});
vi.mock('@/lib/orders/create-order', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/orders/create-order')>();
  return {
    ...actual,
    createOrderForRetailer: (...args: unknown[]) => mocks.createOrder(...args),
    replayOrderRequest: (...args: unknown[]) => mocks.replayOrder(...args),
  };
});

import { GET as getCart } from '@/app/api/mobile/v1/cart/route';
import { POST as addCartLine } from '@/app/api/mobile/v1/cart/lines/route';
import { POST as quoteCheckout } from '@/app/api/mobile/v1/checkout/quote/route';
import { GET as listOrders, POST as submitOrder } from '@/app/api/mobile/v1/orders/route';
import { GET as recoverOrderRequest } from '@/app/api/mobile/v1/orders/requests/[requestKey]/route';
import { resetRateLimits } from '@/lib/mobile/rate-limit';
import { MobileCommerceError } from '@/lib/mobile/commerce-service';

const RETAILER = '11111111-1111-4111-8111-111111111111';
const STAFF = '22222222-2222-4222-8222-222222222222';
const PRODUCT = '33333333-3333-4333-8333-333333333333';
const PACK = '44444444-4444-4444-8444-444444444444';
const LINE = '55555555-5555-4555-8555-555555555555';
const REQUEST_KEY = '66666666-6666-4666-8666-666666666666';
const ADDRESS = '99999999-9999-4999-8999-999999999998';

function baseTables(overrides: Record<string, object[]> = {}) {
  return {
    profiles: [{ id: RETAILER, role: 'retailer', full_name: 'Shop Owner', phone: '9876543210', is_active: true }],
    retailers: [{ id: RETAILER, status: 'active', shop_name: 'Shop', area_id: 'area-1', address: 'Shop Road' }],
    user_access_periods: [],
    product_packs: [{
      id: PACK,
      product_id: PRODUCT,
      pack_name: 'Small pack',
      moq: 6,
      units_per_case: 12,
      case_price: 1200,
      ptr: null,
      base_price: 1200,
      allow_loose_pieces: true,
      is_active: true,
      products: { is_active: true },
    }],
    product_pricing_tiers: [{
      id: 'tier-1',
      product_pack_id: PACK,
      min_quantity: 1,
      max_quantity: null,
      price_per_piece: 100,
      rule_type: 'default',
      is_active: true,
    }],
    cart_items: [{ id: LINE, retailer_id: RETAILER, product_id: PRODUCT, pack_id: PACK, quantity: 4 }],
    ...overrides,
  };
}

function install({
  role = 'retailer',
  orderRows = [] as object[],
  coinRows = [] as object[],
  errors = {} as Record<string, string>,
  authError = null as { message: string } | null,
} = {}) {
  const tables = baseTables({
    profiles: [{ id: role === 'retailer' ? RETAILER : STAFF, role, full_name: 'Shop Owner', phone: '9876543210', is_active: true }],
    retailers: role === 'retailer'
      ? [{ id: RETAILER, status: 'active', shop_name: 'Shop', area_id: 'area-1', address: 'Shop Road' }]
      : [],
    orders: orderRows,
    retailer_wallet_ledger: coinRows,
  });
  const client = supabaseFixture(tables, errors);
  Object.assign(client, {
    auth: {
      getUser: async () => authError
        ? { data: null, error: authError }
        : { data: { user: { id: role === 'retailer' ? RETAILER : STAFF, email: 'shop@example.test' } }, error: null },
    },
  });
  mocks.client = client;
  return client;
}

function apiRequest(path: string, {
  method = 'GET',
  body,
  idempotencyKey,
  token = 'verified-token',
}: {
  method?: string;
  body?: unknown;
  idempotencyKey?: string;
  token?: string;
} = {}) {
  const headers = new Headers();
  if (token) headers.set('authorization', `Bearer ${token}`);
  if (body !== undefined) headers.set('content-type', 'application/json');
  if (idempotencyKey) headers.set('Idempotency-Key', idempotencyKey);
  return new Request(`https://api.test${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

async function json(response: Response) {
  return await response.json() as Record<string, unknown>;
}

const savedLines = [{ pack_id: PACK, quantity: 6, cart_item_id: LINE }];
const serverCart = {
  lines: [{
    id: LINE,
    packId: PACK,
    productId: PRODUCT,
    productName: 'Rice',
    packName: 'Small pack',
    quantity: 4,
    quantityUnit: 'pieces',
    quantityIncrement: 1,
    moq: 6,
    unitsPerCase: 12,
    unitPricePaise: 10000,
    lineTotalPaise: 40000,
    gstPercent: 5,
    availability: 'in_stock',
    orderable: false,
    message: 'Minimum order quantity is 6 pieces.',
  }],
  couponCode: null,
  couponUnavailable: false,
};
const serverQuote = {
  lines: [{
    packId: PACK,
    productId: PRODUCT,
    productName: 'Rice',
    packName: 'Small pack',
    quantity: 6,
    quantityUnit: 'pieces',
    moq: 6,
    unitsPerCase: 12,
    unitPricePaise: 10000,
    lineTotalPaise: 60000,
    gstPercent: 5,
    availability: 'in_stock',
    orderable: true,
  }],
  subtotalPaise: 57143,
  gstTotalPaise: 2857,
  discountTotalPaise: 0,
  grandTotalPaise: 60000,
  coinsBalancePaise: 15000,
  coinsUsedPaise: 15000,
  balanceAfterCoinsPaise: 0,
  couponCode: null,
  address: { id: ADDRESS, label: 'Saved shop', line: 'Shop Road, Gaya, Bihar, 823001', district: 'Gaya', state: 'Bihar', pincode: '823001', receiverName: 'Shop Owner', phone: '9876543210', isDefault: true },
};

beforeEach(() => {
  resetRateLimits();
  install();
  mocks.getUser.mockReset();
  mocks.loadMobileCart.mockReset();
  mocks.loadRetailerCartRows.mockReset();
  mocks.resolveMobileAddress.mockReset();
  mocks.quoteMobileCheckout.mockReset();
  mocks.loadActiveCoupon.mockReset();
  mocks.createOrder.mockReset();
  mocks.replayOrder.mockReset();

  mocks.getUser.mockImplementation(async () => ({ data: { user: { id: RETAILER, email: 'shop@example.test' } }, error: null }));
  // The installed Supabase client's auth method reads this mock at call time.
  const client = mocks.client as { auth: { getUser: () => Promise<unknown> } };
  client.auth.getUser = (...args: unknown[]) => mocks.getUser(...args);
  mocks.loadMobileCart.mockResolvedValue(serverCart);
  mocks.loadRetailerCartRows.mockResolvedValue(savedLines);
  mocks.resolveMobileAddress.mockImplementation(async (_session: unknown, id: unknown) => {
    if (id !== ADDRESS) throw new MobileCommerceError('invalid_request', 400, 'Select a saved delivery address.');
    return {
      id: ADDRESS,
      display: serverQuote.address,
      snapshot: { line: 'Shop Road, Gaya, Bihar, 823001', label: 'Saved shop', receiverName: 'Shop Owner', phone: '9876543210', district: 'Gaya', state: 'Bihar', pincode: '823001' },
    };
  });
  mocks.quoteMobileCheckout.mockImplementation(async (_session: unknown, _lines: unknown, id: unknown) => {
    if (id !== ADDRESS) throw new MobileCommerceError('invalid_request', 400, 'Select a saved delivery address.');
    return serverQuote;
  });
  mocks.loadActiveCoupon.mockResolvedValue({ coupon: null, error: false });
  mocks.replayOrder.mockResolvedValue(null);
  mocks.createOrder.mockResolvedValue({
    order: {
      id: '77777777-7777-4777-8777-777777777777',
      orderNumber: 'MK-20261003-00001',
      status: 'pending',
      placedAt: '2026-10-03T10:00:00.000Z',
      grandTotal: 600,
      coinsUsed: 150,
      payableOnDelivery: 450,
      coinsBalanceAfterPaise: 0,
      idempotentReplay: false,
    },
  });
});

describe('mobile cart and quote endpoints', () => {
  it('returns current server-priced cart data without exposing exact stock or client money', async () => {
    const response = await getCart(apiRequest('/api/mobile/v1/cart'));
    const payload = await json(response);
    expect(response.status).toBe(200);
    expect(payload.data).toEqual(serverCart);
    expect(JSON.stringify(payload)).not.toMatch(/stock_quantity|available_count|cost_price/i);
    expect(mocks.loadMobileCart).toHaveBeenCalledTimes(1);
  });

  it('adds only pack and piece intent through the MOQ-checked cart RPC', async () => {
    const updatedCart = {
      ...serverCart,
      lines: [{ ...serverCart.lines[0]!, quantity: 6, lineTotalPaise: 60000, orderable: true, message: null }],
    };
    mocks.loadMobileCart.mockResolvedValue(updatedCart);
    const response = await addCartLine(apiRequest('/api/mobile/v1/cart/lines', {
      method: 'POST',
      body: { packId: PACK, quantity: 2 },
    }));
    const payload = await json(response);
    const client = mocks.client as ReturnType<typeof supabaseFixture>;
    expect(response.status).toBe(200);
    expect(payload.data).toEqual(updatedCart);
    expect(client.rpcs).toHaveLength(1);
    expect(client.rpcs[0]).toMatchObject({
      name: 'mutate_retailer_cart_line',
      args: { p_pack_id: PACK, p_expected_quantity: 4, p_quantity: 6 },
    });
  });

  it('rejects a client-supplied price and does not mutate the cart', async () => {
    const response = await addCartLine(apiRequest('/api/mobile/v1/cart/lines', {
      method: 'POST',
      body: { packId: PACK, quantity: 2, unitPricePaise: 1 },
    }));
    expect(response.status).toBe(400);
    expect((await json(response)).error).toMatchObject({ code: 'validation_failed' });
    expect((mocks.client as ReturnType<typeof supabaseFixture>).rpcs).toHaveLength(0);
  });

  it('surfaces the minimum piece quantity and leaves a below-MOQ saved line unchanged', async () => {
    const response = await addCartLine(apiRequest('/api/mobile/v1/cart/lines', {
      method: 'POST',
      body: { packId: PACK, quantity: 1 },
    }));
    const payload = await json(response);
    expect(response.status).toBe(422);
    expect(payload.error).toMatchObject({ code: 'minimum_order_quantity', details: { minQuantity: 6 } });
    expect((mocks.client as ReturnType<typeof supabaseFixture>).rpcs).toHaveLength(0);
  });

  it('maps a commit-time MOQ increase to a typed quantity error', async () => {
    const client = install({
      errors: { 'rpc:mutate_retailer_cart_line': 'MINIMUM_ORDER_QUANTITY: minimum is 8 pieces for this pack.' },
    });
    const response = await addCartLine(apiRequest('/api/mobile/v1/cart/lines', {
      method: 'POST',
      body: { packId: PACK, quantity: 2 },
    }));

    expect(response.status).toBe(422);
    expect((await json(response)).error).toMatchObject({
      code: 'minimum_order_quantity',
      details: { minQuantity: 8 },
    });
    expect(client.rpcs).toHaveLength(1);
    expect(mocks.loadMobileCart).not.toHaveBeenCalled();
  });

  it('maps a lost compare-and-set cart race to a refreshable conflict', async () => {
    const client = install({ errors: { 'rpc:mutate_retailer_cart_line': 'CART_CHANGED: cart quantity no longer matches.' } });
    const response = await addCartLine(apiRequest('/api/mobile/v1/cart/lines', {
      method: 'POST',
      body: { packId: PACK, quantity: 2 },
    }));

    expect(response.status).toBe(409);
    expect((await json(response)).error).toMatchObject({ code: 'conflict' });
    expect(client.rpcs).toHaveLength(1);
    expect(mocks.loadMobileCart).not.toHaveBeenCalled();
  });

  it('returns the authoritative paise quote for the exact saved cart and rejects untrusted totals', async () => {
    const response = await quoteCheckout(apiRequest('/api/mobile/v1/checkout/quote', {
      method: 'POST',
      // Saved PIN-coded address is required; profile text is reference only.
      body: { lines: [{ packId: PACK, quantity: 6 }], addressId: ADDRESS },
    }));
    expect(response.status).toBe(200);
    expect((await json(response)).data).toEqual(serverQuote);
    expect(mocks.quoteMobileCheckout).toHaveBeenCalledWith(
      expect.objectContaining({ userId: RETAILER }),
      [{ packId: PACK, quantity: 6 }],
      ADDRESS,
    );

    const forged = await quoteCheckout(apiRequest('/api/mobile/v1/checkout/quote', {
      method: 'POST',
      body: { lines: [{ packId: PACK, quantity: 6 }], addressId: null, grandTotalPaise: 1 },
    }));
    expect(forged.status).toBe(400);
    expect(mocks.quoteMobileCheckout).toHaveBeenCalledTimes(1);
    const missing = await quoteCheckout(apiRequest('/api/mobile/v1/checkout/quote', {
      method: 'POST', body: { lines: [{ packId: PACK, quantity: 6 }] },
    }));
    expect(missing.status).toBe(400);
    expect((await json(missing)).error).toMatchObject({ code: 'invalid_request' });
  });
});

describe('mobile order submit, retry and actual history', () => {
  const body = {
    lines: [{ packId: PACK, quantity: 6 }],
    addressId: ADDRESS,
    notes: 'Ring the bell',
  };

  it('requires a stable idempotency key and rejects body totals', async () => {
    const noKey = await submitOrder(apiRequest('/api/mobile/v1/orders', { method: 'POST', body }));
    expect(noKey.status).toBe(400);
    expect((await json(noKey)).error).toMatchObject({ code: 'invalid_request' });
    expect(mocks.createOrder).not.toHaveBeenCalled();

    const forged = await submitOrder(apiRequest('/api/mobile/v1/orders', {
      method: 'POST',
      idempotencyKey: REQUEST_KEY,
      body: { ...body, grandTotalPaise: 1 },
    }));
    expect(forged.status).toBe(400);
    expect(mocks.createOrder).not.toHaveBeenCalled();
  });

  it('requires exact cart identity, freezes a server-resolved address and clears only inside confirmed order RPC', async () => {
    mocks.loadActiveCoupon.mockResolvedValue({ coupon: { id: 'coupon-1', code: 'SPRING' }, error: false });
    const response = await submitOrder(apiRequest('/api/mobile/v1/orders', {
      method: 'POST',
      idempotencyKey: REQUEST_KEY,
      body,
    }));
    const payload = await json(response);
    expect(response.status).toBe(201);
    expect(payload.data).toMatchObject({
      order: {
        id: '77777777-7777-4777-8777-777777777777',
        status: 'pending',
        placedAt: '2026-10-03T10:00:00.000Z',
        grandTotalPaise: 60000,
        coinsUsedPaise: 15000,
        balanceAfterCoinsPaise: 0,
        idempotentReplay: false,
      },
    });
    expect(mocks.createOrder).toHaveBeenCalledTimes(1);
    const args = mocks.createOrder.mock.calls[0]![0] as Record<string, unknown>;
    expect(args).toMatchObject({
      retailerId: RETAILER,
      collectedBy: null,
      lines: body.lines,
      notes: body.notes,
      requestKey: REQUEST_KEY,
      requestContext: `saved-address:${ADDRESS}`,
      shippingAddress: { line: 'Shop Road, Gaya, Bihar, 823001', district: 'Gaya', state: 'Bihar', pincode: '823001' },
      couponCode: 'SPRING',
      clearCartAfterOrder: true,
    });
    expect(args).not.toHaveProperty('grandTotal');
    expect(args).not.toHaveProperty('gstTotal');
    expect(mocks.loadRetailerCartRows).toHaveBeenCalledTimes(1);
    expect(mocks.resolveMobileAddress).toHaveBeenCalledWith(expect.anything(), ADDRESS);
  });

  it('rejects legacy null/profile addresses instead of accepting an unverified delivery PIN', async () => {
    const response = await submitOrder(apiRequest('/api/mobile/v1/orders', {
      method: 'POST', idempotencyKey: REQUEST_KEY,
      body: { lines: body.lines, notes: body.notes },
    }));
    expect(response.status).toBe(400);
    expect((await json(response)).error).toMatchObject({ code: 'invalid_request' });
    expect(mocks.createOrder).not.toHaveBeenCalled();
  });

  it('returns the original order on same-key retry before cart/address reads and never writes twice', async () => {
    mocks.replayOrder.mockResolvedValue({
      order: {
        id: '88888888-8888-4888-8888-888888888888',
        orderNumber: 'MK-ORIGINAL',
        status: 'confirmed',
        placedAt: '2026-10-02T09:00:00.000Z',
        grandTotal: 125,
        coinsUsed: 25,
        payableOnDelivery: 100,
        coinsBalanceAfterPaise: 7000,
        idempotentReplay: true,
      },
    });
    const response = await submitOrder(apiRequest('/api/mobile/v1/orders', {
      method: 'POST',
      idempotencyKey: REQUEST_KEY,
      body,
    }));
    const payload = await json(response);
    expect(response.status).toBe(200);
    expect(payload.data).toMatchObject({
      order: {
        id: '88888888-8888-4888-8888-888888888888',
        orderNumber: 'MK-ORIGINAL',
        status: 'confirmed',
        grandTotalPaise: 12500,
        coinsUsedPaise: 2500,
        balanceAfterCoinsPaise: 7000,
        idempotentReplay: true,
      },
    });
    expect(mocks.loadRetailerCartRows).not.toHaveBeenCalled();
    expect(mocks.resolveMobileAddress).not.toHaveBeenCalled();
    expect(mocks.createOrder).not.toHaveBeenCalled();
  });

  it('returns 409 for a same-key payload conflict and 422 with stock detail for a stale stock quote', async () => {
    mocks.replayOrder.mockResolvedValue({
      error: 'This order request key was already used for different order details.',
      code: 'idempotency_conflict',
    });
    const conflict = await submitOrder(apiRequest('/api/mobile/v1/orders', {
      method: 'POST',
      idempotencyKey: REQUEST_KEY,
      body,
    }));
    expect(conflict.status).toBe(409);
    expect((await json(conflict)).error).toMatchObject({ code: 'idempotency_conflict' });
    expect(mocks.createOrder).not.toHaveBeenCalled();

    mocks.replayOrder.mockResolvedValue(null);
    mocks.createOrder.mockResolvedValue({
      error: 'Only 1 available for this pack.',
      code: 'insufficient_stock',
      available: 1,
    });
    const shortage = await submitOrder(apiRequest('/api/mobile/v1/orders', {
      method: 'POST',
      idempotencyKey: '99999999-9999-4999-8999-999999999999',
      body,
    }));
    const payload = await json(shortage);
    expect(shortage.status).toBe(422);
    expect(payload.error).toMatchObject({ code: 'insufficient_stock', details: { available: 1 } });
  });

  it('returns an existing v1 conflict code if delivery terms changed, without exposing internal schema errors', async () => {
    mocks.createOrder.mockResolvedValue({
      error: 'Delivery is no longer confirmed for this address/PIN. Choose another address.',
      code: 'delivery_unavailable',
    });
    const response = await submitOrder(apiRequest('/api/mobile/v1/orders', {
      method: 'POST', idempotencyKey: REQUEST_KEY, body,
    }));
    expect(response.status).toBe(409);
    expect((await json(response)).error).toMatchObject({
      code: 'conflict', message: expect.stringContaining('no longer confirmed'),
    });
  });

  it('rejects a request if the shared cart changed and does not call the atomic writer', async () => {
    mocks.loadRetailerCartRows.mockResolvedValue([{ pack_id: PACK, quantity: 5, cart_item_id: LINE }]);
    const response = await submitOrder(apiRequest('/api/mobile/v1/orders', {
      method: 'POST',
      idempotencyKey: REQUEST_KEY,
      body,
    }));
    expect(response.status).toBe(409);
    expect((await json(response)).error).toMatchObject({ code: 'conflict' });
    expect(mocks.createOrder).not.toHaveBeenCalled();
  });

  it('returns real status, timestamp, totals and line snapshots in history', async () => {
    const item = {
      id: 'item-1',
      product_id: PRODUCT,
      pack_id: PACK,
      quantity: 6,
      quantity_unit: 'pieces',
      quantity_pieces: 6,
      units_per_case: 12,
      unit_price: 100,
      gst_percent: 5,
      line_total: 600,
      products: { name: 'Rice' },
      product_packs: { pack_name: 'Small pack' },
    };
    const orderRows = [
      {
        id: 'order-1', retailer_id: RETAILER, order_number: 'MK-1', status: 'dispatched',
        subtotal: 571.43, gst_total: 28.57, discount_total: 0, grand_total: 600,
        placed_at: '2026-10-02T09:00:00.000Z', updated_at: '2026-10-03T09:00:00.000Z',
        notes: 'Handle with care', shipping_address: { line: 'Shop Road' },
        coins_balance_after_paise: 25000, order_items: [item],
      },
      {
        id: 'order-2', retailer_id: RETAILER, order_number: 'MK-2', status: 'delivered',
        subtotal: 100, gst_total: 5, discount_total: 10, grand_total: 95,
        placed_at: '2026-09-30T09:00:00.000Z', updated_at: '2026-10-01T09:00:00.000Z',
        notes: null, shipping_address: null, coins_balance_after_paise: null, order_items: [],
      },
    ];
    install({ orderRows });
    const response = await listOrders(apiRequest('/api/mobile/v1/orders'));
    const payload = await json(response);
    expect(response.status).toBe(200);
    const rows = payload.data as Record<string, unknown>[];
    expect(rows.map((row) => row.status)).toEqual(['dispatched', 'delivered']);
    expect(rows[0]).toMatchObject({
      id: 'order-1',
      placedAt: '2026-10-02T09:00:00.000Z',
      updatedAt: '2026-10-03T09:00:00.000Z',
      balanceAfterCoinsPaise: 25000,
      subtotalPaise: 57143,
      gstTotalPaise: 2857,
      grandTotalPaise: 60000,
      items: [{ productName: 'Rice', packName: 'Small pack', quantity: 6, quantityPieces: 6, lineTotalPaise: 60000 }],
    });
    expect(rows[1]).toMatchObject({ balanceAfterCoinsPaise: null });
    expect((mocks.client as ReturnType<typeof supabaseFixture>).queries.find((query) => query.table === 'orders')?.select)
      .toContain('coins_balance_after_paise');
    expect(JSON.stringify(payload)).not.toMatch(/retailer_id|request_fingerprint|cost_price|stock_quantity/);
  });

  it('recovers only the caller\'s committed order and returns Coins from the real wallet ledger', async () => {
    const orderId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
    const orderRows = [{
      id: orderId,
      retailer_id: RETAILER,
      order_number: 'MK-RECOVERED',
      status: 'processing',
      subtotal: 571.43,
      gst_total: 28.57,
      discount_total: 0,
      grand_total: 600,
      placed_at: '2026-10-01T10:20:30.000Z',
      updated_at: '2026-10-02T10:20:30.000Z',
      request_key: REQUEST_KEY,
      request_completed_at: '2026-10-01T10:20:30.000Z',
      coins_balance_after_paise: 25000,
      notes: null,
      shipping_address: { line: 'Shop Road' },
      order_items: [{
        id: 'recovered-item',
        product_id: PRODUCT,
        pack_id: PACK,
        quantity: 6,
        quantity_unit: 'pieces',
        quantity_pieces: 6,
        units_per_case: 12,
        unit_price: 100,
        gst_percent: 5,
        line_total: 600,
        products: { name: 'Rice' },
        product_packs: { pack_name: 'Small pack' },
      }],
    }];
    const coinRows = [{
      retailer_id: RETAILER,
      reference_id: orderId,
      transaction_type: 'ORDER_DEBIT',
      amount_paise: 15000,
      is_reversed: false,
      reversal_of: null,
    }];
    install({ orderRows, coinRows });

    const response = await recoverOrderRequest(
      apiRequest(`/api/mobile/v1/orders/requests/${REQUEST_KEY}`),
      { params: Promise.resolve({ requestKey: REQUEST_KEY }) },
    );
    const payload = await json(response);
    expect(response.status).toBe(200);
    expect(payload.data).toMatchObject({
      id: orderId,
      orderNumber: 'MK-RECOVERED',
      status: 'processing',
      placedAt: '2026-10-01T10:20:30.000Z',
      grandTotalPaise: 60000,
      coinsUsedPaise: 15000,
      balanceAfterCoinsPaise: 25000,
      items: [{ productName: 'Rice', quantity: 6 }],
    });
    const client = mocks.client as ReturnType<typeof supabaseFixture>;
    expect(client.queries.find((query) => query.table === 'orders')?.select).toContain('coins_balance_after_paise');
    expect(client.queries.find((query) => query.table === 'orders')?.filters).toEqual(expect.arrayContaining([
      { op: 'eq', column: 'request_key', value: REQUEST_KEY },
      { op: 'eq', column: 'retailer_id', value: RETAILER },
    ]));
    expect(client.queries.find((query) => query.table === 'retailer_wallet_ledger')?.filters).toEqual(expect.arrayContaining([
      { op: 'eq', column: 'reference_id', value: orderId },
      { op: 'eq', column: 'retailer_id', value: RETAILER },
    ]));
    expect(client.rpcs).toHaveLength(0);
  });

  it('does not invent a post-order wallet balance for a historical order without a snapshot', async () => {
    const orderRows = [{
      id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
      retailer_id: RETAILER,
      order_number: 'MK-LEGACY',
      status: 'pending',
      subtotal: 571.43,
      gst_total: 28.57,
      discount_total: 0,
      grand_total: 600,
      placed_at: '2026-10-01T10:20:30.000Z',
      updated_at: '2026-10-01T10:20:30.000Z',
      request_key: REQUEST_KEY,
      request_completed_at: '2026-10-01T10:20:30.000Z',
      coins_balance_after_paise: null,
      order_items: [{ id: 'item' }],
    }];
    install({ orderRows, coinRows: [] });

    const response = await recoverOrderRequest(
      apiRequest(`/api/mobile/v1/orders/requests/${REQUEST_KEY}`),
      { params: Promise.resolve({ requestKey: REQUEST_KEY }) },
    );
    const payload = await json(response);
    expect(response.status).toBe(200);
    expect(payload.data).toMatchObject({
      coinsUsedPaise: 0,
      balanceAfterCoinsPaise: null,
    });
    expect(payload.data).not.toHaveProperty('balanceAfterCoinsPaise', 60000);
  });

  it('fails closed when the Coins ledger cannot be read during order recovery', async () => {
    const orderRows = [{
      id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
      retailer_id: RETAILER,
      order_number: 'MK-RECOVERED',
      status: 'pending',
      subtotal: 100,
      gst_total: 5,
      discount_total: 0,
      grand_total: 105,
      placed_at: '2026-10-01T10:20:30.000Z',
      updated_at: '2026-10-01T10:20:30.000Z',
      request_key: REQUEST_KEY,
      request_completed_at: '2026-10-01T10:20:30.000Z',
      order_items: [{ id: 'item' }],
    }];
    install({ orderRows, errors: { retailer_wallet_ledger: 'ledger is unavailable' } });

    const response = await recoverOrderRequest(
      apiRequest(`/api/mobile/v1/orders/requests/${REQUEST_KEY}`),
      { params: Promise.resolve({ requestKey: REQUEST_KEY }) },
    );
    expect(response.status).toBe(503);
    expect((await json(response)).error).toMatchObject({ code: 'database_unavailable' });
  });

  it('blocks inactive or non-retailer sessions before cart/order work', async () => {
    install({ role: 'staff' });
    const response = await submitOrder(apiRequest('/api/mobile/v1/orders', {
      method: 'POST', idempotencyKey: REQUEST_KEY, body,
    }));
    expect(response.status).toBe(403);
    expect((await json(response)).error).toMatchObject({ code: 'forbidden' });
    expect(mocks.replayOrder).not.toHaveBeenCalled();
    expect(mocks.createOrder).not.toHaveBeenCalled();

    install({ authError: { message: 'invalid token' } });
    const invalidSession = await submitOrder(apiRequest('/api/mobile/v1/orders', {
      method: 'POST', idempotencyKey: REQUEST_KEY, body,
    }));
    expect(invalidSession.status).toBe(401);
    expect((await json(invalidSession)).error).toMatchObject({ code: 'invalid_token' });
    expect(mocks.createOrder).not.toHaveBeenCalled();
  });
});
