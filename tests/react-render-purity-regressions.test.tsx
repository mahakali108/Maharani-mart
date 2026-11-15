// @vitest-environment jsdom
/**
 * Behaviour tests for the components changed to satisfy the React purity lint
 * rules (no state set synchronously in an effect, no ref writes during render,
 * no component declared inside a component). Each test pins what the user
 * sees, so the lint fixes cannot have changed behaviour unnoticed.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';

const mocks = vi.hoisted(() => ({
  pathname: '/retailer',
  push: vi.fn(),
  search: vi.fn(),
}));

vi.mock('next/navigation', () => ({
  usePathname: () => mocks.pathname,
  useRouter: () => ({ push: mocks.push, refresh: vi.fn(), replace: vi.fn() }),
}));
vi.mock('@/lib/retailer/search-actions', () => ({ searchSuggestionsAction: mocks.search }));
vi.mock('@/lib/retailer/cart-actions', () => ({ addToCartAction: vi.fn(async () => ({ success: true })) }));
vi.mock('@/lib/retailer/favorite-actions', () => ({ toggleFavoriteAction: vi.fn(async () => ({ success: true })) }));

import InstallPrompt from '@/components/pwa/InstallPrompt';
import { SearchField } from '@/components/retailer/search-field';
import { CompareGrid } from '@/components/retailer/compare-grid';
import { ProductCard, type ProductCardProps } from '@/components/retailer/product-card';

const DISMISS_KEY = 'mt-pwa-install-dismissed';
const COMPARE_KEY = 'maharani.compareIds.v1';
const RECENT_KEY = 'maharani.recentSearches.v1';

function fireInstallable() {
  const event = Object.assign(new Event('beforeinstallprompt'), {
    prompt: vi.fn(async () => undefined),
    userChoice: Promise.resolve({ outcome: 'dismissed' as const, platform: 'web' }),
  });
  act(() => {
    window.dispatchEvent(event);
  });
  return event;
}

function card(id: string, overrides: Partial<ProductCardProps> = {}): ProductCardProps {
  return { id, name: `Product ${id}`, isNewLaunch: false, fromPrice: 100, mrp: 120, moq: 1, ...overrides };
}

beforeEach(() => {
  window.localStorage.clear();
  mocks.pathname = '/retailer';
  mocks.push.mockReset();
  mocks.search.mockReset();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('InstallPrompt visibility is derived, not set in an effect', () => {
  const dialog = () => screen.queryByRole('dialog', { name: 'Install Maharani Traders app' });

  it('stays hidden until the browser says the app is installable, then shows', () => {
    render(<InstallPrompt />);
    expect(dialog()).toBeNull();
    fireInstallable();
    expect(dialog()).not.toBeNull();
  });

  it('is hidden on sign-in screens and appears again elsewhere', () => {
    mocks.pathname = '/login';
    const view = render(<InstallPrompt />);
    fireInstallable();
    expect(dialog()).toBeNull();
    mocks.pathname = '/retailer/catalog';
    view.rerender(<InstallPrompt />);
    expect(dialog()).not.toBeNull();
  });

  it('"Not now" hides it, remembers the choice, and a later install event does not bring it back', () => {
    render(<InstallPrompt />);
    fireInstallable();
    fireEvent.click(screen.getByRole('button', { name: 'Not now' }));
    expect(dialog()).toBeNull();
    expect(window.localStorage.getItem(DISMISS_KEY)).toBe('1');
    fireInstallable();
    expect(dialog()).toBeNull();
  });

  it('honours a dismissal stored earlier, and hides after the app is installed', () => {
    window.localStorage.setItem(DISMISS_KEY, '1');
    const first = render(<InstallPrompt />);
    fireInstallable();
    expect(dialog()).toBeNull();
    first.unmount();

    window.localStorage.clear();
    render(<InstallPrompt />);
    fireInstallable();
    expect(dialog()).not.toBeNull();
    act(() => {
      window.dispatchEvent(new Event('appinstalled'));
    });
    expect(dialog()).toBeNull();
    expect(window.localStorage.getItem(DISMISS_KEY)).toBe('1');
  });
});

describe('SearchField suggestions are derived from the last answered query', () => {
  const input = () => screen.getByLabelText('Search products, brands and categories');
  const flush = async (ms: number) => {
    await act(async () => {
      await vi.advanceTimersByTimeAsync(ms);
    });
  };

  it('shows "Searching…" at once, then the suggestions; a new query clears the old ones', async () => {
    vi.useFakeTimers();
    mocks.search.mockImplementation(async (query: string) => ({
      products: [{ id: `p-${query}`, name: `Result for ${query}` }],
      brands: [],
      categories: [],
    }));
    render(<SearchField />);
    fireEvent.change(input(), { target: { value: 'so' } });
    expect(screen.getByText('Searching…')).toBeTruthy();
    expect(mocks.search).not.toHaveBeenCalled(); // debounced
    await flush(250);
    expect(mocks.search).toHaveBeenCalledWith('so');
    expect(screen.getByText('Result for so')).toBeTruthy();
    expect(screen.queryByText('Searching…')).toBeNull();

    fireEvent.change(input(), { target: { value: 'soap' } });
    expect(screen.queryByText('Result for so')).toBeNull();
    expect(screen.getByText('Searching…')).toBeTruthy();
    await flush(250);
    expect(screen.getByText('Result for soap')).toBeTruthy();
  });

  it('does not search for one character, reports a failed lookup, and drops the answer when closed', async () => {
    vi.useFakeTimers();
    mocks.search.mockRejectedValueOnce(new Error('offline'));
    render(<SearchField />);
    fireEvent.change(input(), { target: { value: 's' } });
    await flush(250);
    expect(mocks.search).not.toHaveBeenCalled();

    fireEvent.change(input(), { target: { value: 'soap' } });
    await flush(250);
    expect(screen.getByText(/Suggestions are unavailable/)).toBeTruthy();
    expect(screen.queryByText('Searching…')).toBeNull();

    mocks.search.mockResolvedValue({ products: [{ id: 'p1', name: 'Soap 100g' }], brands: [], categories: [] });
    fireEvent.keyDown(input(), { key: 'Escape' });
    expect(screen.queryByRole('region', { name: 'Search suggestions' })).toBeNull();
    fireEvent.focus(input());
    expect(screen.getByText('Searching…')).toBeTruthy(); // reopened: asks again, no stale error
    await flush(250);
    expect(screen.getByText('Soap 100g')).toBeTruthy();
  });

  it('reads recent searches when the panel opens and stores a submitted term', () => {
    window.localStorage.setItem(RECENT_KEY, JSON.stringify(['shampoo']));
    render(<SearchField />);
    expect(screen.queryByText('shampoo')).toBeNull();
    fireEvent.focus(input());
    expect(screen.getByText('shampoo')).toBeTruthy();

    fireEvent.change(input(), { target: { value: 'soap' } });
    fireEvent.submit(screen.getByRole('search'));
    expect(mocks.push).toHaveBeenCalledTimes(1);
    expect(JSON.parse(window.localStorage.getItem(RECENT_KEY) ?? '[]')).toEqual(['soap', 'shampoo']);
  });
});

describe('CompareGrid selection lives in browser storage', () => {
  const compareButtons = () => screen.getAllByRole('button', { pressed: true });

  it('restores a stored selection for products on the grid and ignores unknown ids', () => {
    window.localStorage.setItem(COMPARE_KEY, JSON.stringify(['a', 'zzz']));
    render(<CompareGrid cards={[card('a'), card('b')]} />);
    expect(compareButtons()).toHaveLength(1);
  });

  it('toggling writes the selection, never more than four, and un-toggling removes it', () => {
    render(<CompareGrid cards={['a', 'b', 'c', 'd', 'e'].map((id) => card(id))} />);
    const toggles = screen.getAllByRole('button', { pressed: false }).filter((button) => /compare/i.test(button.textContent ?? button.getAttribute('aria-label') ?? ''));
    expect(toggles.length).toBe(5);
    for (const button of toggles) fireEvent.click(button);
    expect(JSON.parse(window.localStorage.getItem(COMPARE_KEY) ?? '[]')).toEqual(['a', 'b', 'c', 'd']);
    fireEvent.click(toggles[0]!);
    expect(JSON.parse(window.localStorage.getItem(COMPARE_KEY) ?? '[]')).toEqual(['b', 'c', 'd']);
  });

  it('keeps working when browser storage refuses writes', () => {
    const setItem = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('QuotaExceededError');
    });
    try {
      render(<CompareGrid cards={[card('a'), card('b')]} />);
      const toggles = screen.getAllByRole('button', { pressed: false }).filter((button) => /compare/i.test(button.textContent ?? button.getAttribute('aria-label') ?? ''));
      fireEvent.click(toggles[0]!);
      expect(compareButtons()).toHaveLength(1);
    } finally {
      setItem.mockRestore();
      // leave no in-memory fallback behind for other tests
      cleanup();
      render(<CompareGrid cards={[card('a')]} />);
      const pressed = screen.queryAllByRole('button', { pressed: true });
      for (const button of pressed) fireEvent.click(button);
    }
  });
});

describe('ProductCard follows the server favourite flag without an effect', () => {
  it('shows the new value when the prop changes after a revalidation', () => {
    const view = render(<ProductCard {...card('a', { isFavorite: false })} />);
    expect(screen.getByRole('button', { name: 'Add Product a to favourites' }).getAttribute('aria-pressed')).toBe('false');
    view.rerender(<ProductCard {...card('a', { isFavorite: true })} />);
    expect(screen.getByRole('button', { name: 'Remove Product a from favourites' }).getAttribute('aria-pressed')).toBe('true');
  });
});
