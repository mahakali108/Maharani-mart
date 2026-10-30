import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const mocks = vi.hoisted(() => ({
  isOrderingReady: vi.fn(),
  createClient: vi.fn(),
  createServiceRoleClient: vi.fn(),
  quoteOrderForRetailer: vi.fn(),
  resolveActiveWarehouse: vi.fn(),
  checkDeliveryTerms: vi.fn(),
}));

vi.mock('@/lib/compliance/ordering-readiness', () => ({
  isOrderingReady: mocks.isOrderingReady,
  ORDERING_NOT_ENABLED_MESSAGE: 'Ordering is not enabled because mandatory business compliance configuration is incomplete.',
}));
vi.mock('@/lib/supabase/server', () => ({
  createClient: mocks.createClient,
  createServiceRoleClient: mocks.createServiceRoleClient,
}));
vi.mock('@/lib/orders/quote-order', () => ({ quoteOrderForRetailer: mocks.quoteOrderForRetailer }));
vi.mock('@/lib/warehouse/resolver', () => ({ resolveActiveWarehouse: mocks.resolveActiveWarehouse }));
vi.mock('@/lib/config/delivery-serviceability', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/config/delivery-serviceability')>()),
  checkDeliveryTerms: mocks.checkDeliveryTerms,
}));

import { createOrderForRetailer } from '@/lib/orders/create-order';

const input = {
  retailerId: '22222222-2222-4222-8222-222222222222',
  collectedBy: null,
  lines: [{ packId: '55555555-5555-4555-8555-555555555555', quantity: 6 }],
  notes: '',
  requestKey: '11111111-1111-4111-8111-111111111111',
  // Deliberately untyped, attacker-controlled data. The service API has no
  // readiness field and the server guard must ignore any client claim.
  orderingReadiness: { allApproved: true },
};

describe('central order launch gate', () => {
  it('blocks a claimed client approval before any order, stock, Coins, cart, payment, quote, or delivery work', async () => {
    mocks.isOrderingReady.mockResolvedValue(false);
    const callerClient = { from: vi.fn() };

    const result = await createOrderForRetailer({ ...input, supabase: callerClient as never } as never);

    expect(result).toEqual({
      error: 'Ordering is not enabled because mandatory business compliance configuration is incomplete.',
      code: 'ordering_not_enabled',
    });
    expect(mocks.isOrderingReady).toHaveBeenCalledTimes(1);
    expect(callerClient.from).not.toHaveBeenCalled();
    expect(mocks.createClient).not.toHaveBeenCalled();
    expect(mocks.createServiceRoleClient).not.toHaveBeenCalled();
    expect(mocks.checkDeliveryTerms).not.toHaveBeenCalled();
    expect(mocks.quoteOrderForRetailer).not.toHaveBeenCalled();
    expect(mocks.resolveActiveWarehouse).not.toHaveBeenCalled();
  });

  it('keeps all traced order-entry paths behind the same guarded server service', () => {
    const root = join(__dirname, '..');
    const read = (path: string) => readFileSync(join(root, path), 'utf8');
    const central = read('lib/orders/create-order.ts');

    const guard = central.indexOf('isOrderingReady()');
    expect(guard).toBeGreaterThan(-1);
    expect(guard).toBeLessThan(central.indexOf('const previous = await findOrderRequest('));
    expect(guard).toBeLessThan(central.indexOf('const quoted = await quoteOrderForRetailer('));
    expect(guard).toBeLessThan(central.indexOf('const warehouse = await resolveActiveWarehouse('));
    expect(guard).toBeLessThan(central.indexOf('writer.rpc('));

    for (const path of [
      'lib/retailer/checkout-actions.ts',
      'app/api/mobile/v1/orders/route.ts',
      'lib/salesman/order-creation-actions.ts',
    ]) {
      expect(read(path)).toContain('createOrderForRetailer');
    }
  });
});
