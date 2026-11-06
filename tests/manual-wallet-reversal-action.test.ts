import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ rpc: vi.fn(), permission: vi.fn(), revalidate: vi.fn() }));
vi.mock('server-only', () => ({}));
vi.mock('next/cache', () => ({ revalidatePath: mocks.revalidate }));
vi.mock('@/lib/admin/guard', () => ({ requirePermission: mocks.permission }));
vi.mock('@/lib/supabase/server', () => ({ createClient: async () => ({ rpc: mocks.rpc }) }));
import { reverseTransactionAction } from '@/lib/admin/wallet-actions';

describe('manual wallet reversal action', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.permission.mockResolvedValue({ id: 'admin' });
    mocks.rpc.mockResolvedValue({ data: 'reversal-id', error: null });
  });
  it('uses one transactional RPC with retailer, original and normalized reason', async () => {
    expect(await reverseTransactionAction('original', 'retailer', '  valid reason  ')).toEqual({ success: true, message: 'Manual adjustment reversed.' });
    expect(mocks.permission).toHaveBeenCalledWith('coins.manage');
    expect(mocks.rpc).toHaveBeenCalledOnce();
    expect(mocks.rpc).toHaveBeenCalledWith('reverse_manual_wallet_adjustment', {
      p_retailer_id: 'retailer', p_transaction_id: 'original', p_reason: 'valid reason',
    });
  });
  it('does not claim success on a database error, including uncertain outcomes', async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { message: 'timeout' } });
    expect(await reverseTransactionAction('original', 'retailer', 'valid reason')).toEqual({ error: expect.stringContaining('could not be confirmed') });
    expect(mocks.revalidate).not.toHaveBeenCalled();
  });
  it('rejects invalid reasons before invoking the database', async () => {
    expect(await reverseTransactionAction('original', 'retailer', 'bad')).toHaveProperty('error');
    expect(await reverseTransactionAction('original', 'retailer', 'x'.repeat(501))).toHaveProperty('error');
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
});
