/**
 * Fix 3: Seller Agreement + marketplace switch, application boundary.
 * (Database boundary: tests/seller-agreement-gate-db.test.ts.)
 * Every path that activates or publishes a seller offer must stop, without
 * writing, when the gate is closed - and the gate fails closed.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { supabaseFixture } from './helpers/supabase-fixture';
import { legalDocumentByKey } from '@/lib/legal/documents';

const mocks = vi.hoisted(() => ({ client: vi.fn(), permission: vi.fn(), activeSeller: vi.fn() }));
vi.mock('@/lib/supabase/server', () => ({ createClient: mocks.client, createServiceRoleClient: mocks.client }));
vi.mock('@/lib/admin/guard', () => ({ requirePermission: mocks.permission }));
vi.mock('@/lib/seller/guard', () => ({ requireSeller: mocks.activeSeller, requireActiveSeller: mocks.activeSeller }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

import {
  checkSellerOfferGate,
  MARKETPLACE_NOT_OPEN_MESSAGE,
  SELLER_AGREEMENT_REQUIRED_MESSAGE,
  SELLER_GATE_UNAVAILABLE_MESSAGE,
  mapSellerGateError,
} from '@/lib/seller/offer-gate';
import { createOfferAction, moderateOfferAction, setOfferActiveAction } from '@/lib/admin/offer-actions';
import { sellerCreateOfferAction, sellerSetOfferActiveAction } from '@/lib/seller/actions';

const SELLER = 'bbbbbbbb-0000-4000-8000-000000000002';
const OFFER = 'cccccccc-0000-4000-8000-000000000003';
const PACK = 'dddddddd-0000-4000-8000-000000000004';
const PRODUCT = 'eeeeeeee-0000-4000-8000-000000000005';
const VERSION = legalDocumentByKey('seller-agreement')!.version;

type Gate = { marketplace_open?: unknown; agreement_current?: unknown; agreement_version?: unknown } | null;

function clientWith(gate: Gate | 'error' | 'throws') {
  const fixture = supabaseFixture({
    seller_offers: [{ id: OFFER, seller_id: SELLER, is_active: false, moderation_status: 'pending' }],
    product_packs: [{ id: PACK, product_id: PRODUCT, is_active: true }],
  });
  const calls: string[] = [];
  const rpc = async (name: string) => {
    calls.push(name);
    if (name === 'seller_offer_gate_status') {
      if (gate === 'throws') throw new Error('network');
      if (gate === 'error') return { data: null, error: { message: 'Could not find the function public.seller_offer_gate_status' } };
      return { data: gate, error: null };
    }
    // Compliance gates pass: only the launch gate is under test.
    return { data: true, error: null };
  };
  return { client: { ...fixture, rpc }, fixture, calls };
}
const writes = (fixture: ReturnType<typeof supabaseFixture>) => fixture.queries.filter((q) => q.operation !== 'select');

function offerForm(extra: Record<string, string> = {}) {
  const form = new FormData();
  for (const [key, value] of Object.entries({ packId: PACK, fulfilmentType: 'seller', unitPrice: '110', moq: '3', stockQuantity: '25', ...extra })) form.set(key, value);
  return form;
}

beforeEach(() => {
  vi.resetAllMocks();
  mocks.permission.mockResolvedValue({ id: 'admin', role: 'admin' });
  mocks.activeSeller.mockResolvedValue({ user: { id: SELLER, role: 'seller' }, seller: { id: SELLER, status: 'active' }, memberRole: 'owner' });
});

describe('checkSellerOfferGate fails closed', () => {
  const cases: [string, Gate | 'error' | 'throws', string][] = [
    ['gate function missing (0098 not installed)', 'error', SELLER_GATE_UNAVAILABLE_MESSAGE],
    ['network failure', 'throws', SELLER_GATE_UNAVAILABLE_MESSAGE],
    ['empty answer', null, SELLER_GATE_UNAVAILABLE_MESSAGE],
    ['marketplace switch off', { marketplace_open: false, agreement_current: true, agreement_version: VERSION }, MARKETPLACE_NOT_OPEN_MESSAGE],
    ['marketplace value is not strictly true', { marketplace_open: 'true', agreement_current: true, agreement_version: VERSION }, MARKETPLACE_NOT_OPEN_MESSAGE],
    ['agreement not accepted', { marketplace_open: true, agreement_current: false, agreement_version: VERSION }, SELLER_AGREEMENT_REQUIRED_MESSAGE],
    ['database enforces a different agreement version from this build', { marketplace_open: true, agreement_current: true, agreement_version: '0.9' }, SELLER_GATE_UNAVAILABLE_MESSAGE],
    ['no agreement version registered', { marketplace_open: true, agreement_current: true, agreement_version: null }, SELLER_GATE_UNAVAILABLE_MESSAGE],
  ];
  for (const [name, gate, message] of cases) {
    it(name, async () => {
      expect(await checkSellerOfferGate(clientWith(gate).client as never, SELLER)).toMatchObject({ open: false, error: message });
    });
  }
  it('opens only when the switch is on AND the current version is accepted', async () => {
    const { client, calls } = clientWith({ marketplace_open: true, agreement_current: true, agreement_version: VERSION });
    expect(await checkSellerOfferGate(client as never, SELLER)).toEqual({ open: true });
    expect(calls).toEqual(['seller_offer_gate_status']);
  });
  it('maps the database refusals to the same wording', () => {
    expect(mapSellerGateError('MARKETPLACE_NOT_OPEN: x')).toBe(MARKETPLACE_NOT_OPEN_MESSAGE);
    expect(mapSellerGateError('SELLER_AGREEMENT_REQUIRED: x')).toBe(SELLER_AGREEMENT_REQUIRED_MESSAGE);
    expect(mapSellerGateError('PRICE_BELOW_FLOOR')).toBeNull();
  });
  it('the messages claim no approval, registration or tax position', () => {
    for (const message of [MARKETPLACE_NOT_OPEN_MESSAGE, SELLER_AGREEMENT_REQUIRED_MESSAGE, SELLER_GATE_UNAVAILABLE_MESSAGE]) {
      expect(message).not.toMatch(/TCS|TDS|GSTIN|registered|approved by/i);
    }
  });
});

describe('every activate / publish path stops before writing when the gate is closed', () => {
  const closed: [string, Gate | 'error'][] = [
    ['marketplace off', { marketplace_open: false, agreement_current: true, agreement_version: VERSION }],
    ['agreement not accepted', { marketplace_open: true, agreement_current: false, agreement_version: VERSION }],
    ['gate unavailable', 'error'],
  ];
  for (const [name, gate] of closed) {
    it(`seller creates an offer - ${name}`, async () => {
      const { client, fixture } = clientWith(gate); mocks.client.mockReturnValue(client);
      expect(await sellerCreateOfferAction(offerForm())).toMatchObject({ ok: false });
      expect(writes(fixture)).toEqual([]);
    });
    it(`seller activates an offer - ${name}`, async () => {
      const { client, fixture } = clientWith(gate); mocks.client.mockReturnValue(client);
      expect(await sellerSetOfferActiveAction(OFFER, true)).toMatchObject({ ok: false });
      expect(writes(fixture)).toEqual([]);
    });
    it(`admin approves (publishes) an offer - ${name}`, async () => {
      const { client, fixture } = clientWith(gate); mocks.client.mockReturnValue(client);
      expect(await moderateOfferAction(OFFER, 'approved')).toMatchObject({ ok: false });
      expect(writes(fixture)).toEqual([]);
    });
    it(`admin activates an offer - ${name}`, async () => {
      const { client, fixture } = clientWith(gate); mocks.client.mockReturnValue(client);
      expect(await setOfferActiveAction(OFFER, true)).toMatchObject({ ok: false });
      expect(writes(fixture)).toEqual([]);
    });
    it(`admin creates an offer for a seller - ${name}`, async () => {
      const { client, fixture } = clientWith(gate); mocks.client.mockReturnValue(client);
      expect(await createOfferAction(offerForm({ sellerId: SELLER }))).toMatchObject({ ok: false });
      expect(writes(fixture)).toEqual([]);
    });
  }

  it('deactivating and rejecting are never blocked (the way out stays open)', async () => {
    for (const run of [
      () => sellerSetOfferActiveAction(OFFER, false),
      () => setOfferActiveAction(OFFER, false),
      () => moderateOfferAction(OFFER, 'rejected', 'not suitable'),
    ]) {
      const { client, fixture, calls } = clientWith('error'); mocks.client.mockReturnValue(client);
      expect(await run()).toEqual({ ok: true });
      expect(calls).not.toContain('seller_offer_gate_status');
      expect(writes(fixture)).toHaveLength(1);
    }
  });

  it('with the gate open the same paths write', async () => {
    const open = { marketplace_open: true, agreement_current: true, agreement_version: VERSION };
    for (const run of [
      () => sellerSetOfferActiveAction(OFFER, true),
      () => setOfferActiveAction(OFFER, true),
      () => moderateOfferAction(OFFER, 'approved'),
    ]) {
      const { client, fixture } = clientWith(open); mocks.client.mockReturnValue(client);
      expect(await run()).toEqual({ ok: true });
      expect(writes(fixture)).toHaveLength(1);
    }
  });
});
