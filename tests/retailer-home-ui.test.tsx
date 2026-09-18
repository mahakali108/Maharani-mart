// @vitest-environment jsdom
import React, { useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ProductCard } from '@/components/retailer/product-card';
import { HomeContent } from '@/components/retailer/home-content';
import { HomeQuickActions } from '@/components/retailer/home-quick-actions';
import { HomeCartSummary } from '@/components/retailer/home-cart-summary';
import { HomeReorderCard } from '@/components/retailer/home-reorder-card';
import { RetailerShell } from '@/components/layout/retailer-shell';
import { PromoCarousel } from '@/components/retailer/promo-carousel';
import { SearchField } from '@/components/retailer/search-field';
import { WholesaleDealCard } from '@/components/retailer/wholesale-deal-card';
import HomeLoading from '@/app/retailer/home/loading';
import { priceCatalogRows } from '@/lib/retailer/catalog';
import { homeCartSummary } from '@/lib/retailer/home-data';
import type { HomeReorderItem } from '@/lib/retailer/home-data';
import { emptyHome, product, pricingData, PRODUCT, PACK, ORDER, CATEGORY, BRAND } from './fixtures/retailer-home';

const mocks = vi.hoisted(() => ({
  path: '/retailer/home', push: vi.fn(), replace: vi.fn(), back: vi.fn(), refresh: vi.fn(),
  add: vi.fn(), reorder: vi.fn(), favorite: vi.fn(), suggestions: vi.fn(),
}));
vi.mock('next/navigation', () => ({ usePathname: () => mocks.path, useRouter: () => ({ push: mocks.push, replace: mocks.replace, back: mocks.back, refresh: mocks.refresh }) }));
vi.mock('next/link', () => ({ default: ({ href, children, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement>) => React.createElement('a', { href, ...props }, children) }));
vi.mock('next/image', () => ({ default: ({ src, alt, className, onError }: { src: string; alt: string; className?: string; onError?: () => void }) => React.createElement('img', { src, alt, className, onError }) }));
vi.mock('@/lib/retailer/cart-actions', () => ({ addToCartAction: mocks.add }));
vi.mock('@/lib/retailer/order-actions', () => ({ addReorderLinesToCartAction: mocks.reorder }));
vi.mock('@/lib/retailer/favorite-actions', () => ({ toggleFavoriteAction: mocks.favorite }));
vi.mock('@/lib/retailer/search-actions', () => ({ searchSuggestionsAction: mocks.suggestions }));
// A compiled Next form action is a URL; no sign-out request is made by this harness.
vi.mock('@/lib/auth/actions', () => ({ logoutAction: '/login' }));

const card = () => priceCatalogRows([product], pricingData())[0]!;
const reordering = (): HomeReorderItem => ({ orderId: ORDER, productId: PRODUCT, packId: PACK, name: product.name,
  packName: '100 g', imageUrl: null, detailsHref: `/retailer/catalog/${PACK}`, previousQuantity: 12, quantity: 12, moq: 6, unitPrice: 28, availability: 'in_stock', canReorder: true });
const banners = [
  { id: 'a', title: 'Configured promotion one', subtitle: 'Merchant subtitle one', cta_label: 'Browse this offer', image_url: '/a.png', link_url: `/retailer/catalog?category=${CATEGORY}` },
  { id: 'b', title: 'Configured promotion two', subtitle: null, cta_label: 'Open brand', image_url: '/b.png', link_url: `/retailer/catalog?brand=${BRAND}` },
];
function motion(reduced: boolean) {
  vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: reduced, addEventListener: vi.fn(), removeEventListener: vi.fn() })));
}
beforeEach(() => {
  vi.resetAllMocks();
  mocks.path = '/retailer/home';
  mocks.add.mockResolvedValue({ success: true });
  mocks.reorder.mockResolvedValue({ success: true, skippedCount: 0 });
  mocks.favorite.mockResolvedValue({ success: true, isFavorite: true });
  mocks.suggestions.mockResolvedValue({ products: [], brands: [], categories: [] });
  motion(true);
  vi.spyOn(document, 'hidden', 'get').mockReturnValue(false);
  window.localStorage.clear();
  window.requestAnimationFrame = (fn) => window.setTimeout(() => fn(0), 0);
});
afterEach(() => { cleanup(); vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe('homepage navigation and profile', () => {
  it('hides missing profile/banner/brand data and renders useful empty states', () => {
    render(<HomeContent data={emptyHome()} wallet={null} services={[]} />);
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Welcome to Maharani Traders');
    expect(screen.queryByText('Delivery area')).toBeNull();
    expect(screen.queryByText('Shop location')).toBeNull();
    expect(screen.queryByRole('region', { name: 'Maharani Traders promotions' })).toBeNull();
    expect(screen.queryByRole('region', { name: 'Shop by brand' })).toBeNull();
    expect(screen.getByText('No categories available yet')).toBeTruthy();
    expect(screen.getByText('Your cart is empty')).toBeTruthy();
    expect(screen.getByText('Make your next restock a one-tap reorder')).toBeTruthy();
  });
  it('uses supplied retailer name, shop and area without a fabricated location', () => {
    render(<HomeContent data={emptyHome()} retailerName="Fixture owner" shopName="Fixture shop" areaName="Configured area" address="Different address" wallet={null} services={[]} />);
    expect(screen.getByRole('heading', { name: 'Welcome, Fixture owner' })).toBeTruthy();
    expect(screen.getByText('Fixture shop')).toBeTruthy();
    expect(screen.getByText('Configured area')).toBeTruthy();
    expect(screen.queryByText('Different address')).toBeNull();
  });
  it('falls back only to a real shop address when no area exists', () => {
    render(<HomeContent data={emptyHome()} address="Configured address" wallet={null} services={[]} />);
    expect(screen.getByText('Shop location')).toBeTruthy();
    expect(screen.getByText('Configured address')).toBeTruthy();
  });
  it('quick actions focus real search and link to the existing catalog/cart/reorder/offers/support flows', async () => {
    render(<HomeQuickActions />);
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Search products' }));
    expect(document.activeElement).toBe(screen.getByRole('searchbox'));
    const nav = within(screen.getByRole('navigation', { name: 'Quick actions' }));
    for (const [name, href] of [['Browse catalog', '/retailer/catalog'], ['View cart', '/retailer/cart'], ['Reorder', '#home-reorder'], ['View offers', '/retailer/schemes'], ['Contact support', '/retailer/help']]) {
      expect(nav.getByRole('link', { name }).getAttribute('href')).toBe(href);
    }
  });
  it('category and brand links use their real catalog filter IDs', () => {
    const data = emptyHome();
    data.categories = [{ id: CATEGORY, name: 'Fixture category', image_url: null, productCount: 3 }];
    data.brands = [{ id: BRAND, name: 'Fixture brand', logo_url: null }];
    render(<HomeContent data={data} wallet={null} services={[]} />);
    // Home categories drill down into the brands available in that category.
    expect(screen.getByRole('link', { name: /Fixture category/ }).getAttribute('href')).toBe(`/retailer/categories?category=${CATEGORY}`);
    expect(screen.getByRole('link', { name: /Fixture brand/ }).getAttribute('href')).toBe(`/retailer/catalog?brand=${BRAND}`);
    expect(screen.getByRole('link', { name: 'View all categories' }).getAttribute('href')).toBe('/retailer/categories');
    expect(screen.getByRole('link', { name: 'View all brands' }).getAttribute('href')).toBe('/retailer/brands');
  });
  it('renders error feedback with a functional retry instead of pretending data is empty', async () => {
    const data = emptyHome(); data.errors.categories = true;
    render(<HomeContent data={data} wallet={null} services={[]} />);
    expect(screen.getByText('Categories are temporarily unavailable')).toBeTruthy();
    await userEvent.setup().click(screen.getByRole('button', { name: 'Try again' }));
    expect(mocks.refresh).toHaveBeenCalledOnce();
  });
  it('provides a route-specific, screen-reader-labeled loading skeleton', () => {
    render(<HomeLoading />);
    expect(screen.getByLabelText('Loading your wholesale store').getAttribute('aria-busy')).toBe('true');
  });
});

describe('sticky header and bottom navigation', () => {
  it('opens and focuses header search and exposes functional logo, notification, cart and account links', async () => {
    render(<RetailerShell fullName="Fixture owner" role="retailer" cartCount={2} unreadCount={3}><p>Content</p></RetailerShell>);
    const header = within(screen.getByRole('banner'));
    expect(screen.getByRole('main').getAttribute('tabindex')).toBe('-1');
    expect(header.getByRole('link', { name: 'Maharani Traders home' }).getAttribute('href')).toBe('/retailer/home');
    expect(header.getByRole('link', { name: 'Notifications (3 unread)' }).getAttribute('href')).toBe('/retailer/notifications');
    expect(header.getByRole('link', { name: 'Cart (2 items)' }).getAttribute('href')).toBe('/retailer/cart');
    expect(header.getAllByRole('link', { name: 'Account' }).every((link) => link.getAttribute('href') === '/retailer/account')).toBe(true);
    await userEvent.setup().click(header.getByRole('button', { name: 'Search', expanded: false }));
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 10)); });
    expect(document.activeElement).toBe(document.querySelector('#retailer-mobile-search input'));
  });
  it('has exactly Home, Categories, Cart, Orders, Account and marks Home active', () => {
    render(<RetailerShell fullName="Fixture owner" role="retailer" cartCount={2}><p>Content</p></RetailerShell>);
    const nav = within(screen.getByRole('navigation', { name: 'Primary navigation' }));
    expect(nav.getAllByRole('link').map((link) => link.getAttribute('href'))).toEqual(['/retailer/home', '/retailer/categories', '/retailer/cart', '/retailer/orders', '/retailer/account']);
    expect(nav.getByRole('link', { name: 'Home' }).getAttribute('aria-current')).toBe('page');
    expect(nav.getByRole('link', { name: 'Orders' }).getAttribute('aria-current')).toBeNull();
  });
  it('highlights nested Orders and Account routes correctly', () => {
    mocks.path = `/retailer/orders/${ORDER}`;
    const view = render(<RetailerShell fullName="Fixture owner" role="retailer"><p>Content</p></RetailerShell>);
    expect(within(screen.getByRole('navigation', { name: 'Primary navigation' })).getByRole('link', { name: 'Orders' }).getAttribute('aria-current')).toBe('page');
    mocks.path = '/retailer/account/edit';
    view.rerender(<RetailerShell fullName="Fixture owner" role="retailer"><p>Content</p></RetailerShell>);
    expect(within(screen.getByRole('navigation', { name: 'Primary navigation' })).getByRole('link', { name: 'Account' }).getAttribute('aria-current')).toBe('page');
  });
});

describe('search behavior', () => {
  it('submits a trimmed, encoded search to the catalog using the keyboard', async () => {
    render(<SearchField variant="hero" />);
    await userEvent.setup().type(screen.getByRole('searchbox'), '  tea & coffee  {Enter}');
    expect(mocks.push).toHaveBeenLastCalledWith('/retailer/catalog?q=tea+%26+coffee');
  });
  it('suggestions navigate to product details, category and brand filters', async () => {
    mocks.suggestions.mockResolvedValue({ products: [{ id: PRODUCT, name: 'Suggested item' }], brands: [{ id: BRAND, name: 'Suggested brand' }], categories: [{ id: CATEGORY, name: 'Suggested category' }] });
    render(<SearchField variant="hero" />);
    const user = userEvent.setup();
    await user.type(screen.getByRole('searchbox'), 'tea');
    await screen.findByRole('button', { name: 'Suggested item' });
    await user.click(screen.getByRole('button', { name: /Suggested category/ }));
    expect(mocks.push).toHaveBeenLastCalledWith(`/retailer/catalog?category=${CATEGORY}`);
    await user.click(screen.getByRole('searchbox'));
    await user.click(await screen.findByRole('button', { name: /Suggested brand/ }));
    expect(mocks.push).toHaveBeenLastCalledWith(`/retailer/catalog?brand=${BRAND}`);
    await user.click(screen.getByRole('searchbox'));
    await user.click(await screen.findByRole('button', { name: 'Suggested item' }));
    expect(mocks.push).toHaveBeenLastCalledWith(`/retailer/catalog/${PRODUCT}`);
  });
  it('dismisses suggestions with Escape, handles failure, and can still submit', async () => {
    mocks.suggestions.mockRejectedValue(new Error('offline'));
    render(<SearchField variant="hero" />);
    const user = userEvent.setup();
    await user.type(screen.getByRole('searchbox'), 'tea');
    expect(await screen.findByText(/Suggestions are unavailable/)).toBeTruthy();
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('region', { name: 'Search suggestions' })).toBeNull();
    await user.keyboard('{Enter}');
    expect(mocks.push).toHaveBeenCalledWith('/retailer/catalog?q=tea');
  });
  it('does not let a slow older suggestion response overwrite a newer query', async () => {
    let finishOld!: (value: object) => void;
    mocks.suggestions.mockImplementation((q: string) => q === 'tea' ? new Promise((resolve) => { finishOld = resolve; }) : Promise.resolve({ products: [{ id: PRODUCT, name: 'Latest result' }], brands: [], categories: [] }));
    render(<SearchField variant="hero" />);
    const user = userEvent.setup();
    await user.type(screen.getByRole('searchbox'), 'tea');
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 250)); });
    await user.type(screen.getByRole('searchbox'), 's');
    await screen.findByRole('button', { name: 'Latest result' });
    await act(async () => finishOld({ products: [{ id: PRODUCT, name: 'Stale result' }], brands: [], categories: [] }));
    expect(screen.queryByRole('button', { name: 'Stale result' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Latest result' })).toBeTruthy();
  });
  it('local storage failure cannot break search navigation', async () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('Storage disabled'); });
    render(<SearchField variant="hero" />);
    await userEvent.setup().type(screen.getByRole('searchbox'), 'tea{Enter}');
    expect(mocks.push).toHaveBeenCalledWith('/retailer/catalog?q=tea');
  });
});

describe('live-data carousel controls', () => {
  it('renders supplied subtitle and CTA; arrows/dots change the only accessible slide', async () => {
    render(<PromoCarousel banners={banners} />);
    expect(screen.getByText('Merchant subtitle one')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Browse this offer' }).getAttribute('href')).toBe(`/retailer/catalog?category=${CATEGORY}`);
    expect(screen.queryByRole('link', { name: 'Open brand' })).toBeNull();
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Next promotion' }));
    expect(screen.getByRole('link', { name: 'Open brand' }).getAttribute('href')).toBe(`/retailer/catalog?brand=${BRAND}`);
    await user.click(screen.getByRole('button', { name: 'Show promotion 1' }));
    expect(screen.getByRole('link', { name: 'Browse this offer' }).getAttribute('target')).toBeNull();
  });
  it('does not render empty promotions or a fake CTA for a banner without a safe target', () => {
    const view = render(<PromoCarousel banners={[]} />);
    expect(screen.queryByRole('region')).toBeNull();
    view.rerender(<PromoCarousel banners={[{ ...banners[0]!, link_url: 'javascript:alert(1)' }]} />);
    expect(screen.queryByRole('link')).toBeNull();
    expect(screen.queryByRole('button')).toBeNull();
  });
  it('preserves external merchant links with a new-tab announcement', () => {
    render(<PromoCarousel banners={[{ ...banners[0]!, link_url: 'https://merchant.test/offer' }]} />);
    const link = screen.getByRole('link', { name: /opens in a new tab/ });
    expect(link.getAttribute('target')).toBe('_blank');
    expect(link.getAttribute('rel')).toContain('noopener');
  });
  it('does not autoplay under reduced motion', () => {
    vi.useFakeTimers(); render(<PromoCarousel banners={banners} />);
    act(() => vi.advanceTimersByTime(12000));
    expect(screen.getByRole('link', { name: 'Browse this offer' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Pause promotions' })).toBeNull();
  });
  it('autoplay can be paused and stops when a user focuses the carousel', () => {
    motion(false); vi.useFakeTimers(); render(<PromoCarousel banners={banners} />);
    act(() => vi.advanceTimersByTime(6000));
    expect(screen.getByRole('link', { name: 'Open brand' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Pause promotions' }));
    act(() => vi.advanceTimersByTime(6000));
    expect(screen.getByRole('link', { name: 'Open brand' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Play promotions' }));
    fireEvent.focus(screen.getByRole('link', { name: 'Open brand' }));
    act(() => vi.advanceTimersByTime(6000));
    expect(screen.getByRole('link', { name: 'Open brand' })).toBeTruthy();
  });
});

describe('product purchase, cart feedback and wholesale deal', () => {
  it('reprices the selected quantity and sends only pack ID + pieces to the existing action', async () => {
    render(<ProductCard {...card()} />);
    expect(screen.getByText('₹30.00')).toBeTruthy();
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: /Increase .*quantity in pieces/ }));
    expect(screen.getByText('₹28.00')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: /Add 7 .*pieces to cart/ }));
    expect(mocks.add).toHaveBeenCalledWith(PACK, 7);
    expect(screen.getByRole('status').textContent).toBe('Added to your cart.');
    expect(screen.getByRole('link', { name: /View details for/ }).getAttribute('href')).toBe(`/retailer/catalog/${PACK}`);
  });
  it('holds the add button disabled until the server action finishes', async () => {
    let finish!: (value: object) => void;
    mocks.add.mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
    render(<ProductCard {...card()} />);
    await userEvent.setup().click(screen.getByRole('button', { name: /Add 6 .*pieces to cart/ }));
    expect(screen.getByRole('button', { name: /Add 6 .*pieces to cart/ }).hasAttribute('disabled')).toBe(true);
    await act(async () => finish({ success: true }));
    expect(screen.getByRole('status')).toBeTruthy();
  });
  it('shows server validation failure rather than false Added feedback', async () => {
    mocks.add.mockResolvedValue({ error: 'Minimum order quantity changed. Review the product.' });
    render(<ProductCard {...card()} />);
    await userEvent.setup().click(screen.getByRole('button', { name: /Add 6 .*pieces to cart/ }));
    expect(screen.getByRole('alert').textContent).toContain('Minimum order quantity changed');
    expect(screen.queryByText('Added to your cart.')).toBeNull();
  });
  it('unknown stock is not marked in stock, and out-of-stock/unpriced cards cannot add', () => {
    const view = render(<ProductCard {...card()} availability="unknown" />);
    expect(screen.getByText('Stock not confirmed')).toBeTruthy();
    view.rerender(<ProductCard {...card()} availability="out_of_stock" />);
    expect(screen.queryByRole('button', { name: /pieces to cart/ })).toBeNull();
    view.rerender(<ProductCard {...card()} fromPrice={null} />);
    expect(screen.getByText('Price unavailable')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /pieces to cart/ })).toBeNull();
  });
  it('image errors show a fallback and a later valid source can recover', () => {
    const view = render(<ProductCard {...card()} imageUrl="/broken.png" />);
    fireEvent.error(screen.getByRole('img', { name: card().name }));
    expect(screen.getByText('Image unavailable')).toBeTruthy();
    view.rerender(<ProductCard {...card()} imageUrl="/different.png" />);
    expect(screen.getByRole('img', { name: card().name }).getAttribute('src')).toBe('/different.png');
  });
  it('preserves favourites without nesting an interactive button inside a link', async () => {
    const view = render(<ProductCard {...card()} />);
    expect(view.container.querySelector('a button')).toBeNull();
    await userEvent.setup().click(screen.getByRole('button', { name: /to favourites/ }));
    expect(mocks.favorite).toHaveBeenCalledWith(PRODUCT);
    expect(screen.getByRole('button', { name: /from favourites/ }).getAttribute('aria-pressed')).toBe('true');
  });
  it('refreshes cart badges, quantity, inclusive subtotal and savings from new server props', async () => {
    function CartFlow() {
      const [quantity, setQuantity] = useState(0);
      mocks.add.mockImplementation(async (_pack: string, added: number) => { setQuantity((value) => value + added); return { success: true }; });
      const cart = homeCartSummary(quantity ? [{ id: 'cart', pack_id: PACK, product_id: PRODUCT, quantity }] : [], [product], pricingData());
      return <RetailerShell fullName="Fixture owner" role="retailer" cartCount={quantity ? 1 : 0}><ProductCard {...card()} /><HomeCartSummary cart={cart} /></RetailerShell>;
    }
    render(<CartFlow />);
    expect(screen.getByText('Your cart is empty')).toBeTruthy();
    await userEvent.setup().click(screen.getByRole('button', { name: /Add 6 .*pieces to cart/ }));
    expect(within(screen.getByRole('banner')).getByRole('link', { name: 'Cart (1 items)' })).toBeTruthy();
    const summary = within(screen.getByRole('region', { name: 'Your cart' }));
    expect(summary.getByText('6 pcs')).toBeTruthy();
    expect(summary.getByText('₹180.00')).toBeTruthy();
    expect(summary.getByText('₹60.00')).toBeTruthy();
    expect(summary.getByRole('link', { name: 'View Cart' }).getAttribute('href')).toBe('/retailer/cart');
    expect(summary.getByRole('link', { name: 'Continue Shopping' }).getAttribute('href')).toBe('/retailer/catalog');
  });
  it('wholesale deals show a real slab threshold and navigate to that exact pack', () => {
    render(<WholesaleDealCard product={card()} />);
    expect(screen.getByText('₹26.00')).toBeTruthy();
    expect(screen.getByText('At 21+ pcs')).toBeTruthy();
    expect(screen.getByText('Buy more, save more')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'View bulk pricing' }).getAttribute('href')).toBe(`/retailer/catalog/${PACK}`);
  });
});

describe('reorder UI', () => {
  it('uses the exact previously ordered pack/quantity and preserves review navigation', async () => {
    render(<HomeReorderCard item={reordering()} />);
    expect(screen.getByText('Last ordered: 12 pcs')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Review order' }).getAttribute('href')).toBe(`/retailer/orders/${ORDER}/reorder`);
    await userEvent.setup().click(screen.getByRole('button', { name: /Reorder 12/ }));
    expect(mocks.reorder).toHaveBeenCalledWith(ORDER, [{ packId: PACK, quantity: 12 }]);
    expect(screen.getByRole('status').textContent).toContain('Added to your cart');
  });
  it('explains a current-MOQ adjustment and blocks unavailable lines', () => {
    const view = render(<HomeReorderCard item={{ ...reordering(), moq: 24, quantity: 24 }} />);
    expect(screen.getByText('Reorder quantity adjusted to the current MOQ.')).toBeTruthy();
    expect(screen.getByRole('button', { name: /Reorder 24/ })).toBeTruthy();
    view.rerender(<HomeReorderCard item={{ ...reordering(), availability: 'out_of_stock', canReorder: false }} />);
    expect(screen.getByRole('button', { name: /Reorder 12/ }).hasAttribute('disabled')).toBe(true);
  });
  it('shows a skipped/failed validation instead of an invented successful reorder', async () => {
    mocks.reorder.mockResolvedValue({ error: 'Order not found.' });
    render(<HomeReorderCard item={reordering()} />);
    await userEvent.setup().click(screen.getByRole('button', { name: /Reorder 12/ }));
    expect(screen.getByRole('alert').textContent).toBe('Order not found.');
    expect(screen.queryByRole('status')).toBeNull();
  });
});
