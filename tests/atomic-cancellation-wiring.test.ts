import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';

vi.mock('server-only', () => ({}));
vi.mock('@/lib/orders/wallet-reversal', () => ({ reverseOrderWalletDebit: vi.fn() }));

import { attemptAtomicOrderCancellation, tryAtomicOrderCancellation } from '@/lib/orders/cancellation-coins';

function client(opts: { rpcCode?: string; rpcError?: string | null; status?: string; readError?: boolean; throws?: boolean; noRpc?: boolean }) {
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
      return { error: opts.rpcError ? { message: opts.rpcError, code: opts.rpcCode } : null };
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
      const atomic = source.indexOf('attemptAtomicOrderCancellation(');
      const verify = source.lastIndexOf('restoreAndVerifyCancellationCoins(');
      expect(atomic).toBeGreaterThan(-1);
      expect(verify).toBeGreaterThan(atomic);
    });
  }
});

describe('attemptAtomicOrderCancellation: a database refusal is final (Fix 2, 0097)', () => {
  it('reports "refused" for every database error except a missing function', async () => {
    for (const message of [
      'Split order cancellation requires separate reviewed handling.',
      'SPLIT_CANCEL: Coins were not fully returned.',
      'SPLIT_CANCEL: a settled sub-order requires administrator reconciliation.',
      'Ambiguous prior order credits require reconciliation.',
      'Child debit does not match checkout share; reconciliation required.',
      'deadlock detected',
    ]) {
      const outcome = await attemptAtomicOrderCancellation(client({ rpcError: message }).c, 'o', 'x');
      expect(outcome, message).toMatchObject({ status: 'refused', conflict: false });
      // Raw database text is not shown to the retailer.
      expect((outcome as { error: string }).error).toMatch(/nothing was changed/i);
    }
  });

  it('maps status / ownership refusals to the existing "can no longer be cancelled" message', async () => {
    for (const message of ['Order cannot be cancelled in its current status.', 'Access denied.', 'SPLIT_CANCEL: part of this order is already being fulfilled, so the whole order cannot be cancelled.']) {
      expect(await attemptAtomicOrderCancellation(client({ rpcError: message }).c, 'o', 'x'))
        .toEqual({ status: 'refused', conflict: true, error: 'This order can no longer be cancelled — it may already be processing.' });
    }
  });

  it('treats only a missing function as "unavailable"', async () => {
    expect(await attemptAtomicOrderCancellation(client({ rpcError: 'Could not find the function public.cancel_order_coins_atomic(p_order_id, p_reason) in the schema cache', rpcCode: 'PGRST202' }).c, 'o', 'x'))
      .toEqual({ status: 'unavailable' });
    expect(await attemptAtomicOrderCancellation(client({ noRpc: true }).c, 'o', 'x')).toEqual({ status: 'unavailable' });
  });

  it('a lost response is "refused" (retry is idempotent; a non-atomic fallback is not safe)', async () => {
    expect(await attemptAtomicOrderCancellation(client({ throws: true }).c, 'o', 'x')).toMatchObject({ status: 'refused' });
  });
});

describe('no cancellation path continues to a direct status write after a refusal', () => {
  for (const file of [
    'lib/retailer/order-actions.ts',
    'lib/admin/orders-actions.ts',
    'app/api/mobile/v1/orders/[id]/cancel/route.ts',
  ]) {
    it(file, () => {
      const source = readFileSync(file, 'utf8');
      const attempt = source.indexOf('attemptAtomicOrderCancellation(');
      const refusal = source.indexOf("status === 'refused'", attempt);
      const directWrite = source.indexOf("status: 'cancelled'", attempt);
      expect(refusal).toBeGreaterThan(attempt);
      // The early return on refusal comes before the legacy status write.
      expect(directWrite).toBeGreaterThan(refusal);
      expect(source.slice(refusal, directWrite)).toMatch(/return /);
    });
  }

  it('the admin sub-order action has no legacy stock / refund RPC left', () => {
    const source = readFileSync('lib/admin/sub-order-actions.ts', 'utf8');
    expect(source).toContain("'close_sub_order_atomic'");
    expect(source).not.toContain("'restore_sub_order_stock'");
    expect(source).not.toContain("'refund_sub_order_coins'");
  });
});
