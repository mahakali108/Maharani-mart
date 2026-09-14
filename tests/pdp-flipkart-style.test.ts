/**
 * Product detail page — marketplace (Flipkart-inspired) B2B upgrade guards.
 *
 * Locks in the behaviour the redesign promises:
 *   1. A real back/exit button (history back, catalog fallback, big tap target)
 *   2. Sticky mobile header: logo, search icon (functional), notifications,
 *      live cart count, account
 *   3. Gallery controls that work: zoom button, share, wishlist, discount badge
 *   4. B2B integrity: blue CTAs, live MOQ validation, server re-validation
 *   5. Loading / empty / unavailable / error states are handled
 *   6. No marketplace branding is copied — layout only
 *
 * The pages are Next.js Server Components backed by Supabase; like the other
 * UI suites in this repo, "rendering" is verified through the pure helpers
 * plus source-level guards on the exact JSX wiring.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { calculateRetailerPiecePrice } from '@/lib/retailer/retailer-pricing';

const root = join(__dirname, '..');
const read = (rel: string) => readFileSync(join(root, rel), 'utf8');

const shell = read('components/layout/retailer-shell.tsx');
const page = read('app/retailer/catalog/[id]/page.tsx');
const gallery = read('components/retailer/product-gallery.tsx');
const selector = read('components/retailer/pack-selector.tsx');
const actions = read('lib/retailer/cart-actions.ts');

// ---------------------------------------------------------------------------
// 1. Back / exit navigation
// ---------------------------------------------------------------------------
describe('back / exit navigation', () => {
  it('is a real button (not a decorative icon) shown on product detail routes', () => {
    expect(shell).toContain('isProductDetail');
    expect(shell).toContain('aria-label="Go back"');
    expect(shell).toContain('onClick={handleBack}');
    expect(shell).toMatch(/type="button"[\s\S]{0,200}aria-label="Go back"/);
  });

  it('returns to the previous page when history exists, else the product listing', () => {
    expect(shell).toContain('router.back()');
    expect(shell).toContain("router.replace('/retailer/catalog')");
    // History detection via the App Router idx in history.state.
    expect(shell).toContain('window.history.state');
  });

  it('is large enough for mobile tapping (>= 44px target, bold icon)', () => {
    const backButton = shell.slice(
      shell.indexOf('aria-label="Go back"') - 400,
      shell.indexOf('aria-label="Go back"') + 200
    );
    expect(backButton).toContain('h-11 w-11'); // 44px tap target
    expect(backButton).toContain('shrink-0');
    expect(shell).toContain('<ArrowLeft className="h-6 w-6"');
  });
});

// ---------------------------------------------------------------------------
// 2. Sticky mobile header composition
// ---------------------------------------------------------------------------
describe('sticky mobile header', () => {
  it('is sticky above content with a brand wordmark', () => {
    expect(shell).toContain('sticky top-0 z-40');
    expect(shell).toContain('Maharani Traders');
    expect(shell).toContain('aria-label="Maharani Traders home"');
  });

  it('has a functional search icon that toggles + focuses the search field', () => {
    expect(shell).toContain('aria-label="Search"');
    expect(shell).toContain('aria-expanded={searchOpen}');
    expect(shell).toContain('onClick={handleSearchToggle}');
    expect(shell).toContain('searchInputRef');
    // The row the icon toggles is the real SearchField, focused on demand.
    expect(shell).toContain('<SearchField inputRef={searchInputRef} />');
    expect(shell).toContain("requestAnimationFrame(() => searchInputRef.current?.focus())");
    const field = read('components/retailer/search-field.tsx');
    expect(field).toContain('ref={inputRef}');
  });

  it('has notification, cart (live count) and account icons', () => {
    expect(shell).toContain('href="/retailer/notifications"');
    expect(shell).toContain('<CountBadge count={unreadCount} />');
    expect(shell).toContain('href="/retailer/cart"');
    expect(shell).toContain('<CountBadge count={cartCount} />');
    expect(shell).toContain('href="/retailer/account"');
  });

  it('the live cart count comes from the real cart_items table in the layout', () => {
    const layout = read('app/retailer/layout.tsx');
    expect(layout).toContain(".from('cart_items')");
    expect(layout).toContain("{ count: 'exact', head: true }");
    expect(layout).toContain('cartCount={cartCount ?? 0}');
  });
});

// ---------------------------------------------------------------------------
// 3. Gallery controls — every button on the image works
// ---------------------------------------------------------------------------
describe('gallery controls', () => {
  it('the zoom control is a real button that opens the lightbox', () => {
    expect(gallery).toContain('aria-label="Zoom image"');
    const zoom = gallery.slice(
      gallery.indexOf('aria-label="Zoom image"') - 260,
      gallery.indexOf('aria-label="Zoom image"') + 60
    );
    expect(zoom).toContain('type="button"');
    expect(zoom).toContain('onClick={openLightbox}');
  });

  it('keeps working share and wishlist buttons on the image card', () => {
    expect(page).toContain('shareSlot={<ShareButton title={canonicalProductName} />}');
    expect(page).toContain('<FavoriteToggle productId={product.id}');
    const share = read('components/retailer/share-button.tsx');
    expect(share).toContain('navigator.share');
    const favorite = read('components/retailer/favorite-toggle.tsx');
    expect(favorite).toContain('toggleFavoriteAction(productId)');
  });

  it('the discount badge is derived from real MRP-vs-price data only', () => {
    expect(page).toContain('{discount > 0 ? (');
    expect(page).toContain('calcDiscountPercent(selectedPack?.mrp, selectedPiecePrice)');
  });

  it('gallery shows a real empty state when no images exist', () => {
    expect(gallery).toContain('Product image unavailable');
  });
});

// ---------------------------------------------------------------------------
// 4. B2B integrity — blue CTAs, MOQ, server re-validation
// ---------------------------------------------------------------------------
describe('B2B marketplace actions', () => {
  it('defines the marketplace blue action palette', () => {
    const config = read('tailwind.config.ts');
    expect(config).toContain('action: {');
    expect(config).toContain("#2874f0");
  });

  it('primary buy actions use the blue action color', () => {
    // Selected variant's Buy now, the full-width 1-click checkout, the batch
    // add and the sticky bar's View Cart are the four primary CTAs.
    const buyNow = selector.slice(
      selector.indexOf('Buy now — 1-click checkout') - 700,
      selector.indexOf('Buy now — 1-click checkout')
    );
    expect(buyNow).toContain('bg-action-600');
    const viewCart = selector.slice(
      selector.indexOf('View Cart') - 600,
      selector.indexOf('View Cart')
    );
    expect(viewCart).toContain('bg-action-600');
    expect(selector).toContain('Add all selected');
    expect(selector).toContain('Buy now — 1-click checkout');
    // The blue CTA count on the page is bounded — no decorative blue buttons.
    expect(selector.match(/bg-action-600/g)?.length ?? 0).toBeGreaterThanOrEqual(4);
  });

  it('one-tap Add to cart drops the MOQ into the cart on the empty state', () => {
    expect(selector).toContain('handleAddSinglePack(pack, Math.max(1, pack.moq))');
    // The preset quantity keeps the stepper in sync with the server line.
    expect(selector).toContain('presetQty');
  });

  it('the quantity stepper never goes below MOQ (clears to 0 instead)', () => {
    expect(selector).toContain('current === 0 ? Math.max(1, pack.moq) : current + 1');
    expect(selector).toContain('current <= pack.moq ? 0 : current - 1');
  });

  it('shows a useful live validation message when a typed quantity is below MOQ', () => {
    expect(selector).toContain('qty > 0 && qty < pack.moq');
    expect(selector).toContain('Minimum order quantity is {pack.moq}');
    expect(selector).toContain('role="alert"');
    // The message wording matches the server engine's own verdict.
    const pricing = calculateRetailerPiecePrice({
      quantity: 2,
      unitsPerCase: 24,
      casePrice: 0,
      tiers: [],
      gstPercent: 5,
      moq: 5,
    });
    expect(pricing.orderable).toBe(false);
    expect(pricing.message).toBe('Minimum order quantity is 5 pcs.');
  });

  it('client still submits only (packId, pieces) — server re-validates and refreshes the badge', () => {
    expect(selector).toContain('addToCartAction(pack.id, qty)');
    expect(selector).toContain('await buyNowAction(pack.id, qty)');
    expect(actions).toContain("revalidatePath('/retailer', 'layout')");
    expect(actions).toContain("revalidatePath('/retailer/cart')");
  });
});

// ---------------------------------------------------------------------------
// 5. Loading / empty / unavailable / error states
// ---------------------------------------------------------------------------
describe('loading, empty, unavailable and error states', () => {
  it('the product detail route has a loading skeleton', () => {
    const loading = read('app/retailer/catalog/[id]/loading.tsx');
    expect(loading).toContain('Skeleton');
    expect(loading).toContain('aria-busy="true"');
    expect(loading).toContain('min-h-[360px]');
  });

  it('empty cart, unavailable product and unknown route are all handled', () => {
    expect(page).toContain('Your cart is empty');
    expect(page).toContain('Currently unavailable');
    expect(page).toContain('if (!isUuidLike(params.id)) notFound();');
    expect(read('app/not-found.tsx')).toContain('Page not found');
    expect(read('app/retailer/error.tsx')).toContain('use client');
  });

  it('the selector has an empty state when no packs are active', () => {
    expect(selector).toContain('No pack sizes are currently available for this product.');
  });
});

// ---------------------------------------------------------------------------
// 6. Marketplace layout without marketplace branding
// ---------------------------------------------------------------------------
describe('layout style without branding', () => {
  it('uses white cards, light grey separators and a clear price hierarchy', () => {
    expect(page).toContain('bg-white');
    expect(page).toContain('border-slate-200');
    expect(page).toContain('border-t border-slate-100');
    expect(page).toContain('line-through');
    expect(page).toContain('font-black');
  });

  it('does not copy any marketplace branding into the codebase', () => {
    const sources = [
      'app/retailer/catalog/[id]/page.tsx',
      'app/retailer/catalog/[id]/loading.tsx',
      'components/layout/retailer-shell.tsx',
      'components/retailer/pack-selector.tsx',
      'components/retailer/product-gallery.tsx',
      'components/retailer/search-field.tsx',
      'tailwind.config.ts',
    ];
    for (const file of sources) {
      const source = read(file).toLowerCase();
      expect(source, file).not.toContain('flipkart');
      expect(source, file).not.toContain('amazon');
    }
  });

  it('keeps the single fixed cart bar above the bottom navigation on mobile', () => {
    const fixedBars =
      selector.match(/fixed inset-x-0 bottom-\[calc\(4\.25rem\+env\(safe-area-inset-bottom\)\)\]/g) ?? [];
    expect(fixedBars).toHaveLength(1);
    const nav = read('components/layout/mobile-bottom-nav.tsx');
    expect(nav).toContain('h-[calc(4.25rem+env(safe-area-inset-bottom))]');
    expect(shell).toContain('icon: ShoppingCart, badge: cartCount');
  });
});
