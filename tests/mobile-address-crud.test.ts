import { describe, expect, it } from 'vitest';
import { MobileCommerceError } from '@/lib/mobile/commerce-service';
import {
  createMobileAddress,
  deleteMobileAddress,
  setDefaultMobileAddress,
  updateMobileAddress,
} from '@/lib/mobile/commerce-service';
import { addressPayloadSchema, parseAddressForm } from '@/lib/retailer/address-shared';
import type { MobileSession } from '@/lib/mobile/auth';
import { supabaseFixture } from './helpers/supabase-fixture';

const RETAILER = '11111111-1111-4111-8111-111111111111';
const OTHER_RETAILER = '22222222-2222-4222-8222-222222222222';
const ADDRESS = '33333333-3333-4333-8333-333333333333';
const OTHER_ADDRESS = '44444444-4444-4444-8444-444444444444';

const NEW_ADDRESS = {
  label: 'Godown',
  receiverName: 'Shop Owner',
  phone: '9000000000',
  line1: 'Warehouse 7, NH-31',
  city: 'Khagaria',
  pincode: '851204',
} as const;

function session(tables: Record<string, object[]> = {}): { value: MobileSession; client: ReturnType<typeof supabaseFixture> } {
  const client = supabaseFixture({ retailer_addresses: [], ...tables });
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
  landmark: null,
  city: 'Khagaria',
  district: null,
  state: 'Bihar',
  pincode: '851204',
  is_default: true,
};

describe('mobile address book CRUD', () => {
  it('creates an address owned by the verified session and normalizes optional fields', async () => {
    const { value, client } = session();

    const created = await createMobileAddress(value, addressPayloadSchema.parse(NEW_ADDRESS));

    const insert = client.queries.find((query) => query.table === 'retailer_addresses' && query.operation === 'insert');
    expect(insert?.payload).toMatchObject({
      retailer_id: RETAILER,
      label: 'Godown',
      line2: null,
      landmark: null,
      district: null,
      state: 'Bihar',
      is_default: false,
    });
    // The client can never choose the owner: the body has nowhere to put one.
    expect(created).toMatchObject({ label: 'Godown', receiverName: 'Shop Owner', isDefault: false });
    expect(created.id).toBeTruthy();
    expect(created.line).toContain('851204');
  });

  it('makes the first saved address the default when the retailer had none', async () => {
    const { value, client } = session({
      retailer_addresses: [{ ...savedAddress, id: ADDRESS, is_default: false }],
    });

    await createMobileAddress(value, addressPayloadSchema.parse(NEW_ADDRESS));

    const updates = client.queries.filter((query) => query.table === 'retailer_addresses' && query.operation === 'update');
    // The new row is not the default, so the oldest existing address is promoted.
    expect(updates.some((query) => query.payload?.is_default === true)).toBe(true);
    expect(updates.some((query) => query.filters.some((filter) => filter.column === 'id' && filter.value === ADDRESS))).toBe(true);
  });

  it('keeps the default exclusive when a new address is saved as default', async () => {
    const { value, client } = session({
      retailer_addresses: [{ ...savedAddress, id: OTHER_ADDRESS, is_default: true }],
    });

    await createMobileAddress(value, { ...addressPayloadSchema.parse(NEW_ADDRESS), isDefault: true });

    const update = client.queries
      .filter((query) => query.table === 'retailer_addresses' && query.operation === 'update' && query.payload?.is_default === false)
      .at(-1);
    expect(update?.filters).toContainEqual({ op: 'eq', column: 'retailer_id', value: RETAILER });
    expect(update?.filters).toContainEqual({ op: 'neq', column: 'id', value: expect.any(String) });
  });

  it('scopes an edit to the caller with both id and owner filters', async () => {
    const { value, client } = session({ retailer_addresses: [savedAddress] });

    const updated = await updateMobileAddress(value, ADDRESS, {
      ...addressPayloadSchema.parse(NEW_ADDRESS),
      label: 'Main godown',
    });

    const update = client.queries.find((query) => query.table === 'retailer_addresses' && query.operation === 'update');
    expect(update?.filters).toContainEqual({ op: 'eq', column: 'id', value: ADDRESS });
    expect(update?.filters).toContainEqual({ op: 'eq', column: 'retailer_id', value: RETAILER });
    expect(updated).toMatchObject({ id: ADDRESS, label: 'Main godown' });
  });

  it('answers not_found for another retailer\'s address instead of editing it', async () => {
    const { value } = session({
      retailer_addresses: [{ ...savedAddress, retailer_id: OTHER_RETAILER }],
    });

    const error = await updateMobileAddress(value, ADDRESS, addressPayloadSchema.parse(NEW_ADDRESS))
      .catch((cause: unknown) => cause);

    expect(error).toBeInstanceOf(MobileCommerceError);
    expect(error).toMatchObject({ code: 'not_found', status: 404 });
  });

  it('sets the default on the caller\'s own row and clears the others', async () => {
    const { value, client } = session({
      retailer_addresses: [
        { ...savedAddress, id: ADDRESS, is_default: false },
        { ...savedAddress, id: OTHER_ADDRESS, is_default: true },
      ],
    });

    const address = await setDefaultMobileAddress(value, ADDRESS);

    expect(address).toMatchObject({ id: ADDRESS, isDefault: true });
    const updates = client.queries.filter((query) => query.table === 'retailer_addresses' && query.operation === 'update');
    expect(updates.some((query) => query.payload?.is_default === true
      && query.filters.some((filter) => filter.column === 'id' && filter.value === ADDRESS))).toBe(true);
    expect(updates.some((query) => query.payload?.is_default === false
      && query.filters.some((filter) => filter.op === 'neq' && filter.value === ADDRESS))).toBe(true);
  });

  it('deletes only the caller\'s row and re-establishes a deterministic default', async () => {
    const { value, client } = session({
      retailer_addresses: [
        { ...savedAddress, id: ADDRESS, is_default: true },
        { ...savedAddress, id: OTHER_ADDRESS, is_default: false },
      ],
    });

    await deleteMobileAddress(value, ADDRESS);

    const deletion = client.queries.find((query) => query.table === 'retailer_addresses' && query.operation === 'delete');
    expect(deletion?.filters).toContainEqual({ op: 'eq', column: 'id', value: ADDRESS });
    expect(deletion?.filters).toContainEqual({ op: 'eq', column: 'retailer_id', value: RETAILER });
    const promotion = client.queries
      .filter((query) => query.table === 'retailer_addresses' && query.operation === 'update' && query.payload?.is_default === true)
      .at(-1);
    expect(promotion?.filters).toContainEqual({ op: 'eq', column: 'id', value: OTHER_ADDRESS });
  });

  it('answers not_found when a delete targets a foreign address', async () => {
    const { value } = session({
      retailer_addresses: [{ ...savedAddress, retailer_id: OTHER_RETAILER }],
    });

    const error = await deleteMobileAddress(value, ADDRESS).catch((cause: unknown) => cause);

    expect(error).toBeInstanceOf(MobileCommerceError);
    expect(error).toMatchObject({ code: 'not_found', status: 404 });
  });
});

describe('shared address rules', () => {
  it('rejects a malformed PIN with the same message the web form shows', () => {
    const result = addressPayloadSchema.safeParse({ ...NEW_ADDRESS, pincode: '85120' });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]?.message).toBe('PIN code must be exactly 6 digits.');
    }
  });

  it('accepts the same submission through the web FormData parser', () => {
    const formData = new FormData();
    formData.set('label', NEW_ADDRESS.label);
    formData.set('receiverName', NEW_ADDRESS.receiverName);
    formData.set('phone', NEW_ADDRESS.phone);
    formData.set('line1', NEW_ADDRESS.line1);
    formData.set('city', NEW_ADDRESS.city);
    formData.set('pincode', NEW_ADDRESS.pincode);

    const parsed = parseAddressForm(formData);
    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      expect(addressPayloadSchema.safeParse(parsed.value).success).toBe(true);
    }
  });
});
