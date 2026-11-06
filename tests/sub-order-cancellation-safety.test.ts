import { beforeEach, describe, expect, it, vi } from 'vitest';
import { supabaseFixture } from './helpers/supabase-fixture';

const mocks = vi.hoisted(() => ({ client: null as unknown }));
vi.mock('@/lib/supabase/server', () => ({ createClient: async () => mocks.client }));
vi.mock('@/lib/admin/guard', () => ({ requirePermission: vi.fn() }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
import { adminTransitionSubOrderAction } from '@/lib/admin/sub-order-actions';

const order = '11111111-1111-4111-8111-111111111111';
const child = '22222222-2222-4222-8222-222222222222';

beforeEach(() => { mocks.client = null; });

describe('sub-order transition safety', () => {
  it('rejects a child belonging to a different parent before changing its status', async () => {
    const client = supabaseFixture({ sub_orders: [{ id: child, parent_order_id: 'other', coins_share_paise: 100 }] });
    mocks.client = client;
    expect(await adminTransitionSubOrderAction(order, child, 'cancelled')).toHaveProperty('ok', false);
    expect(client.rpcs).toHaveLength(0);
  });
  it('reports a stock failure and does not attempt a refund', async () => {
    const client = supabaseFixture({ sub_orders: [{ id: child, parent_order_id: order, coins_share_paise: 100 }] }, { 'rpc:restore_sub_order_stock': 'failed' });
    mocks.client = client;
    expect(await adminTransitionSubOrderAction(order, child, 'cancelled')).toEqual({ ok: false, error: expect.stringContaining('stock restoration failed') });
    expect(client.rpcs.map((r) => r.name)).toEqual(['set_sub_order_status', 'restore_sub_order_stock']);
  });
  it('reports a refund failure instead of claiming success', async () => {
    const client = supabaseFixture({ sub_orders: [{ id: child, parent_order_id: order, coins_share_paise: 100 }] }, { 'rpc:refund_sub_order_coins': 'failed' });
    mocks.client = client;
    expect(await adminTransitionSubOrderAction(order, child, 'cancelled')).toEqual({ ok: false, error: expect.stringContaining('Coins restoration failed') });
  });
  it('fails before transition on an invalid coin share', async () => {
    const client = supabaseFixture({ sub_orders: [{ id: child, parent_order_id: order, coins_share_paise: 'not-a-number' }] });
    mocks.client = client;
    expect(await adminTransitionSubOrderAction(order, child, 'cancelled')).toHaveProperty('ok', false);
    expect(client.rpcs).toHaveLength(0);
  });
});
