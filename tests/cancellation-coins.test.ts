import { beforeEach, describe, expect, it, vi } from 'vitest';
import { supabaseFixture } from './helpers/supabase-fixture';

const mocks = vi.hoisted(() => ({ reverse: vi.fn(), client: null as unknown, permission: vi.fn(), release: vi.fn(), revalidate: vi.fn() }));
vi.mock('server-only', () => ({}));
vi.mock('@/lib/orders/wallet-reversal', () => ({ reverseOrderWalletDebit: mocks.reverse }));
vi.mock('@/lib/supabase/server', () => ({ createClient: async () => mocks.client }));
vi.mock('@/lib/admin/guard', () => ({ requirePermission: mocks.permission }));
vi.mock('@/lib/coupons/validate', () => ({ releaseOrderCoupon: mocks.release }));
vi.mock('@/lib/notifications/notify', () => ({ createInAppNotification: vi.fn(), notifyOrderEvent: vi.fn() }));
vi.mock('next/cache', () => ({ revalidatePath: mocks.revalidate }));

import { restoreAndVerifyCancellationCoins } from '@/lib/orders/cancellation-coins';
import { cancelOrderAction } from '@/lib/retailer/order-actions';
import { cancelOrderAction as adminCancelOrder, updateOrderStatusAction } from '@/lib/admin/orders-actions';

const owner = 'retailer-1';
const order = 'order-1';
const debit = () => ({ id: 'debit-1', retailer_id: owner, reference_id: order, transaction_type: 'ORDER_DEBIT', direction: 'debit', amount_paise: 2500, is_reversed: false, reversal_of: null });
const credit = () => ({ id: 'credit-1', retailer_id: owner, reference_id: order, transaction_type: 'ORDER_REVERSAL', direction: 'credit', amount_paise: 2500, is_reversed: false, reversal_of: 'debit-1' });

beforeEach(() => {
  vi.clearAllMocks();
  mocks.permission.mockResolvedValue({ id: owner, role: 'retailer' });
  mocks.release.mockResolvedValue(undefined);
  mocks.reverse.mockResolvedValue({ success: true, refundedPaise: 0 });
});

describe('cancellation and coin verification with a mocked ledger', () => {
  it('cancels an owned pending order and confirms a single matched reversal', async () => {
    const client = supabaseFixture({ orders: [{ id: order, retailer_id: owner, status: 'pending' }], retailer_wallet_ledger: [debit()] });
    mocks.client = client;
    mocks.reverse.mockImplementation(async () => {
      client.tables.retailer_wallet_ledger![0]!.is_reversed = true;
      client.tables.retailer_wallet_ledger!.push(credit());
      return { success: true, refundedPaise: 2500 };
    });
    expect(await cancelOrderAction(order, 'changed mind')).toEqual({ success: true });
    expect(client.tables.orders?.[0]?.status).toBe('cancelled');
    expect(mocks.reverse).toHaveBeenCalledWith(order, owner, 'changed mind', owner, client, { requireRefundRpc: true });
    expect(client.tables.retailer_wallet_ledger).toHaveLength(2);
  });

  it('retries an owned cancellation without adding a second reversal in the idempotent RPC model', async () => {
    const client = supabaseFixture({ orders: [{ id: order, retailer_id: owner, status: 'cancelled' }], retailer_wallet_ledger: [{ ...debit(), is_reversed: true }, credit()] });
    mocks.client = client;
    expect(await cancelOrderAction(order, '')).toEqual({ success: true });
    expect(await cancelOrderAction(order, '')).toEqual({ success: true });
    expect(client.tables.retailer_wallet_ledger).toHaveLength(2);
    expect(mocks.reverse).toHaveBeenCalledTimes(2);
  });

  it('returns an honest partial-failure error when the refund RPC fails after status committed', async () => {
    const client = supabaseFixture({ orders: [{ id: order, retailer_id: owner, status: 'pending' }], retailer_wallet_ledger: [debit()] });
    mocks.client = client;
    mocks.reverse.mockResolvedValue({ error: 'RPC unavailable' });
    const result = await cancelOrderAction(order, '');
    expect(result).toEqual({ error: expect.stringContaining('order is cancelled') });
    expect(client.tables.orders?.[0]?.status).toBe('cancelled');
    expect(client.tables.retailer_wallet_ledger).toHaveLength(1);
  });

  it('rejects an unverified zero result and mismatched or partial credit', async () => {
    for (const rows of [[debit()], [{ ...debit(), is_reversed: true }], [{ ...debit(), is_reversed: true }, { ...credit(), amount_paise: 1000 }]]) {
      const client = supabaseFixture({ retailer_wallet_ledger: rows });
      expect(await restoreAndVerifyCancellationCoins(client as never, order, owner, 'cancel', owner)).toHaveProperty('error');
    }
  });

  it('fails safely when multiple child debits need a transactional refund design', async () => {
    const client = supabaseFixture({ retailer_wallet_ledger: [debit(), { ...debit(), id: 'debit-2', amount_paise: 900 }] });
    expect(await restoreAndVerifyCancellationCoins(client as never, order, owner, 'cancel', owner)).toHaveProperty('error');
    expect(mocks.reverse).not.toHaveBeenCalled();
    expect(client.tables.retailer_wallet_ledger).toHaveLength(2);
  });

  it('does not assume an unreadable ledger is empty', async () => {
    const client = supabaseFixture({}, { retailer_wallet_ledger: 'read failed' });
    expect(await restoreAndVerifyCancellationCoins(client as never, order, owner, 'cancel', owner)).toHaveProperty('error');
    expect(mocks.reverse).not.toHaveBeenCalled();
  });

  it('does not report admin cancellation as complete when the refund fails', async () => {
    const client = supabaseFixture({ orders: [{ id: order, retailer_id: owner, status: 'pending' }], retailer_wallet_ledger: [debit()] });
    Object.assign(client, { auth: { getUser: async () => ({ data: { user: { id: 'admin-1' } } }) } });
    mocks.client = client;
    mocks.reverse.mockResolvedValue({ error: 'RPC failed' });
    expect(await adminCancelOrder(order, '')).toHaveProperty('error');
    expect(client.tables.orders?.[0]?.status).toBe('cancelled');
    expect(client.tables.retailer_wallet_ledger).toHaveLength(1);
  });

  it('routes generic admin status cancellation through the checked refund path', async () => {
    const client = supabaseFixture({ orders: [{ id: order, retailer_id: owner, status: 'pending' }], retailer_wallet_ledger: [debit()] });
    Object.assign(client, { auth: { getUser: async () => ({ data: { user: { id: 'admin-1' } } }) } });
    mocks.client = client;
    mocks.reverse.mockResolvedValue({ error: 'RPC failed' });
    expect(await updateOrderStatusAction(order, 'cancelled')).toHaveProperty('error');
    expect(mocks.permission).toHaveBeenCalledWith('orders.approve');
    expect(mocks.permission).toHaveBeenCalledWith('orders.cancel');
  });

  it('does not retry restoration for a foreign or processing order', async () => {
    for (const row of [{ id: order, retailer_id: 'other', status: 'cancelled' }, { id: order, retailer_id: owner, status: 'processing' }]) {
      const client = supabaseFixture({ orders: [row] });
      mocks.client = client;
      expect(await cancelOrderAction(order, '')).toHaveProperty('error');
      expect(mocks.reverse).not.toHaveBeenCalled();
    }
  });
});
