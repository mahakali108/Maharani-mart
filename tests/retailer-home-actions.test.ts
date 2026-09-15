import { beforeEach, describe, expect, it, vi } from 'vitest';
import { addToCartAction } from '@/lib/retailer/cart-actions';
import { addReorderLinesToCartAction } from '@/lib/retailer/order-actions';
import { mergeLinesIntoCart } from '@/lib/retailer/cart-merge';
import { product, tiers, RETAILER, PACK, PRODUCT, ORDER } from './fixtures/retailer-home';
import { supabaseFixture } from './helpers/supabase-fixture';

const mocks = vi.hoisted(() => ({ client: vi.fn(), permission: vi.fn(), revalidate: vi.fn() }));
vi.mock('@/lib/supabase/server', () => ({ createClient: mocks.client, createServiceRoleClient: vi.fn() }));
vi.mock('@/lib/admin/guard', () => ({ requirePermission: mocks.permission }));
vi.mock('next/cache', () => ({ revalidatePath: mocks.revalidate }));
vi.mock('@/lib/notifications/notify', () => ({ createInAppNotification: vi.fn() }));
vi.mock('@/lib/orders/wallet-reversal', () => ({ reverseOrderWalletDebit: vi.fn() }));

function tables() {
  return {
    product_packs: [{ ...product.product_packs[0]!, product_id: PRODUCT, allow_loose_pieces: true, products: { is_active: true } }],
    product_pricing_tiers: tiers.map((tier) => ({ ...tier, product_pack_id: PACK })),
    orders: [{ id: ORDER, retailer_id: RETAILER }],
    order_items: [{ order_id: ORDER, pack_id: PACK }],
  };
}
beforeEach(() => {
  vi.resetAllMocks();
  mocks.permission.mockResolvedValue({ id: RETAILER, role: 'retailer', fullName: 'Fixture owner', email: null });
});

describe('existing cart action contract used by home (mocked Supabase)', () => {
  it('gets identity/permission from the server and refreshes the real layout count/summary', async () => {
    const db = supabaseFixture(tables()); mocks.client.mockReturnValue(db);
    expect(await addToCartAction(PACK, 6)).toEqual({ success: true });
    expect(mocks.permission).toHaveBeenCalledWith('orders.create');
    expect(db.tables.cart_items?.[0]).toMatchObject({ retailer_id: RETAILER, pack_id: PACK, quantity: 6 });
    expect(db.tables.cart_items?.[0]).not.toHaveProperty('price');
    expect(mocks.revalidate).toHaveBeenCalledWith('/retailer/cart');
    expect(mocks.revalidate).toHaveBeenCalledWith('/retailer', 'layout');
  });
  it.each([0, 1, 2.5, 100001])('rejects invalid/current-MOQ quantity %s before writing', async (quantity) => {
    const db = supabaseFixture(tables()); mocks.client.mockReturnValue(db);
    expect(await addToCartAction(PACK, quantity)).toHaveProperty('error');
    expect(db.queries.some((query) => query.operation === 'insert' || query.operation === 'update')).toBe(false);
    expect(mocks.revalidate).not.toHaveBeenCalled();
  });
  it('refuses an inactive pack and a pack without a selling price', async () => {
    const inactive = tables(); inactive.product_packs[0]!.is_active = false;
    mocks.client.mockReturnValue(supabaseFixture(inactive));
    expect(await addToCartAction(PACK, 6)).toMatchObject({ error: 'This pack is currently unavailable.' });
    const unpriced = { ...tables(), product_packs: [{ ...tables().product_packs[0]!, case_price: 0 }], product_pricing_tiers: [] };
    mocks.client.mockReturnValue(supabaseFixture(unpriced));
    expect(await addToCartAction(PACK, 6)).toHaveProperty('error');
  });
  it('returns a usable error for a failed price read without writing', async () => {
    const db = supabaseFixture(tables(), { product_pricing_tiers: 'offline' }); mocks.client.mockReturnValue(db);
    expect(await addToCartAction(PACK, 6)).toEqual({ error: 'Current pricing could not be verified. Please try again.' });
    expect(db.tables.cart_items).toBeUndefined();
  });
  it('rejects a non-finite selling price without writing', async () => {
    const invalid = tables(); invalid.product_pricing_tiers[0]!.price_per_piece = Number.NaN;
    const db = supabaseFixture(invalid); mocks.client.mockReturnValue(db);
    expect(await addToCartAction(PACK, 6)).toHaveProperty('error');
    expect(db.tables.cart_items).toBeUndefined();
  });
  it('does not falsely report success when the cart write is rejected', async () => {
    const db = supabaseFixture(tables(), { 'cart_items:insert': 'RLS denied' }); mocks.client.mockReturnValue(db);
    expect(await addToCartAction(PACK, 6)).toHaveProperty('error');
    expect(mocks.revalidate).not.toHaveBeenCalled();
  });
  it('rejects a denied permission before any query or mutation', async () => {
    mocks.permission.mockRejectedValue(new Error('Permission denied'));
    await expect(addToCartAction(PACK, 6)).rejects.toThrow('Permission denied');
    expect(mocks.client).not.toHaveBeenCalled();
  });
  it('bounds combined quantities and owner-scopes the existing-line update', async () => {
    const db = supabaseFixture({ cart_items: [{ id: 'line', retailer_id: RETAILER, pack_id: PACK, quantity: 99999 }] });
    await expect(mergeLinesIntoCart(db as never, RETAILER, [{ packId: PACK, quantity: 6 }])).rejects.toThrow('combined quantity');
    expect(db.tables.cart_items?.[0]?.quantity).toBe(99999);
    await mergeLinesIntoCart(db as never, RETAILER, [{ packId: PACK, quantity: 1 }]);
    expect(db.queries.find((query) => query.operation === 'update')?.filters).toContainEqual({ op: 'eq', column: 'retailer_id', value: RETAILER });
  });
});

describe('reorder keeps ownership and current server validation', () => {
  it('revalidates the exact original pack at today’s MOQ/price and refreshes the layout', async () => {
    const db = supabaseFixture(tables()); mocks.client.mockReturnValue(db);
    expect(await addReorderLinesToCartAction(ORDER, [{ packId: PACK, quantity: 12 }])).toEqual({ success: true, skippedCount: 0 });
    expect(db.queries.some((query) => query.table === 'product_pricing_tiers')).toBe(true);
    expect(db.tables.cart_items?.[0]).toMatchObject({ retailer_id: RETAILER, pack_id: PACK, quantity: 12 });
    expect(mocks.revalidate).toHaveBeenCalledWith('/retailer', 'layout');
  });
  it('cannot reorder another retailer’s order', async () => {
    const db = supabaseFixture({ ...tables(), orders: [{ id: ORDER, retailer_id: 'someone-else' }] }); mocks.client.mockReturnValue(db);
    expect(await addReorderLinesToCartAction(ORDER, [{ packId: PACK, quantity: 12 }])).toMatchObject({ error: 'Order not found.' });
    expect(db.tables.cart_items).toBeUndefined();
  });
  it('cannot inject a pack that did not occur in the source order', async () => {
    const db = supabaseFixture(tables()); mocks.client.mockReturnValue(db);
    expect(await addReorderLinesToCartAction(ORDER, [{ packId: 'injected', quantity: 12 }])).toHaveProperty('error');
    expect(db.tables.cart_items).toBeUndefined();
  });
  it('rejects a stale quantity below the current MOQ and an unpriced reorder', async () => {
    const changed = tables(); changed.product_packs[0]!.moq = 24;
    mocks.client.mockReturnValue(supabaseFixture(changed));
    expect(await addReorderLinesToCartAction(ORDER, [{ packId: PACK, quantity: 12 }])).toHaveProperty('error');
    const unpriced = { ...tables(), product_packs: [{ ...tables().product_packs[0]!, case_price: 0 }], product_pricing_tiers: [] };
    const db = supabaseFixture(unpriced); mocks.client.mockReturnValue(db);
    expect(await addReorderLinesToCartAction(ORDER, [{ packId: PACK, quantity: 12 }])).toHaveProperty('error');
    expect(db.tables.cart_items).toBeUndefined();
  });
  it('refuses non-retailer callers even if they can create orders elsewhere', async () => {
    mocks.permission.mockResolvedValue({ id: 'admin', role: 'admin' });
    expect(await addReorderLinesToCartAction(ORDER, [{ packId: PACK, quantity: 12 }])).toHaveProperty('error');
    expect(mocks.client).not.toHaveBeenCalled();
  });
});
