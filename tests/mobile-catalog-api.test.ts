/**
 * `/api/mobile/v1/catalog/*` + `/api/mobile/v1/home` — Phase D contract tests.
 *
 * These run in the repository's vitest harness against the REAL route handlers
 * and the REAL `lib/retailer/*` pricing/catalogue services, with Supabase mocked
 * at the client boundary (the same seam `tests/mobile-auth.test.ts` uses). What
 * they therefore prove:
 *
 *   1. every gate `requireMobileSession` applies to the rest of the API also
 *      applies here — a catalogue read is not a loophole for a pending,
 *      suspended, inactive or access-expired account, or for a non-retailer;
 *   2. prices cross the boundary as INTEGER PAISE and equal what the shared
 *      pricing engine computed (never a float, never a client-supplied number);
 *   3. availability is the two-state customer vocabulary, and an exact stock
 *      count never appears in any response;
 *   4. pack size and MOQ come from the pack row, not from the client;
 *   5. the cursor is opaque, advances, and does not repeat or skip rows;
 *   6. `inStock=1` excludes out-of-stock AND unknown-availability packs;
 *   7. banners are the admin's rows filtered by the existing IST scheduler and
 *      area targeting, with unsafe links dropped — never hardcoded content;
 *   8. malformed parameters are rejected, not silently ignored.
 *
 * HONEST SCOPE: these are unit/contract tests. They do not exercise a live
 * Supabase project (no credentials exist in CI), so RLS enforcement itself is
 * asserted by the existing `tests/security*.test.ts` / migration tests, not here.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

// ---------------------------------------------------------------------------
// PostgREST double
// ---------------------------------------------------------------------------

type Row = Record<string, unknown>;

interface RecordedQuery {
  table: string;
  select: string;
  filters: { op: string; column: string; value: unknown }[];
  ors: string[];
  orders: { column: string; ascending: boolean }[];
  limit: number | null;
  range: [number, number] | null;
  count: boolean;
}

interface DoubleOptions {
  /** Rows `get_retailer_pack_availability` returns. */
  availability?: { pack_id: string; stock_status: string }[];
  rpcError?: string;
  tableErrors?: Record<string, string>;
}

/** Split an `or=(a,b,and(c,d))` expression on top-level commas. */
function splitTopLevel(expression: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let current = '';
  for (const char of expression) {
    if (char === '(') depth += 1;
    if (char === ')') depth -= 1;
    if (char === ',' && depth === 0) {
      parts.push(current);
      current = '';
      continue;
    }
    current += char;
  }
  if (current) parts.push(current);
  return parts;
}

function unquote(value: string): string {
  const trimmed = value.trim();
  return trimmed.startsWith('"') && trimmed.endsWith('"') ? trimmed.slice(1, -1) : trimmed;
}

function matchSingleClause(row: Row, clause: string): boolean {
  const match = /^([\w.]+)\.(ilike|eq|in|gt|lt)\.(.*)$/.exec(clause.trim());
  if (!match) return true;
  const column = match[1]!;
  const op = match[2]!;
  const rawValue = match[3] ?? '';
  // A dotted column is a nested relation the double does not model.
  if (column.includes('.')) return true;
  const cell = row[column];
  if (op === 'ilike') {
    const term = unquote(rawValue).replace(/%/g, '').toLowerCase();
    return String(cell ?? '').toLowerCase().includes(term);
  }
  if (op === 'in') {
    const values = rawValue.trim().replace(/^\(|\)$/g, '').split(',').map(unquote);
    return values.includes(String(cell));
  }
  if (op === 'eq') return String(cell) === unquote(rawValue);
  if (op === 'gt') return String(cell) > unquote(rawValue);
  return String(cell) < unquote(rawValue);
}

/**
 * PostgREST `or=(a,b,and(c,d))` is `a OR b OR (c AND d)`: commas at the top
 * level are OR, a nested `and(...)` group is AND. Getting this the wrong way
 * round silently empties every keyset continuation, so it is spelled out here.
 */
function matchOrClause(row: Row, clause: string): boolean {
  return splitTopLevel(clause).some((part) => {
    const trimmed = part.trim();
    if (trimmed.startsWith('and(') && trimmed.endsWith(')')) {
      return splitTopLevel(trimmed.slice(4, -1)).every((inner) => matchSingleClause(row, inner));
    }
    return matchSingleClause(row, trimmed);
  });
}

function createDouble(tables: Record<string, Row[]>, options: DoubleOptions = {}) {
  const data = structuredClone(tables);
  const queries: RecordedQuery[] = [];
  const rpcCalls: { name: string; args: Row }[] = [];

  function from(table: string) {
    const query: RecordedQuery = {
      table,
      select: '',
      filters: [],
      ors: [],
      orders: [],
      limit: null,
      range: null,
      count: false,
    };

    const matches = (row: Row) =>
      query.filters.every(({ op, column, value }) => {
        if (column.includes('.')) return true;
        switch (op) {
          case 'eq': return row[column] === value;
          case 'neq': return row[column] !== value;
          case 'in': return (value as unknown[]).includes(row[column]);
          case 'is': return row[column] === value;
          case 'lte': return String(row[column]) <= String(value);
          case 'gte': return String(row[column]) >= String(value);
          default: return true;
        }
      }) && query.ors.every((expression) => matchOrClause(row, expression));

    const run = () => {
      queries.push(query);
      const failure = options.tableErrors?.[table];
      if (failure) return { data: null, error: { message: failure }, count: null };

      let rows = (data[table] ?? []).filter(matches);
      rows = [...rows].sort((a, b) => {
        for (const order of query.orders) {
          const left = a[order.column];
          const right = b[order.column];
          // Booleans sort DESC-first so `is_new_launch DESC` puts launches first,
          // exactly as Postgres does.
          const compare = typeof left === 'boolean' && typeof right === 'boolean'
            ? Number(left) - Number(right)
            : typeof left === 'number' && typeof right === 'number'
              ? left - right
              : String(left ?? '').localeCompare(String(right ?? ''));
          if (compare !== 0) return order.ascending ? compare : -compare;
        }
        return 0;
      });

      const total = rows.length;
      if (query.range) rows = rows.slice(query.range[0], query.range[1] + 1);
      else if (query.limit !== null) rows = rows.slice(0, query.limit);
      return { data: rows, error: null, count: query.count ? total : null };
    };

    const chain: Record<string, unknown> = {
      select: (select: string, opts?: { count?: string }) => {
        query.select = select;
        query.count = opts?.count === 'exact';
        return chain;
      },
      eq: (column: string, value: unknown) => { query.filters.push({ op: 'eq', column, value }); return chain; },
      neq: (column: string, value: unknown) => { query.filters.push({ op: 'neq', column, value }); return chain; },
      in: (column: string, value: unknown[]) => { query.filters.push({ op: 'in', column, value }); return chain; },
      is: (column: string, value: unknown) => { query.filters.push({ op: 'is', column, value }); return chain; },
      lte: (column: string, value: unknown) => { query.filters.push({ op: 'lte', column, value }); return chain; },
      gte: (column: string, value: unknown) => { query.filters.push({ op: 'gte', column, value }); return chain; },
      ilike: (column: string, value: string) => { query.ors.push(`${column}.ilike.${value}`); return chain; },
      or: (expression: string) => { query.ors.push(expression); return chain; },
      order: (column: string, opts?: { ascending?: boolean }) => {
        query.orders.push({ column, ascending: opts?.ascending !== false });
        return chain;
      },
      limit: (limit: number) => { query.limit = limit; return chain; },
      range: (from: number, to: number) => { query.range = [from, to]; return chain; },
      returns: () => chain,
      maybeSingle: async () => { const result = run(); return { ...result, data: result.data?.[0] ?? null }; },
      single: async () => { const result = run(); return { ...result, data: result.data?.[0] ?? null }; },
      then: (resolve: (result: unknown) => unknown) => Promise.resolve(run()).then(resolve),
    };
    return chain;
  }

  return {
    queries,
    rpcCalls,
    from,
    auth: {
      getUser: async () => h.auth,
    },
    rpc: async (name: string, args: Row) => {
      rpcCalls.push({ name, args });
      return options.rpcError
        ? { data: null, error: { message: options.rpcError } }
        : { data: options.availability ?? [], error: null };
    },
  };
}

// ---------------------------------------------------------------------------
// Mock surface
// ---------------------------------------------------------------------------

const h = vi.hoisted(() => ({
  auth: { data: null as { user: { id: string; email: string } } | null, error: null as { message: string } | null },
  client: null as ReturnType<typeof Object> | null,
}));

vi.mock('@/lib/mobile/supabase', () => ({
  createMobileSupabaseClient: () => h.client,
}));

import { GET as listProducts } from '@/app/api/mobile/v1/catalog/products/route';
import { GET as getProduct } from '@/app/api/mobile/v1/catalog/products/[id]/route';
import { GET as listCategories } from '@/app/api/mobile/v1/catalog/categories/route';
import { GET as listBrands } from '@/app/api/mobile/v1/catalog/brands/route';
import { GET as getHome } from '@/app/api/mobile/v1/home/route';
import { resetRateLimits } from '@/lib/mobile/rate-limit';
import {
  DEFAULT_MOBILE_CATALOG_FILTERS,
  parseCatalogQuery,
  toMobileBanners,
  toMobileCategories,
  toMobileCatalogProduct,
} from '@/lib/mobile/catalog';
import { encodeCursor } from '@/lib/infinite-scroll/cursor';
import type { PricedCatalogCard } from '@/lib/retailer/catalog';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const RETAILER = '11111111-1111-4111-8111-111111111111';
const AREA = '22222222-2222-4222-8222-222222222222';
const PRODUCT_1 = '33333333-3333-4333-8333-333333333331';
const PRODUCT_2 = '33333333-3333-4333-8333-333333333332';
const PRODUCT_3 = '33333333-3333-4333-8333-333333333333';
const PACK_1 = '44444444-4444-4444-8444-444444444441';
const PACK_2 = '44444444-4444-4444-8444-444444444442';
const PACK_3 = '44444444-4444-4444-8444-444444444443';
const CATEGORY_1 = '55555555-5555-4555-8555-555555555551';
const CATEGORY_2 = '55555555-5555-4555-8555-555555555552';
const BRAND_1 = '66666666-6666-4666-8666-666666666661';
const BRAND_2 = '66666666-6666-4666-8666-666666666662';

const IMAGE = 'https://ref.supabase.co/storage/v1/object/public/product-images/p1.jpg';

function pack(id: string, productId: string, over: Row = {}): Row {
  return {
    id,
    product_id: productId,
    pack_name: '500g',
    ptr: null,
    base_price: 250,
    case_price: 1000,
    units_per_case: 4,
    mrp: 300,
    moq: 4,
    allow_loose_pieces: true,
    barcode: null,
    image_url: IMAGE,
    is_active: true,
    sort_order: 0,
    stock_quantity: 40,
    cost_price: 700,
    ...over,
  };
}

function product(id: string, over: Row = {}, packs: Row[] = []): Row {
  return {
    id,
    name: 'Basmati Rice',
    sku_code: `SKU-${id.slice(-2)}`,
    barcode: null,
    unit: 'carton',
    hsn_code: '1006',
    lead_time_days: 2,
    category_id: CATEGORY_1,
    brand_id: BRAND_1,
    gst_percent: 5,
    is_new_launch: false,
    is_active: true,
    created_at: '2026-01-01T00:00:00.000Z',
    brands: { id: BRAND_1, name: 'Maharani' },
    categories: { id: CATEGORY_1, name: 'Rice' },
    product_images: [{ id: 'img-1', image_url: IMAGE, sort_order: 0 }],
    product_packs: packs,
    ...over,
  };
}

/** Three real products: two in stock, one out of stock. */
function threeProductTables(): Record<string, Row[]> {
  const pack1 = pack(PACK_1, PRODUCT_1);
  const pack2 = pack(PACK_2, PRODUCT_2, {
    pack_name: '1L', units_per_case: 12, case_price: 1200, mrp: 130, moq: 12, sort_order: 0,
  });
  const pack3 = pack(PACK_3, PRODUCT_3, { pack_name: '1kg', case_price: 800, mrp: 220, moq: 8 });

  return {
    profiles: [{ id: RETAILER, role: 'retailer', full_name: 'Gupta Kirana', is_active: true, phone: '9876543210' }],
    retailers: [{ id: RETAILER, status: 'active', shop_name: 'Gupta Kirana Store', area_id: AREA }],
    user_access_periods: [{ user_id: RETAILER, status: 'active', expires_at: '2030-01-01T00:00:00.000Z' }],
    products: [
      product(PRODUCT_1, { name: 'Basmati Rice', is_new_launch: true, created_at: '2026-03-01T00:00:00.000Z' }, [pack1]),
      product(PRODUCT_2, { name: 'Sunflower Oil', category_id: CATEGORY_2, brand_id: BRAND_2, created_at: '2025-06-01T00:00:00.000Z' }, [pack2]),
      product(PRODUCT_3, { name: 'Toor Dal', created_at: '2025-01-01T00:00:00.000Z' }, [pack3]),
    ],
    product_packs: [pack1, pack2, pack3],
    product_pack_images: [
      { id: 'pi-1', product_pack_id: PACK_1, image_url: IMAGE, sort_order: 0 },
    ],
    product_images: [{ id: 'img-1', product_id: PRODUCT_1, image_url: IMAGE, sort_order: 0 }],
    categories: [
      { id: CATEGORY_1, name: 'Rice', image_url: null, parent_id: null, is_active: true, sort_order: 0, products: [{ count: 1 }] },
      { id: CATEGORY_2, name: 'Oils', image_url: null, parent_id: null, is_active: true, sort_order: 1, products: [{ count: 1 }] },
    ],
    brands: [
      { id: BRAND_1, name: 'Maharani', logo_url: null, is_active: true, products: [{ count: 2 }] },
      { id: BRAND_2, name: 'Fortune', logo_url: null, is_active: true, products: [{ count: 1 }] },
    ],
    price_lists: [],
    product_pricing_tiers: [],
    retailer_favorites: [],
    banners: [],
  };
}

const AVAILABILITY = [
  { pack_id: PACK_1, stock_status: 'in_stock' },
  { pack_id: PACK_2, stock_status: 'in_stock' },
  { pack_id: PACK_3, stock_status: 'out_of_stock' },
];

/** 30 in-stock products, so a real second batch exists at the 24-row page size. */
function thirtyProductTables(): Record<string, Row[]> {
  const tables = threeProductTables();
  const products = [...tables.products!];
  const packs = [...tables.product_packs!];
  const availability = [...AVAILABILITY];

  for (let index = 0; index < 27; index += 1) {
    const id = `77777777-7777-4777-8777-77777777${String(index).padStart(4, '0')}`;
    const packId = `88888888-8888-4888-8888-88888888${String(index).padStart(4, '0')}`;
    const row = pack(packId, id, { pack_name: `${index}kg`, case_price: 100 + index });
    packs.push(row);
    availability.push({ pack_id: packId, stock_status: 'in_stock' });
    products.push(product(id, { name: `Product ${String(index).padStart(2, '0')}`, created_at: '2024-01-01T00:00:00.000Z' }, [row]));
  }

  return { ...tables, products, product_packs: packs };
}

function install(tables: Record<string, Row[]>, options: DoubleOptions = {}) {
  h.client = createDouble(tables, { availability: AVAILABILITY, ...options }) as never;
  h.auth = { data: { user: { id: RETAILER, email: 'gupta@example.com' } }, error: null };
  return h.client as unknown as ReturnType<typeof createDouble>;
}

function request(path: string, token = 'valid-token'): Request {
  return new Request(`https://api.test${path}`, {
    headers: token ? { authorization: `Bearer ${token}` } : {},
  });
}

/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * The decoded wire payload, left deliberately untyped.
 *
 * These tests assert on the raw JSON the routes emit — that shape IS the
 * contract under test — so typing it here would only restate the thing being
 * verified, and would let the compiler paper over a changed field name.
 */
type Wire = Record<string, any>;
/* eslint-enable @typescript-eslint/no-explicit-any */

async function body(response: Response): Promise<Wire> {
  return (await response.json()) as Wire;
}

beforeEach(() => {
  resetRateLimits();
});

// ---------------------------------------------------------------------------
// 1. Session and role gates
// ---------------------------------------------------------------------------

describe('catalogue endpoints enforce the same session gates as the rest of the API', () => {
  const endpoints: [string, (req: Request) => Promise<Response>][] = [
    ['/api/mobile/v1/catalog/products', listProducts],
    ['/api/mobile/v1/catalog/categories', listCategories],
    ['/api/mobile/v1/catalog/brands', listBrands],
    ['/api/mobile/v1/home', getHome],
  ];

  for (const [path, handler] of endpoints) {
    it(`${path} requires a bearer token`, async () => {
      install(threeProductTables());
      const response = await handler(request(path, ''));
      expect(response.status).toBe(401);
      expect((await body(response)).error).toMatchObject({ code: 'missing_token' });
    });

    it(`${path} rejects a token GoTrue does not verify`, async () => {
      install(threeProductTables());
      h.auth = { data: null, error: { message: 'invalid jwt' } };
      const response = await handler(request(path));
      expect(response.status).toBe(401);
      const payload = await body(response);
      expect(['invalid_token', 'expired_token']).toContain(payload.error.code);
    });

    it(`${path} rejects an inactive profile`, async () => {
      const tables = threeProductTables();
      tables.profiles = [{ ...tables.profiles![0]!, is_active: false }];
      install(tables);
      const response = await handler(request(path));
      expect(response.status).toBe(403);
      expect((await body(response)).error).toMatchObject({ code: 'account_inactive' });
    });

    it(`${path} rejects a retailer awaiting approval`, async () => {
      const tables = threeProductTables();
      tables.retailers = [{ ...tables.retailers![0]!, status: 'pending_approval' }];
      install(tables);
      const response = await handler(request(path));
      expect(response.status).toBe(403);
      expect((await body(response)).error).toMatchObject({ code: 'retailer_pending_approval' });
    });

    it(`${path} rejects a suspended retailer`, async () => {
      const tables = threeProductTables();
      tables.retailers = [{ ...tables.retailers![0]!, status: 'suspended' }];
      install(tables);
      const response = await handler(request(path));
      expect(response.status).toBe(403);
      expect((await body(response)).error).toMatchObject({ code: 'account_suspended' });
    });

    it(`${path} rejects a lapsed access period`, async () => {
      const tables = threeProductTables();
      tables.user_access_periods = [
        { user_id: RETAILER, status: 'active', expires_at: '2020-01-01T00:00:00.000Z' },
      ];
      install(tables);
      const response = await handler(request(path));
      expect(response.status).toBe(403);
      expect((await body(response)).error).toMatchObject({ code: 'access_expired' });
    });

    it(`${path} is retailer-only`, async () => {
      const tables = threeProductTables();
      tables.profiles = [{ ...tables.profiles![0]!, role: 'staff' }];
      install(tables);
      const response = await handler(request(path));
      expect(response.status).toBe(403);
      expect((await body(response)).error).toMatchObject({ code: 'forbidden' });
    });

    it(`${path} returns a sanitized error envelope with a request id`, async () => {
      install(threeProductTables());
      const response = await handler(request(path, ''));
      const payload = await body(response);
      expect(payload.requestId).toBeTruthy();
      expect(response.headers.get('X-Request-Id')).toBe(payload.requestId);
      // No driver text, SQL or hostname may reach the client.
      expect(JSON.stringify(payload)).not.toMatch(/postgres|supabase\.co|select \*|stack/i);
    });
  }
});

// ---------------------------------------------------------------------------
// 2. The catalogue list
// ---------------------------------------------------------------------------

describe('GET /api/mobile/v1/catalog/products', () => {
  it('returns the collection envelope the contract specifies', async () => {
    install(threeProductTables());
    const response = await listProducts(request('/api/mobile/v1/catalog/products'));

    expect(response.status).toBe(200);
    const payload = await body(response);
    expect(Array.isArray(payload.data)).toBe(true);
    expect(payload.page).toMatchObject({ hasMore: false, limit: 24 });
    expect(payload.page.nextCursor).toBeNull();
    expect(payload.meta).toMatchObject({ resultCount: 3, resultCapped: false });
  });

  it('prices every card in integer paise using the shared pricing engine', async () => {
    install(threeProductTables());
    const payload = await body(await listProducts(request('/api/mobile/v1/catalog/products')));
    const cards = payload.data as Wire[];
    const rice = cards.find((card) => card.id === PRODUCT_1)!;

    // case_price 1000 / units_per_case 4 = ₹250 per piece, GST-inclusive.
    expect(rice.pack).toMatchObject({
      packId: PACK_1,
      packName: '500g',
      unitsPerCase: 4,
      moq: 4,
      unitPricePaise: 25000,
      mrpPaise: 30000,
      derivedCasePricePaise: 100000,
      availability: 'in_stock',
    });
    expect(Number.isInteger(rice.pack.unitPricePaise)).toBe(true);
    expect(Number.isInteger(rice.pack.mrpPaise)).toBe(true);

    const oil = cards.find((card) => card.id === PRODUCT_2)!;
    expect(oil.pack).toMatchObject({ packName: '1L', unitsPerCase: 12, moq: 12, unitPricePaise: 10000 });
  });

  it('carries real product images and never invents a price for an unpriced pack', async () => {
    install(threeProductTables());
    const payload = await body(await listProducts(request('/api/mobile/v1/catalog/products')));
    const cards = payload.data as Wire[];
    expect(cards.find((card) => card.id === PRODUCT_1)!.pack.imageUrl ?? IMAGE).toBe(IMAGE);
    expect(cards.find((card) => card.id === PRODUCT_1)!.imageUrl).toBe(IMAGE);

    // A pack with no case price cannot be priced: the answer is null, not 0.
    const broken = threeProductTables();
    broken.products = [product(PRODUCT_1, { name: 'Unpriced' }, [pack(PACK_1, PRODUCT_1, { case_price: 0, base_price: 0 })])];
    broken.product_packs = [pack(PACK_1, PRODUCT_1, { case_price: 0, base_price: 0 })];
    install(broken);
    const unpriced = await body(await listProducts(request('/api/mobile/v1/catalog/products')));
    expect((unpriced.data as Wire[])[0]!.pack.unitPricePaise).toBeNull();
  });

  it('exposes the two-state availability vocabulary and never an exact stock count', async () => {
    const client = install(threeProductTables());
    const payload = await body(await listProducts(request('/api/mobile/v1/catalog/products')));
    const cards = payload.data as Wire[];
    const states = cards.map((card) => card.pack.availability);
    expect(states).toContain('in_stock');
    expect(states).toContain('out_of_stock');
    for (const state of states) {
      expect(['in_stock', 'out_of_stock', 'unknown']).toContain(state);
    }

    // The status-only RPC is what supplied them.
    expect(client.rpcCalls.map((call) => call.name)).toContain('get_retailer_pack_availability');

    const raw = JSON.stringify(payload);
    expect(raw).not.toContain('stock_quantity');
    expect(raw).not.toContain('cost_price');
    expect(raw).not.toContain('"available"');
  });

  it('reports unknown — not in stock — when availability cannot be read', async () => {
    install(threeProductTables(), { rpcError: 'rpc unavailable' });
    const payload = await body(await listProducts(request('/api/mobile/v1/catalog/products')));
    const cards = payload.data as Wire[];
    expect(cards.length).toBe(3);
    for (const card of cards) expect(card.pack.availability).toBe('unknown');
  });

  it('sorts new launches first, then by name (the existing recommended order)', async () => {
    install(threeProductTables());
    const payload = await body(await listProducts(request('/api/mobile/v1/catalog/products')));
    const names = (payload.data as Wire[]).map((card) => card.name);
    expect(names[0]).toContain('Basmati Rice');
    expect(names).toEqual([...names].sort((a, b) => String(a).localeCompare(String(b))));
  });

  it('paginates with an opaque cursor that advances without repeating rows', async () => {
    install(thirtyProductTables());
    const first = await body(await listProducts(request('/api/mobile/v1/catalog/products')));
    expect((first.data as unknown[]).length).toBe(24);
    expect(first.page.hasMore).toBe(true);
    const cursor = first.page.nextCursor as string;
    expect(cursor).toBeTruthy();
    // Opaque: the client cannot read the ordering columns out of it.
    expect(cursor).not.toContain('name');

    const second = await body(
      await listProducts(request(`/api/mobile/v1/catalog/products?cursor=${encodeURIComponent(cursor)}`))
    );
    expect((second.data as unknown[]).length).toBe(6);
    expect(second.page.hasMore).toBe(false);
    expect(second.page.nextCursor).toBeNull();

    const firstIds = new Set((first.data as Wire[]).map((card) => card.id));
    const overlap = (second.data as Wire[]).filter((card) => firstIds.has(card.id));
    expect(overlap).toEqual([]);
  });

  it('rejects a cursor it cannot decode instead of restarting the list', async () => {
    install(thirtyProductTables());
    const response = await listProducts(request('/api/mobile/v1/catalog/products?cursor=not-a-cursor'));
    expect(response.status).toBe(400);
    expect((await body(response)).error).toMatchObject({ code: 'invalid_request' });
  });

  it('accepts a cursor the server itself issued', async () => {
    install(thirtyProductTables());
    const cursor = encodeCursor({ k: 'keyset', v: [true, 'Basmati Rice', PRODUCT_1] });
    const response = await listProducts(
      request(`/api/mobile/v1/catalog/products?cursor=${encodeURIComponent(cursor)}`)
    );
    expect(response.status).toBe(200);
  });

  it('filters by category using the caller-supplied id and nothing else', async () => {
    const client = install(threeProductTables());
    await listProducts(request(`/api/mobile/v1/catalog/products?categoryId=${CATEGORY_2}`));
    const productQuery = client.queries.find((query) => query.table === 'products' && query.select.includes('product_packs'))!;
    expect(productQuery.filters).toContainEqual({ op: 'in', column: 'category_id', value: [CATEGORY_2] });
  });

  it('rejects a category id that is not a uuid', async () => {
    install(threeProductTables());
    const response = await listProducts(request("/api/mobile/v1/catalog/products?categoryId=1' OR 1=1"));
    expect(response.status).toBe(400);
    const payload = await body(response);
    expect(payload.error).toMatchObject({ code: 'invalid_request' });
    expect(payload.error.details.fields.categoryId).toBeTruthy();
  });

  it('rejects a price range that cannot match', async () => {
    install(threeProductTables());
    const response = await listProducts(request('/api/mobile/v1/catalog/products?minPrice=500&maxPrice=10'));
    expect(response.status).toBe(400);
    expect((await body(response)).error).toMatchObject({ code: 'invalid_request' });
  });

  it('sanitizes the search term before it reaches the database', async () => {
    const client = install(threeProductTables());
    const response = await listProducts(request('/api/mobile/v1/catalog/products?q=%25ad%25min%27--'));
    expect(response.status).toBe(200);
    const searchQuery = client.queries.find((query) => query.ors.length > 0);
    expect(searchQuery).toBeTruthy();
    const expression = searchQuery!.ors.join(' ');
    expect(expression).not.toContain('%admin%');
    expect(expression).not.toContain("'");
    // The sanitized term still searches name and barcode.
    expect(expression).toContain('name.ilike');
  });

  it('keeps only in-stock packs when inStock=1, and drops unknown ones too', async () => {
    install(threeProductTables());
    const payload = await body(await listProducts(request('/api/mobile/v1/catalog/products?inStock=1')));
    const cards = payload.data as Wire[];
    expect(cards.map((card) => card.id).sort()).toEqual([PRODUCT_1, PRODUCT_2]);
    for (const card of cards) expect(card.pack.availability).toBe('in_stock');

    // With the availability RPC down, nothing may claim to be in stock.
    resetRateLimits();
    install(threeProductTables(), { rpcError: 'rpc unavailable' });
    const unavailable = await body(await listProducts(request('/api/mobile/v1/catalog/products?inStock=1')));
    expect(unavailable.data).toEqual([]);
  });

  it('ignores identity supplied by the caller', async () => {
    const client = install(threeProductTables());
    const response = await listProducts(
      request(`/api/mobile/v1/catalog/products?retailerId=other&areaId=other&role=admin`)
    );
    expect(response.status).toBe(200);
    // The retailer and its area were read from the caller's OWN rows.
    const retailerQueries = client.queries.filter((query) => query.table === 'retailers');
    expect(retailerQueries.length).toBeGreaterThan(0);
    for (const query of retailerQueries) {
      expect(query.filters).toContainEqual({ op: 'eq', column: 'id', value: RETAILER });
    }
  });
});

// ---------------------------------------------------------------------------
// 3. Product detail
// ---------------------------------------------------------------------------

describe('GET /api/mobile/v1/catalog/products/{id}', () => {
  const detail = (id: string) =>
    getProduct(request(`/api/mobile/v1/catalog/products/${id}`), { params: { id } });

  it('returns every active pack priced at its own MOQ', async () => {
    install(threeProductTables());
    const response = await detail(PRODUCT_1);
    expect(response.status).toBe(200);
    const payload = await body(response);

    expect(payload.data).toMatchObject({
      id: PRODUCT_1,
      name: 'Basmati Rice',
      brandName: 'Maharani',
      categoryName: 'Rice',
      unit: 'carton',
      hsnCode: '1006',
      gstPercent: 5,
      isNewLaunch: true,
    });
    expect(payload.data.images).toEqual([IMAGE]);
    expect(payload.data.packs).toHaveLength(1);
    expect(payload.data.packs[0]).toMatchObject({
      packId: PACK_1,
      packName: '500g',
      unitsPerCase: 4,
      moq: 4,
      allowLoosePieces: true,
      unitPricePaise: 25000,
      lineTotalAtMoqPaise: 100000,
      mrpPaise: 30000,
      availability: 'in_stock',
      selected: false,
    });
    expect(payload.data.packs[0].images).toEqual([IMAGE]);
  });

  it('resolves a pack id to its product and marks that pack selected', async () => {
    install(threeProductTables());
    const payload = await body(await detail(PACK_1));
    expect(payload.data.id).toBe(PRODUCT_1);
    expect(payload.data.packs[0]).toMatchObject({ packId: PACK_1, selected: true });
  });

  it('answers 404 for an id that does not exist or is not visible', async () => {
    install(threeProductTables());
    for (const id of ['99999999-9999-4999-8999-999999999999', 'not-a-uuid']) {
      const response = await detail(id);
      expect(response.status).toBe(404);
      expect((await body(response)).error).toMatchObject({ code: 'not_found' });
    }
  });

  it('never leaks an exact stock count or a cost price', async () => {
    install(threeProductTables());
    const raw = JSON.stringify(await body(await detail(PRODUCT_1)));
    expect(raw).not.toContain('stock_quantity');
    expect(raw).not.toContain('cost_price');
    expect(raw).not.toContain('ptr');
  });

  it('is retailer-only', async () => {
    const tables = threeProductTables();
    tables.profiles = [{ ...tables.profiles![0]!, role: 'admin' }];
    install(tables);
    const response = await detail(PRODUCT_1);
    expect(response.status).toBe(403);
    expect((await body(response)).error).toMatchObject({ code: 'forbidden' });
  });
});

// ---------------------------------------------------------------------------
// 4. Taxonomy + home
// ---------------------------------------------------------------------------

describe('GET /api/mobile/v1/catalog/categories and /brands', () => {
  it('returns real categories with rolled-up active product counts', async () => {
    install(threeProductTables());
    const payload = await body(await listCategories(request('/api/mobile/v1/catalog/categories')));
    expect(payload.data.categories).toEqual([
      { id: CATEGORY_1, name: 'Rice', imageUrl: null, parentName: null, productCount: 1 },
      { id: CATEGORY_2, name: 'Oils', imageUrl: null, parentName: null, productCount: 1 },
    ]);
  });

  it('returns real brands, ordered by name', async () => {
    install(threeProductTables());
    const payload = await body(await listBrands(request('/api/mobile/v1/catalog/brands')));
    // `order('name')`, so "Fortune" precedes "Maharani".
    expect(payload.data.brands).toEqual([
      { id: BRAND_2, name: 'Fortune', logoUrl: null, productCount: 1 },
      { id: BRAND_1, name: 'Maharani', logoUrl: null, productCount: 2 },
    ]);
  });
});

describe('GET /api/mobile/v1/home', () => {
  const bannerRow = (over: Row = {}): Row => ({
    id: '99999999-0000-4000-8000-000000000001',
    title: 'Diwali wholesale deals',
    subtitle: 'Up to 12% off cases',
    image_url: 'https://ref.supabase.co/storage/v1/object/public/banners/diwali.jpg',
    cta_label: 'Shop now',
    link_url: '/retailer/catalog',
    is_active: true,
    area_id: null,
    starts_at: null,
    ends_at: null,
    sort_order: 0,
    ...over,
  });

  it('returns banners, categories and a real catalogue batch', async () => {
    const tables = threeProductTables();
    tables.banners = [bannerRow()];
    install(tables);

    const payload = await body(await getHome(request('/api/mobile/v1/home')));
    expect(payload.data.banners).toEqual([
      {
        id: '99999999-0000-4000-8000-000000000001',
        title: 'Diwali wholesale deals',
        subtitle: 'Up to 12% off cases',
        imageUrl: 'https://ref.supabase.co/storage/v1/object/public/banners/diwali.jpg',
        ctaLabel: 'Shop now',
        linkUrl: '/retailer/catalog',
      },
    ]);
    expect((payload.data.categories as unknown[]).length).toBe(2);
    expect((payload.data.products as unknown[]).length).toBe(3);
    expect((payload.data.products as Wire[])[0]!.pack.unitPricePaise).toBe(25000);
  });

  it('returns an empty banner array rather than fabricated promotions', async () => {
    install(threeProductTables());
    const payload = await body(await getHome(request('/api/mobile/v1/home')));
    expect(payload.data.banners).toEqual([]);
  });

  it('hides banners outside their schedule or targeted at another area', async () => {
    const tables = threeProductTables();
    tables.banners = [
      bannerRow({ id: 'b-expired', ends_at: '2020-01-01T00:00:00.000Z' }),
      bannerRow({ id: 'b-future', starts_at: '2030-01-01T00:00:00.000Z' }),
      bannerRow({ id: 'b-other-area', area_id: '00000000-0000-4000-8000-000000000009' }),
    ];
    install(tables);
    const payload = await body(await getHome(request('/api/mobile/v1/home')));
    expect(payload.data.banners).toEqual([]);
  });

  it('drops an unsafe banner link instead of passing it through', async () => {
    const tables = threeProductTables();
    tables.banners = [bannerRow({ link_url: 'javascript:alert(1)' })];
    install(tables);
    const payload = await body(await getHome(request('/api/mobile/v1/home')));
    expect(payload.data.banners[0]!.linkUrl).toBeNull();
    expect(payload.data.banners[0]!.title).toBe('Diwali wholesale deals');
  });

  it('keeps working when the banner read fails', async () => {
    install(threeProductTables(), { tableErrors: { banners: 'read failed' } });
    const payload = await body(await getHome(request('/api/mobile/v1/home')));
    expect(payload.data.banners).toEqual([]);
    expect((payload.data.products as unknown[]).length).toBe(3);
  });
});

// ---------------------------------------------------------------------------
// 5. Pure mapping
// ---------------------------------------------------------------------------

describe('mobile catalogue mapping', () => {
  const card = (over: Partial<PricedCatalogCard> = {}): PricedCatalogCard => ({
    id: PRODUCT_1,
    name: 'Basmati Rice 500g',
    brandName: 'Maharani',
    imageUrl: IMAGE,
    isNewLaunch: true,
    fromPrice: 250,
    mrp: 300,
    packName: '500g',
    moq: 4,
    defaultPackId: PACK_1,
    gstPercent: 5,
    availability: 'in_stock',
    isFavorite: false,
    hasOffer: false,
    piecePricing: { unitsPerCase: 4, derivedPiecePrice: 250, tiers: [] },
    categoryId: CATEGORY_1,
    brandId: BRAND_1,
    createdAt: '2026-01-01T00:00:00.000Z',
    timesOrdered: 0,
    ...over,
  });

  it('converts money to integer paise and keeps nulls null', () => {
    expect(toMobileCatalogProduct(card()).pack).toMatchObject({ unitPricePaise: 25000, mrpPaise: 30000 });
    expect(toMobileCatalogProduct(card({ fromPrice: null, mrp: null })).pack).toMatchObject({
      unitPricePaise: null,
      mrpPaise: null,
    });
  });

  it('returns no pack block at all for a product with no active pack', () => {
    expect(toMobileCatalogProduct(card({ defaultPackId: null, fromPrice: null })).pack).toBeNull();
  });

  it('normalizes an unrecognised availability value to unknown', () => {
    expect(toMobileCatalogProduct(card({ availability: 'low_stock' as never })).pack!.availability).toBe('unknown');
  });

  it('maps slab tiers into paise with their piece bounds', () => {
    const mapped = toMobileCatalogProduct(
      card({
        piecePricing: {
          unitsPerCase: 4,
          derivedPiecePrice: 250,
          tiers: [{ min_quantity: 8, max_quantity: 16, price_per_piece: 240 }, { min_quantity: 16, max_quantity: null, price_per_piece: 235 }],
        },
      })
    );
    expect(mapped.pack!.tiers).toEqual([
      { minQuantity: 8, maxQuantity: 16, pricePerPiecePaise: 24000 },
      { minQuantity: 16, maxQuantity: null, pricePerPiecePaise: 23500 },
    ]);
  });

  it('returns null for an image the app cannot render', () => {
    expect(toMobileCatalogProduct(card({ imageUrl: 'blob:https://x/1' })).imageUrl).toBeNull();
    expect(toMobileCatalogProduct(card({ imageUrl: undefined })).imageUrl).toBeNull();
  });

  it('rolls a parent category up with its children and reports unknown honestly', () => { {
    const rows = [
      { id: 'c-parent', name: 'Rice', image_url: null, parent_id: null, products: [{ count: 2 }] },
      { id: 'c-child', name: 'Basmati', image_url: null, parent_id: 'c-parent', products: [{ count: 3 }] },
      { id: 'c-orphan', name: 'Oils', image_url: null, parent_id: null, products: null },
    ];
    const categories = toMobileCategories(rows);
    expect(categories).toHaveLength(2);
    expect(categories[0]).toMatchObject({ id: 'c-parent', productCount: 5 });
    expect(categories[1]).toMatchObject({ id: 'c-orphan', productCount: null });
  } });

  it('applies the existing banner schedule and area targeting', () => {
    const now = Date.parse('2026-06-15T00:00:00.000Z');
    const base = {
      id: 'b1', title: 'T', subtitle: null, image_url: IMAGE, cta_label: null,
      link_url: null, is_active: true, area_id: null, starts_at: null, ends_at: null,
    };
    expect(toMobileBanners([base], AREA, now)).toHaveLength(1);
    expect(toMobileBanners([{ ...base, is_active: false }], AREA, now)).toHaveLength(0);
    expect(toMobileBanners([{ ...base, area_id: 'other' }], AREA, now)).toHaveLength(0);
    expect(toMobileBanners([{ ...base, area_id: AREA }], AREA, now)).toHaveLength(1);
    expect(toMobileBanners([{ ...base, starts_at: '2026-07-01' }], AREA, now)).toHaveLength(0);
    expect(toMobileBanners([{ ...base, ends_at: '2026-06-15' }], AREA, now)).toHaveLength(1);
  });

  it('parses and validates the catalogue query string', () => {
    expect(parseCatalogQuery('https://x/api?q=rice&sort=name').ok).toBe(true);
    const parsed = parseCatalogQuery('https://x/api?q=rice&sort=name');
    expect(parsed.ok && parsed.filters).toMatchObject({ q: 'rice', sort: 'name' });

    // An unknown sort falls back rather than erroring, so an older app keeps working.
    const fallback = parseCatalogQuery('https://x/api?sort=invented');
    expect(fallback.ok && fallback.filters.sort).toBe('recommended');

    expect(parseCatalogQuery('https://x/api?categoryId=nope')).toEqual({ ok: false, field: 'categoryId' });
    expect(parseCatalogQuery('https://x/api?brandId=nope')).toEqual({ ok: false, field: 'brandId' });
    expect(parseCatalogQuery('https://x/api?minPrice=-1')).toEqual({ ok: false, field: 'minPrice' });
    expect(parseCatalogQuery('https://x/api?minPrice=9&maxPrice=1')).toEqual({ ok: false, field: 'minPrice' });

    // inStock / new / offers are explicit flags, and the default filter set is off.
    const inStockOnly = parseCatalogQuery('https://x/api?inStock=1');
    expect(inStockOnly.ok && inStockOnly.filters.onlyInStock).toBe(true);
    const unfiltered = parseCatalogQuery('https://x/api');
    expect(unfiltered.ok && unfiltered.filters.onlyInStock).toBe(false);
    expect(DEFAULT_MOBILE_CATALOG_FILTERS.onlyInStock).toBe(false);
    expect(DEFAULT_MOBILE_CATALOG_FILTERS.sort).toBe('recommended');
  });
});

// ---------------------------------------------------------------------------
// 6. Wire contract lock: the Kotlin DTOs and the route payloads must agree
// ---------------------------------------------------------------------------

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Field names of one `@Serializable data class` in the Android DTO source.
 *
 * WHY THIS TEST EXISTS: the Android DTOs are hand-written and the sandbox has no
 * JDK, so a field the server renamed — or a Kotlin field the server never sends —
 * would otherwise only surface as a silently defaulted value on a product card.
 * Comparing the two sides here makes the contract a test rather than a promise.
 */
function kotlinDtoFields(className: string): Set<string> {
  const source = readFileSync(
    join(__dirname, '..', 'android', 'core', 'network', 'src', 'main', 'kotlin', 'com',
      'maharanitraders', 'core', 'network', 'dto', 'CatalogDtos.kt'),
    'utf8'
  );
  const declaration = new RegExp(`data class ${className}\\(([\\s\\S]*?)\\n\\)`, 'm').exec(source);
  if (!declaration) throw new Error(`data class ${className} not found in CatalogDtos.kt`);
  return new Set(
    [...declaration[1]!.matchAll(/^\s{2}(?:val|var)\s+([A-Za-z_]\w*)/gm)].map((m) => m[1]!)
  );
}

function envelopeFields(className: string): Set<string> {
  const source = readFileSync(
    join(__dirname, '..', 'android', 'core', 'network', 'src', 'main', 'kotlin', 'com',
      'maharanitraders', 'core', 'network', 'dto', 'ApiDtos.kt'),
    'utf8'
  );
  const declaration = new RegExp(`data class ${className}(?:<T>)?\\(([\\s\\S]*?)\\n\\)`, 'm').exec(source);
  if (!declaration) throw new Error(`data class ${className} not found in ApiDtos.kt`);
  return new Set(
    [...declaration[1]!.matchAll(/^\s{2}(?:val|var)\s+([A-Za-z_]\w*)/gm)].map((m) => m[1]!)
  );
}

/** Keys present anywhere in a value, at the top level of objects only. */
function objectKeys(value: unknown): Set<string> {
  return new Set(value && typeof value === 'object' && !Array.isArray(value)
    ? Object.keys(value as Record<string, unknown>)
    : []);
}

function assertSameFields(actual: Set<string>, declared: Set<string>, label: string): void {
  // Guard against a regex change silently emptying one side, which would turn
  // this contract lock into a test that can no longer fail.
  expect(actual.size, `${label}: no fields observed on the wire`).toBeGreaterThanOrEqual(2);
  expect(declared.size, `${label}: no fields parsed from the Kotlin source`).toBeGreaterThanOrEqual(2);

  const missingInKotlin = [...actual].filter((key) => !declared.has(key)).sort();
  const neverSentByServer = [...declared].filter((key) => !actual.has(key)).sort();
  expect(missingInKotlin, `${label}: server sends fields no Kotlin DTO declares`).toEqual([]);
  expect(neverSentByServer, `${label}: Kotlin DTO declares fields the server never sends`).toEqual([]);
}

describe('the Android DTOs and the mobile catalogue payloads agree field for field', () => {
  it('locks the product card, pack, tier and page shapes', async () => {
    install(thirtyProductTables());
    const response = await listProducts(request('/api/mobile/v1/catalog/products'));
    const payload = await body(response);
    const card = (payload.data as Wire[])[0]!;

    assertSameFields(objectKeys(card), kotlinDtoFields('CatalogProductDto'), 'CatalogProductDto');
    assertSameFields(objectKeys(card.pack), kotlinDtoFields('CatalogPackDto'), 'CatalogPackDto');
    assertSameFields(objectKeys(payload.page), envelopeFields('PageDto'), 'PageDto');
    assertSameFields(objectKeys(payload.meta), envelopeFields('ListMetaDto'), 'ListMetaDto');

    // With no slab rows configured the engine prices off the case price and
    // emits NO tiers — an honest empty array, not an invented slab.
    expect(card.pack.tiers).toEqual([]);

    // The slab shape, from a pack that really does have slabs configured.
    // Loose slabs only price a remainder BELOW one case, so the pack is 12 to a
    // case and the slabs start at 1 and 6 pieces.
    resetRateLimits();
    const slabPack = pack(PACK_1, PRODUCT_1, { units_per_case: 12, case_price: 3000, moq: 1, mrp: 300 });
    install({
      ...threeProductTables(),
      products: [product(PRODUCT_1, { name: 'Basmati Rice' }, [slabPack])],
      product_packs: [slabPack],
      product_pricing_tiers: [
        { id: 't1', product_pack_id: PACK_1, min_quantity: 1, max_quantity: 6, price_per_piece: 260, rule_type: 'loose', label: null, is_active: true },
        { id: 't2', product_pack_id: PACK_1, min_quantity: 6, max_quantity: 12, price_per_piece: 250, rule_type: 'loose', label: null, is_active: true },
      ],
    });
    const slabbed = await body(await listProducts(request('/api/mobile/v1/catalog/products')));
    const slabCard = (slabbed.data as Wire[]).find((row) => row.id === PRODUCT_1)!;
    const tiers = slabCard.pack.tiers as Wire[];
    expect(tiers.length).toBeGreaterThan(0);
    // Prices cross as paise even inside the slab table.
    for (const tier of tiers) {
      expect(Number.isInteger(tier.pricePerPiecePaise)).toBe(true);
      expect(tier.pricePerPiecePaise).toBeGreaterThan(0);
    }
    assertSameFields(objectKeys(tiers[0]), kotlinDtoFields('PriceTierDto'), 'PriceTierDto');
  });

  it('locks the product detail and pack detail shapes', async () => {
    install(threeProductTables());
    const payload = await body(
      await getProduct(request(`/api/mobile/v1/catalog/products/${PRODUCT_1}`), { params: { id: PRODUCT_1 } })
    );
    const detail = payload.data as Wire;

    assertSameFields(objectKeys(detail), kotlinDtoFields('ProductDetailDto'), 'ProductDetailDto');
    assertSameFields(objectKeys(detail.packs[0]), kotlinDtoFields('ProductPackDetailDto'), 'ProductPackDetailDto');
  });

  it('locks the home, banner, category and brand shapes', async () => {
    const tables = threeProductTables();
    tables.banners = [{
      id: 'b1', title: 'T', subtitle: 'S', image_url: IMAGE, cta_label: 'C',
      link_url: '/retailer/catalog', is_active: true, area_id: null,
      starts_at: null, ends_at: null, sort_order: 0,
    }];
    install(tables);

    const payload = await body(await getHome(request('/api/mobile/v1/home')));
    const home = payload.data as Wire;

    assertSameFields(objectKeys(home), kotlinDtoFields('RetailerHomeDto'), 'RetailerHomeDto');
    assertSameFields(objectKeys(home.banners[0]), kotlinDtoFields('PromoBannerDto'), 'PromoBannerDto');
    assertSameFields(objectKeys(home.categories[0]), kotlinDtoFields('CatalogCategoryDto'), 'CatalogCategoryDto');
    assertSameFields(objectKeys(home.brands[0]), kotlinDtoFields('CatalogBrandDto'), 'CatalogBrandDto');
  });

  it('locks the envelope shape around a collection response', async () => {
    install(threeProductTables());
    const payload = await body(await listProducts(request('/api/mobile/v1/catalog/products')));
    // `data`, `page`, `meta` and `requestId` — nothing else may appear at the top
    // level, or an installed app is reading a response it was never built for.
    expect(Object.keys(payload).sort()).toEqual(['data', 'meta', 'page', 'requestId']);
    const envelope = envelopeFields('ApiEnvelope');
    for (const key of Object.keys(payload)) expect(envelope.has(key), `${key} in ApiEnvelope`).toBe(true);
  });
});
