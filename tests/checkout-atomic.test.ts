import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * CHECKOUT ATOMICITY — one cart, one order.
 *
 * `placeOrderAction` claims the cart by DELETE ... RETURNING: Postgres decides
 * which submission wins, so a double-tap, a retry or two concurrent tabs can
 * never turn one basket into two orders. When the order cannot be created the
 * claimed lines are put back, so the shop fixes the problem and retries with
 * one tap instead of rebuilding the cart.
 */

type Op = { table: string; op: 'select' | 'insert' | 'delete' | 'update'; filters: [string, unknown][]; payload?: unknown };

const state = {
  cartRows: [] as { pack_id: string; quantity: number }[],
  inserted: [] as Record<string, unknown>[],
  ops: [] as Op[],
  address: null as Record<string, unknown> | null,
  retailer: { address: 'Shop line, Khagaria' } as Record<string, unknown> | null,
};

function makeClient() {
  function from(table: string) {
    const op: Op = { table, op: 'select', filters: [] };
    let selected = false;
    const chain: Record<string, unknown> = {
      select: () => {
        if (op.op === 'delete') selected = true;
        return chain;
      },
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
        if (table === 'cart_items' && op.op === 'delete') {
          // The atomic claim: whoever calls first gets the rows.
          const claimed = state.cartRows;
          state.cartRows = [];
          return Promise.resolve({ data: selected ? claimed : null, error: null }).then(resolve);
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
vi.mock('@/lib/coupons/validate', () => ({ loadActiveCouponForRetailer: async () => ({ coupon: null }) }));
vi.mock('next/cache', () => ({ revalidatePath: () => undefined }));
const redirects: string[] = [];
vi.mock('next/navigation', () => ({
  // A real Next redirect throws to unwind the server action; the test records
  // the destination and treats the throw as success.
  redirect: (url: string) => {
    redirects.push(url);
    throw new Error('NEXT_REDIRECT');
  },
}));

async function place(notes = '', addressId?: string) {
  const { placeOrderAction } = await import('@/lib/retailer/checkout-actions');
  try {
    return await placeOrderAction(notes, addressId);
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
  state.inserted = [];
  state.ops = [];
  state.address = { label: 'Shop', receiver_name: 'Owner', phone: '90000', line1: 'A', line2: null, landmark: null, city: 'Khagaria', district: null, state: null, pincode: '851204' };
  state.retailer = { address: 'Shop line, Khagaria' };
  redirects.length = 0;
  mocks.createOrder.mockReset();
  mocks.createOrder.mockResolvedValue({
    order: { id: 'order-1', orderNumber: 'MK-1', grandTotal: 636, coinsUsed: 100, payableOnDelivery: 536 },
  });
});

describe('one cart, one order', () => {
  it('claims the cart with DELETE ... RETURNING and forwards no client money', async () => {
    const result = await place('Please deliver in the morning');

    expect(result).toEqual({ success: true });
    expect(redirects).toEqual(['/retailer/orders/order-1?placed=1']);
    const claim = state.ops.find((op) => op.table === 'cart_items' && op.op === 'delete');
    expect(claim).toBeTruthy();
    expect(claim!.filters).toContainEqual(['retailer_id', 'retailer-1']);

    // Only pack ids + quantities + notes/address reach the order service.
    expect(mocks.createOrder).toHaveBeenCalledTimes(1);
    const args = mocks.createOrder.mock.calls[0]![0] as Record<string, unknown>;
    expect(args.lines).toEqual([
      { packId: 'pack-1', quantity: 12 },
      { packId: 'pack-2', quantity: 6 },
    ]);
    expect(args.notes).toBe('Please deliver in the morning');
    expect(Object.keys(args).sort()).toEqual(['collectedBy', 'couponCode', 'lines', 'notes', 'retailerId', 'shippingAddress']);
  });

  it('lets exactly ONE of two concurrent submissions place the order', async () => {
    const [first, second] = await Promise.all([place(), place()]);
    const succeeded = [first, second].filter((result) => 'success' in result);
    const failed = [first, second].filter((result) => 'error' in result);

    expect(succeeded).toHaveLength(1);
    expect(failed).toHaveLength(1);
    expect((failed[0] as { error: string }).error).toMatch(/cart is empty/i);
    expect(mocks.createOrder).toHaveBeenCalledTimes(1);
    expect(redirects).toHaveLength(1);
  });

  it('restores the claimed cart when the order cannot be created', async () => {
    mocks.createOrder.mockResolvedValue({ error: 'Minimum order quantity for this pack is 24.' });

    const result = await place();

    expect(result).toEqual({ error: 'Minimum order quantity for this pack is 24.' });
    const restore = state.ops.filter((op) => op.table === 'cart_items' && op.op === 'insert');
    expect(restore).toHaveLength(1);
    expect(restore[0]!.payload).toEqual([
      { retailer_id: 'retailer-1', pack_id: 'pack-1', quantity: 12 },
      { retailer_id: 'retailer-1', pack_id: 'pack-2', quantity: 6 },
    ]);
    expect(state.cartRows).toEqual([]); // the fake returns the claim, not the re-insert
  });

  it('restores the cart and stops before ordering when the address is not the caller’s', async () => {
    state.address = null;

    const result = await place('', 'someone-elses-address');

    expect(result).toEqual({ error: 'The selected delivery address could not be found. Pick an address and try again.' });
    expect(mocks.createOrder).not.toHaveBeenCalled();
    expect(state.ops.some((op) => op.table === 'cart_items' && op.op === 'insert')).toBe(true);
    // The address lookup is owner-scoped, so a foreign id can never resolve.
    const lookup = state.ops.find((op) => op.table === 'retailer_addresses');
    expect(lookup!.filters).toContainEqual(['retailer_id', 'retailer-1']);
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
