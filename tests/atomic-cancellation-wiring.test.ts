import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';

vi.mock('server-only', () => ({}));
vi.mock('@/lib/orders/wallet-reversal', () => ({ reverseOrderWalletDebit: vi.fn() }));

import { tryAtomicOrderCancellation } from '@/lib/orders/cancellation-coins';

function client(opts: { rpcError?: string | null; status?: string; readError?: boolean; throws?: boolean; noRpc?: boolean }) {
  const calls: Array<{ fn: string; args: Record<string, unknown> }> = [];
  const c: Record<string, unknown> = {
    from: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => opts.readError
            ? { data: null, error: { message: 'read failed' } }
            : { data: { status: opts.status ?? 'pending' }, error: null },
        }),
      }),
    }),
  };
  if (!opts.noRpc) {
    c.rpc = async (fn: string, args: Record<string, unknown>) => {
      calls.push({ fn, args });
      if (opts.throws) throw new Error('network');
      return { error: opts.rpcError ? { message: opts.rpcError } : null };
    };
  }
  return { c: c as never, calls };
}

describe('tryAtomicOrderCancellation', () => {
  it('calls cancel_order_coins_atomic and reports success only when the order reads cancelled', async () => {
    const { c, calls } = client({ status: 'cancelled' });
    expect(await tryAtomicOrderCancellation(c, 'order-1', 'changed mind')).toBe(true);
    expect(calls).toEqual([{ fn: 'cancel_order_coins_atomic', args: { p_order_id: 'order-1', p_reason: 'changed mind' } }]);
  });

  it('does not report success when the RPC returned no error but the order is not cancelled', async () => {
    expect(await tryAtomicOrderCancellation(client({ status: 'pending' }).c, 'order-1', 'x')).toBe(false);
  });

  it('reports failure (never throws) on RPC error, thrown error, unreadable order or missing rpc', async () => {
    expect(await tryAtomicOrderCancellation(client({ rpcError: 'Access denied' }).c, 'o', 'x')).toBe(false);
    expect(await tryAtomicOrderCancellation(client({ throws: true }).c, 'o', 'x')).toBe(false);
    expect(await tryAtomicOrderCancellation(client({ status: 'cancelled', readError: true }).c, 'o', 'x')).toBe(false);
    expect(await tryAtomicOrderCancellation(client({ noRpc: true }).c, 'o', 'x')).toBe(false);
  });

  it('caps the reason length sent to the database', async () => {
    const { c, calls } = client({ status: 'cancelled' });
    await tryAtomicOrderCancellation(c, 'o', 'r'.repeat(900));
    expect(String(calls[0]!.args.p_reason)).toHaveLength(500);
  });
});

describe('every cancellation path tries the atomic RPC first and still verifies the ledger', () => {
  for (const file of [
    'lib/retailer/order-actions.ts',
    'lib/admin/orders-actions.ts',
    'app/api/mobile/v1/orders/[id]/cancel/route.ts',
  ]) {
    it(file, () => {
      const source = readFileSync(file, 'utf8');
      const atomic = source.indexOf('tryAtomicOrderCancellation(');
      const verify = source.lastIndexOf('restoreAndVerifyCancellationCoins(');
      expect(atomic).toBeGreaterThan(-1);
      expect(verify).toBeGreaterThan(atomic);
    });
  }
});
