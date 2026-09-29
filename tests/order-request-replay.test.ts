import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  client: null as unknown,
  quote: vi.fn(),
  debit: vi.fn(),
  coinMovement: vi.fn(),
  resolveWarehouse: vi.fn(),
}));

vi.mock('@/lib/supabase/server', () => ({
  createClient: () => mocks.client,
  createServiceRoleClient: () => mocks.client,
}));
vi.mock('@/lib/orders/quote-order', () => ({ quoteOrderForRetailer: mocks.quote }));
vi.mock('@/lib/coins/server', () => ({ debitCoinsForOrder: mocks.debit, getOrderCoinMovement: mocks.coinMovement }));
vi.mock('@/lib/warehouse/resolver', () => ({ resolveActiveWarehouse: mocks.resolveWarehouse }));

import { createOrderForRetailer } from '@/lib/orders/create-order';

const REQUEST_KEY = '11111111-1111-4111-8111-111111111111';
const RETAILER_ID = '22222222-2222-4222-8222-222222222222';
const SALESMAN_ID = '33333333-3333-4333-8333-333333333333';
const ORDER_ID = '44444444-4444-4444-8444-444444444444';

const state: {
  order: Record<string, unknown> | null;
  firstItem: Record<string, unknown> | null;
  queries: { table: string; select: string; filters: [string, unknown][]; limit?: number }[];
} = { order: null, firstItem: null, queries: [] };

function replayClient() {
  return {
    from(table: string) {
      const query = { table, select: '', filters: [] as [string, unknown][], limit: undefined as number | undefined };
      const chain = {
        select: (value: string) => { query.select = value; return chain; },
        eq: (column: string, value: unknown) => { query.filters.push([column, value]); return chain; },
        limit: (value: number) => { query.limit = value; return chain; },
        maybeSingle: async () => {
          state.queries.push(query);
          if (table === 'orders') return { data: state.order, error: null };
          if (table === 'order_items') return { data: state.firstItem, error: null };
          return { data: null, error: null };
        },
      };
      return chain;
    },
  };
}

function input() {
  return {
    retailerId: RETAILER_ID,
    collectedBy: SALESMAN_ID,
    lines: [{ packId: '55555555-5555-4555-8555-555555555555', quantity: 6 }],
    notes: '',
    requestKey: REQUEST_KEY,
  };
}

beforeEach(() => {
  state.order = {
    id: ORDER_ID,
    order_number: 'MK-20260929-00001',
    retailer_id: RETAILER_ID,
    collected_by: SALESMAN_ID,
    grand_total: 100,
    status: 'pending',
    request_completed_at: null,
  };
  state.firstItem = null;
  state.queries = [];
  mocks.client = replayClient();
  mocks.quote.mockReset();
  mocks.debit.mockReset();
  mocks.coinMovement.mockReset();
  mocks.resolveWarehouse.mockReset();
});

describe('salesman request-key replay', () => {
  it('does not return an unfinished pending order as a successful replay', async () => {
    const result = await createOrderForRetailer(input());

    expect(result).toEqual({ error: 'This order request is still being finalized. Refresh your orders before trying again.' });
    expect(state.queries.map((query) => query.table)).toEqual(['orders']);
    expect(mocks.quote).not.toHaveBeenCalled();
    expect(mocks.coinMovement).not.toHaveBeenCalled();
  });

  it('replays only after the server-side completion marker exists and an order line is present', async () => {
    state.order = { ...state.order, request_completed_at: '2026-09-29T00:00:00.000Z' };
    state.firstItem = { id: 'item-1' };
    mocks.coinMovement.mockResolvedValue({ spentPaise: 2500, refunded: false, refundedPaise: 0 });

    const result = await createOrderForRetailer(input());

    expect(result).toEqual({
      order: {
        id: ORDER_ID,
        orderNumber: 'MK-20260929-00001',
        grandTotal: 100,
        coinsUsed: 25,
        payableOnDelivery: 75,
      },
    });
    expect(state.queries.map((query) => query.table)).toEqual(['orders', 'order_items']);
    expect(mocks.coinMovement).toHaveBeenCalledWith(mocks.client, ORDER_ID, RETAILER_ID);
    expect(mocks.quote).not.toHaveBeenCalled();
  });

  it('does not replay cancelled orders even if they were previously completed', async () => {
    state.order = { ...state.order, status: 'cancelled', request_completed_at: '2026-09-29T00:00:00.000Z' };

    const result = await createOrderForRetailer(input());

    expect(result).toEqual({ error: 'This order request was already cancelled. Review the current stock and submit a new order.' });
    expect(state.queries.map((query) => query.table)).toEqual(['orders']);
    expect(mocks.quote).not.toHaveBeenCalled();
  });
});
