import { beforeEach, describe, expect, it, vi } from 'vitest';
import { supabaseFixture } from './helpers/supabase-fixture';

/**
 * Route-level coverage for the address book CRUD endpoints.
 *
 * The service layer has its own ownership/validation tests
 * (`mobile-address-crud.test.ts`); these assert the HTTP contract: the verified
 * session decides the owner, a non-retailer is refused, invalid input is a
 * field-level `400`, and another retailer's address is a `404`.
 */

const mocks = vi.hoisted(() => ({
  client: null as unknown,
}));

vi.mock('@/lib/mobile/supabase', () => ({ createMobileSupabaseClient: () => mocks.client }));

import { POST as createAddress, GET as listAddresses } from '@/app/api/mobile/v1/addresses/route';
import { DELETE as deleteAddress, PATCH as patchAddress } from '@/app/api/mobile/v1/addresses/[addressId]/route';
import { POST as setDefaultAddress } from '@/app/api/mobile/v1/addresses/[addressId]/default/route';
import { resetRateLimits } from '@/lib/mobile/rate-limit';

const RETAILER = '11111111-1111-4111-8111-111111111111';
const STAFF = '22222222-2222-4222-8222-222222222222';
const ADDRESS = '33333333-3333-4333-8333-333333333333';
const OTHER_RETAILER = '44444444-4444-4444-8444-444444444444';

const validBody = {
  label: 'Godown',
  receiverName: 'Shop Owner',
  phone: '9000000000',
  line1: 'Warehouse 7, NH-31',
  city: 'Khagaria',
  pincode: '851204',
};

function install({ role = 'retailer', addresses = [] as object[] } = {}) {
  const client = supabaseFixture({
    profiles: [{
      id: role === 'retailer' ? RETAILER : STAFF,
      role,
      full_name: 'Shop Owner',
      phone: '9876543210',
      is_active: true,
    }],
    retailers: role === 'retailer'
      ? [{ id: RETAILER, status: 'active', shop_name: 'Shop', address: 'Shop Road' }]
      : [],
    retailer_addresses: addresses,
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

describe('mobile address routes', () => {
  it('lists only the caller\'s addresses for the verified session', async () => {
    const client = install({
      addresses: [
        {
          id: ADDRESS, retailer_id: RETAILER, label: 'Shop', receiver_name: 'Owner', phone: '9000000000',
          line1: 'A', line2: null, landmark: null, city: 'Khagaria', district: null, state: 'Bihar',
          pincode: '851204', is_default: true,
        },
        {
          id: 'other', retailer_id: OTHER_RETAILER, label: 'Theirs', receiver_name: 'Other', phone: '9000000001',
          line1: 'B', line2: null, landmark: null, city: 'Khagaria', district: null, state: 'Bihar',
          pincode: '851204', is_default: false,
        },
      ],
    });

    const response = await listAddresses(apiRequest('GET', '/api/mobile/v1/addresses'));
    const payload = await json(response);

    expect(response.status).toBe(200);
    const addresses = (payload.data as { addresses: { id: string | null }[] }).addresses;
    expect(addresses.some((address) => address.id === ADDRESS)).toBe(true);
    expect(addresses.some((address) => address.id === 'other')).toBe(false);
    expect(client.queries.find((query) => query.table === 'retailer_addresses')?.filters)
      .toContainEqual({ op: 'eq', column: 'retailer_id', value: RETAILER });
  });

  it('creates an address owned by the session, not the request body', async () => {
    const client = install();

    const response = await createAddress(apiRequest('POST', '/api/mobile/v1/addresses', {
      ...validBody,
      retailerId: OTHER_RETAILER,
    }));
    const payload = await json(response);

    expect(response.status).toBe(200);
    const insert = client.queries.find((query) => query.table === 'retailer_addresses' && query.operation === 'insert');
    expect(insert?.payload).toMatchObject({ retailer_id: RETAILER, label: 'Godown', state: 'Bihar' });
    expect(insert?.payload).not.toHaveProperty('retailerId');
    expect((payload.data as { address: { id: string } }).address.id).toBeTruthy();
  });

  it('refuses an invalid address with a field-level validation error', async () => {
    const response = await createAddress(apiRequest('POST', '/api/mobile/v1/addresses', {
      ...validBody,
      pincode: '8512',
    }));
    const payload = await json(response);

    expect(response.status).toBe(400);
    expect((payload.error as { code: string }).code).toBe('validation_failed');
    expect((payload.error as { details: { fields: Record<string, string> } }).details.fields.pincode)
      .toBe('PIN code must be exactly 6 digits.');
  });

  it('refuses a non-retailer session before touching the database', async () => {
    const client = install({ role: 'staff' });

    const response = await createAddress(apiRequest('POST', '/api/mobile/v1/addresses', validBody));

    expect(response.status).toBe(403);
    expect(client.queries.some((query) => query.operation === 'insert')).toBe(false);
  });

  it('edits the caller\'s own address', async () => {
    const client = install({
      addresses: [{
        id: ADDRESS, retailer_id: RETAILER, label: 'Shop', receiver_name: 'Owner', phone: '9000000000',
        line1: 'A', line2: null, landmark: null, city: 'Khagaria', district: null, state: 'Bihar',
        pincode: '851204', is_default: true,
      }],
    });

    const response = await patchAddress(
      apiRequest('PATCH', `/api/mobile/v1/addresses/${ADDRESS}`, { ...validBody, label: 'Main godown' }),
      { params: { addressId: ADDRESS } },
    );

    expect(response.status).toBe(200);
    const update = client.queries.find((query) => query.table === 'retailer_addresses' && query.operation === 'update');
    expect(update?.filters).toContainEqual({ op: 'eq', column: 'retailer_id', value: RETAILER });
  });

  it('answers 404 for another retailer\'s address and 400 for a malformed id', async () => {
    install({
      addresses: [{
        id: ADDRESS, retailer_id: OTHER_RETAILER, label: 'Theirs', receiver_name: 'Other', phone: '9000000001',
        line1: 'B', line2: null, landmark: null, city: 'Khagaria', district: null, state: 'Bihar',
        pincode: '851204', is_default: false,
      }],
    });

    const foreign = await patchAddress(
      apiRequest('PATCH', `/api/mobile/v1/addresses/${ADDRESS}`, validBody),
      { params: { addressId: ADDRESS } },
    );
    expect(foreign.status).toBe(404);

    const malformed = await deleteAddress(
      apiRequest('DELETE', '/api/mobile/v1/addresses/not-a-uuid'),
      { params: { addressId: 'not-a-uuid' } },
    );
    expect(malformed.status).toBe(400);
  });

  it('promotes the caller\'s address to default exclusively', async () => {
    const client = install({
      addresses: [
        {
          id: ADDRESS, retailer_id: RETAILER, label: 'Shop', receiver_name: 'Owner', phone: '9000000000',
          line1: 'A', line2: null, landmark: null, city: 'Khagaria', district: null, state: 'Bihar',
          pincode: '851204', is_default: false,
        },
        {
          id: 'second', retailer_id: RETAILER, label: 'Godown', receiver_name: 'Owner', phone: '9000000000',
          line1: 'B', line2: null, landmark: null, city: 'Khagaria', district: null, state: 'Bihar',
          pincode: '851204', is_default: true,
        },
      ],
    });

    const response = await setDefaultAddress(
      apiRequest('POST', `/api/mobile/v1/addresses/${ADDRESS}/default`),
      { params: { addressId: ADDRESS } },
    );

    expect(response.status).toBe(200);
    const updates = client.queries.filter((query) => query.table === 'retailer_addresses' && query.operation === 'update');
    expect(updates.some((query) => query.payload?.is_default === true
      && query.filters.some((filter) => filter.column === 'id' && filter.value === ADDRESS))).toBe(true);
    expect(updates.some((query) => query.payload?.is_default === false
      && query.filters.some((filter) => filter.op === 'neq' && filter.value === ADDRESS))).toBe(true);
  });

  it('deletes the caller\'s address and reports the refreshed list', async () => {
    install({
      addresses: [{
        id: ADDRESS, retailer_id: RETAILER, label: 'Shop', receiver_name: 'Owner', phone: '9000000000',
        line1: 'A', line2: null, landmark: null, city: 'Khagaria', district: null, state: 'Bihar',
        pincode: '851204', is_default: true,
      }],
    });

    const response = await deleteAddress(
      apiRequest('DELETE', `/api/mobile/v1/addresses/${ADDRESS}`),
      { params: { addressId: ADDRESS } },
    );
    const payload = await json(response);

    expect(response.status).toBe(200);
    const addresses = (payload.data as { addresses: { id: string | null }[] }).addresses;
    expect(addresses.some((address) => address.id === ADDRESS)).toBe(false);
    // The registered shop address stays available for checkout.
    expect(addresses.some((address) => address.id === null)).toBe(true);
  });
});
