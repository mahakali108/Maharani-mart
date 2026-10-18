import { describe, expect, it } from 'vitest';
import { MobileCommerceError, loadMobileAddresses, resolveMobileAddress } from '@/lib/mobile/commerce-service';
import type { MobileSession } from '@/lib/mobile/auth';
import { supabaseFixture } from './helpers/supabase-fixture';

const RETAILER = '11111111-1111-4111-8111-111111111111';
const OTHER_RETAILER = '22222222-2222-4222-8222-222222222222';
const ADDRESS = '33333333-3333-4333-8333-333333333333';

function session(tables: Record<string, object[]> = {}): { value: MobileSession; client: ReturnType<typeof supabaseFixture> } {
  const client = supabaseFixture({
    retailer_addresses: [],
    retailers: [{ id: RETAILER, address: 'Registered shop, Patna' }],
    ...tables,
  });
  return {
    client,
    value: {
      userId: RETAILER,
      email: 'shop@example.test',
      role: 'retailer',
      fullName: 'Shop Owner',
      phone: '9000000000',
      retailer: { status: 'active', shopName: 'Shop' },
      access: { status: 'active', expiresAt: null },
      accessToken: 'verified-token',
      supabase: client as unknown as MobileSession['supabase'],
    },
  };
}

const savedAddress = {
  id: ADDRESS,
  retailer_id: RETAILER,
  label: 'Shop entrance',
  receiver_name: 'Shop Owner',
  phone: '9000000000',
  line1: 'Shop 4, Market Road',
  line2: null,
  landmark: 'Near the bus stand',
  city: 'Patna',
  district: 'Patna',
  state: 'Bihar',
  pincode: '800001',
  is_default: true,
};

describe('mobile checkout address constraints', () => {
  it('lists only the authenticated retailer\'s saved addresses and its profile address', async () => {
    const { value, client } = session({
      retailer_addresses: [savedAddress, { ...savedAddress, id: 'other-address', retailer_id: OTHER_RETAILER }],
    });

    const addresses = await loadMobileAddresses(value);

    expect(addresses).toHaveLength(2);
    expect(addresses[0]).toMatchObject({ id: ADDRESS, isDefault: true });
    expect(addresses[1]).toMatchObject({ id: null, label: 'Shop address', line: 'Registered shop, Patna' });
    expect(client.queries.find((query) => query.table === 'retailer_addresses')?.filters)
      .toContainEqual({ op: 'eq', column: 'retailer_id', value: RETAILER });
  });

  it('resolves and freezes only a saved address owned by the current retailer', async () => {
    const { value, client } = session({ retailer_addresses: [savedAddress] });

    const resolved = await resolveMobileAddress(value, ADDRESS);

    expect(resolved).toMatchObject({
      id: ADDRESS,
      display: { id: ADDRESS, label: 'Shop entrance' },
      snapshot: {
        line: expect.stringContaining('800001'),
        label: 'Shop entrance',
        receiverName: 'Shop Owner',
        phone: '9000000000',
        district: 'Patna', state: 'Bihar', pincode: '800001',
      },
    });
    expect(client.queries.find((query) => query.table === 'retailer_addresses')?.filters)
      .toContainEqual({ op: 'eq', column: 'retailer_id', value: RETAILER });
  });

  it('returns a non-disclosing not-found error for another retailer\'s address', async () => {
    const { value } = session({
      retailer_addresses: [{ ...savedAddress, retailer_id: OTHER_RETAILER }],
    });

    const error = await resolveMobileAddress(value, ADDRESS).catch((cause: unknown) => cause);

    expect(error).toBeInstanceOf(MobileCommerceError);
    expect(error).toMatchObject({ code: 'not_found', status: 404 });
  });

  it('rejects unstructured registered-shop text even when a profile address exists', async () => {
    const { value } = session();

    const error = await resolveMobileAddress(value, null).catch((cause: unknown) => cause);

    expect(error).toBeInstanceOf(MobileCommerceError);
    expect(error).toMatchObject({ code: 'invalid_request', status: 400 });
    expect((error as Error).message).toMatch(/saved delivery address/);
  });
});
