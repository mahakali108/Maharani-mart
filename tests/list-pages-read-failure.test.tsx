/**
 * @vitest-environment jsdom
 *
 * List pages must never render an empty state for a FAILED read.
 *
 * The detail-page variant of this defect (`notFound()` on a dropped error) is
 * covered by tests/detail-pages-read-failure.test.ts. This file covers the list
 * variant: `const { data } = await …` with no `error`, so a schema drift, an RLS
 * denial or a timeout rendered "No coupons yet" / "No return requests yet" /
 * "No offers to review" — a false statement about the operator's data, and in
 * the moderation case a queue that silently hides pending listings.
 *
 * Each case asserts BOTH directions: a failure shows the notice (and not the
 * empty state), and a working query with zero rows still shows the real empty
 * state.
 *
 * Retailer schemes / notifications / orders are NOT covered here: those files
 * belong to open PR #42 (orders also to #107). This branch reverted its edits to
 * them rather than conflict with their rewrites, and the exact patch for their
 * owner is in docs/HANDOFF_TO_PR_OWNERS.md. The second half matters — an "always show an error" regression would
 * pass a one-sided test.
 */
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';

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
import AdminCouponsPage from '@/app/admin/coupons/page';
import AdminReturnsPage from '@/app/admin/returns/page';
import AdminOffersPage from '@/app/admin/offers/page';
import AdminWalletsPage from '@/app/admin/wallets/page';
import AdminTargetsPage from '@/app/admin/targets/page';
import SalesmanTargetsPage from '@/app/salesman/targets/page';

const FAILURE = 'permission denied for table coupons';
const adminUser = { id: 'admin-1', email: null, fullName: 'Fixture Admin', role: 'admin' };
const retailerUser = { id: 'retailer-1', email: null, fullName: 'Fixture Retailer', role: 'retailer' };
const salesmanUser = { id: 'salesman-1', email: null, fullName: 'Fixture Salesman', role: 'salesman' };

beforeEach(() => {
  vi.resetAllMocks();
  mocks.requirePagePermission.mockResolvedValue(adminUser);
  mocks.requireUser.mockResolvedValue(retailerUser);
  mocks.notFound.mockImplementation(() => {
    throw new Error('notFound');
  });
});

afterEach(cleanup);

describe('admin coupons', () => {
  it('reports the read failure instead of "No coupons yet"', async () => {
    mocks.createClient.mockReturnValue(supabaseFixture({ coupons: [] }, { coupons: FAILURE }));
    render(await AdminCouponsPage());
    expect(screen.getByText('Coupons could not be loaded.')).toBeDefined();
    expect(screen.queryByText('No coupons yet')).toBeNull();
  });

  it('keeps the real empty state when the query works', async () => {
    mocks.createClient.mockReturnValue(supabaseFixture({ coupons: [] }));
    render(await AdminCouponsPage());
    expect(screen.getByText('No coupons yet')).toBeDefined();
    expect(screen.queryByText('Coupons could not be loaded.')).toBeNull();
  });
});

describe('admin returns', () => {
  it('reports the read failure instead of "No return requests yet"', async () => {
    mocks.createClient.mockReturnValue(
      supabaseFixture({ return_requests: [] }, { return_requests: 'timeout' })
    );
    render(await AdminReturnsPage());
    expect(screen.getByText('Return requests could not be loaded.')).toBeDefined();
    expect(screen.queryByText('No return requests yet')).toBeNull();
  });

  it('keeps the real empty state when the query works', async () => {
    mocks.createClient.mockReturnValue(supabaseFixture({ return_requests: [] }));
    render(await AdminReturnsPage());
    expect(screen.getByText('No return requests yet')).toBeDefined();
  });
});

describe('admin seller-offer moderation queue', () => {
  it('reports the read failure instead of claiming there is nothing to review', async () => {
    mocks.createClient.mockReturnValue(supabaseFixture({ seller_offers: [] }, { seller_offers: 'timeout' }));
    render(await AdminOffersPage({ searchParams: {} }));
    expect(screen.getByText('Seller offers could not be loaded.')).toBeDefined();
    expect(screen.queryByText('No offers to review')).toBeNull();
  });

  it('keeps the real empty state when the query works', async () => {
    mocks.createClient.mockReturnValue(supabaseFixture({ seller_offers: [] }));
    render(await AdminOffersPage({ searchParams: {} }));
    expect(screen.getByText('No offers to review')).toBeDefined();
  });
});

describe('admin wallets (credit)', () => {
  it('warns that balances are not authoritative when the retailer read fails', async () => {
    mocks.createClient.mockReturnValue(
      supabaseFixture({ retailers: [], retailer_credit_accounts: [] }, { retailers: 'timeout' })
    );
    render(await AdminWalletsPage({ searchParams: {} }));
    expect(screen.getByText('Retailer credit accounts could not be loaded.')).toBeDefined();
  });

  it('shows no warning for a working query', async () => {
    mocks.createClient.mockReturnValue(supabaseFixture({ retailers: [], retailer_credit_accounts: [] }));
    render(await AdminWalletsPage({ searchParams: {} }));
    expect(screen.queryByText('Retailer credit accounts could not be loaded.')).toBeNull();
  });
});

describe('admin targets', () => {
  it('reports the read failure instead of "No team members yet"', async () => {
    mocks.createClient.mockReturnValue(
      supabaseFixture({ profiles: [], staff_targets: [] }, { profiles: 'timeout' })
    );
    render(await AdminTargetsPage());
    expect(screen.getByText('Team members and targets could not be loaded.')).toBeDefined();
    expect(screen.queryByText('No team members yet')).toBeNull();
    expect(screen.queryByText('No targets set yet')).toBeNull();
  });

  it('keeps the real empty states when the query works', async () => {
    mocks.createClient.mockReturnValue(supabaseFixture({ profiles: [], staff_targets: [] }));
    render(await AdminTargetsPage());
    expect(screen.getByText('No team members yet')).toBeDefined();
    expect(screen.getByText('No targets set yet')).toBeDefined();
  });
});

describe('salesman targets', () => {
  it('reports the read failure instead of "No active targets"', async () => {
    mocks.requireUser.mockResolvedValue(salesmanUser);
    mocks.createClient.mockReturnValue(supabaseFixture({ staff_targets: [] }, { staff_targets: 'timeout' }));
    render(await SalesmanTargetsPage());
    expect(screen.getByText('Your targets could not be loaded.')).toBeDefined();
    expect(screen.queryByText('No active targets')).toBeNull();
  });

  it('keeps the real empty state when the query works', async () => {
    mocks.requireUser.mockResolvedValue(salesmanUser);
    mocks.createClient.mockReturnValue(supabaseFixture({ staff_targets: [] }));
    render(await SalesmanTargetsPage());
    expect(screen.getByText('No active targets')).toBeDefined();
  });
});
