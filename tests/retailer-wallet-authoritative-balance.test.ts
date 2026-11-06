import { describe, expect, it, vi } from 'vitest';
vi.mock('server-only', () => ({}));
import { getRetailerOutstandingPaise } from '@/lib/retailer/wallet';

describe('retailer outstanding balance', () => {
  it('uses the same complete backend balance as the admin reader', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: '30000', error: null });
    const from = vi.fn();
    expect(await getRetailerOutstandingPaise({ rpc, from } as never, 'retailer')).toBe(30000);
    expect(rpc).toHaveBeenCalledWith('get_retailer_outstanding_paise', { p_retailer_id: 'retailer' });
    expect(from).not.toHaveBeenCalled();
  });

  it.each([
    { data: null, error: { message: 'RPC unavailable' } },
    { data: null, error: null },
    { data: '1.2', error: null },
    { data: '9007199254740992', error: null },
  ])('fails closed rather than returning a stale mirror or zero for %o', async (response) => {
    const rpc = vi.fn().mockResolvedValue(response);
    const from = vi.fn();
    await expect(getRetailerOutstandingPaise({ rpc, from } as never, 'retailer')).rejects.toThrow();
    expect(from).not.toHaveBeenCalled();
  });

  it('does not fall back when the RPC throws', async () => {
    const from = vi.fn();
    await expect(getRetailerOutstandingPaise({ rpc: async () => { throw new Error('network'); }, from } as never, 'retailer')).rejects.toThrow('network');
    expect(from).not.toHaveBeenCalled();
  });
});
