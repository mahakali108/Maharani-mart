/**
 * `/api/mobile/v1/shell/badges`, `/notifications`, `/notifications/read` and
 * `/favorites` — the endpoints the native shell's badges, alert feed and saved
 * products are built on.
 *
 * These run against the REAL route handlers with Supabase mocked at the client
 * boundary (the seam `tests/mobile-commerce-api.test.ts` uses), so they prove the
 * app can rely on:
 *
 *   1. the shell counters being counts the server took from the CALLER's own
 *      rows — and nothing else: no cart contents, no notification bodies;
 *   2. `unreadOnly=1` being a real query filter rather than a client-side trim,
 *      so an unread-only view cannot hide an alert that has not been seen;
 *   3. `POST /notifications/read` writing only the caller's ids, and refusing a
 *      body that is not one to one hundred UUIDs;
 *   4. the favourite toggle being a server-owned state change: the caller comes
 *      from the verified token, the body carries a product id and nothing else,
 *      and the answer IS the new state;
 *   5. every gate `requireMobileSession` applies elsewhere also applying here.
 *
 * HONEST SCOPE: unit/contract tests with a PostgREST double. Live RLS is asserted
 * by the migration and `tests/security*.test.ts` suites, not here.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { supabaseFixture } from './helpers/supabase-fixture';

const mocks = vi.hoisted(() => ({ client: null as unknown }));

vi.mock('@/lib/mobile/supabase', () => ({ createMobileSupabaseClient: () => mocks.client }));

import { GET as shellBadges } from '@/app/api/mobile/v1/shell/badges/route';
import { GET as listNotifications } from '@/app/api/mobile/v1/notifications/route';
import { POST as markNotificationsRead } from '@/app/api/mobile/v1/notifications/read/route';
import { GET as listFavorites, POST as toggleFavorite } from '@/app/api/mobile/v1/favorites/route';
import { resetRateLimits } from '@/lib/mobile/rate-limit';

const RETAILER = '11111111-1111-4111-8111-111111111111';
const OTHER_SHOP = '22222222-2222-4222-8222-222222222222';
const STAFF = '33333333-3333-4333-8333-333333333333';
const PRODUCT = '44444444-4444-4444-8444-444444444444';
const PRODUCT_TWO = '55555555-5555-4555-8555-555555555555';
const NOTE_ONE = '66666666-6666-4666-8666-666666666666';
const NOTE_TWO = '77777777-7777-4777-8777-777777777777';
const NOTE_OTHER = '88888888-8888-4888-8888-888888888888';

type Tables = Record<string, object[]>;

function install({
  role = 'retailer',
  extra = {},
  errors = {},
  authError = null,
}: {
  role?: 'retailer' | 'staff';
  extra?: Tables;
  errors?: Record<string, string>;
  authError?: { message: string } | null;
} = {}) {
  const userId = role === 'retailer' ? RETAILER : STAFF;
  const client = supabaseFixture({
    profiles: [
      { id: userId, role, full_name: 'Shop Owner', phone: '9876543210', is_active: true },
      { id: OTHER_SHOP, role: 'retailer', full_name: 'Other Shop', phone: '9876543211', is_active: true },
    ],
    retailers: role === 'retailer'
      ? [{ id: RETAILER, status: 'active', shop_name: 'Shop', area_id: 'area-1' }]
      : [],
    user_access_periods: [],
    cart_items: [
      { id: 'line-1', retailer_id: RETAILER, product_id: PRODUCT, pack_id: 'pack-1', quantity: 2 },
      { id: 'line-2', retailer_id: RETAILER, product_id: PRODUCT_TWO, pack_id: 'pack-2', quantity: 1 },
      // Another shop's basket must never be counted into this one's badge.
      { id: 'line-3', retailer_id: OTHER_SHOP, product_id: PRODUCT, pack_id: 'pack-1', quantity: 5 },
    ],
    notifications: [
      { id: NOTE_ONE, recipient_id: RETAILER, title: 'Order confirmed', body: 'Your order is packed.', link_url: '/retailer/orders', is_read: false, created_at: '2026-01-03T10:00:00Z' },
      { id: NOTE_TWO, recipient_id: RETAILER, title: 'Coins credited', body: '50 coins added.', link_url: '/retailer/coins', is_read: false, created_at: '2026-01-02T10:00:00Z' },
      { id: 'note-read', recipient_id: RETAILER, title: 'Old news', body: 'Long ago.', link_url: null, is_read: true, created_at: '2026-01-01T10:00:00Z' },
      { id: NOTE_OTHER, recipient_id: OTHER_SHOP, title: 'Someone else', body: 'Not yours.', link_url: null, is_read: false, created_at: '2026-01-04T10:00:00Z' },
    ],
    retailer_favorites: [
      { id: 'fav-1', retailer_id: RETAILER, product_id: PRODUCT, created_at: '2026-01-01T10:00:00Z' },
      { id: 'fav-2', retailer_id: OTHER_SHOP, product_id: PRODUCT_TWO, created_at: '2026-01-01T10:00:00Z' },
    ],
    ...extra,
  }, errors);
  Object.assign(client, {
    auth: {
      getUser: async () => authError
        ? { data: null, error: authError }
        : { data: { user: { id: userId, email: 'shop@example.test' } }, error: null },
    },
  });
  mocks.client = client;
  return client;
}

function apiRequest(
  path: string,
  {
    method = 'GET',
    body,
    token = 'verified-token',
  }: { method?: string; body?: unknown; token?: string | null } = {}
) {
  const headers = new Headers();
  if (token) headers.set('authorization', `Bearer ${token}`);
  if (body !== undefined) headers.set('content-type', 'application/json');
  return new Request(`https://api.test${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

async function json(response: Response): Promise<Record<string, unknown>> {
  return await response.json() as Record<string, unknown>;
}

function valueOf(client: ReturnType<typeof supabaseFixture>, table: string, column: string) {
  return client.queries
    .find((query) => query.table === table)
    ?.filters.find((filter) => filter.column === column)?.value;
}

function queryFor(
  client: ReturnType<typeof supabaseFixture>,
  table: string,
  operation: 'select' | 'insert' | 'update' | 'delete'
) {
  return client.queries.find((query) => query.table === table && query.operation === operation);
}

beforeEach(() => {
  resetRateLimits();
});

describe('GET /api/mobile/v1/shell/badges', () => {
  it('answers with the counts of the caller\'s own rows', async () => {
    const client = install();

    const response = await shellBadges(apiRequest('/api/mobile/v1/shell/badges'));
    const payload = await json(response);

    // Two lines for this shop (the third belongs to another shop), and two unread
    // alerts for this shop (the third belongs to another recipient). The read
    // alert is excluded by the query, not by the caller.
    expect(response.status).toBe(200);
    expect(payload.data).toEqual({ cartCount: 2, unreadNotificationCount: 2 });
    expect(typeof payload.requestId).toBe('string');

    expect(valueOf(client, 'cart_items', 'retailer_id')).toBe(RETAILER);
    expect(valueOf(client, 'notifications', 'recipient_id')).toBe(RETAILER);
    expect(valueOf(client, 'notifications', 'is_read')).toBe(false);
  });

  it('returns counts only — never cart contents or notification bodies', async () => {
    install();

    const payload = await json(await shellBadges(apiRequest('/api/mobile/v1/shell/badges')));

    expect(Object.keys(payload).sort()).toEqual(['data', 'requestId']);
    expect(Object.keys(payload.data as object).sort()).toEqual(['cartCount', 'unreadNotificationCount']);
    const wire = JSON.stringify(payload);
    expect(wire).not.toContain('line-1');
    expect(wire).not.toContain('pack_id');
    expect(wire).not.toContain('Order confirmed');
  });

  it('an empty cart and an empty feed are two zeros, not an error', async () => {
    install({ extra: { cart_items: [], notifications: [] } });

    const payload = await json(await shellBadges(apiRequest('/api/mobile/v1/shell/badges')));

    expect(payload.data).toEqual({ cartCount: 0, unreadNotificationCount: 0 });
  });

  it('refuses a token GoTrue does not verify', async () => {
    install({ authError: { message: 'invalid token' } });

    const response = await shellBadges(apiRequest('/api/mobile/v1/shell/badges'));
    const payload = await json(response);

    expect(response.status).toBe(401);
    expect(payload.error).toMatchObject({ message: expect.any(String) });
    expect(payload.data).toBeUndefined();
  });

  it('refuses a request with no bearer token at all', async () => {
    install();

    const response = await shellBadges(apiRequest('/api/mobile/v1/shell/badges', { token: null }));
    const payload = await json(response);

    expect(response.status).toBe(401);
    expect(payload.error).toMatchObject({ code: 'missing_token' });
  });

  it('is a retailer surface: a staff account is refused', async () => {
    install({ role: 'staff' });

    const response = await shellBadges(apiRequest('/api/mobile/v1/shell/badges'));
    const payload = await json(response);

    expect(response.status).toBe(403);
    expect(payload.error).toMatchObject({ code: 'forbidden' });
    expect(payload.data).toBeUndefined();
  });

  it('a failed count is a retryable 503 with no half a badge', async () => {
    install({ errors: { notifications: 'connection lost' } });

    const response = await shellBadges(apiRequest('/api/mobile/v1/shell/badges'));
    const payload = await json(response);

    expect(response.status).toBe(503);
    expect(payload.error).toMatchObject({ code: 'database_unavailable' });
    // End-user prose rather than the driver's message, and no invented counts for
    // the part that DID succeed.
    expect(payload.error).not.toMatchObject({ message: 'connection lost' });
    expect(payload.data).toBeUndefined();
  });
});

describe('GET /api/mobile/v1/notifications', () => {
  it('filters to unread in the query, not on the client', async () => {
    const client = install();

    const payload = await json(await listNotifications(apiRequest('/api/mobile/v1/notifications?unreadOnly=1')));

    expect(payload.data).toEqual([
      {
        id: NOTE_ONE,
        title: 'Order confirmed',
        body: 'Your order is packed.',
        linkUrl: '/retailer/orders',
        isRead: false,
        createdAt: '2026-01-03T10:00:00Z',
      },
      {
        id: NOTE_TWO,
        title: 'Coins credited',
        body: '50 coins added.',
        linkUrl: '/retailer/coins',
        isRead: false,
        createdAt: '2026-01-02T10:00:00Z',
      },
    ]);
    expect(payload.page).toEqual({ nextCursor: null, hasMore: false, limit: 20 });
    expect(queryFor(client, 'notifications', 'select')?.filters).toEqual(expect.arrayContaining([
      { op: 'eq', column: 'is_read', value: false },
    ]));
  });

  it('without the flag the whole feed comes back, newest first', async () => {
    const payload = await json(await listNotifications(apiRequest('/api/mobile/v1/notifications')));
    const rows = payload.data as { id: string }[];

    expect(rows.map((row) => row.id)).toEqual([NOTE_ONE, NOTE_TWO, 'note-read']);
    // Another recipient's row is not present under any circumstances.
    expect(JSON.stringify(rows)).not.toContain(NOTE_OTHER);
  });

  it('an unreadOnly value that is not 1 is rejected, not ignored', async () => {
    const response = await listNotifications(apiRequest('/api/mobile/v1/notifications?unreadOnly=yes'));

    expect(response.status).toBe(400);
    expect(await json(response)).toMatchObject({ error: { code: 'invalid_request' } });
  });

  it('a query key cannot widen the feed to another recipient', async () => {
    const payload = await json(await listNotifications(
      apiRequest(`/api/mobile/v1/notifications?recipientId=${OTHER_SHOP}`)
    ));
    const rows = payload.data as { id: string }[];

    // The route reads only `cursor` and `unreadOnly`; identity comes from the
    // token, so an injected recipient is dropped rather than honoured.
    expect(rows.length).toBeGreaterThan(0);
    expect(JSON.stringify(rows)).not.toContain(NOTE_OTHER);
  });

  it('a staff account sees its own empty feed rather than the retailer\'s', async () => {
    install({ role: 'staff' });

    const payload = await json(await listNotifications(apiRequest('/api/mobile/v1/notifications')));

    expect(payload.data).toEqual([]);
  });
});

describe('POST /api/mobile/v1/notifications/read', () => {
  it('marks exactly the ids the caller named, scoped to that caller', async () => {
    const client = install();

    const response = await markNotificationsRead(apiRequest('/api/mobile/v1/notifications/read', {
      method: 'POST',
      body: { ids: [NOTE_ONE, NOTE_TWO] },
    }));

    expect(response.status).toBe(200);
    expect(await json(response)).toMatchObject({ data: { marked: 2 } });

    const update = queryFor(client, 'notifications', 'update');
    expect(update?.table).toBe('notifications');
    expect(update?.payload).toEqual({ is_read: true });
    expect(update?.filters).toEqual(expect.arrayContaining([
      { op: 'eq', column: 'recipient_id', value: RETAILER },
      { op: 'in', column: 'id', value: [NOTE_ONE, NOTE_TWO] },
    ]));
  });

  it('refuses an empty list, a non-uuid, a hundred-and-first id and an unknown key', async () => {
    install();
    const rejected = [
      { ids: [] },
      { ids: ['not-a-uuid'] },
      { ids: Array.from({ length: 101 }, (_, index) => `${String(index).padStart(8, '0')}-0000-4000-8000-000000000000`) },
      { ids: [NOTE_ONE], recipient_id: OTHER_SHOP },
      {},
    ];

    for (const body of rejected) {
      const response = await markNotificationsRead(apiRequest('/api/mobile/v1/notifications/read', { method: 'POST', body }));
      expect(response.status, JSON.stringify(body)).toBe(400);
      expect(await json(response)).toMatchObject({ error: { code: 'validation_failed' } });
    }
  });

  it('body that is not JSON is refused before anything is written', async () => {
    const client = install();

    const response = await markNotificationsRead(new Request(
      'https://api.test/api/mobile/v1/notifications/read',
      {
        method: 'POST',
        headers: new Headers({ authorization: 'Bearer verified-token', 'content-type': 'application/json' }),
        body: 'ids=1',
      }
    ));

    expect(response.status).toBe(400);
    expect(await json(response)).toMatchObject({ error: { code: 'invalid_json' } });
    expect(queryFor(client, 'notifications', 'update')).toBeUndefined();
  });

  it('a database failure is a retryable 503, and the alert is not claimed as read', async () => {
    install({ errors: { 'notifications:update': 'connection lost' } });

    const response = await markNotificationsRead(apiRequest('/api/mobile/v1/notifications/read', {
      method: 'POST',
      body: { ids: [NOTE_ONE] },
    }));

    expect(response.status).toBe(503);
    expect(await json(response)).toMatchObject({ error: { code: 'database_unavailable' } });
  });

  it('needs a verified session like every other write', async () => {
    install();

    const response = await markNotificationsRead(apiRequest('/api/mobile/v1/notifications/read', {
      method: 'POST',
      body: { ids: [NOTE_ONE] },
      token: null,
    }));

    expect(response.status).toBe(401);
  });
});

describe('/api/mobile/v1/favorites', () => {
  it('lists only the caller\'s saved product ids', async () => {
    const payload = await json(await listFavorites(apiRequest('/api/mobile/v1/favorites')));

    expect(payload.data).toEqual({ productIds: [PRODUCT] });
  });

  it('a toggle adds the product and answers with the new state', async () => {
    const client = install();

    const response = await toggleFavorite(apiRequest('/api/mobile/v1/favorites', {
      method: 'POST',
      body: { productId: PRODUCT_TWO },
    }));

    expect(response.status).toBe(200);
    expect(await json(response)).toMatchObject({ data: { isFavorite: true } });

    const insert = queryFor(client, 'retailer_favorites', 'insert');
    expect(insert?.table).toBe('retailer_favorites');
    // The owner is the verified session and nothing else: a body cannot name a
    // retailer, so one shop cannot save products into another's list.
    expect(insert?.payload).toEqual({ retailer_id: RETAILER, product_id: PRODUCT_TWO });
    expect(client.tables.retailer_favorites).toHaveLength(3);
  });

  it('the second toggle removes it, because the server owns the state', async () => {
    const client = install();

    const response = await toggleFavorite(apiRequest('/api/mobile/v1/favorites', {
      method: 'POST',
      body: { productId: PRODUCT },
    }));

    expect(await json(response)).toMatchObject({ data: { isFavorite: false } });
    expect(client.tables.retailer_favorites).toHaveLength(1);
    // The other shop's row survives this caller's removal.
    expect(client.tables.retailer_favorites?.[0]?.product_id).toBe(PRODUCT_TWO);
  });

  it('the saved list reads back a saved product, because the row is real', async () => {
    install();

    await toggleFavorite(apiRequest('/api/mobile/v1/favorites', { method: 'POST', body: { productId: PRODUCT_TWO } }));
    const payload = await json(await listFavorites(apiRequest('/api/mobile/v1/favorites')));

    expect(payload.data).toEqual({ productIds: [PRODUCT, PRODUCT_TWO] });
  });

  it('refuses a body that is not exactly one product uuid', async () => {
    install();
    const rejected = [
      {},
      { productId: 'nope' },
      { productId: PRODUCT, retailer_id: OTHER_SHOP },
      { product_id: PRODUCT },
    ];

    for (const body of rejected) {
      const response = await toggleFavorite(apiRequest('/api/mobile/v1/favorites', { method: 'POST', body }));
      expect(response.status, JSON.stringify(body)).toBe(400);
      expect(await json(response)).toMatchObject({ error: { code: 'validation_failed' } });
    }
  });

  it('a failed write is a 503 with no invented favourite', async () => {
    const client = install({ errors: { 'retailer_favorites:insert': 'connection lost' } });

    const response = await toggleFavorite(apiRequest('/api/mobile/v1/favorites', {
      method: 'POST',
      body: { productId: PRODUCT_TWO },
    }));

    expect(response.status).toBe(503);
    expect(await json(response)).toMatchObject({ error: { code: 'database_unavailable' } });
    expect(client.tables.retailer_favorites).toHaveLength(2);
  });

  it('needs a verified session', async () => {
    install({ authError: { message: 'invalid token' } });

    const response = await listFavorites(apiRequest('/api/mobile/v1/favorites'));

    expect(response.status).toBe(401);
  });
});
