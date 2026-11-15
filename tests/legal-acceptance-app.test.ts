import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ rpc: vi.fn(), rows: [] as unknown[], readError: null as unknown, user: { id: 'user-1', role: 'retailer' } }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('@/lib/auth/session', () => ({ requireUser: async () => mocks.user }));
vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({
    rpc: mocks.rpc,
    from: () => ({ select: () => ({ eq: () => ({ returns: async () => ({ data: mocks.rows, error: mocks.readError }) }) }) }),
  }),
}));

import { acceptLegalDocumentsAction, getAcceptanceStatus } from '@/lib/legal/acceptance';
import { REQUIRED_ACCEPTANCE, legalDocumentByKey } from '@/lib/legal/documents';

const form = (entries: Record<string, string>) => {
  const data = new FormData();
  for (const [key, value] of Object.entries(entries)) data.set(key, value);
  return data;
};

beforeEach(() => {
  mocks.rpc.mockReset().mockResolvedValue({ error: null });
  mocks.rows = [];
  mocks.readError = null;
});

describe('legal acceptance server action', () => {
  it('records the registry versions, ignoring any version or document sent by the browser', async () => {
    await acceptLegalDocumentsAction(form({ audience: 'seller', confirm: 'on', version: '99.0', document_key: 'forged' }));
    expect(mocks.rpc.mock.calls.map(([, args]) => args.p_document_key)).toEqual([...REQUIRED_ACCEPTANCE.seller]);
    for (const [fn, args] of mocks.rpc.mock.calls) {
      expect(fn).toBe('record_legal_acceptance');
      expect(args.p_document_version).toBe(legalDocumentByKey(args.p_document_key)!.version);
      expect(args.p_context).toBe('seller_onboarding');
      expect(args).not.toHaveProperty('p_user_id');
    }
  });

  it('records nothing without the explicit confirmation or with an unknown audience', async () => {
    await acceptLegalDocumentsAction(form({ audience: 'retailer' }));
    await acceptLegalDocumentsAction(form({ audience: 'admin', confirm: 'on' }));
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it('reports a document as pending until the CURRENT version is accepted', async () => {
    const terms = legalDocumentByKey('terms')!;
    mocks.rows = [{ document_key: 'terms', document_version: '0.9', accepted_at: '2026-01-01T00:00:00Z' }];
    let status = await getAcceptanceStatus('retailer');
    expect(status).toMatchObject({ available: true, pending: REQUIRED_ACCEPTANCE.retailer.length });
    mocks.rows = [{ document_key: 'terms', document_version: terms.version, accepted_at: '2026-11-14T00:00:00Z' }];
    status = await getAcceptanceStatus('retailer');
    expect(status).toMatchObject({ available: true, pending: REQUIRED_ACCEPTANCE.retailer.length - 1 });
  });

  it('reports unavailable (and so shows nothing) when the table is not installed', async () => {
    mocks.readError = { message: 'relation does not exist' };
    expect(await getAcceptanceStatus('retailer')).toEqual({ available: false });
  });
});
