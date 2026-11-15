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
  // Fix 2 (migration 0097): cancellation is ONE RPC. The two tests below used to
  // pin the legacy three-call sequence (set status -> restore stock -> refund),
  // i.e. the non-atomic behaviour itself. They keep their intent - a stock or
  // Coins failure is reported and never claimed as success - and now also
  // prove the legacy calls are never issued.
  it('reports a stock failure and does not attempt a refund', async () => {
    const client = supabaseFixture({ sub_orders: [{ id: child, parent_order_id: order, coins_share_paise: 100 }] }, { 'rpc:close_sub_order_atomic': 'ATOMIC_CLOSE: stock was not fully released for this sub-order.' });
    mocks.client = client;
    expect(await adminTransitionSubOrderAction(order, child, 'cancelled')).toEqual({ ok: false, error: expect.stringContaining('stock was not fully released') });
    expect(client.rpcs.map((r) => r.name)).toEqual(['close_sub_order_atomic']);
  });
  it('reports a refund failure instead of claiming success', async () => {
    const client = supabaseFixture({ sub_orders: [{ id: child, parent_order_id: order, coins_share_paise: 100 }] }, { 'rpc:close_sub_order_atomic': 'ATOMIC_CLOSE: Coins were not fully returned for this sub-order.' });
    mocks.client = client;
    expect(await adminTransitionSubOrderAction(order, child, 'cancelled')).toEqual({ ok: false, error: expect.stringContaining('Coins were not fully returned') });
    expect(client.rpcs.map((r) => r.name)).toEqual(['close_sub_order_atomic']);
  });
  it('never falls back to the legacy three-step sequence, for cancel or return', async () => {
    for (const status of ['cancelled', 'returned'] as const) {
      const client = supabaseFixture({ sub_orders: [{ id: child, parent_order_id: order, coins_share_paise: 100 }] }, { 'rpc:close_sub_order_atomic': 'Could not find the function public.close_sub_order_atomic' });
      mocks.client = client;
      const result = await adminTransitionSubOrderAction(order, child, status);
      expect(result).toEqual({ ok: false, error: expect.stringContaining('Nothing was changed') });
      expect(client.rpcs.map((r) => r.name)).toEqual(['close_sub_order_atomic']);
    }
  });
  it('does not claim success when the database did not confirm an atomic result', async () => {
    // The fixture answers an RPC with no data: that is not proof of a commit.
    const client = supabaseFixture({ sub_orders: [{ id: child, parent_order_id: order, coins_share_paise: 100 }] });
    mocks.client = client;
    expect(await adminTransitionSubOrderAction(order, child, 'cancelled')).toEqual({ ok: false, error: expect.stringContaining('could not be confirmed') });
    expect(client.rpcs.map((r) => r.name)).toEqual(['close_sub_order_atomic']);
  });
  it('sends the parent id so the database re-checks ownership, and reports success only on an atomic result', async () => {
    const client = supabaseFixture({ sub_orders: [{ id: child, parent_order_id: order, coins_share_paise: 100 }] });
    const rpc = client.rpc;
    (client as { rpc: unknown }).rpc = async (name: string, args: Record<string, unknown>) => {
      await rpc(name, args);
      return { data: { atomic: true, status: args.p_status }, error: null };
    };
    mocks.client = client;
    expect(await adminTransitionSubOrderAction(order, child, 'cancelled', ' damaged ')).toEqual({ ok: true });
    expect(client.rpcs).toEqual([{ name: 'close_sub_order_atomic', args: { p_parent_order_id: order, p_sub_order_id: child, p_status: 'cancelled', p_reason: 'damaged' } }]);
  });
  it('non-closing transitions still use set_sub_order_status only', async () => {
    const client = supabaseFixture({ sub_orders: [{ id: child, parent_order_id: order, coins_share_paise: 100 }] });
    mocks.client = client;
    expect(await adminTransitionSubOrderAction(order, child, 'confirmed')).toEqual({ ok: true });
    expect(client.rpcs.map((r) => r.name)).toEqual(['set_sub_order_status']);
  });
  it('fails before transition on an invalid coin share', async () => {
    const client = supabaseFixture({ sub_orders: [{ id: child, parent_order_id: order, coins_share_paise: 'not-a-number' }] });
    mocks.client = client;
    expect(await adminTransitionSubOrderAction(order, child, 'cancelled')).toHaveProperty('ok', false);
    expect(client.rpcs).toHaveLength(0);
  });
});
