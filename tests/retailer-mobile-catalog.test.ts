/**
 * Mobile retailer catalog — pure + static verification.
 *
 * These cover the four UI fixes at the level they can honestly be verified
 * without a database or a browser: image resolution, bounded continuous
 * loading, category → brand derivation, banner filtering, and the source-level
 * invariants that keep the phone layout safe (no page-level overflow, no
 * pagination UI, no service-role client, no duplicated loader).
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { catalogCardImage, PRODUCT_CARD_SELECT } from '@/lib/retailer/catalog';
import type { CatalogProductRow } from '@/lib/retailer/catalog';
import {
  CATALOG_FEED_MAX_ROWS,
  CATALOG_MAX_ROWS,
  CATALOG_PAGE_SIZE,
  catalogFeedHref,
  catalogFeedKey,
  catalogFeedWindow,
  catalogOffsetFromPage,
  parseCatalogOffset,
  type CatalogQuery,
} from '@/lib/retailer/catalog-params';
import { homeBanners } from '@/lib/retailer/home-data';
import { categoryScopeIds, orderBrandsByCount } from '@/lib/retailer/catalog-taxonomy';

const ROOT = join(__dirname, '..');
const read = (relative: string) => readFileSync(join(ROOT, relative), 'utf8');

const PACK_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const PACK_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

function row(partial: Partial<CatalogProductRow> = {}): CatalogProductRow {
  return {
    id: 'p-1',
    name: 'Fixture product',
    category_id: null,
    brand_id: null,
    gst_percent: 5,
    is_new_launch: false,
    created_at: '2026-01-01T00:00:00.000Z',
    brands: null,
    product_images: [],
    product_pack_images: [],
    product_packs: [],
    ...partial,
  };
}

describe('product card images', () => {
  it('reads the variant gallery the catalog pages use', () => {
    // Regression guard: the card SELECT used to omit `product_pack_images`
    // (migration 0028), so products whose photos live in the variant gallery
    // showed "Image unavailable" on every card while the detail page was fine.
    expect(PRODUCT_CARD_SELECT).toContain('product_pack_images (');
    expect(PRODUCT_CARD_SELECT).toContain('product_pack_id');
  });

  it('resolves in the same order as the product-detail page', () => {
    const product = row({
      product_images: [{ image_url: '/parent.png', sort_order: 0 }],
      product_pack_images: [
        { product_pack_id: PACK_A, image_url: '/second.webp', sort_order: 1 },
        { product_pack_id: PACK_A, image_url: '/primary.webp', sort_order: 0 },
      ],
    });
    // 1. the priced variant's own gallery (lowest sort_order first)
    expect(catalogCardImage(product, { id: PACK_A, image_url: '/legacy.png' })).toBe('/primary.webp');
    // 2. the variant's legacy single column
    expect(catalogCardImage(row(), { id: PACK_A, image_url: '/legacy.png' })).toBe('/legacy.png');
    // 3. the parent gallery
    expect(catalogCardImage(product, { id: PACK_B })).toBe('/parent.png');
    // 4. nothing at all → the compact placeholder
    expect(catalogCardImage(row(), { id: PACK_B })).toBeNull();
    expect(catalogCardImage(row(), null)).toBeNull();
  });

  it('never shows another variant’s image and never treats blanks as images', () => {
    const product = row({
      product_images: [{ image_url: '   ', sort_order: 0 }],
      product_pack_images: [{ product_pack_id: PACK_B, image_url: '/other-variant.png', sort_order: 0 }],
    });
    // PACK_A has no gallery of its own: it must not borrow PACK_B's photo.
    expect(catalogCardImage(product, { id: PACK_A, image_url: '' })).toBeNull();
    expect(catalogCardImage(product, { id: PACK_B, image_url: '  ' })).toBe('/other-variant.png');
  });
});

describe('continuous (bounded) catalog loading', () => {
  it('parses a cursor safely', () => {
    expect(parseCatalogOffset(undefined)).toBe(0);
    expect(parseCatalogOffset('')).toBe(0);
    expect(parseCatalogOffset('abc')).toBe(0);
    expect(parseCatalogOffset('-5')).toBe(0);
    expect(parseCatalogOffset('24')).toBe(24);
    // A hostile cursor is clamped, never trusted.
    expect(parseCatalogOffset('99999999')).toBeLessThanOrEqual(CATALOG_FEED_MAX_ROWS);
  });

  it('clamps every window into the feed’s hard bounds', () => {
    const first = catalogFeedWindow(0);
    expect(first).toEqual({ offset: 0, limit: CATALOG_PAGE_SIZE, maxRows: CATALOG_FEED_MAX_ROWS, from: 0, to: CATALOG_PAGE_SIZE - 1 });
    const last = catalogFeedWindow(CATALOG_FEED_MAX_ROWS + 500);
    // The server never reads past the cap, so the browser cannot pull the whole
    // catalog down one batch at a time forever.
    expect(last.offset + last.limit).toBeLessThanOrEqual(CATALOG_FEED_MAX_ROWS);
    // A client cannot raise the batch size.
    expect(catalogFeedWindow(0, 10_000).limit).toBe(CATALOG_PAGE_SIZE);
  });

  it('keeps more rows available than one page, and less than the whole catalog', () => {
    expect(CATALOG_FEED_MAX_ROWS).toBeGreaterThan(CATALOG_PAGE_SIZE);
    expect(CATALOG_FEED_MAX_ROWS).toBeGreaterThanOrEqual(CATALOG_MAX_ROWS);
  });

  it('builds feed URLs from the real filter state, with the cursor only', () => {
    const query: CatalogQuery = { q: 'tea', category: 'c-1', brand: 'b-1', sort: 'name', offers: '1' };
    const href = catalogFeedHref(query, 24);
    expect(href.startsWith('/api/retailer/catalog?')).toBe(true);
    expect(href).toContain('q=tea');
    expect(href).toContain('category=c-1');
    expect(href).toContain('brand=b-1');
    expect(href).toContain('sort=name');
    expect(href).toContain('offers=1');
    expect(href).toContain('offset=24');
    // A page number is never part of a feed request.
    expect(href).not.toContain('page=');
  });

  it('identifies a feed by its filters, not by how far it has been scrolled', () => {
    expect(catalogFeedKey({ q: 'tea' })).toBe('/retailer/catalog?q=tea');
    expect(catalogFeedKey({ q: 'tea', page: '3' })).toBe(catalogFeedKey({ q: 'tea' }));
  });

  it('still understands legacy ?page= deep links as a batch offset', () => {
    expect(catalogOffsetFromPage(1)).toBe(0);
    expect(catalogOffsetFromPage(3)).toBe(CATALOG_PAGE_SIZE * 2);
  });

  it('hides the pagination UI and reuses the shared server loader', () => {
    const page = read('app/retailer/catalog/page.tsx');
    expect(page).not.toContain('Page {page} of {totalPages}');
    expect(page).not.toContain('aria-label="Catalog pages"');
    expect(page).not.toContain('catalogPageHref(');
    expect(page).toContain('loadCatalogFeed(');
    expect(page).toContain('<CatalogFeed');

    const feed = read('components/retailer/catalog-feed.tsx');
    expect(feed).toContain('IntersectionObserver');
    expect(feed).toContain('nextOffset');
    expect(feed).toContain('seen.has(card.id)'); // de-duplication
    expect(feed).not.toContain('page=');
    expect(feed).toContain('sessionStorage'); // back/forward resume
  });

  it('keeps the JSON feed server-side, session-scoped and bounded', () => {
    const route = read('app/api/retailer/catalog/route.ts');
    // No service-role key, no privileged client in a client-facing route.
    expect(route).not.toContain('SERVICE_ROLE');
    expect(route).not.toContain('createServiceRoleClient');
    expect(route).toContain("@/lib/supabase/server'");
    expect(route).toContain('auth.getUser()');
    expect(route).toContain('401');
    expect(route).toContain('403');
    expect(route).toContain('loadCatalogFeed(');
    expect(route).toContain("'cache-control': 'no-store'");
    expect(route).toContain('export const dynamic');
  });
});

describe('homepage banners', () => {
  const NOW = Date.parse('2026-06-15T12:00:00.000Z');
  const base = {
    id: 'banner-1',
    title: 'Fixture promotion',
    image_url: 'https://demo.supabase.co/storage/v1/object/public/banners/b/1.png',
    link_url: null as string | null,
    is_active: true,
    area_id: null as string | null,
    starts_at: null as string | null,
    ends_at: null as string | null,
  };

  it('shows exactly the banners that are active, in schedule and in scope', () => {
    expect(homeBanners([base], null, NOW)).toHaveLength(1);
    expect(homeBanners([{ ...base, is_active: false }], null, NOW)).toHaveLength(0);
    expect(homeBanners([{ ...base, starts_at: '2026-07-01T00:00:00.000Z' }], null, NOW)).toHaveLength(0);
    expect(homeBanners([{ ...base, ends_at: '2026-06-01T00:00:00.000Z' }], null, NOW)).toHaveLength(0);
    // Scoped to another area → hidden; scoped to this area → shown.
    expect(homeBanners([{ ...base, area_id: 'area-1' }], null, NOW)).toHaveLength(0);
    expect(homeBanners([{ ...base, area_id: 'area-1' }], 'area-1', NOW)).toHaveLength(1);
  });

  it('never renders a banner whose image cannot be resolved', () => {
    // A bare object path, an old Appwrite ref and a blob URL are all data the
    // browser cannot draw — dropping the slide beats a broken-image box.
    expect(homeBanners([{ ...base, image_url: 'banners/b/1.png' }], null, NOW)).toHaveLength(0);
    expect(homeBanners([{ ...base, image_url: 'appwrite://bucket/file' }], null, NOW)).toHaveLength(0);
    expect(homeBanners([{ ...base, image_url: 'blob:https://x/y' }], null, NOW)).toHaveLength(0);
    expect(homeBanners([{ ...base, image_url: '   ' }], null, NOW)).toHaveLength(0);
  });

  it('skips a banner with no title and maps real navigation targets only', () => {
    expect(homeBanners([{ ...base, title: '  ' }], null, NOW)).toHaveLength(0);
    expect(homeBanners([{ ...base, link_url: 'javascript:alert(1)' }], null, NOW)[0]?.link_url).toBeNull();
    expect(homeBanners([{ ...base, link_url: '/retailer/catalog?q=tea' }], null, NOW)[0]?.link_url).toBe(
      '/retailer/catalog?q=tea'
    );
    // An absolute link to this site becomes an in-app route.
    expect(
      homeBanners([{ ...base, link_url: 'https://shop.test/retailer/schemes' }], null, NOW, 'https://shop.test')[0]
        ?.link_url
    ).toBe('/retailer/schemes');
  });

  it('reads active banners in one query and filters with the shared rule', () => {
    const homeData = read('lib/retailer/home-data.ts');
    // The old query stacked three PostgREST `.or()` filters (starts_at, ends_at,
    // area_id) whose combined behaviour depended on the client version.
    expect(homeData).not.toMatch(/\.or\(`starts_at/);
    expect(homeData).not.toMatch(/\.or\(`area_id/);
    expect(homeData).toContain('isBannerVisible(banner, areaId, now)');
    expect(homeData).toContain("from('banners')");
    expect(homeData).toContain("eq('is_active', true)");
    expect(homeData).toContain("order('sort_order')");
  });

  it('renders the carousel between the welcome block and the categories', () => {
    const home = read('components/retailer/home-content.tsx');
    const welcome = home.indexOf('aria-labelledby="home-welcome"');
    const carousel = home.indexOf('<PromoCarousel');
    const categories = home.indexOf('Shop by category');
    expect(welcome).toBeGreaterThan(-1);
    expect(carousel).toBeGreaterThan(welcome);
    expect(categories).toBeGreaterThan(carousel);

    const carouselSource = read('components/retailer/promo-carousel.tsx');
    expect(carouselSource).toContain('if (banners.length === 0) return null;');
    expect(carouselSource).toContain('touch-pan-y'); // swipe without blocking scroll
    expect(carouselSource).toContain('onTouchEnd');
  });
});

describe('category → brand taxonomy', () => {
  const categories = [
    { id: 'c-1', parent_id: null },
    { id: 'c-2', parent_id: 'c-1' },
    { id: 'c-3', parent_id: 'c-1' },
    { id: 'c-4', parent_id: null },
  ];

  it('scopes a category to itself plus its immediate children', () => {
    expect(categoryScopeIds(categories, 'c-1')).toEqual(['c-1', 'c-2', 'c-3']);
    expect(categoryScopeIds(categories, 'c-2')).toEqual(['c-2']);
    expect(categoryScopeIds(categories, null)).toEqual([]);
    // An unknown id must not silently become "everything".
    expect(categoryScopeIds(categories, 'nope')).toEqual([]);
  });

  it('lists only brands that really have products in the scope, biggest first', () => {
    const brands = [
      { id: 'b-1', name: 'Zebra brand' },
      { id: 'b-2', name: 'Apple brand' },
      { id: 'b-3', name: 'No products here' },
    ];
    const counts = new Map([
      ['b-1', 5],
      ['b-2', 5],
    ]);
    const ordered = orderBrandsByCount(brands, counts);
    expect(ordered.map((entry) => entry.brand.id)).toEqual(['b-2', 'b-1']);
    expect(ordered.map((entry) => entry.count)).toEqual([5, 5]);
  });

  it('derives brands from real products instead of inventing a relationship', () => {
    const taxonomy = read('lib/retailer/catalog-taxonomy.ts');
    expect(taxonomy).toContain("from('products')");
    expect(taxonomy).toContain("eq('is_active', true)");
    expect(taxonomy).toContain("in('category_id', categoryIds)");
    expect(taxonomy).toContain('.limit(limit)');
  });

  it('offers the drill-down with a working back route and empty states', () => {
    const directory = read('components/retailer/category-directory.tsx');
    expect(directory).toContain('/retailer/categories?category=');
    expect(directory).toContain('href="/retailer/categories"');
    expect(directory).toContain('No brands in this category yet');
    expect(directory).toContain('No matching category');

    const page = read('app/retailer/categories/page.tsx');
    expect(page).toContain('loadCategoryBrandCounts(');
    expect(page).toContain("eq('is_active', true)");
  });
});

describe('mobile layout safety of the changed surfaces', () => {
  /** Arbitrary Tailwind widths in px/rem that exceed a 320px phone. */
  const WIDTH_TOKEN = /(?:w|min-w|max-w)-\[([0-9.]+)(px|rem)\]/g;

  for (const file of [
    'components/retailer/catalog-feed.tsx',
    'components/retailer/category-directory.tsx',
    'components/retailer/product-card.tsx',
    'components/retailer/promo-carousel.tsx',
    'components/retailer/promo-banner.tsx',
    'components/retailer/category-card.tsx',
    'components/retailer/brand-card.tsx',
  ]) {
    it(`${file} never hard-codes a width wider than a phone`, () => {
      const violations: string[] = [];
      for (const match of read(file).matchAll(WIDTH_TOKEN)) {
        const px = match[2] === 'rem' ? Number(match[1]) * 16 : Number(match[1]);
        if (px > 300) violations.push(match[0]);
      }
      expect(violations).toEqual([]);
    });
  }

  it('keeps touch targets and readable text on the product card', () => {
    const card = read('components/retailer/product-card.tsx');
    expect(card).toContain('min-h-11'); // Add to cart
    expect(card).toContain('min-h-10'); // View details
    expect(card).toContain('Piece price · GST inclusive');
    // No text smaller than 9px anywhere in the card.
    for (const match of card.matchAll(/text-\[([0-9]+)px\]/g)) {
      expect(Number(match[1])).toBeGreaterThanOrEqual(9);
    }
  });

  it('reserves the bottom navigation area instead of hiding behind it', () => {
    const shell = read('components/layout/retailer-shell.tsx');
    expect(shell).toContain('pb-24');
    expect(shell).toContain('MobileBottomNav');
  });
});
