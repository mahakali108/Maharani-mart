import { beforeEach, describe, expect, it, vi } from 'vitest';
import { cartCounts } from '@/lib/mobile/commerce-shared';
import { supabaseFixture } from './helpers/supabase-fixture';

/**
 * The two badge facts the native shell shows, proven against the server:
 * the cart's line count (same fact the web shell badges) and the notifications
 * unread count. Both are computed by the API, never guessed on the device.
 */

const mocks = vi.hoisted(() => ({ client: null as unknown }));

vi.mock('@/lib/mobile/supabase', () => ({ createMobileSupabaseClient: () => mocks.client }));

import { GET as listNotifications } from '@/app/api/mobile/v1/notifications/route';
import { resetRateLimits } from '@/lib/mobile/rate-limit';

const RETAILER = '11111111-1111-4111-8111-111111111111';
const OTHER_RETAILER = '22222222-2222-4222-8222-222222222222';

function install(notifications: object[] = []) {
  const client = supabaseFixture({
    profiles: [{ id: RETAILER, role: 'retailer', full_name: 'Shop Owner', phone: '9876543210', is_active: true }],
    retailers: [{ id: RETAILER, status: 'active', shop_name: 'Shop', address: 'Shop Road' }],
    notifications,
  });
  Object.assign(client, {
    auth: { getUser: async () => ({ data: { user: { id: RETAILER, email: 'shop@example.test' } }, error: null }) },
  });
  mocks.client = client;
  return client;
}

function apiRequest(path: string) {
  const headers = new Headers();
  headers.set('authorization', 'Bearer verified-token');
  return new Request(`https://api.test${path}`, { method: 'GET', headers });
}

beforeEach(() => {
  resetRateLimits();
  install();
});

describe('cart badge facts', () => {
  it('counts saved lines and total pieces, never a negative or fractional value', () => {
    expect(cartCounts([])).toEqual({ lineCount: 0, itemCount: 0 });
    expect(cartCounts([{ quantity: 6 }])).toEqual({ lineCount: 1, itemCount: 6 });
    expect(cartCounts([{ quantity: 6 }, { quantity: 12 }, { quantity: 1 }]))
      .toEqual({ lineCount: 3, itemCount: 19 });
    expect(cartCounts([{ quantity: -5 }, { quantity: Number.NaN }, { quantity: 2.9 }]))
      .toEqual({ lineCount: 3, itemCount: 2 });
  });
});

describe('notifications unread badge', () => {
  it('reports the caller\'s unread count on the first page', async () => {
    const client = install([
      { id: 'n1', recipient_id: RETAILER, title: 'Order shipped', body: 'On the way', link_url: null, is_read: false, created_at: '2026-10-05T06:00:00Z' },
      { id: 'n2', recipient_id: RETAILER, title: 'Payment received', body: 'Thanks', link_url: null, is_read: true, created_at: '2026-10-04T06:00:00Z' },
      { id: 'n3', recipient_id: RETAILER, title: 'Offer', body: 'Festival', link_url: null, is_read: false, created_at: '2026-10-03T06:00:00Z' },
      { id: 'n4', recipient_id: OTHER_RETAILER, title: 'Someone else', body: 'Not yours', link_url: null, is_read: false, created_at: '2026-10-02T06:00:00Z' },
    ]);

    const response = await listNotifications(apiRequest('/api/mobile/v1/notifications'));
    const payload = await response.json() as { data: unknown[]; meta?: { unreadCount?: number }; page: { hasMore: boolean } };

    expect(response.status).toBe(200);
    expect(payload.data).toHaveLength(3);
    expect(payload.meta?.unreadCount).toBe(2);
    // The notifications meta carries the unread total and nothing else; the
    // catalogue's resultCount/resultCapped belong to its own list meta. The
    // shared Kotlin `ListMetaDto` declares the union of both.
    expect(Object.keys(payload.meta ?? {}).sort()).toEqual(['unreadCount']);
    // The unread count is its own query, scoped to the same owned feed.
    const countQuery = client.queries
      .filter((query) => query.table === 'notifications')
      .find((query) => query.filters.some((filter) => filter.column === 'is_read'));
    expect(countQuery?.filters).toContainEqual({ op: 'eq', column: 'recipient_id', value: RETAILER });
    expect(countQuery?.filters).toContainEqual({ op: 'eq', column: 'is_read', value: false });
  });

  it('omits the count on cursor pages instead of re-counting', async () => {
    install([
      { id: 'n1', recipient_id: RETAILER, title: 'One', body: 'Body', link_url: null, is_read: false, created_at: '2026-10-05T06:00:00Z' },
    ]);

    const cursor = Buffer.from(JSON.stringify({ created_at: '2026-10-05T06:00:00Z', id: 'n1' })).toString('base64');
    const response = await listNotifications(apiRequest(`/api/mobile/v1/notifications?cursor=${cursor}`));
    const payload = await response.json() as { meta?: { unreadCount?: number } };

    expect(response.status).toBe(200);
    expect(payload.meta?.unreadCount).toBeUndefined();
  });

  it('serves every authenticated role its own feed, never another user\'s rows', async () => {
    const STAFF = '33333333-3333-4333-8333-333333333333';
    const client = supabaseFixture({
      profiles: [{ id: STAFF, role: 'staff', full_name: 'Staff', phone: '9876543210', is_active: true }],
      retailers: [],
      notifications: [
        { id: 'own', recipient_id: STAFF, title: 'Assigned to you', body: 'Body', link_url: null, is_read: false, created_at: '2026-10-05T06:00:00Z' },
        { id: 'foreign', recipient_id: OTHER_RETAILER, title: 'Someone else', body: 'Not yours', link_url: null, is_read: false, created_at: '2026-10-04T06:00:00Z' },
      ],
    });
    Object.assign(client, {
      auth: { getUser: async () => ({ data: { user: { id: STAFF, email: 'staff@example.test' } }, error: null }) },
    });
    mocks.client = client;

    const response = await listNotifications(apiRequest('/api/mobile/v1/notifications'));

    // The contract opens the feed to any role (§2.5) and RLS narrows it to
    // `recipient_id = auth.uid()`, so a non-retailer reads their OWN feed
    // rather than being refused — but never anyone else's rows.
    expect(response.status).toBe(200);
    const payload = await response.json() as { data: { id: string }[]; meta?: { unreadCount?: number } };
    expect(payload.data.map((item) => item.id)).toEqual(['own']);
    expect(payload.meta?.unreadCount).toBe(1);
    for (const query of client.queries.filter((query) => query.table === 'notifications')) {
      expect(query.filters).toContainEqual({ op: 'eq', column: 'recipient_id', value: STAFF });
    }
  });
});
