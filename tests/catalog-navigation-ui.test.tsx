// @vitest-environment jsdom
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import CategoryDetailPage from '@/app/retailer/categories/[id]/page';
import CategoriesPage from '@/app/retailer/categories/page';
import BrandsPage from '@/app/retailer/brands/page';
import CatalogPage from '@/app/retailer/catalog/page';
import { BrowseTabs } from '@/components/retailer/browse-tabs';
import { supabaseFixture } from './helpers/supabase-fixture';

const RETAILER = '99999999-9999-4999-8999-999999999999';
const PERSONAL_CARE = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const FACE_WASH = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const MAKE_UP = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const PONDS = '11111111-1111-4111-8111-111111111111';
const PATANJALI = '22222222-2222-4222-8222-222222222222';

const USER = { id: RETAILER, email: 'retailer@example.com', fullName: 'Rita', role: 'retailer' as const };

const mocks = vi.hoisted(() => ({ fixture: null as unknown }));

vi.mock('next/link', () => ({
  default: ({ href, children, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement>) =>
    React.createElement('a', { href, ...props }, children),
}));
vi.mock('next/image', () => ({
  default: ({ src, alt }: { src?: string; alt?: string }) => React.createElement('img', { src: src ?? '', alt }),
}));
vi.mock('next/navigation', () => ({
  usePathname: () => '/retailer/catalog',
  useRouter: () => ({ push: () => {}, replace: () => {}, back: () => {}, refresh: () => {} }),
}));
vi.mock('@/lib/supabase/server', () => ({ createClient: () => mocks.fixture }));
vi.mock('@/lib/auth/session', () => ({ requireUser: async () => USER }));
vi.mock('@/lib/retailer/search-actions', () => ({
  searchSuggestionsAction: async () => ({ products: [], brands: [], categories: [] }),
}));

function productRow(id: string, name: string, categoryId: string, brandId: string, brandName: string) {
  return {
    id,
    name,
    category_id: categoryId,
    brand_id: brandId,
    gst_percent: 5,
    is_new_launch: false,
    is_active: true,
    created_at: '2026-01-01T00:00:00Z',
    brands: { id: brandId, name: brandName },
    product_images: [],
    product_packs: [
      {
        id: `pack-${id}`, pack_name: '100 g', ptr: null, base_price: 1000, case_price: 1000,
        units_per_case: 80, mrp: 40, moq: 1, image_url: null, is_active: true, sort_order: 0,
      },
    ],
  };
}

function linksOnScreen() {
  return screen.getAllByRole('link').map((anchor) => ({
    name: anchor.textContent ?? '',
    href: anchor.getAttribute('href'),
  }));
}

beforeEach(() => {
  mocks.fixture = null;
});
afterEach(() => {
  cleanup();
});

describe('category detail — a category-only page', () => {
  it('shows banner, product count, subcategories and View all products — and no brand list', async () => {
    const fixture = supabaseFixture({
      categories: [
        { id: PERSONAL_CARE, name: 'Personal Care', image_url: null, parent_id: null, is_active: true, products: [{ id: 'p1' }, { id: 'p2' }] },
        { id: FACE_WASH, name: 'Face Wash', image_url: null, parent_id: PERSONAL_CARE, is_active: true, products: [{ id: 'p3' }] },
      ],
      brands: [
        { id: PONDS, name: 'Ponds', logo_url: null, is_active: true, products: [{ id: 'p1', category_id: PERSONAL_CARE }] },
      ],
    });
    mocks.fixture = fixture;

    render(<>{await CategoryDetailPage({ params: { id: PERSONAL_CARE } } as never)}</>);

    expect(screen.getByRole('heading', { name: 'Personal Care' })).toBeTruthy();
    expect(screen.getByText('3 products across this aisle')).toBeTruthy();
    expect(screen.getByRole('link', { name: /face wash/i }).getAttribute('href')).toBe(`/retailer/categories/${FACE_WASH}`);
    expect(screen.getByRole('link', { name: /view all products/i }).getAttribute('href')).toBe(
      `/retailer/catalog?category=${PERSONAL_CARE}`
    );

    // "Brands in Personal Care" must not exist on the category detail page.
    expect(screen.queryByText(/brands in/i)).toBeNull();
    expect(screen.queryByRole('link', { name: /ponds/i })).toBeNull();
    // The brand list is gone entirely: no /retailer/brands links are rendered.
    expect(linksOnScreen().filter((link) => link.href?.startsWith('/retailer/brands'))).toEqual([]);
  });

  it('never issues a brands query for a category (independent dimensions)', async () => {
    const fixture = supabaseFixture({
      categories: [
        { id: PERSONAL_CARE, name: 'Personal Care', image_url: null, parent_id: null, is_active: true, products: [{ id: 'p1' }] },
      ],
      brands: [
        { id: PONDS, name: 'Ponds', logo_url: null, is_active: true, products: [{ id: 'p1', category_id: PERSONAL_CARE }] },
      ],
    });
    mocks.fixture = fixture;

    render(<>{await CategoryDetailPage({ params: { id: PERSONAL_CARE } } as never)}</>);

    expect(screen.getByRole('heading', { name: 'Personal Care' })).toBeTruthy();
    expect(fixture.queries.filter((query) => query.table === 'brands')).toEqual([]);
  });
});

describe('categories page — independent category directory', () => {
  it('lists categories linking to /retailer/categories/[id] and offers the Brands tab', async () => {
    const fixture = supabaseFixture({
      categories: [
        { id: PERSONAL_CARE, name: 'Personal Care', image_url: null, parent_id: null, is_active: true, products: [{ count: 5 }] },
        { id: FACE_WASH, name: 'Face Wash', image_url: null, parent_id: PERSONAL_CARE, is_active: true, products: [{ count: 2 }] },
        { id: MAKE_UP, name: 'Make Up', image_url: null, parent_id: null, is_active: true, products: [{ count: 7 }] },
      ],
    });
    mocks.fixture = fixture;

    render(<>{await CategoriesPage()}</>);

    const links = linksOnScreen();
    expect(links).toContainEqual({ name: expect.stringContaining('Personal Care'), href: `/retailer/categories/${PERSONAL_CARE}` });
    expect(links).toContainEqual({ name: expect.stringContaining('Make Up'), href: `/retailer/categories/${MAKE_UP}` });

    // The two independent entry points sit side by side; Categories is active here.
    const brandsTab = screen.getAllByRole('link').find((link) => link.getAttribute('href') === '/retailer/brands');
    expect(brandsTab).toBeTruthy();
    const categoriesTab = screen.getAllByRole('link').find((link) => link.getAttribute('href') === '/retailer/categories');
    expect(categoriesTab).toBeTruthy();
    expect(categoriesTab?.getAttribute('aria-current')).toBe('page');
    expect(brandsTab?.getAttribute('aria-current')).toBeNull();

    // No brand detail links inside the category directory.
    expect(links.filter((link) => link.href?.startsWith('/retailer/brands/'))).toEqual([]);
  });
});

describe('brands page — independent brand directory', () => {
  it('lets a brand be opened directly without entering through a category', async () => {
    const fixture = supabaseFixture({
      categories: [
        { id: PERSONAL_CARE, name: 'Personal Care', parent_id: null, is_active: true },
      ],
      brands: [
        { id: PONDS, name: 'Ponds', logo_url: null, is_active: true, products: [{ id: 'p1', category_id: PERSONAL_CARE }] },
        { id: PATANJALI, name: 'Patanjali', logo_url: null, is_active: true, products: [{ id: 'p2', category_id: PERSONAL_CARE }] },
      ],
    });
    mocks.fixture = fixture;

    render(<>{await BrandsPage({ searchParams: {} } as never)}</>);

    const links = linksOnScreen();
    // Ponds is reachable at /retailer/brands/<id> — no category in the path.
    expect(links).toContainEqual({ name: expect.stringContaining('Ponds'), href: `/retailer/brands/${PONDS}` });
    expect(links).toContainEqual({ name: expect.stringContaining('Patanjali'), href: `/retailer/brands/${PATANJALI}` });

    // The two independent entry points sit side by side; Brands is active here.
    const brandsTab = screen.getAllByRole('link').find((link) => link.getAttribute('href') === '/retailer/brands');
    const categoriesTab = screen.getAllByRole('link').find((link) => link.getAttribute('href') === '/retailer/categories');
    expect(brandsTab).toBeTruthy();
    expect(categoriesTab).toBeTruthy();
    expect(brandsTab?.getAttribute('aria-current')).toBe('page');
    expect(categoriesTab?.getAttribute('aria-current')).toBeNull();
  });
});

describe('catalog page — separate Categories and Brands entry points', () => {
  it('renders independent Categories and Brands entry points plus brand chips', async () => {
    const fixture = supabaseFixture({
      retailers: [{ id: RETAILER, area_id: null }],
      categories: [
        { id: PERSONAL_CARE, name: 'Personal Care', image_url: null, parent_id: null, is_active: true, sort_order: 1 },
        { id: MAKE_UP, name: 'Make Up', image_url: null, parent_id: null, is_active: true, sort_order: 2 },
      ],
      brands: [
        { id: PONDS, name: 'Ponds', is_active: true },
        { id: PATANJALI, name: 'Patanjali', is_active: true },
      ],
      products: [
        productRow('prod-1', 'Ponds Face Wash', PERSONAL_CARE, PONDS, 'Ponds'),
        productRow('prod-2', 'Patanjali Chyawanprash', PERSONAL_CARE, PATANJALI, 'Patanjali'),
      ],
      retailer_favorites: [],
    });
    mocks.fixture = fixture;

    render(<>{await CatalogPage({ searchParams: {} } as never)}</>);

    const links = linksOnScreen();

    // The two separate entry points (same page, separate cards).
    expect(links.some((link) => link.href === '/retailer/categories' && /categories/i.test(link.name))).toBe(true);
    expect(links.some((link) => link.href === '/retailer/brands' && /brands/i.test(link.name))).toBe(true);
    // "View all brands" points at the independent brands directory.
    expect(links.some((link) => link.href === '/retailer/brands' && /view all brands/i.test(link.name))).toBe(true);
    // Brand chips open the brand detail directly — no category in the path.
    expect(links.some((link) => link.href === `/retailer/brands/${PONDS}`)).toBe(true);
    expect(links.some((link) => link.href === `/retailer/brands/${PATANJALI}`)).toBe(true);
    // Category chips keep the existing category-scoped catalog filter.
    expect(links.some((link) => link.href === `/retailer/catalog?category=${PERSONAL_CARE}`)).toBe(true);

    // Each product appears exactly once — no duplication across the dimensions.
    expect(screen.getAllByRole('heading', { name: /ponds face wash/i })).toHaveLength(1);
    expect(screen.getAllByRole('heading', { name: /patanjali chyawanprash/i })).toHaveLength(1);
  });
});

describe('BrowseTabs — the [ Categories ] [ Brands ] navigation', () => {
  it('always offers both independent destinations', () => {
    render(<BrowseTabs active="categories" />);
    const links = screen.getAllByRole('link');
    expect(links).toHaveLength(2);
    const byHref = new Map(links.map((link) => [link.getAttribute('href'), link]));
    expect(byHref.get('/retailer/categories')?.getAttribute('aria-current')).toBe('page');
    expect(byHref.get('/retailer/brands')?.getAttribute('aria-current')).toBeNull();

    cleanup();
    render(<BrowseTabs active="brands" />);
    const second = screen.getAllByRole('link');
    const byHref2 = new Map(second.map((link) => [link.getAttribute('href'), link]));
    expect(byHref2.get('/retailer/brands')?.getAttribute('aria-current')).toBe('page');
    expect(byHref2.get('/retailer/categories')?.getAttribute('aria-current')).toBeNull();
  });
});
