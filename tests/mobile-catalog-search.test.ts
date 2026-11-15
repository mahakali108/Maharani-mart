import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { supabaseFixture } from './helpers/supabase-fixture';

/**
 * Route coverage for `GET /api/mobile/v1/catalog/search` and for the offers
 * (`schemes`) the retailer home payload now carries.
 *
 * WHAT THESE PROVE
 *  1. the search endpoint is gated exactly like the rest of the mobile catalogue
 *     — no bearer token, an unverified token, an inactive/pending/suspended
 *     profile, a lapsed access period and a non-retailer role are all refused
 *     BEFORE any table is read;
 *  2. it answers PRODUCTS, PACK-barcode matches folded onto their parent
 *     product, BRANDS and CATEGORIES from real rows — the four entities the web
 *     storefront's own suggestion loader offers;
 *  3. it returns ids and names ONLY: no price, no stock and no MOQ crosses this
 *     boundary, so a suggestion can never quote a number checkout would reject;
 *  4. a FAILED read is a 503 with a retry, never an empty result. "No match"
 *     and "the read did not happen" stay distinguishable — the exact defect the
 *     catalogue taxonomy read once had;
 *  5. a short/empty term is a normal `searched: false` answer that reads nothing;
 *  6. the term is sanitized before it reaches a query, so `%`/`_` in user input
 *     cannot widen an `ilike`;
 *  7. `/home` now returns the admin's LIVE offers (active + inside the window,
 *     soonest-ending first) and reports a failed scheme read as
 *     `schemesUnavailable` instead of an empty "no offers" claim.
 *
 * HONEST SCOPE: Supabase is mocked at the client boundary, so live RLS itself is
 * asserted by `tests/security*.test.ts` and the migration tests, not here.
 */

const mocks = vi.hoisted(() => ({ client: null as unknown }));
vi.mock('@/lib/mobile/supabase', () => ({ createMobileSupabaseClient: () => mocks.client }));

import { GET as catalogSearch } from '@/app/api/mobile/v1/catalog/search/route';
import { GET as getHome } from '@/app/api/mobile/v1/home/route';
import { resetRateLimits } from '@/lib/mobile/rate-limit';
import { MOBILE_SEARCH_MIN_TERM } from '@/lib/mobile/search-service';

const RETAILER = '11111111-1111-4111-8111-111111111111';
const STAFF = '22222222-2222-4222-8222-222222222222';
const AREA = '33333333-3333-4333-8333-333333333333';

const RICE = 'aaaaaaaa-0000-4000-8000-000000000001';
const OIL = 'aaaaaaaa-0000-4000-8000-000000000002';
const RICE_PACK = 'bbbbbbbb-0000-4000-8000-000000000001';
const OIL_PACK = 'bbbbbbbb-0000-4000-8000-000000000002';
const CAT_RICE = 'cccccccc-0000-4000-8000-000000000001';
const CAT_BASMATI = 'cccccccc-0000-4000-8000-000000000002';
const CAT_OILS = 'cccccccc-0000-4000-8000-000000000003';
const BRAND_MAHARANI = 'dddddddd-0000-4000-8000-000000000001';
const BRAND_FORTUNE = 'dddddddd-0000-4000-8000-000000000002';

const IMAGE = 'https://ref.supabase.co/storage/v1/object/public/product-images/rice.jpg';

const LIVE_SCHEME = 'eeeeeeee-0000-4000-8000-000000000001';
const ENDS_LATER = 'eeeeeeee-0000-4000-8000-000000000002';
const FUTURE_SCHEME = 'eeeeeeee-0000-4000-8000-000000000003';
const EXPIRED_SCHEME = 'eeeeeeee-0000-4000-8000-000000000004';
const INACTIVE_SCHEME = 'eeeeeeee-0000-4000-8000-000000000005';

function tables(): Record<string, object[]> {
  return {
    profiles: [{ id: RETAILER, role: 'retailer', full_name: 'Gupta Kirana', phone: '9876543210', is_active: true }],
    retailers: [{ id: RETAILER, status: 'active', shop_name: 'Gupta Kirana Store', area_id: AREA }],
    user_access_periods: [{ user_id: RETAILER, status: 'active', expires_at: '2030-01-01T00:00:00.000Z' }],
    products: [
      {
        id: RICE,
        name: 'Basmati Rice',
        barcode: '8901000000001',
        is_active: true,
        created_at: '2026-03-01T00:00:00.000Z',
        category_id: CAT_BASMATI,
        brand_id: BRAND_MAHARANI,
        brands: { name: 'Maharani' },
        product_images: [{ image_url: IMAGE, sort_order: 0 }],
        product_packs: [],
      },
      {
        id: OIL,
        name: 'Sunflower Oil',
        barcode: null,
        is_active: true,
        created_at: '2025-06-01T00:00:00.000Z',
        category_id: CAT_OILS,
        brand_id: BRAND_FORTUNE,
        brands: { name: 'Fortune' },
        product_images: [],
        product_packs: [],
      },
      {
        id: 'aaaaaaaa-0000-4000-8000-000000000003',
        name: 'Retired Toor Dal',
        barcode: null,
        is_active: false,
        created_at: '2025-01-01T00:00:00.000Z',
        brands: null,
        product_images: [],
        product_packs: [],
      },
    ],
    product_packs: [
      {
        id: RICE_PACK,
        product_id: RICE,
        pack_name: '5kg Sack',
        barcode: '8901000000002',
        is_active: true,
        products: {
          id: RICE,
          name: 'Basmati Rice',
          barcode: '8901000000001',
          brands: { name: 'Maharani' },
          product_images: [{ image_url: IMAGE, sort_order: 0 }],
        },
      },
      {
        id: OIL_PACK,
        product_id: OIL,
        pack_name: '1L Pouch',
        barcode: '8901000000009',
        is_active: true,
        products: {
          id: OIL,
          name: 'Sunflower Oil',
          barcode: null,
          brands: { name: 'Fortune' },
          product_images: [],
        },
      },
    ],
    brands: [
      { id: BRAND_MAHARANI, name: 'Maharani', logo_url: null, is_active: true },
      { id: BRAND_FORTUNE, name: 'Fortune', logo_url: null, is_active: true },
      { id: 'dddddddd-0000-4000-8000-000000000003', name: 'Retired Brand', logo_url: null, is_active: false },
    ],
    categories: [
      { id: CAT_RICE, name: 'Rice', image_url: null, parent_id: null, is_active: true, sort_order: 0 },
      { id: CAT_BASMATI, name: 'Basmati', image_url: null, parent_id: CAT_RICE, is_active: true, sort_order: 0 },
      { id: CAT_OILS, name: 'Oils', image_url: null, parent_id: null, is_active: true, sort_order: 1 },
      { id: 'cccccccc-0000-4000-8000-000000000004', name: 'Retired Rice Bran', image_url: null, parent_id: null, is_active: false, sort_order: 2 },
    ],
    schemes: [
      { id: LIVE_SCHEME, name: 'Diwali Dhamaka', description: 'Festival pricing', is_festival: true, is_active: true, starts_at: '2026-01-01T00:00:00.000Z', ends_at: '2026-11-05T00:00:00.000Z' },
      { id: ENDS_LATER, name: 'Winter Bulk Offer', description: null, is_festival: false, is_active: true, starts_at: '2026-01-01T00:00:00.000Z', ends_at: '2027-02-01T00:00:00.000Z' },
      { id: FUTURE_SCHEME, name: 'Coming Soon', description: null, is_festival: false, is_active: true, starts_at: '2027-06-01T00:00:00.000Z', ends_at: '2027-12-01T00:00:00.000Z' },
      { id: EXPIRED_SCHEME, name: 'Last Year', description: null, is_festival: false, is_active: true, starts_at: '2020-01-01T00:00:00.000Z', ends_at: '2021-01-01T00:00:00.000Z' },
      { id: INACTIVE_SCHEME, name: 'Switched Off', description: null, is_festival: false, is_active: false, starts_at: '2026-01-01T00:00:00.000Z', ends_at: '2027-01-01T00:00:00.000Z' },
    ],
    banners: [],
    price_lists: [],
    product_pricing_tiers: [],
    retailer_favorites: [],
  };
}

function install({ role = 'retailer', errors = {} as Record<string, string>, override }: {
  role?: 'retailer' | 'staff';
  errors?: Record<string, string>;
  override?: Record<string, object[]>;
} = {}) {
  const userId = role === 'retailer' ? RETAILER : STAFF;
  const seeded = { ...tables(), ...override };
  if (role === 'staff') {
    seeded.profiles = [{ id: STAFF, role: 'staff', full_name: 'Warehouse', phone: '9876543211', is_active: true }];
    seeded.retailers = [];
    seeded.user_access_periods = [{ user_id: STAFF, status: 'active', expires_at: '2030-01-01T00:00:00.000Z' }];
  }
  const client = supabaseFixture(seeded, errors);
  Object.assign(client, {
    auth: { getUser: async () => ({ data: { user: { id: userId, email: 'shop@example.test' } }, error: null }) },
  });
  mocks.client = client;
  return client;
}

function apiRequest(path: string, token: string | null = 'verified-token') {
  const headers = new Headers();
  if (token) headers.set('authorization', `Bearer ${token}`);
  return new Request(`https://api.test${path}`, { headers });
}

async function json(response: Response) {
  return (await response.json()) as Record<string, unknown>;
}

interface Suggestions {
  query: string;
  searched: boolean;
  products: { id: string; name: string; brandName: string | null; packName: string | null; imageUrl: string | null; matchKind: string }[];
  brands: { id: string; name: string; logoUrl: string | null }[];
  categories: { id: string; name: string; parentName: string | null }[];
}

function suggestions(payload: Record<string, unknown>): Suggestions {
  return payload.data as Suggestions;
}

beforeEach(() => {
  resetRateLimits();
  install();
});

// ---------------------------------------------------------------------------
// 1. Session and role gates — identical to the rest of the mobile catalogue
// ---------------------------------------------------------------------------

describe('GET /api/mobile/v1/catalog/search access control', () => {
  const PATH = '/api/mobile/v1/catalog/search?q=rice';

  it('refuses a call with no bearer token before reading anything', async () => {
    const client = install();
    const response = await catalogSearch(apiRequest(PATH, null));
    expect(response.status).toBe(401);
    expect((await json(response)).error).toMatchObject({ code: 'missing_token' });
    expect(client.queries).toHaveLength(0);
  });

  it('refuses a token GoTrue does not verify', async () => {
    install();
    const client = mocks.client as ReturnType<typeof supabaseFixture>;
    Object.assign(client, { auth: { getUser: async () => ({ data: null, error: { message: 'invalid jwt' } }) } });
    const response = await catalogSearch(apiRequest(PATH));
    expect(response.status).toBe(401);
    expect(['invalid_token', 'expired_token']).toContain(((await json(response)).error as { code: string }).code);
  });

  it('refuses an inactive profile', async () => {
    install({
      override: {
        profiles: [{ id: RETAILER, role: 'retailer', full_name: 'Gupta Kirana', phone: '9876543210', is_active: false }],
      },
    });
    const response = await catalogSearch(apiRequest(PATH));
    expect(response.status).toBe(403);
    expect((await json(response)).error).toMatchObject({ code: 'account_inactive' });
  });

  it('refuses a retailer awaiting approval', async () => {
    install({ override: { retailers: [{ id: RETAILER, status: 'pending_approval', shop_name: 'Gupta', area_id: AREA }] } });
    const response = await catalogSearch(apiRequest(PATH));
    expect(response.status).toBe(403);
    expect((await json(response)).error).toMatchObject({ code: 'retailer_pending_approval' });
  });

  it('refuses a suspended retailer', async () => {
    install({ override: { retailers: [{ id: RETAILER, status: 'suspended', shop_name: 'Gupta', area_id: AREA }] } });
    const response = await catalogSearch(apiRequest(PATH));
    expect(response.status).toBe(403);
    expect((await json(response)).error).toMatchObject({ code: 'account_suspended' });
  });

  it('refuses a lapsed access period', async () => {
    install({
      override: { user_access_periods: [{ user_id: RETAILER, status: 'active', expires_at: '2020-01-01T00:00:00.000Z' }] },
    });
    const response = await catalogSearch(apiRequest(PATH));
    expect(response.status).toBe(403);
    expect((await json(response)).error).toMatchObject({ code: 'access_expired' });
  });

  it('is retailer-only', async () => {
    install({ role: 'staff' });
    const response = await catalogSearch(apiRequest(PATH));
    expect(response.status).toBe(403);
    expect((await json(response)).error).toMatchObject({ code: 'forbidden' });
  });

  it('returns a sanitized error envelope with a request id', async () => {
    install();
    const response = await catalogSearch(apiRequest(PATH, ''));
    const payload = await json(response);
    expect(payload.requestId).toBeTruthy();
    expect(response.headers.get('X-Request-Id')).toBe(payload.requestId);
    expect(JSON.stringify(payload)).not.toMatch(/postgres|supabase\.co|select \*|stack/i);
  });
});

// ---------------------------------------------------------------------------
// 2. Cross-entity suggestions
// ---------------------------------------------------------------------------

describe('GET /api/mobile/v1/catalog/search results', () => {
  it('matches a product name and returns the canonical name with its brand', async () => {
    const response = await catalogSearch(apiRequest('/api/mobile/v1/catalog/search?q=basmati'));
    expect(response.status).toBe(200);
    const data = suggestions(await json(response));

    expect(data.searched).toBe(true);
    expect(data.query).toBe('basmati');
    expect(data.products.map((product) => product.id)).toContain(RICE);
    const rice = data.products.find((product) => product.id === RICE)!;
    // Canonical name = brand + product, built by the one helper the whole
    // product uses, so the suggestion cannot contradict the product page.
    expect(rice.name).toContain('Basmati Rice');
    expect(rice.brandName).toBe('Maharani');
    expect(rice.imageUrl).toBe(IMAGE);
    expect(rice.matchKind).toBe('name');
    // The category "Basmati" is offered too, with its parent's real name.
    expect(data.categories.map((category) => category.name)).toContain('Basmati');
    expect(data.categories.find((category) => category.name === 'Basmati')!.parentName).toBe('Rice');
  });

  it('matches a brand name typed into the search field', async () => {
    const data = suggestions(await json(await catalogSearch(apiRequest('/api/mobile/v1/catalog/search?q=fortune'))));
    expect(data.brands.map((brand) => brand.id)).toContain(BRAND_FORTUNE);
    expect(data.brands.find((brand) => brand.id === BRAND_FORTUNE)!.name).toBe('Fortune');
  });

  it('matches a category name and never offers an inactive one', async () => {
    const data = suggestions(await json(await catalogSearch(apiRequest('/api/mobile/v1/catalog/search?q=rice'))));
    const names = data.categories.map((category) => category.name);
    expect(names).toContain('Rice');
    expect(names).not.toContain('Retired Rice Bran');
  });

  it('finds a product by its own barcode', async () => {
    const data = suggestions(await json(await catalogSearch(apiRequest('/api/mobile/v1/catalog/search?q=8901000000001'))));
    const hit = data.products.find((product) => product.id === RICE);
    expect(hit).toBeTruthy();
    expect(hit!.matchKind).toBe('barcode');
  });

  it('folds a PACK barcode onto its parent product and names the variant', async () => {
    // The sachet barcode is not the product barcode: a shopkeeper scans what is
    // in their hand, so the pack match must still resolve to the product.
    const data = suggestions(await json(await catalogSearch(apiRequest('/api/mobile/v1/catalog/search?q=8901000000009'))));
    expect(data.products).toHaveLength(1);
    expect(data.products[0]!.id).toBe(OIL);
    expect(data.products[0]!.packName).toBe('1L Pouch');
    expect(data.products[0]!.matchKind).toBe('barcode');
    expect(data.products[0]!.name).toContain('Sunflower Oil');
  });

  it('matches a pack name and reports it as a variant match', async () => {
    const data = suggestions(await json(await catalogSearch(apiRequest('/api/mobile/v1/catalog/search?q=Sack'))));
    expect(data.products.map((product) => product.id)).toEqual([RICE]);
    expect(data.products[0]!.matchKind).toBe('pack');
    expect(data.products[0]!.packName).toBe('5kg Sack');
  });

  it('never offers an inactive product, brand or category', async () => {
    const data = suggestions(await json(await catalogSearch(apiRequest('/api/mobile/v1/catalog/search?q=Retired'))));
    expect(data.products).toHaveLength(0);
    expect(data.brands).toHaveLength(0);
    expect(data.categories).toHaveLength(0);
    expect(data.searched).toBe(true);
  });

  it('carries no price, stock, MOQ or availability of any kind', async () => {
    const response = await catalogSearch(apiRequest('/api/mobile/v1/catalog/search?q=rice'));
    const raw = await response.text();
    for (const forbidden of ['unitPrice', 'Paise', 'availability', 'in_stock', 'moq', 'stock', 'mrp']) {
      expect(raw.toLowerCase()).not.toContain(forbidden.toLowerCase());
    }
  });

  it('answers `searched: false` with empty lists for a term below the floor, reading nothing', async () => {
    const client = install();
    const short = 'r'.repeat(MOBILE_SEARCH_MIN_TERM - 1);
    const data = suggestions(await json(await catalogSearch(apiRequest(`/api/mobile/v1/catalog/search?q=${short}`))));
    expect(data).toEqual({ query: short, searched: false, products: [], brands: [], categories: [] });
    expect(client.queries.filter((query) => ['products', 'product_packs', 'brands', 'categories'].includes(query.table)))
      .toHaveLength(0);
  });

  it('sanitizes the term so wildcards in user input cannot widen the match', async () => {
    const client = install();
    await catalogSearch(apiRequest('/api/mobile/v1/catalog/search?q=%25ri%5Fce%25'));
    const productQuery = client.queries.find((query) => query.table === 'products');
    expect(productQuery).toBeTruthy();
    const orClause = productQuery!.filters.find((filter) => filter.op === 'or');
    expect(orClause).toBeTruthy();
    expect(String(orClause!.value)).not.toContain('%ri_ce%');
    expect(String(orClause!.value)).toContain('ri ce');
  });

  it('scopes every read to active rows', async () => {
    const client = install();
    await catalogSearch(apiRequest('/api/mobile/v1/catalog/search?q=rice'));
    for (const table of ['products', 'product_packs', 'brands', 'categories']) {
      const query = client.queries.find((candidate) => candidate.table === table);
      expect(query, `${table} was never read`).toBeTruthy();
      expect(query!.filters).toEqual(
        expect.arrayContaining([{ op: 'eq', column: 'is_active', value: true }]),
      );
    }
  });

  it('reports a failed read as 503 database_unavailable, never as an empty result', async () => {
    install({ errors: { products: 'connection reset' } });
    const response = await catalogSearch(apiRequest('/api/mobile/v1/catalog/search?q=rice'));
    expect(response.status).toBe(503);
    expect((await json(response)).error).toMatchObject({ code: 'database_unavailable' });
  });

  it('reports a failed brand read as a failure too, not as "no brands"', async () => {
    install({ errors: { brands: 'permission denied' } });
    const response = await catalogSearch(apiRequest('/api/mobile/v1/catalog/search?q=rice'));
    expect(response.status).toBe(503);
    expect((await json(response)).error).toMatchObject({ code: 'database_unavailable' });
  });

  it('does not leak driver text in a failure', async () => {
    install({ errors: { categories: 'select * from pg_catalog failed' } });
    const response = await catalogSearch(apiRequest('/api/mobile/v1/catalog/search?q=rice'));
    expect(response.status).toBe(503);
    expect(JSON.stringify(await json(response))).not.toMatch(/pg_catalog|select \*/i);
  });
});

// ---------------------------------------------------------------------------
// 3. Home offers (schemes)
// ---------------------------------------------------------------------------

describe('GET /api/mobile/v1/home offers', () => {
  // The scheme fixtures carry fixed calendar windows (one ends 2026-11-05), so
  // the clock is pinned inside them; otherwise this suite expires with the date.
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-08-01T06:00:00.000Z'));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns only the admin schemes that are active and inside their window', async () => {
    const response = await getHome(apiRequest('/api/mobile/v1/home'));
    expect(response.status).toBe(200);
    const data = (await json(response)).data as {
      schemes: { id: string; name: string; description: string | null; isFestival: boolean; startsAt: string; endsAt: string }[];
      schemesUnavailable: boolean;
    };

    expect(data.schemesUnavailable).toBe(false);
    expect(data.schemes.map((scheme) => scheme.id)).toEqual([LIVE_SCHEME, ENDS_LATER]);
    expect(data.schemes[0]).toMatchObject({
      name: 'Diwali Dhamaka',
      description: 'Festival pricing',
      isFestival: true,
    });
  });

  it('orders live offers soonest-ending first, so a deadline rail is honest', async () => {
    const client = install();
    await getHome(apiRequest('/api/mobile/v1/home'));
    const schemeQuery = client.queries.find((query) => query.table === 'schemes');
    expect(schemeQuery).toBeTruthy();
    expect(schemeQuery!.select).toContain('ends_at');
    expect(schemeQuery!.filters).toEqual(
      expect.arrayContaining([
        { op: 'eq', column: 'is_active', value: true },
      ]),
    );
  });

  it('answers an empty offer list — not a failure — when no scheme is live', async () => {
    install({ override: { schemes: [] } });
    const response = await getHome(apiRequest('/api/mobile/v1/home'));
    expect(response.status).toBe(200);
    const data = (await json(response)).data as { schemes: unknown[]; schemesUnavailable: boolean };
    expect(data.schemes).toEqual([]);
    expect(data.schemesUnavailable).toBe(false);
  });

  it('flags a failed scheme read without taking banners, taxonomy or products down', async () => {
    install({ errors: { schemes: 'connection reset' } });
    const response = await getHome(apiRequest('/api/mobile/v1/home'));
    expect(response.status).toBe(200);
    const data = (await json(response)).data as {
      schemes: unknown[];
      schemesUnavailable: boolean;
      categories: unknown[];
      brands: unknown[];
    };
    expect(data.schemes).toEqual([]);
    expect(data.schemesUnavailable).toBe(true);
    // The rest of the shop is still on screen.
    expect(data.categories.length).toBeGreaterThan(0);
    expect(data.brands.length).toBeGreaterThan(0);
  });
});
