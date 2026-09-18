// @vitest-environment jsdom
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, createEvent, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { CatalogFeed, type CatalogFeedState } from '@/components/retailer/catalog-feed';
import { CategoryDirectory, type DirectoryCategory } from '@/components/retailer/category-directory';
import { PromoCarousel } from '@/components/retailer/promo-carousel';
import { priceCatalogRows } from '@/lib/retailer/catalog';
import type { PricedCatalogCard } from '@/lib/retailer/catalog';
import { CATEGORY, BRAND, PACK, product, pricingData } from './fixtures/retailer-home';

const mocks = vi.hoisted(() => ({
  add: vi.fn(),
  favorite: vi.fn(),
}));

vi.mock('next/navigation', () => ({
  usePathname: () => '/retailer/catalog',
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn(), refresh: vi.fn() }),
}));
vi.mock('next/link', () => ({
  default: ({ href, children, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement>) =>
    React.createElement('a', { href, ...props }, children),
}));
vi.mock('next/image', () => ({
  default: ({ src, alt, className, onError }: { src: string; alt: string; className?: string; onError?: () => void }) =>
    React.createElement('img', { src, alt, className, onError }),
}));
vi.mock('@/lib/retailer/cart-actions', () => ({ addToCartAction: mocks.add }));
vi.mock('@/lib/retailer/favorite-actions', () => ({ toggleFavoriteAction: mocks.favorite }));

function motion(reduced: boolean) {
  vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: reduced, addEventListener: vi.fn(), removeEventListener: vi.fn() })));
}

/** Deterministic priced card built by the REAL pricing path, one per id. */
function card(id: string, name: string): PricedCatalogCard {
  return priceCatalogRows([{ ...product, id, name }], pricingData())[0]!;
}

/** jsdom has no IntersectionObserver; this records the callback so a test can
 *  decide exactly when "the user reached the bottom". */
class FakeIntersectionObserver {
  static instances: FakeIntersectionObserver[] = [];
  constructor(public callback: IntersectionObserverCallback) {
    FakeIntersectionObserver.instances.push(this);
  }
  observe() {}
  unobserve() {}
  disconnect() {}
  takeRecords(): IntersectionObserverEntry[] {
    return [];
  }
  trigger() {
    this.callback(
      [{ isIntersecting: true } as unknown as IntersectionObserverEntry],
      this as unknown as IntersectionObserver
    );
  }
}

function feedState(partial: Partial<CatalogFeedState> = {}): CatalogFeedState {
  return {
    cards: [card('p-1', 'First fixture product')],
    total: 1,
    offset: 0,
    limit: 1,
    nextOffset: null,
    hasMore: false,
    workingSetCapped: false,
    feedCapped: false,
    ...partial,
  };
}

/** Card headings are "<product> <pack>" (built by the shared name helper). */
function productVisible(text: string): boolean {
  return screen.getAllByRole('heading', { level: 3 }).some((heading) => heading.textContent?.includes(text));
}
function visibleCount(text: string): number {
  return screen.getAllByRole('heading', { level: 3 }).filter((heading) => heading.textContent?.includes(text)).length;
}

function jsonResponse(payload: unknown, ok = true) {
  return { ok, status: ok ? 200 : 500, json: async () => payload } as unknown as Response;
}

beforeEach(() => {
  vi.resetAllMocks();
  mocks.add.mockResolvedValue({ success: true });
  mocks.favorite.mockResolvedValue({ success: true, isFavorite: false });
  motion(true);
  vi.spyOn(document, 'hidden', 'get').mockReturnValue(false);
  window.sessionStorage.clear();
  FakeIntersectionObserver.instances = [];
  vi.stubGlobal('IntersectionObserver', FakeIntersectionObserver);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe('continuous catalog loading', () => {
  it('renders the server’s first batch and says the list is finished', () => {
    render(<CatalogFeed initial={feedState({ total: 1 })} query={{}} />);
    expect(productVisible('First fixture product')).toBe(true);
    expect(screen.getByText(/reached the end/)).toBeTruthy();
    // No page numbers, no Next/Previous controls.
    expect(screen.queryByText(/Page 1 of/)).toBeNull();
    expect(screen.queryByRole('link', { name: /next/i })).toBeNull();
  });

  it('appends the next batch when the end of the list is reached', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({
        cards: [card('p-2', 'Second fixture product')],
        total: 2,
        offset: 1,
        limit: 1,
        nextOffset: null,
        hasMore: false,
      })
    );
    vi.stubGlobal('fetch', fetchMock);
    render(<CatalogFeed initial={feedState({ nextOffset: 1, hasMore: true, total: 2 })} query={{}} />);

    FakeIntersectionObserver.instances[0]!.trigger();
    await waitFor(() => expect(productVisible('Second fixture product')).toBe(true));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0]![0])).toContain('offset=1');
    // The first batch stays on screen — loading appends, it never replaces.
    expect(productVisible('First fixture product')).toBe(true);
  });

  it('stops asking once the server says there is nothing left', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    render(<CatalogFeed initial={feedState({ nextOffset: null, hasMore: false })} query={{}} />);
    FakeIntersectionObserver.instances[0]!.trigger();
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('never requests the same batch twice and never duplicates a product', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({
        // Deliberately returns a product the client already has.
        cards: [card('p-1', 'First fixture product')],
        total: 2,
        offset: 1,
        limit: 1,
        nextOffset: null,
        hasMore: false,
      })
    );
    vi.stubGlobal('fetch', fetchMock);
    render(<CatalogFeed initial={feedState({ nextOffset: 1, hasMore: true, total: 2 })} query={{}} />);
    const observer = FakeIntersectionObserver.instances[0]!;
    observer.trigger();
    observer.trigger();
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(visibleCount('First fixture product')).toBe(1);
  });

  it('shows a retry instead of silently stopping when a batch fails', async () => {
    const fetchMock = vi.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValue(
      jsonResponse({ cards: [card('p-2', 'Second fixture product')], total: 2, offset: 1, limit: 1, nextOffset: null, hasMore: false })
    );
    vi.stubGlobal('fetch', fetchMock);
    render(<CatalogFeed initial={feedState({ nextOffset: 1, hasMore: true, total: 2 })} query={{}} />);
    FakeIntersectionObserver.instances[0]!.trigger();

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('Could not load more products');
    const retry = screen.getByRole('button', { name: /try again/i });
    fireEvent.click(retry);
    await waitFor(() => expect(productVisible('Second fixture product')).toBe(true));
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('resumes how far the retailer had already scrolled for the same filters', async () => {
    const restored = feedState({
      cards: [card('p-1', 'First fixture product'), card('p-2', 'Second fixture product')],
      total: 2,
      nextOffset: 2,
      hasMore: true,
    });
    window.sessionStorage.setItem('maharani.catalogFeed.v1', JSON.stringify({ key: '/retailer/catalog', ...restored }));
    render(<CatalogFeed initial={feedState({ nextOffset: 1, hasMore: true, total: 2 })} query={{}} />);
    // Back/forward (or returning from a product page) must not shrink the list.
    await waitFor(() => expect(productVisible('Second fixture product')).toBe(true));
    expect(productVisible('First fixture product')).toBe(true);
  });

  it('tells the truth when the browse-list cap is reached', () => {
    render(<CatalogFeed initial={feedState({ feedCapped: true, total: 900 })} query={{}} />);
    expect(screen.getByText(/You have reached the end of this browse list/)).toBeTruthy();
  });
});

describe('promotional carousel', () => {
  const banners = [
    { id: 'b-1', title: 'Fixture promotion one', image_url: '/one.png', link_url: '/retailer/catalog' },
    { id: 'b-2', title: 'Fixture promotion two', image_url: '/two.png', link_url: null },
  ];

  it('renders nothing at all when there is no active banner', () => {
    const { container } = render(<PromoCarousel banners={[]} />);
    expect(screen.queryByRole('region', { name: 'Maharani Traders promotions' })).toBeNull();
    expect(container.textContent).toBe('');
  });

  it('shows one slide at a time and moves with the controls', () => {
    render(<PromoCarousel banners={banners} />);
    // Inactive slides are aria-hidden, so they must be queried explicitly.
    const slides = () => screen.getAllByRole('group', { hidden: true });
    expect(slides()).toHaveLength(2);
    expect(slides()[0]!.getAttribute('aria-hidden')).toBe('false');
    expect(slides()[1]!.getAttribute('aria-hidden')).toBe('true');

    fireEvent.click(screen.getByRole('button', { name: 'Next promotion' }));
    expect(slides()[1]!.getAttribute('aria-hidden')).toBe('false');
  });

  it('swipes horizontally on touch and ignores a tap', () => {
    render(<PromoCarousel banners={banners} />);
    const track = screen.getAllByRole('group')[0]!.parentElement!;

    const slides = () => screen.getAllByRole('group', { hidden: true });
    // jsdom exposes `touches`/`changedTouches` as getters, so they are set with
    // defineProperty rather than by assignment.
    function touch(type: 'touchStart' | 'touchEnd', clientX: number) {
      const event = createEvent[type](track, {});
      const key = type === 'touchStart' ? 'touches' : 'changedTouches';
      Object.defineProperty(event, key, { value: [{ clientX }], configurable: true });
      return event;
    }

    // A tap (no horizontal travel) must not change the slide.
    fireEvent(track, touch('touchStart', 150));
    fireEvent(track, touch('touchEnd', 148));
    expect(slides()[0]!.getAttribute('aria-hidden')).toBe('false');

    // A left swipe advances.
    fireEvent(track, touch('touchStart', 250));
    fireEvent(track, touch('touchEnd', 90));
    expect(slides()[1]!.getAttribute('aria-hidden')).toBe('false');

    // …and a right swipe goes back.
    fireEvent(track, touch('touchStart', 90));
    fireEvent(track, touch('touchEnd', 250));
    expect(slides()[0]!.getAttribute('aria-hidden')).toBe('false');
  });
});

describe('category → brand browsing', () => {
  const categories: DirectoryCategory[] = [
    {
      id: CATEGORY,
      name: 'Fixture category',
      image_url: null,
      productCount: 4,
      children: [{ id: 'child-1', name: 'Fixture sub-category', image_url: null, productCount: 2 }],
    },
  ];

  it('level 1 opens the brands for a category instead of skipping them', () => {
    render(<CategoryDirectory categories={categories} />);
    expect(screen.getByRole('link', { name: /Fixture category/ }).getAttribute('href')).toBe(
      `/retailer/categories?category=${CATEGORY}`
    );
    expect(screen.getByRole('link', { name: /Fixture sub-category/ }).getAttribute('href')).toBe(
      '/retailer/categories?category=child-1'
    );
  });

  it('level 2 lists only the brands that exist in the category and filters to both', () => {
    render(
      <CategoryDirectory
        categories={categories}
        selectedCategory={categories[0]!}
        brands={[
          { id: BRAND, name: 'Fixture brand', logo_url: null, productCount: 3 },
          { id: 'brand-2', name: 'Second brand', logo_url: null, productCount: 1 },
        ]}
      />
    );
    const list = screen.getByRole('list', { name: '' }) ?? screen.getAllByRole('list')[0]!;
    const brandLink = within(list).getByRole('link', { name: /Fixture brand/ });
    expect(brandLink.getAttribute('href')).toBe(`/retailer/catalog?category=${CATEGORY}&brand=${BRAND}`);
    expect(brandLink.textContent).toContain('3 products');
    // Shortcut for the retailer who does not care about the brand.
    expect(screen.getByRole('link', { name: /View all products in Fixture category/ }).getAttribute('href')).toBe(
      `/retailer/catalog?category=${CATEGORY}`
    );
    // Back to level 1 is always one tap away.
    expect(screen.getByRole('link', { name: /All categories/ }).getAttribute('href')).toBe('/retailer/categories');
  });

  it('keeps the brand search working inside a category', () => {
    render(
      <CategoryDirectory
        categories={categories}
        selectedCategory={categories[0]!}
        brands={[
          { id: BRAND, name: 'Fixture brand', logo_url: null, productCount: 3 },
          { id: 'brand-2', name: 'Second brand', logo_url: null, productCount: 1 },
        ]}
      />
    );
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'second' } });
    expect(screen.getByRole('link', { name: /Second brand/ })).toBeTruthy();
    expect(screen.queryByRole('link', { name: /Fixture brand/ })).toBeNull();
  });

  it('shows an honest empty state when a category has no brands', () => {
    render(<CategoryDirectory categories={categories} selectedCategory={categories[0]!} brands={[]} />);
    expect(screen.getByText('No brands in this category yet')).toBeTruthy();
    const shortcuts = screen.getAllByRole('link', { name: /View all products in Fixture category/ });
    expect(shortcuts.length).toBeGreaterThan(0);
    for (const link of shortcuts) expect(link.getAttribute('href')).toBe(`/retailer/catalog?category=${CATEGORY}`);
  });

  it('product cards still expose the priced pack used by the catalog', () => {
    // Guards the shared card builder the feed renders (pack id PACK, MOQ 6).
    const priced = priceCatalogRows([product], pricingData())[0]!;
    expect(priced.defaultPackId).toBe(PACK);
    expect(priced.moq).toBe(6);
  });
});
