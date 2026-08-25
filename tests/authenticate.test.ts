import { describe, expect, it } from 'vitest';
import { authenticateAIRequest } from '@/lib/ai/authenticate';

function client(user: { id: string } | null, profile?: { role: string; full_name: string; is_active: boolean }) {
  const query = { select: () => query, eq: () => query, maybeSingle: async () => ({ data: profile ?? null, error: null }) };
  return { auth: { getUser: async () => ({ data: { user }, error: null }) }, from: () => query } as never;
}

describe('AI request authentication', () => {
  it('rejects an unauthenticated request', async () => {
    expect(await authenticateAIRequest(client(null), 'retailer')).toMatchObject({ status: 401 });
  });

  it('rejects an admin profile from the retailer workspace', async () => {
    const result = await authenticateAIRequest(client({ id: 'u' }, { role: 'admin', full_name: 'A', is_active: true }), 'retailer');
    expect(result).toMatchObject({ status: 403 });
  });
});
