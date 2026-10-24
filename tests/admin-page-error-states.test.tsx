/**
 * @vitest-environment jsdom
 *
 * Page-level error states — a failed Supabase read must never be rendered as
 * a legitimate empty list or a 404.
 *
 * These pages query with `.limit()/.range()` and destructured only `{ data }`,
 * so a schema drift (PostgREST 42703) or an RLS/network failure produced
 * "No orders yet" / "No sellers yet" / a 404 "banner deleted". The assertions
 * below pin the corrected behaviour, using the repo's existing fluent query
 * double (tests/helpers/supabase-fixture.ts) with per-table error injection.
 */
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';

const mocks = vi.hoisted(() => ({
  createClient: vi.fn(),
  requirePagePermission: vi.fn(),
  notFound: vi.fn(),
}));

vi.mock('@/lib/supabase/server', () => ({ createClient: mocks.createClient }));
vi.mock('@/lib/admin/guard', () => ({ requirePagePermission: mocks.requirePagePermission, requirePermission: mocks.requirePagePermission }));
vi.mock('next/navigation', () => ({
  notFound: mocks.notFound,
  redirect: vi.fn(),
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
  usePathname: () => '/',
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn() }));
// The create-banner form is a client component built on useFormState; it is
// irrelevant to the query/error rendering under test, so it is stubbed.
vi.mock('@/components/admin/banner-form', () => ({ BannerForm: () => null }));

import { supabaseFixture } from './helpers/supabase-fixture';
import BannersPage from '@/app/admin/banners/page';
import AdminOrdersPage from '@/app/admin/orders/page';
import SellersPage from '@/app/admin/sellers/page';
import EditBannerPage from '@/app/admin/banners/[id]/page';

const FAILURE = 'column banners.status does not exist';

const adminUser = { id: 'admin-1', email: null, fullName: 'Fixture Admin', role: 'admin' };

beforeEach(() => {
  vi.resetAllMocks();
  mocks.requirePagePermission.mockResolvedValue(adminUser);
  mocks.notFound.mockImplementation(() => {
    throw new Error('notFound');
  });
});

afterEach(cleanup);

describe('admin banners list', () => {
  it('reports a failed read instead of showing the empty state', async () => {
    mocks.createClient.mockReturnValue(supabaseFixture({ banners: [], areas: [] }, { banners: FAILURE }));
    render(await BannersPage());
    expect(screen.getByText('Banners could not be loaded')).toBeDefined();
    expect(screen.getByText(FAILURE)).toBeDefined();
    expect(screen.queryByText('No banners yet')).toBeNull();
  });

  it('still shows the real empty state when the read succeeds with no rows', async () => {
    mocks.createClient.mockReturnValue(supabaseFixture({ banners: [], areas: [] }));
    render(await BannersPage());
    expect(screen.getByText('No banners yet')).toBeDefined();
    expect(screen.queryByText('Banners could not be loaded')).toBeNull();
  });
});

describe('admin orders list', () => {
  it('reports a failed read instead of "No orders yet"', async () => {
    mocks.createClient.mockReturnValue(supabaseFixture({ orders: [] }, { orders: 'permission denied for table orders' }));
    render(await AdminOrdersPage({ searchParams: {} }));
    expect(screen.getByText('Orders could not be loaded')).toBeDefined();
    expect(screen.queryByText('No orders yet')).toBeNull();
  });

  it('keeps the real empty state for a working query', async () => {
    mocks.createClient.mockReturnValue(supabaseFixture({ orders: [] }));
    render(await AdminOrdersPage({ searchParams: {} }));
    expect(screen.getByText('No orders yet')).toBeDefined();
    expect(screen.queryByText('Orders could not be loaded')).toBeNull();
  });
});

describe('admin sellers directory', () => {
  it('reports a failed read instead of "No sellers yet"', async () => {
    mocks.createClient.mockReturnValue(supabaseFixture({ sellers: [] }, { sellers: 'timeout' }));
    render(await SellersPage({ searchParams: {} }));
    expect(screen.getByText('Sellers could not be loaded')).toBeDefined();
    expect(screen.queryByText('No sellers yet')).toBeNull();
  });

  it('keeps the real empty state for a working query', async () => {
    mocks.createClient.mockReturnValue(supabaseFixture({ sellers: [] }));
    render(await SellersPage({ searchParams: {} }));
    expect(screen.getByText('No sellers yet')).toBeDefined();
    expect(screen.queryByText('Sellers could not be loaded')).toBeNull();
  });
});

describe('admin banner detail', () => {
  it('surfaces a read failure instead of pretending the banner is gone', async () => {
    mocks.createClient.mockReturnValue(supabaseFixture({ banners: [], areas: [] }, { banners: FAILURE }));
    await expect(EditBannerPage({ params: { id: 'banner-1' } })).rejects.toThrow(/could not be loaded/);
    expect(mocks.notFound).not.toHaveBeenCalled();
  });

  it('still 404s when the read succeeds and the row is genuinely absent', async () => {
    mocks.createClient.mockReturnValue(supabaseFixture({ banners: [], areas: [] }));
    await expect(EditBannerPage({ params: { id: 'missing' } })).rejects.toThrow('notFound');
    expect(mocks.notFound).toHaveBeenCalled();
  });
});
