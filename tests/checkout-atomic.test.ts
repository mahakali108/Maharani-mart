import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Checkout delegates the exact-cart comparison and clearing to one database
 * transaction. The web action only reads the basket; a failed or uncertain RPC
 * must never try to restore rows beside an order that might have committed.
 */

type Op = { table: string; op: 'select' | 'insert' | 'delete' | 'update'; filters: [string, unknown][]; payload?: unknown };

const state = {
  cartRows: [] as { pack_id: string; quantity: number }[],
  ops: [] as Op[],
  address: null as Record<string, unknown> | null,
  retailer: { address: 'Shop line, Khagaria' } as Record<string, unknown> | null,
  orderCommitted: false,
};

function makeClient() {
  function from(table: string) {
    const op: Op = { table, op: 'select', filters: [] };
    const chain: Record<string, unknown> = {
      select: () => chain,
      eq: (column: string, value: unknown) => {
        op.filters.push([column, value]);
        return chain;
      },
      delete: () => {
        op.op = 'delete';
        return chain;
      },
      insert: (payload: unknown) => {
        op.op = 'insert';
        op.payload = payload;
        state.ops.push(op);
        return Promise.resolve({ data: null, error: null });
      },
      maybeSingle: async () => {
        state.ops.push(op);
        if (table === 'retailer_addresses') return { data: state.address, error: null };
        return { data: state.retailer, error: null };
      },
      then: (resolve: (value: { data: unknown; error: null }) => unknown) => {
        state.ops.push(op);
        if (table === 'cart_items' && op.op === 'select') {
          return Promise.resolve({ data: [...state.cartRows], error: null }).then(resolve);
        }
        return Promise.resolve({ data: null, error: null }).then(resolve);
      },
    };
    return chain;
  }
  return { from } as never;
}

const mocks = vi.hoisted(() => ({
  createOrder: vi.fn(),
  user: { id: 'retailer-1', role: 'retailer', fullName: 'Shop', phone: null } as Record<string, unknown>,
}));

vi.mock('@/lib/supabase/server', () => ({ createClient: () => makeClient() }));
vi.mock('@/lib/admin/guard', () => ({
  requirePermission: async () => mocks.user,
}));
vi.mock('@/lib/orders/create-order', () => ({
  createOrderForRetailer: (...args: unknown[]) => mocks.createOrder(...args),
}));
vi.mock('@/lib/notifications/notify', () => ({ createInAppNotification: async () => undefined }));
vi.mock('@/lib/coupons/validate', () => ({ loadActiveCouponForRetailer: async () => ({ coupon: null, error: false }) }));
vi.mock('next/cache', () => ({ revalidatePath: () => undefined }));
const redirects: string[] = [];
vi.mock('next/navigation', () => ({
  redirect: (url: string) => {
    redirects.push(url);
    throw new Error('NEXT_REDIRECT');
  },
}));

async function place(notes = '', addressId?: string) {
  const { placeOrderAction } = await import('@/lib/retailer/checkout-actions');
  try {
    return await placeOrderAction(notes, addressId === undefined ? 'owned-address' : addressId);
  } catch (cause) {
    if (cause instanceof Error && cause.message === 'NEXT_REDIRECT') return { success: true as const };
    throw cause;
  }
}

beforeEach(() => {
  state.cartRows = [
    { pack_id: 'pack-1', quantity: 12 },
    { pack_id: 'pack-2', quantity: 6 },
  ];
  state.ops = [];
  state.address = { label: 'Shop', receiver_name: 'Owner', phone: '90000', line1: 'A', line2: null, landmark: null, city: 'Gaya', district: 'Gaya', state: 'Bihar', pincode: '823001' };
  state.retailer = { address: 'Shop line, Khagaria' };
  state.orderCommitted = false;
  redirects.length = 0;
  mocks.createOrder.mockReset();
  mocks.createOrder.mockResolvedValue({
    order: { id: 'order-1', orderNumber: 'MK-1', grandTotal: 636, coinsUsed: 100, payableOnDelivery: 536 },
  });
});

describe('one cart, one order', () => {
  it('reads the saved basket and asks the atomic writer to clear it only with a confirmed order', async () => {
    const result = await place('Please deliver in the morning');

    expect(result).toEqual({ success: true });
    expect(redirects).toEqual(['/retailer/orders/order-1?placed=1']);
    const cartRead = state.ops.find((op) => op.table === 'cart_items' && op.op === 'select');
    expect(cartRead?.filters).toContainEqual(['retailer_id', 'retailer-1']);
    expect(state.ops.some((op) => op.table === 'cart_items' && op.op === 'delete')).toBe(false);

    expect(mocks.createOrder).toHaveBeenCalledTimes(1);
    const args = mocks.createOrder.mock.calls[0]![0] as Record<string, unknown>;
    expect(args.lines).toEqual([
      { packId: 'pack-1', quantity: 12 },
      { packId: 'pack-2', quantity: 6 },
    ]);
    expect(args.notes).toBe('Please deliver in the morning');
    expect(args.clearCartAfterOrder).toBe(true);
    expect(Object.keys(args).sort()).toEqual([
      'clearCartAfterOrder', 'collectedBy', 'couponCode', 'lines', 'notes', 'retailerId', 'shippingAddress',
    ]);
  });

  it('lets the atomic writer arbitrate overlapping cart reads without creating two orders', async () => {
    let committed = false;
    mocks.createOrder.mockImplementation(async () => {
      if (committed) return { error: 'Your cart changed after it was reviewed.', code: 'conflict' };
      committed = true;
      state.orderCommitted = true;
      state.cartRows = [];
      return {
        order: {
          id: 'order-1', orderNumber: 'MK-1', status: 'pending',
          placedAt: '2026-10-03T10:00:00.000Z', grandTotal: 636,
          coinsUsed: 100, payableOnDelivery: 536, coinsBalanceAfterPaise: 0,
          idempotentReplay: false,
        },
      };
    });

    const [first, second] = await Promise.all([place(), place()]);
    const outcomes = [first, second];
    expect(outcomes.filter((result) => 'success' in result)).toHaveLength(1);
    expect(outcomes.filter((result) => 'error' in result)).toHaveLength(1);
    expect((outcomes.find((result) => 'error' in result) as { error: string }).error)
      .toMatch(/cart changed/i);
    expect(state.orderCommitted).toBe(true);
    expect(state.cartRows).toEqual([]);
    expect(mocks.createOrder).toHaveBeenCalledTimes(2);
    expect(redirects).toHaveLength(1);
    expect(state.ops.filter((op) => op.table === 'cart_items' && op.op === 'select')).toHaveLength(2);
    expect(state.ops.some((op) => op.table === 'cart_items' && (op.op === 'insert' || op.op === 'delete'))).toBe(false);
  });

  it('does not expose money inputs to the order service', async () => {
    await place();
    const args = mocks.createOrder.mock.calls[0]![0] as Record<string, unknown>;
    expect(args).not.toHaveProperty('subtotal');
    expect(args).not.toHaveProperty('grandTotal');
    expect(args).not.toHaveProperty('gst');
    expect(args).not.toHaveProperty('stock');
  });

  it('does not clear or restore the cart when order creation fails', async () => {
    mocks.createOrder.mockResolvedValue({ error: 'Minimum order quantity for this pack is 24.' });

    const result = await place();

    expect(result).toEqual({ error: 'Minimum order quantity for this pack is 24.' });
    expect(state.cartRows).toHaveLength(2);
    expect(state.ops.some((op) => op.table === 'cart_items' && op.op === 'insert')).toBe(false);
    expect(state.ops.some((op) => op.table === 'cart_items' && op.op === 'delete')).toBe(false);
  });

  it('does not restore rows after an uncertain result that may have committed', async () => {
    mocks.createOrder.mockImplementation(async () => {
      // Simulate the database commit succeeding before the response is lost.
      state.orderCommitted = true;
      state.cartRows = [];
      return { error: 'The order could not be confirmed. Check your order history before trying again.' };
    });

    const result = await place();

    expect(result).toHaveProperty('error');
    expect(state.orderCommitted).toBe(true);
    expect(state.cartRows).toEqual([]);
    expect(state.ops.some((op) => op.table === 'cart_items' && op.op === 'insert')).toBe(false);
  });

  it('stops before ordering when the address is not owned by the caller and preserves their cart', async () => {
    state.address = null;

    const result = await place('', 'someone-elses-address');

    expect(result).toEqual({ error: 'The selected delivery address could not be found. Pick an address and try again.' });
    expect(mocks.createOrder).not.toHaveBeenCalled();
    expect(state.cartRows).toHaveLength(2);
    const lookup = state.ops.find((op) => op.table === 'retailer_addresses');
    expect(lookup!.filters).toContainEqual(['retailer_id', 'retailer-1']);
  });

  it('does not place an order from unstructured registered-shop text', async () => {
    const { placeOrderAction } = await import('@/lib/retailer/checkout-actions');
    const result = await placeOrderAction('', undefined);
    expect(result).toHaveProperty('error');
    expect((result as { error: string }).error).toMatch(/saved delivery address/i);
    expect(mocks.createOrder).not.toHaveBeenCalled();
  });

  it('refuses an empty cart instead of creating a zero-line order', async () => {
    state.cartRows = [];
    const result = await place();
    expect(result).toEqual({ error: 'Your cart is empty — add products before placing an order.' });
    expect(mocks.createOrder).not.toHaveBeenCalled();
  });

  it('only a retailer may check out', async () => {
    redirects.length = 0;
    mocks.user = { id: 'staff-1', role: 'staff' };
    const result = await place();
    expect(result).toEqual({ error: 'Only a retailer can check out this cart.' });
    expect(mocks.createOrder).not.toHaveBeenCalled();
    mocks.user = { id: 'retailer-1', role: 'retailer' };
  });
});
