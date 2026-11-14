import { beforeEach, describe, expect, it, vi } from 'vitest';
import { supabaseFixture } from './helpers/supabase-fixture';

const mocks = vi.hoisted(() => ({
  client: null as unknown,
  reportClient: null as unknown,
  restoreAndVerifyCancellationCoins: vi.fn(),
  releaseOrderCoupon: vi.fn(),
  createMobileAnonClient: vi.fn(),
  gotrueFetch: vi.fn(),
  signInWithPassword: vi.fn(),
}));

vi.mock('@/lib/mobile/supabase', () => ({ createMobileSupabaseClient: () => mocks.client }));
vi.mock('@/lib/mobile/clients', () => ({
  createMobileAnonClient: mocks.createMobileAnonClient,
  gotrueFetch: mocks.gotrueFetch,
}));
vi.mock('@/lib/supabase/server', () => ({ createClient: () => mocks.reportClient }));
// tryAtomicOrderCancellation (added with the atomic-cancel wiring) reports "not
// committed" here so these tests keep exercising the guarded fallback path.
vi.mock('@/lib/orders/cancellation-coins', () => ({
  restoreAndVerifyCancellationCoins: mocks.restoreAndVerifyCancellationCoins,
  tryAtomicOrderCancellation: async () => false,
}));
vi.mock('@/lib/coupons/validate', () => ({ releaseOrderCoupon: mocks.releaseOrderCoupon }));

import { GET as getProfile, PATCH as patchProfile } from '@/app/api/mobile/v1/profile/route';
import { POST as changePassword } from '@/app/api/mobile/v1/auth/password-change/route';
import { POST as logoutAll } from '@/app/api/mobile/v1/auth/logout-all/route';
import { GET as getPreferences, PATCH as patchPreferences } from '@/app/api/mobile/v1/notifications/preferences/route';
import { GET as getSchemes } from '@/app/api/mobile/v1/schemes/route';
import { GET as getHelp } from '@/app/api/mobile/v1/help/route';
import { GET as getTickets, POST as createTicket } from '@/app/api/mobile/v1/support/tickets/route';
import { GET as getTicket, POST as replyToTicket } from '@/app/api/mobile/v1/support/tickets/[id]/route';
import { GET as getSavedCarts, POST as saveCurrentCart } from '@/app/api/mobile/v1/saved-carts/route';
import { DELETE as deleteSavedCart, PATCH as renameSavedCart } from '@/app/api/mobile/v1/saved-carts/[id]/route';
import { POST as requestReturn } from '@/app/api/mobile/v1/orders/[id]/return/route';
import { POST as cancelOrder } from '@/app/api/mobile/v1/orders/[id]/cancel/route';
import { GET as getAccountRequests, POST as createAccountRequest } from '@/app/api/mobile/v1/account/requests/route';
import { GET as getStatement } from '@/app/api/mobile/v1/reports/statement/route';
import { resetRateLimits } from '@/lib/mobile/rate-limit';

const RETAILER = '11111111-1111-4111-8111-111111111111';
const OTHER_RETAILER = '44444444-4444-4444-8444-444444444444';
const ORDER = '55555555-5555-4555-8555-555555555555';
const TICKET = '66666666-6666-4666-8666-666666666666';
const SAVED_CART = '77777777-7777-4777-8777-777777777777';

function install({
  role = 'retailer',
  tables = {} as Record<string, object[]>,
  helpPhone = null as string | null,
} = {}) {
  const id = role === 'retailer' ? RETAILER : OTHER_RETAILER;
  const client = supabaseFixture({
    profiles: [{ id, role, full_name: 'Shop Owner', phone: '9876543210', is_active: true }],
    retailers: role === 'retailer'
      ? [{ id, status: 'active', shop_name: 'Maharani Shop', address: 'Station Road', gstin: '10AAAAA0000A1Z5' }]
      : [],
    ...tables,
  });
  Object.assign(client, {
    auth: { getUser: async () => ({ data: { user: { id, email: 'shop@example.test' } }, error: null }) },
  });
  mocks.client = client;
  mocks.reportClient = client;
  if (helpPhone != null) process.env.COMPANY_PHONE = helpPhone;
  else delete process.env.COMPANY_PHONE;
  return client;
}

function request(method: string, path: string, body?: unknown) {
  const headers = new Headers({ authorization: 'Bearer verified-token' });
  if (body !== undefined) headers.set('content-type', 'application/json');
  return new Request(`https://api.test${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

async function json(response: Response) {
  return await response.json() as Record<string, any>;
}

beforeEach(() => {
  resetRateLimits();
  mocks.restoreAndVerifyCancellationCoins.mockReset().mockResolvedValue({ success: true });
  mocks.releaseOrderCoupon.mockReset().mockResolvedValue(undefined);
  mocks.gotrueFetch.mockReset().mockResolvedValue({ ok: true, status: 200 });
  mocks.signInWithPassword.mockReset().mockResolvedValue({
    data: { user: { id: RETAILER }, session: { access_token: 'verified-current-password-token' } },
    error: null,
  });
  mocks.createMobileAnonClient.mockReset().mockReturnValue({ auth: { signInWithPassword: mocks.signInWithPassword } });
  install();
});

describe('mobile retailer upgrade routes', () => {
  it('re-authenticates the current password and changes it only for the verified caller', async () => {
    const response = await changePassword(request('POST', '/api/mobile/v1/auth/password-change', {
      currentPassword: 'old-password', newPassword: 'new-password-123', confirmPassword: 'new-password-123',
    }));
    expect(response.status).toBe(200);
    expect(mocks.signInWithPassword).toHaveBeenCalledWith({ email: 'shop@example.test', password: 'old-password' });
    expect(mocks.gotrueFetch).toHaveBeenCalledWith('/user', {
      method: 'PUT', accessToken: 'verified-current-password-token', body: { password: 'new-password-123' },
    });

    mocks.gotrueFetch.mockClear();
    mocks.signInWithPassword.mockResolvedValueOnce({
      data: { user: { id: OTHER_RETAILER }, session: { access_token: 'foreign-token' } }, error: null,
    });
    const mismatch = await changePassword(request('POST', '/api/mobile/v1/auth/password-change', {
      currentPassword: 'old-password', newPassword: 'new-password-123', confirmPassword: 'new-password-123',
    }));
    expect(mismatch.status).toBe(401);
    expect(mocks.gotrueFetch).not.toHaveBeenCalled();
  });

  it('revokes all provider sessions using only the verified bearer token', async () => {
    const response = await logoutAll(request('POST', '/api/mobile/v1/auth/logout-all'));
    expect(response.status).toBe(200);
    expect(mocks.gotrueFetch).toHaveBeenCalledWith('/logout?scope=global', {
      method: 'POST', accessToken: 'verified-token',
    });
  });

  it('reads and updates only the verified retailer profile; protected fields are rejected', async () => {
    const client = install();
    const response = await getProfile(request('GET', '/api/mobile/v1/profile'));
    const payload = await json(response);
    expect(response.status).toBe(200);
    expect(payload.data).toMatchObject({ shopName: 'Maharani Shop', status: 'active', fullName: 'Shop Owner' });
    expect(payload.data).not.toHaveProperty('creditLimit');

    const updated = await patchProfile(request('PATCH', '/api/mobile/v1/profile', {
      section: 'shop', shopName: 'Updated Store', address: 'Market Road',
    }));
    expect(updated.status).toBe(200);
    expect(client.rpcs).toContainEqual({
      name: 'update_my_shop_profile',
      args: { p_shop_name: 'Updated Store', p_address: 'Market Road' },
    });
    const contact = await patchProfile(request('PATCH', '/api/mobile/v1/profile', {
      section: 'contact', fullName: 'Shop Owner', phone: '9876543210',
    }));
    expect(contact.status).toBe(200);
    const profileUpdate = client.queries.find((query) => query.table === 'profiles' && query.operation === 'update');
    expect(profileUpdate?.payload).toEqual({ full_name: 'Shop Owner', phone: '9876543210' });
    expect(profileUpdate?.filters).toContainEqual({ op: 'eq', column: 'id', value: RETAILER });

    const tampered = await patchProfile(request('PATCH', '/api/mobile/v1/profile', {
      section: 'shop', shopName: 'Store', address: 'Road', creditLimit: 999999,
    }));
    expect(tampered.status).toBe(400);
  });

  it('defaults missing notification preferences to enabled and upserts only caller-owned values', async () => {
    const client = install();
    const defaults = await json(await getPreferences(request('GET', '/api/mobile/v1/notifications/preferences')));
    expect(defaults.data).toEqual({ orderUpdates: true, paymentUpdates: true, walletUpdates: true, offerUpdates: true });

    const saved = await patchPreferences(request('PATCH', '/api/mobile/v1/notifications/preferences', {
      orderUpdates: false, paymentUpdates: true, walletUpdates: false, offerUpdates: true,
    }));
    expect(saved.status).toBe(200);
    const upsert = client.queries.find((query) => query.table === 'retailer_notification_prefs' && query.operation === 'upsert');
    expect(upsert?.operation).toBe('upsert');
    expect(upsert?.payload).toMatchObject({ retailer_id: RETAILER, order_updates: false, wallet_updates: false });

    const tampered = await patchPreferences(request('PATCH', '/api/mobile/v1/notifications/preferences', {
      orderUpdates: true, paymentUpdates: true, walletUpdates: true, offerUpdates: true, retailerId: OTHER_RETAILER,
    }));
    expect(tampered.status).toBe(400);
  });

  it('returns active schemes and help contact details from real service values', async () => {
    install({
      helpPhone: '+91-9876543210',
      tables: { schemes: [{
        id: 'scheme-1', name: 'Monsoon scheme', description: 'Live scheme', is_festival: false,
        is_active: true, starts_at: '2026-01-01T00:00:00Z', ends_at: '2099-12-31T23:59:59Z',
      }] },
    });
    const schemes = await json(await getSchemes(request('GET', '/api/mobile/v1/schemes')));
    expect(schemes.data.schemes).toHaveLength(1);
    expect(schemes.data.schemes[0].name).toBe('Monsoon scheme');
    const help = await json(await getHelp(request('GET', '/api/mobile/v1/help')));
    expect(help.data.supportPhone).toBe('+91-9876543210');
  });

  it('lists caller-owned support tickets and hides another retailer ticket', async () => {
    const client = install({ tables: { support_tickets: [
      { id: TICKET, retailer_id: RETAILER, ticket_number: 'MT-TKT-20261006-ABCD', subject: 'Order issue', topic: 'order', priority: 'normal', status: 'open', created_at: '2026-10-05T10:00:00Z', updated_at: '2026-10-05T10:00:00Z', orders: null },
      { id: 'foreign-ticket', retailer_id: OTHER_RETAILER, ticket_number: 'MT-TKT-20261006-ABCE', subject: 'Other shop', topic: 'other', priority: 'low', status: 'open', created_at: '2026-10-05T09:00:00Z', updated_at: '2026-10-05T09:00:00Z', orders: null },
    ] } });
    const payload = await json(await getTickets(request('GET', '/api/mobile/v1/support/tickets')));
    expect(payload.data).toHaveLength(1);
    expect(payload.data[0].id).toBe(TICKET);
    expect(client.queries.find((query) => query.table === 'support_tickets')?.filters)
      .toContainEqual({ op: 'eq', column: 'retailer_id', value: RETAILER });
  });

  it('creates a support ticket and first message using server identity; rejects closed replies', async () => {
    const client = install();
    const created = await json(await createTicket(request('POST', '/api/mobile/v1/support/tickets', {
      subject: 'Missing items from order', topic: 'order', priority: 'normal', description: 'Two products were missing from the delivered order.',
    })));
    expect(created.data.ticketNumber).toMatch(/^MT-TKT-\d{8}-[A-Z0-9]{4}$/);
    expect(client.queries.find((query) => query.table === 'support_tickets' && query.operation === 'insert')?.payload)
      .toMatchObject({ retailer_id: RETAILER, status: 'open' });
    expect(client.queries.find((query) => query.table === 'support_ticket_messages' && query.operation === 'insert')?.payload)
      .toMatchObject({ author_id: RETAILER, author_role: 'retailer' });

    const hostile = await createTicket(request('POST', '/api/mobile/v1/support/tickets', {
      subject: 'Missing items from order', topic: 'order', priority: 'normal', description: 'Two products were missing from the delivered order.', retailerId: OTHER_RETAILER,
    }));
    expect(hostile.status).toBe(400);

    install({ tables: { support_tickets: [{
      id: TICKET, retailer_id: RETAILER, ticket_number: 'MT-TKT-20261006-ABCD', subject: 'Closed case', topic: 'order', priority: 'normal', status: 'closed', created_at: '2026-10-01T00:00:00Z', updated_at: '2026-10-01T00:00:00Z', order_id: null, orders: null,
    }] } });
    const reply = await replyToTicket(request('POST', `/api/mobile/v1/support/tickets/${TICKET}`, { body: 'A new update for the closed support case.' }), { params: Promise.resolve({ id: TICKET }) });
    expect(reply.status).toBe(409);
  });

  it('returns support details only to the ticket owner and carries append-only messages', async () => {
    const client = install({ tables: {
      support_tickets: [{ id: TICKET, retailer_id: RETAILER, ticket_number: 'MT-TKT-20261006-ABCD', subject: 'Delivery issue', topic: 'delivery', priority: 'high', status: 'in_progress', created_at: '2026-10-01T00:00:00Z', updated_at: '2026-10-01T01:00:00Z', order_id: null, orders: null }],
      support_ticket_messages: [{ id: 'message-1', ticket_id: TICKET, author_id: RETAILER, author_role: 'retailer', body: 'My delivery has not arrived.', created_at: '2026-10-01T00:30:00Z' }],
    } });
    const detail = await json(await getTicket(request('GET', `/api/mobile/v1/support/tickets/${TICKET}`), { params: Promise.resolve({ id: TICKET }) }));
    expect(detail.data.canReply).toBe(true);
    expect(detail.data.messages[0]).toMatchObject({ authorRole: 'retailer', isOwn: true });
    expect(client.queries.some((query) => query.table === 'support_tickets' && query.filters.some((filter) => filter.column === 'retailer_id' && filter.value === RETAILER))).toBe(true);

    install({ tables: { support_tickets: [{ id: TICKET, retailer_id: OTHER_RETAILER, status: 'open', orders: null }] } });
    const foreign = await getTicket(request('GET', `/api/mobile/v1/support/tickets/${TICKET}`), { params: Promise.resolve({ id: TICKET }) });
    expect(foreign.status).toBe(404);
  });

  it('lists owner saved carts and protects the reserved Saved for later list from rename, delete and duplicates', async () => {
    const client = install({ tables: {
      retailer_saved_carts: [{ id: SAVED_CART, retailer_id: RETAILER, name: 'Saved for later', created_at: '2026-10-01T00:00:00Z', updated_at: '2026-10-01T00:00:00Z', retailer_saved_cart_items: [] }],
    } });
    const payload = await json(await getSavedCarts(request('GET', '/api/mobile/v1/saved-carts')));
    expect(payload.data.savedCarts[0].name).toBe('Saved for later');
    expect(client.queries.find((query) => query.table === 'retailer_saved_carts')?.filters)
      .toContainEqual({ op: 'eq', column: 'retailer_id', value: RETAILER });
    const blocked = await deleteSavedCart(request('DELETE', `/api/mobile/v1/saved-carts/${SAVED_CART}`), { params: Promise.resolve({ id: SAVED_CART }) });
    expect(blocked.status).toBe(404);
    const rename = await renameSavedCart(request('PATCH', `/api/mobile/v1/saved-carts/${SAVED_CART}`, { name: 'Restock list' }), { params: Promise.resolve({ id: SAVED_CART }) });
    expect(rename.status).toBe(404);

    install({ tables: { cart_items: [{ id: 'cart-line', retailer_id: RETAILER, pack_id: 'pack-1', product_id: 'product-1', quantity: 6 }] } });
    const duplicate = await saveCurrentCart(request('POST', '/api/mobile/v1/saved-carts', { name: 'Saved   FOR   later' }));
    expect(duplicate.status).toBe(400);
  });

  it('submits an order return for a delivered caller-owned order and rejects foreign orders', async () => {
    const client = install({ tables: {
      orders: [{ id: ORDER, retailer_id: RETAILER, status: 'delivered' }],
      order_deliveries: [{ order_id: ORDER, return_deadline: '2099-12-31' }],
    } });
    const response = await requestReturn(request('POST', `/api/mobile/v1/orders/${ORDER}/return`, { reason: 'Several items arrived damaged.' }), { params: Promise.resolve({ id: ORDER }) });
    expect(response.status).toBe(200);
    expect(client.queries.find((query) => query.table === 'return_requests' && query.operation === 'insert')?.payload)
      .toMatchObject({ order_id: ORDER, retailer_id: RETAILER, reason: 'Several items arrived damaged.' });

    install({ tables: { orders: [{ id: ORDER, retailer_id: OTHER_RETAILER, status: 'delivered' }] } });
    const foreign = await requestReturn(request('POST', `/api/mobile/v1/orders/${ORDER}/return`, { reason: 'Damaged item.' }), { params: Promise.resolve({ id: ORDER }) });
    expect(foreign.status).toBe(404);
  });

  it('cancels only the caller pending order and passes its verified Supabase client to reversals', async () => {
    const client = install({ tables: { orders: [{ id: ORDER, retailer_id: RETAILER, status: 'pending' }] } });
    const response = await cancelOrder(request('POST', `/api/mobile/v1/orders/${ORDER}/cancel`, { reason: 'Duplicate order.' }), { params: Promise.resolve({ id: ORDER }) });
    expect(response.status).toBe(200);
    expect(mocks.restoreAndVerifyCancellationCoins).toHaveBeenCalledWith(client, ORDER, RETAILER, 'Duplicate order.', RETAILER);
    const update = client.queries.find((query) => query.table === 'orders' && query.operation === 'update');
    expect(update?.filters).toContainEqual({ op: 'eq', column: 'retailer_id', value: RETAILER });
    expect(update?.filters).toContainEqual({ op: 'eq', column: 'status', value: 'pending' });
    expect(mocks.releaseOrderCoupon).toHaveBeenCalledWith(client, ORDER);
  });

  it('does not report success when cancellation committed but coin restoration is unverified, and allows an owned retry', async () => {
    const client = install({ tables: { orders: [{ id: ORDER, retailer_id: RETAILER, status: 'pending' }] } });
    mocks.restoreAndVerifyCancellationCoins.mockResolvedValueOnce({ error: 'The order is cancelled, but Coins restoration could not be verified. Contact support before retrying.' });
    const failed = await cancelOrder(request('POST', `/api/mobile/v1/orders/${ORDER}/cancel`, { reason: 'Duplicate order.' }), { params: Promise.resolve({ id: ORDER }) });
    expect(failed.status).toBe(503);
    expect(client.tables.orders?.[0]?.status).toBe('cancelled');
    const retry = await cancelOrder(request('POST', `/api/mobile/v1/orders/${ORDER}/cancel`, { reason: 'Duplicate order.' }), { params: Promise.resolve({ id: ORDER }) });
    expect(retry.status).toBe(200);
    expect(mocks.restoreAndVerifyCancellationCoins).toHaveBeenCalledTimes(2);
    install({ tables: { orders: [{ id: ORDER, retailer_id: OTHER_RETAILER, status: 'cancelled' }] } });
    const foreign = await cancelOrder(request('POST', `/api/mobile/v1/orders/${ORDER}/cancel`, {}), { params: Promise.resolve({ id: ORDER }) });
    expect(foreign.status).toBe(409);
    expect(mocks.restoreAndVerifyCancellationCoins).toHaveBeenCalledTimes(2);
  });

  it('records account requests without accepting a caller-supplied owner', async () => {
    const client = install();
    const created = await createAccountRequest(request('POST', '/api/mobile/v1/account/requests', { requestType: 'data_export', note: 'Please send my account data.' }));
    expect(created.status).toBe(200);
    expect(client.queries.find((query) => query.table === 'retailer_account_requests' && query.operation === 'insert')?.payload)
      .toMatchObject({ retailer_id: RETAILER, request_type: 'data_export' });
    const hostile = await createAccountRequest(request('POST', '/api/mobile/v1/account/requests', { requestType: 'account_deletion', retailerId: OTHER_RETAILER }));
    expect(hostile.status).toBe(400);
    install({ tables: { retailer_account_requests: [{ id: 'request-1', retailer_id: RETAILER, request_type: 'data_export', status: 'submitted', created_at: '2026-10-01T00:00:00Z' }] } });
    const list = await json(await getAccountRequests(request('GET', '/api/mobile/v1/account/requests')));
    expect(list.data.requests[0].requestType).toBe('data_export');
  });

  it('rejects impossible or reversed report-date ranges instead of silently substituting defaults', async () => {
    const impossible = await getStatement(request('GET', '/api/mobile/v1/reports/statement?type=orders&from=2026-02-30'));
    expect(impossible.status).toBe(400);
    const reversed = await getStatement(request('GET', '/api/mobile/v1/reports/statement?type=orders&from=2026-04-02&to=2026-04-01'));
    expect(reversed.status).toBe(400);
  });

  it('exports owner-only order rows as CSV with the same India business-day boundaries', async () => {
    const client = install({ tables: {
      orders: [
        { id: 'mine', retailer_id: RETAILER, order_number: 'MT-001', placed_at: '2026-04-30T18:00:00.000Z', status: 'delivered', subtotal: 100, discount_total: 0, gst_total: 18, grand_total: 118 },
        { id: 'foreign', retailer_id: OTHER_RETAILER, order_number: 'MT-OTHER', placed_at: '2026-04-15T10:00:00.000Z', status: 'delivered', subtotal: 100, discount_total: 0, gst_total: 18, grand_total: 118 },
      ],
    } });
    const response = await getStatement(request('GET', '/api/mobile/v1/reports/statement?type=orders&from=2026-04-01&to=2026-04-30'));
    const csv = await response.text();
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('text/csv');
    expect(csv).toContain('MT-001');
    expect(csv).not.toContain('MT-OTHER');
    const orderQuery = client.queries.find((query) => query.table === 'orders');
    expect(orderQuery?.filters).toContainEqual({ op: 'eq', column: 'retailer_id', value: RETAILER });
    expect(orderQuery?.filters).toContainEqual({ op: 'gte', column: 'placed_at', value: '2026-03-31T18:30:00.000Z' });
    expect(orderQuery?.filters).toContainEqual({ op: 'lte', column: 'placed_at', value: '2026-04-30T18:29:59.999Z' });
  });
});
