/**
 * @vitest-environment jsdom
 *
 * Paginated work queues must fail loudly, not render an empty queue.
 *
 * These pages load their first batch through a helper (`loadQueueBatch`,
 * `loadStockBatch`, `loadCollectionBatch`, …) that used to destructure only
 * `{ data }` from the keyset query. A failed read therefore rendered the normal
 * empty state — "Nothing to dispatch", "No inventory recorded yet", "No
 * collections recorded yet", "No orders yet" — which is a *factual claim about
 * operational data* that was never read. With a dispatch queue that is actively
 * misleading: the packer is told there is nothing to do.
 *
 * The corrected contract (mirroring lib/delivery/queries.ts#fetchDeliveryDetail)
 * is to throw with the PostgREST code so app/error.tsx / app/retailer/error.tsx
 * renders a retryable failure.
 *
 * `app/retailer/orders`, `app/retailer/support` and `app/retailer/notifications`
 * are fixed in this branch but not asserted here: #42's rewrite makes them
 * conflict-prone, so the retailer-order case was removed along with the edit.
 * See docs/HANDOFF_TO_PR_OWNERS.md. tests/list-pages-read-failure.test.tsx covers the
 * pages that render a `ReadFailureNotice` instead of throwing.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup } from '@testing-library/react';

const mocks = vi.hoisted(() => ({
  createClient: vi.fn(),
  requirePagePermission: vi.fn(),
  requireUser: vi.fn(),
  redirect: vi.fn(),
  notFound: vi.fn(),
}));

vi.mock('@/lib/supabase/server', () => ({ createClient: mocks.createClient }));
vi.mock('@/lib/admin/guard', () => ({
  requirePagePermission: mocks.requirePagePermission,
  requirePermission: mocks.requirePagePermission,
}));
vi.mock('@/lib/auth/session', () => ({ requireUser: mocks.requireUser }));
vi.mock('next/navigation', () => ({
  redirect: mocks.redirect,
  notFound: mocks.notFound,
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
  usePathname: () => '/',
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn() }));

import { supabaseFixture } from './helpers/supabase-fixture';
import StaffOrdersPage from '@/app/staff/orders/page';
import StaffInventoryPage from '@/app/staff/inventory/page';
import SalesmanCollectionsPage from '@/app/salesman/collections/page';
import AdminDeliveredPage from '@/app/admin/delivered/page';

const staffUser = { id: 'staff-1', email: null, fullName: 'Fixture Staff', role: 'staff' };
const salesmanUser = { id: 'salesman-1', email: null, fullName: 'Fixture Salesman', role: 'salesman' };
const retailerUser = { id: 'retailer-1', email: null, fullName: 'Fixture Retailer', role: 'retailer' };

beforeEach(() => {
  vi.resetAllMocks();
  mocks.requirePagePermission.mockResolvedValue(staffUser);
  mocks.requireUser.mockResolvedValue(retailerUser);
});

afterEach(cleanup);

describe('staff dispatch queue', () => {
  it('throws with the PostgREST code instead of showing "Nothing to dispatch"', async () => {
    mocks.createClient.mockReturnValue(supabaseFixture({ orders: [] }, { orders: 'permission denied for table orders' }));
    await expect(StaffOrdersPage()).rejects.toThrow(/Dispatch queue could not be loaded/);
  });
});

describe('staff inventory', () => {
  it('throws instead of showing "No inventory recorded yet"', async () => {
    mocks.createClient.mockReturnValue(
      supabaseFixture({ inventory_stock: [], products: [] }, { inventory_stock: 'timeout' })
    );
    await expect(StaffInventoryPage()).rejects.toThrow(/Stock levels could not be loaded/);
  });
});

describe('salesman collections', () => {
  it('throws instead of showing "No collections recorded yet"', async () => {
    mocks.requirePagePermission.mockResolvedValue(salesmanUser);
    mocks.createClient.mockReturnValue(
      supabaseFixture({ payment_collections: [], retailers: [] }, { payment_collections: 'timeout' })
    );
    await expect(SalesmanCollectionsPage()).rejects.toThrow(/Collections could not be loaded/);
  });
});

describe('admin delivered report', () => {
  it('throws instead of showing "No completed deliveries yet"', async () => {
    mocks.createClient.mockReturnValue(
      supabaseFixture({ order_deliveries: [], profiles: [] }, { order_deliveries: 'timeout' })
    );
    await expect(AdminDeliveredPage({ searchParams: Promise.resolve({}) })).rejects.toThrow(/Deliveries could not be loaded/);
  });
});
