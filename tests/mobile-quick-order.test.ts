import { beforeEach, describe, expect, it, vi } from 'vitest';
import { supabaseFixture } from './helpers/supabase-fixture';

/**
 * Route coverage for the native quick-order endpoints.
 *
 * They mirror the web quick-order page and bulk panel: a name search priced for
 * the calling retailer, and a pasted-list matcher that resolves real packs and
 * never writes. The cart endpoint remains the only writer, so these tests also
 * pin that a match performs no insert/update/delete.
 */

const mocks = vi.hoisted(() => ({
  client: null as unknown,
}));

vi.mock('@/lib/mobile/supabase', () => ({ createMobileSupabaseClient: () => mocks.client }));

import { GET as quickOrderSearch } from '@/app/api/mobile/v1/quick-order/route';
import { POST as matchBulkLines } from '@/app/api/mobile/v1/quick-order/match/route';
import { resetRateLimits } from '@/lib/mobile/rate-limit';

const RETAILER = '11111111-1111-4111-8111-111111111111';
const STAFF = '22222222-2222-4222-8222-222222222222';

const PRODUCT = {
  id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  name: 'Parle-G Gold 50g',
  is_active: true,
  gst_percent: 18,
  is_new_launch: false,
  created_at: '2026-01-01T00:00:00Z',
  category_id: null,
  brand_id: null,
  brands: { id: 'brand-1', name: 'Parle' },
  product_images: [{ image_url: 'https://cdn.test/parle-1.png', sort_order: 1 }],
  product_packs: [
    {
      id: 'pack-active',
      pack_name: 'Box of 24',
      ptr: null,
      base_price: 10,
      case_price: 240,
      units_per_case: 24,
      mrp: 30,
      moq: 24,
      allow_loose_pieces: false,
      barcode: '8901234567890',
      image_url: null,
      is_active: true,
      sort_order: 1,
    },
    {
      id: 'pack-retired',
      pack_name: 'Retired pack',
      ptr: null,
      base_price: 10,
      case_price: 240,
      units_per_case: 24,
      mrp: 30,
      moq: 24,
      allow_loose_pieces: true,
      barcode: null,
      image_url: null,
      is_active: false,
      sort_order: 2,
    },
  ],
};

function install({ role = 'retailer', products = [PRODUCT] as object[] } = {}) {
  const client = supabaseFixture({
    profiles: [{
      id: role === 'retailer' ? RETAILER : STAFF,
      role,
      full_name: 'Shop Owner',
      phone: '9876543210',
      is_active: true,
    }],
    retailers: role === 'retailer'
      ? [{ id: RETAILER, status: 'active', area_id: null }]
      : [],
    products,
    product_pricing_tiers: [],
    price_lists: [],
    favorites: [],
  });
  Object.assign(client, {
    auth: {
      getUser: async () => ({ data: { user: { id: role === 'retailer' ? RETAILER : STAFF, email: 'shop@example.test' } }, error: null }),
    },
  });
  mocks.client = client;
  return client;
}

function apiRequest(method: string, path: string, body?: unknown) {
  const headers = new Headers();
  headers.set('authorization', 'Bearer verified-token');
  if (body !== undefined) headers.set('content-type', 'application/json');
  return new Request(`https://api.test${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

async function json(response: Response) {
  return await response.json() as Record<string, unknown>;
}

beforeEach(() => {
  resetRateLimits();
  install();
});

describe('quick order search', () => {
  it('returns only active packs with server prices for the caller', async () => {
    const response = await quickOrderSearch(apiRequest('GET', '/api/mobile/v1/quick-order?q=parle'));
    expect(response.status).toBe(200);

    const body = await json(response);
    const data = body.data as {
      term: string;
      products: { id: string; name: string; brandName: string | null; imageUrl: string | null; packs: { packId: string; unitPricePaise: number | null; derivedPiecePricePaise: number | null; availability: string }[] }[];
    };

    expect(data.term).toBe('parle');
    expect(data.products).toHaveLength(1);
    expect(data.products[0]!.name).toBe('Parle-G Gold 50g');
    expect(data.products[0]!.brandName).toBe('Parle');
    expect(data.products[0]!.imageUrl).toBe('https://cdn.test/parle-1.png');
    // Only the active pack is orderable; the retired one is not offered at all.
    expect(data.products[0]!.packs.map((pack) => pack.packId)).toEqual(['pack-active']);
    expect(data.products[0]!.packs[0]!.unitPricePaise).toBe(1000);
  });

  it('scopes the product read to active products and the pasted term', async () => {
    const client = mocks.client as ReturnType<typeof supabaseFixture>;
    await quickOrderSearch(apiRequest('GET', '/api/mobile/v1/quick-order?q=parle'));

    const productQuery = client.queries.find((query) => query.table === 'products');
    expect(productQuery).toBeTruthy();
    expect(productQuery!.filters).toEqual(
      expect.arrayContaining([{ op: 'eq', column: 'is_active', value: true }]),
    );
  });

  it('answers an empty list for an empty term without reading products', async () => {
    const client = mocks.client as ReturnType<typeof supabaseFixture>;
    const response = await quickOrderSearch(apiRequest('GET', '/api/mobile/v1/quick-order?q='));
    expect(response.status).toBe(200);
    const body = await json(response);
    expect(body.data).toEqual({ term: '', products: [] });
    expect(client.queries.filter((query) => query.table === 'products')).toHaveLength(0);
  });

  it('refuses a non-retailer session before touching the catalogue', async () => {
    const client = install({ role: 'staff' });
    const response = await quickOrderSearch(apiRequest('GET', '/api/mobile/v1/quick-order?q=parle'));
    expect(response.status).toBe(403);
    expect(client.queries.filter((query) => query.table === 'products')).toHaveLength(0);
  });
});

describe('bulk line matching', () => {
  it('resolves a pasted list to real packs without writing anything', async () => {
    const client = mocks.client as ReturnType<typeof supabaseFixture>;
    const response = await matchBulkLines(
      apiRequest('POST', '/api/mobile/v1/quick-order/match', { raw: '2 x parle\nrice 5kg x 3' }),
    );
    expect(response.status).toBe(200);

    const body = await json(response);
    const data = body.data as { matches: { line: string; quantity: number | null; productId: string; matches: { packId: string; unitPricePaise: number | null }[] }[] };
    expect(data.matches).toHaveLength(2);
    expect(data.matches[0]!.quantity).toBe(2);
    expect(data.matches[0]!.productId).toBe(PRODUCT.id);
    expect(data.matches[0]!.matches[0]!.packId).toBe('pack-active');
    expect(data.matches[1]!.quantity).toBe(3);

    // The same name/barcode search the web bulk matcher uses, for the
    // sanitized term (the fixture records `or` filters without applying them).
    const productQuery = client.queries.find((query) => query.table === 'products');
    expect(productQuery!.filters).toEqual(
      expect.arrayContaining([
        { op: 'eq', column: 'is_active', value: true },
        { op: 'or', column: '', value: 'name.ilike."%parle%",barcode.ilike."%parle%"' },
      ]),
    );

    // The matcher is a read: the cart is the only writer.
    expect(client.queries.filter((query) => query.operation !== 'select')).toHaveLength(0);
  });

  it('answers a per-line error when a term matches nothing', async () => {
    install({ products: [] });
    const response = await matchBulkLines(
      apiRequest('POST', '/api/mobile/v1/quick-order/match', { raw: 'nonexistent-thing' }),
    );
    expect(response.status).toBe(200);
    const body = await json(response);
    const data = body.data as { matches: { productId: string; error?: string }[] };
    expect(data.matches).toHaveLength(1);
    expect(data.matches[0]!.productId).toBe('');
    expect(data.matches[0]!.error).toBe('No matching product found.');
  });

  it('refuses a paste longer than the web parser cap', async () => {
    const raw = Array.from({ length: 21 }, (_, index) => `item-${index}`).join('\n');
    const response = await matchBulkLines(
      apiRequest('POST', '/api/mobile/v1/quick-order/match', { raw }),
    );
    expect(response.status).toBe(400);
    const body = await json(response);
    expect(body.error).toMatchObject({ code: 'validation_failed' });
  });

  it('refuses an unparseable paste rather than guessing', async () => {
    const response = await matchBulkLines(
      apiRequest('POST', '/api/mobile/v1/quick-order/match', { raw: '   \n  \n' }),
    );
    expect(response.status).toBe(400);
  });

  it('refuses a non-retailer session before matching', async () => {
    const client = install({ role: 'staff' });
    const response = await matchBulkLines(
      apiRequest('POST', '/api/mobile/v1/quick-order/match', { raw: '2 x parle' }),
    );
    expect(response.status).toBe(403);
    expect(client.queries.filter((query) => query.table === 'products')).toHaveLength(0);
  });
});
