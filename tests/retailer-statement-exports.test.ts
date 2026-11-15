import { beforeEach, describe, expect, it, vi } from 'vitest';
import { supabaseFixture } from './helpers/supabase-fixture';
import { iterateKeysetPages } from '@/lib/infinite-scroll/collect-keyset-pages';
import { streamCsvRows } from '@/lib/retailer/reports';

const routeMocks = vi.hoisted(() => ({
  client: null as unknown,
  user: { id: 'retailer-1', role: 'retailer' } as { id: string; role: string } | null,
}));

vi.mock('@/lib/supabase/server', () => ({ createClient: () => routeMocks.client }));
vi.mock('@/lib/auth/session', () => ({ requireUser: async () => routeMocks.user }));
vi.mock('@/lib/mobile', () => ({
  enforceRateLimit: () => null,
  jsonError: (code: string, message: string, options?: { status?: number }) =>
    new Response(JSON.stringify({ code, error: message }), { status: options?.status ?? 400 }),
  logServerError: () => undefined,
  newRequestId: () => 'statement-export-test',
}));
vi.mock('@/lib/mobile/commerce-route', () => ({
  requireRetailerCommerceSession: async () => ({
    session: { userId: 'retailer-1', supabase: routeMocks.client },
  }),
}));

import { GET as downloadStatement } from '@/app/retailer/reports/statement/route';
import { GET as downloadMobileStatement } from '@/app/api/mobile/v1/reports/statement/route';

const RETAILER = 'retailer-1';
const OTHER_RETAILER = 'retailer-2';
const ROW_COUNT = 1_005;

function walletEntry(index: number, retailerId = RETAILER, createdAt?: string) {
  return {
    id: `ledger-${String(index).padStart(4, '0')}`,
    retailer_id: retailerId,
    account_id: null,
    transaction_type: 'PAYMENT_CREDIT',
    amount_paise: index + 1,
    direction: 'credit',
    reference_type: null,
    reference_id: null,
    description: `Payment ${index}, "cash"`,
    reason: null,
    created_by: null,
    created_at: createdAt ?? '2026-04-15T12:00:00.000Z',
    notes: null,
    idempotency_key: null,
    metadata: null,
    is_reversed: false,
  };
}

function orderRow(index: number, retailerId = RETAILER, placedAt?: string) {
  return {
    id: `order-${String(index).padStart(4, '0')}`,
    retailer_id: retailerId,
    order_number: `MT-ORDER-${String(index).padStart(4, '0')}`,
    placed_at: placedAt ?? '2026-04-15T12:00:00.000Z',
    status: 'delivered',
    subtotal: 100,
    discount_total: 0,
    gst_total: 18,
    grand_total: 118,
  };
}

function getRequest(type: 'orders' | 'ledger') {
  return new Request(
    `https://shop.test/retailer/reports/statement?type=${type}&from=2026-04-01&to=2026-04-30`
  );
}

beforeEach(() => {
  routeMocks.user = { id: RETAILER, role: 'retailer' };
  routeMocks.client = null;
});

describe('retailer statement CSV exports', () => {
  it('fails fast if a keyset continuation repeats instead of looping or duplicating rows', async () => {
    const rows = [
      { id: 'row-2', created_at: '2026-04-15T12:00:00.000Z' },
      { id: 'row-1', created_at: '2026-04-15T12:00:00.000Z' },
    ];
    const fetchPage = vi.fn(async () => rows);
    const iterator = iterateKeysetPages(
      fetchPage,
      [
        { column: 'created_at', ascending: false },
        { column: 'id', ascending: false },
      ],
      1
    );

    await expect(iterator.next()).resolves.toMatchObject({ done: false, value: rows[0] });
    await expect(iterator.next()).rejects.toThrow('Keyset pagination did not advance');
    expect(fetchPage).toHaveBeenCalledTimes(2);
  });

  it('terminates a failed stream with a generic error and does not retry or expose query details', async () => {
    const onError = vi.fn();
    let fetchCount = 0;
    const iterator: AsyncIterator<string> = {
      async next() {
        fetchCount += 1;
        if (fetchCount === 1) return { done: false, value: 'later,row' };
        throw new Error('sensitive database detail');
      },
      async return() {
        return { done: true, value: undefined };
      },
    };
    const stream = streamCsvRows(
      'Header',
      { done: false, value: 'first,row' },
      iterator,
      (row) => row,
      onError
    );

    await expect(new Response(stream).text()).rejects.toThrow('The statement export could not be completed.');
    expect(onError).toHaveBeenCalledWith(expect.objectContaining({ message: 'sensitive database detail' }));
    expect(fetchCount).toBe(2);
  });

  it('exports every date-matched wallet entry across keyset pages, not just the first 1,000', async () => {
    const client = supabaseFixture({
      retailer_wallet_ledger: [
        ...Array.from({ length: ROW_COUNT }, (_, index) => walletEntry(index)),
        walletEntry(2_000, RETAILER, '2026-03-30T00:00:00.000Z'),
        walletEntry(2_001, RETAILER, '2026-05-01T00:00:00.000Z'),
        walletEntry(2_002, OTHER_RETAILER, '2026-04-15T12:00:00.000Z'),
      ],
    });
    routeMocks.client = client;

    const response = await downloadStatement(getRequest('ledger'));
    const csv = await response.text();
    const rows = csv.split('\n');

    expect(response.status).toBe(200);
    expect(rows).toHaveLength(ROW_COUNT + 1);
    expect(rows[0]).toBe('Date (IST),Type,Direction,Amount (Rs),Reference');
    expect(rows[1]).toContain('Payment 1004, ""cash""');
    expect(rows.at(-1)).toContain('Payment 0, ""cash""');
    expect(csv).not.toContain('Payment 2000');
    expect(csv).not.toContain('Payment 2001');
    expect(csv).not.toContain('Payment 2002');

    const queries = client.queries.filter((query) => query.table === 'retailer_wallet_ledger');
    expect(queries).toHaveLength(3);
    for (const query of queries) {
      expect(query.filters).toContainEqual({ op: 'eq', column: 'retailer_id', value: RETAILER });
      expect(query.filters).toContainEqual({ op: 'gte', column: 'created_at', value: '2026-03-31T18:30:00.000Z' });
      expect(query.filters).toContainEqual({ op: 'lte', column: 'created_at', value: '2026-04-30T18:29:59.999Z' });
    }
  });

  it('exports purchase statements with more than 1,000 own orders in stable date order', async () => {
    const client = supabaseFixture({
      orders: [
        ...Array.from({ length: ROW_COUNT }, (_, index) => orderRow(index)),
        orderRow(2_000, RETAILER, '2026-03-30T00:00:00.000Z'),
        orderRow(2_001, RETAILER, '2026-05-01T00:00:00.000Z'),
        orderRow(2_002, OTHER_RETAILER, '2026-04-15T12:00:00.000Z'),
      ],
    });
    routeMocks.client = client;

    const response = await downloadStatement(getRequest('orders'));
    const csv = await response.text();
    const rows = csv.split('\n');

    expect(response.status).toBe(200);
    expect(rows).toHaveLength(ROW_COUNT + 1);
    expect(rows[0]).toBe('Order number,Placed on (IST),Status,Subtotal (Rs),Discount (Rs),GST (Rs),Grand total (Rs)');
    expect(rows[1]).toContain('MT-ORDER-0000');
    expect(rows.at(-1)).toContain('MT-ORDER-1004');
    expect(csv).not.toContain('MT-ORDER-2000');
    expect(csv).not.toContain('MT-ORDER-2001');
    expect(csv).not.toContain('MT-ORDER-2002');

    const queries = client.queries.filter((query) => query.table === 'orders');
    expect(queries).toHaveLength(3);
    for (const query of queries) {
      expect(query.filters).toContainEqual({ op: 'eq', column: 'retailer_id', value: RETAILER });
      expect(query.filters).toContainEqual({ op: 'gte', column: 'placed_at', value: '2026-03-31T18:30:00.000Z' });
      expect(query.filters).toContainEqual({ op: 'lte', column: 'placed_at', value: '2026-04-30T18:29:59.999Z' });
    }
  });

  it('keeps the mobile statement API complete across the same ledger keyset pages', async () => {
    const client = supabaseFixture({
      retailer_wallet_ledger: [
        ...Array.from({ length: ROW_COUNT }, (_, index) => walletEntry(index)),
        walletEntry(2_000, RETAILER, '2026-03-30T00:00:00.000Z'),
        walletEntry(2_001, RETAILER, '2026-05-01T00:00:00.000Z'),
        walletEntry(2_002, OTHER_RETAILER, '2026-04-15T12:00:00.000Z'),
      ],
    });
    routeMocks.client = client;

    const response = await downloadMobileStatement(new Request(
      'https://api.test/api/mobile/v1/reports/statement?type=ledger&from=2026-04-01&to=2026-04-30'
    ));
    const csv = await response.text();

    expect(response.status).toBe(200);
    expect(csv.split('\n')).toHaveLength(ROW_COUNT + 1);
    expect(csv).toContain('Payment 1004, ""cash""');
    expect(csv).toContain('Payment 0, ""cash""');
    expect(csv).not.toContain('Payment 2000');
    expect(csv).not.toContain('Payment 2001');
    expect(csv).not.toContain('Payment 2002');
    expect(response.headers.get('x-request-id')).toBe('statement-export-test');

    const queries = client.queries.filter((query) => query.table === 'retailer_wallet_ledger');
    expect(queries).toHaveLength(3);
    for (const query of queries) {
      expect(query.filters).toContainEqual({ op: 'eq', column: 'retailer_id', value: RETAILER });
      expect(query.filters).toContainEqual({ op: 'gte', column: 'created_at', value: '2026-03-31T18:30:00.000Z' });
      expect(query.filters).toContainEqual({ op: 'lte', column: 'created_at', value: '2026-04-30T18:29:59.999Z' });
    }
  });

  it('returns an unavailable response instead of a misleading empty CSV when a ledger page fails', async () => {
    routeMocks.client = supabaseFixture({}, { retailer_wallet_ledger: 'database timeout' });

    const response = await downloadStatement(getRequest('ledger'));

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({ error: 'The statement could not be prepared. Please try again.' });
  });
});
