import { beforeEach, describe, expect, it, vi } from 'vitest';
import RetailerLayout from '@/app/retailer/layout';
import { RETAILER, AREA } from './fixtures/retailer-home';
import { supabaseFixture } from './helpers/supabase-fixture';

const mocks = vi.hoisted(() => ({ context: vi.fn(), client: vi.fn(), redirect: vi.fn() }));
vi.mock('@/lib/retailer/shopping-context', () => ({ getRetailerShoppingContext: mocks.context }));
vi.mock('@/lib/supabase/server', () => ({ createClient: mocks.client }));
vi.mock('next/navigation', () => ({ redirect: mocks.redirect }));

const context = () => ({
  user: { id: RETAILER, role: 'retailer', fullName: 'Fixture owner', email: null },
  retailer: { area_id: AREA, shop_name: 'Fixture shop', address: null, status: 'active', areas: { name: 'Configured area', district: null } },
  areaName: 'Configured area', profileUnavailable: false,
});
beforeEach(() => {
  vi.resetAllMocks();
  mocks.context.mockResolvedValue(context());
  mocks.redirect.mockImplementation((path: string) => { throw new Error(`redirect:${path}`); });
});

describe('retailer layout defense-in-depth (mocked session)', () => {
  it('keeps active-retailer cart and notification reads owner-scoped', async () => {
    const db = supabaseFixture({ cart_items: [{ id: 'own', retailer_id: RETAILER }, { id: 'foreign', retailer_id: 'other' }], notifications: [] });
    mocks.client.mockReturnValue(db);
    const layout = await RetailerLayout({ children: 'content' });
    expect(layout.props.cartCount).toBe(1);
    expect(layout.props.fullName).toBe('Fixture owner');
    expect(layout.props.areaName).toBe('Configured area');
    expect(db.queries.find((query) => query.table === 'cart_items')?.filters).toContainEqual({ op: 'eq', column: 'retailer_id', value: RETAILER });
    expect(db.queries.find((query) => query.table === 'notifications')?.filters).toContainEqual({ op: 'eq', column: 'recipient_id', value: RETAILER });
  });
  it('redirects a non-retailer without reading shopping records', async () => {
    mocks.context.mockResolvedValue({ ...context(), user: { ...context().user, role: 'admin' } });
    await expect(RetailerLayout({ children: null })).rejects.toThrow('redirect:/unauthorized');
    expect(mocks.client).not.toHaveBeenCalled();
  });
  it.each([
    ['pending_approval', '/pending-approval'],
    ['suspended', '/login?error=account_suspended'],
  ])('blocks %s before querying the retailer cart', async (status, route) => {
    mocks.context.mockResolvedValue({ ...context(), retailer: { ...context().retailer, status } });
    await expect(RetailerLayout({ children: null })).rejects.toThrow(`redirect:${route}`);
    expect(mocks.client).not.toHaveBeenCalled();
  });
  it('does not invent an area or retailer name when profile fields are missing', async () => {
    mocks.context.mockResolvedValue({ ...context(), user: { ...context().user, fullName: '' }, retailer: null, areaName: null });
    mocks.client.mockReturnValue(supabaseFixture());
    const layout = await RetailerLayout({ children: null });
    expect(layout.props.fullName).toBe('');
    expect(layout.props.areaName).toBeNull();
  });
});
