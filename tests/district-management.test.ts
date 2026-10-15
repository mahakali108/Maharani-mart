import { beforeEach, describe, expect, it, vi } from 'vitest';
import { areaSchema, areasInDistrict, districtOptions, districtSchema, serviceAreaLabel } from '@/lib/areas/district';
import { addressPayloadSchema, parseAddressForm } from '@/lib/retailer/address-shared';
import { supabaseFixture } from './helpers/supabase-fixture';

const AREA = '11111111-1111-4111-8111-111111111111';
const RETAILER = '22222222-2222-4222-8222-222222222222';
const state = vi.hoisted(() => ({ client: null as unknown, guard: vi.fn(), revalidate: vi.fn() }));
vi.mock('@/lib/supabase/server', () => ({ createClient: () => state.client }));
vi.mock('@/lib/admin/guard', () => ({ requirePermission: state.guard }));
vi.mock('@/lib/media', () => ({ deleteMedia: vi.fn(), isRenderableMediaRef: vi.fn(() => true) }));
vi.mock('next/cache', () => ({ revalidatePath: state.revalidate }));
vi.mock('next/navigation', () => ({ redirect: (path: string) => { throw new Error(`redirect:${path}`); } }));
import { createAreaAction, updateAreaAction } from '@/lib/admin/master-data-actions';
import { saveAddressAction } from '@/lib/retailer/address-actions';
import { reassignRetailerAreaAction } from '@/lib/admin/retailers-actions';

const form = (values: Record<string, string>) => {
  const data = new FormData();
  Object.entries(values).forEach(([key, value]) => data.set(key, value));
  return data;
};
beforeEach(() => { vi.clearAllMocks(); state.guard.mockResolvedValue({ id: 'admin', role: 'admin' }); });

describe('district vocabulary and existing assignments', () => {
  it('trims edits but does not guess aliases, case, state or coverage', () => {
    expect(districtSchema.parse(' Saran ')).toBe('Saran');
    for (const value of ['Khagaria', 'Patna', 'CHHAPRA', 'South 24 Parganas']) expect(districtSchema.parse(value)).toBe(value);
  });
  it('bounds input and rejects blank required districts/control characters', () => {
    expect(areaSchema.safeParse({ name: 'Market', district: '  ' }).success).toBe(false);
    expect(areaSchema.safeParse({ name: '  ', district: 'Saran' }).success).toBe(false);
    expect(districtSchema.safeParse('x'.repeat(121)).success).toBe(false);
    expect(districtSchema.safeParse('Saran\u0000').success).toBe(false);
  });
  it('uses configured districts and includes legacy values without inventing options', () => {
    const areas = [{ name: 'Market', district: 'Saran' }, { name: 'Market', district: 'Khagaria' }, { name: 'Ward', district: 'Saran' }];
    expect(districtOptions(areas)).toEqual(['Khagaria', 'Saran']);
    expect(areasInDistrict(areas, 'Saran')).toHaveLength(2);
    expect(areasInDistrict(areas, 'Unknown')).toEqual([]);
    expect(areasInDistrict(areas, '')).toEqual(areas);
    expect(serviceAreaLabel(areas[0]!)).toBe('Market — Saran');
  });
  it('web and native API parse the same address district without a Saran default', () => {
    const payload = { label: 'Shop', receiverName: 'Owner', phone: '9000000000', line1: 'Market road', city: 'Town', pincode: '800001', district: ' Patna ' };
    const web = parseAddressForm(form(payload));
    expect(web.ok && web.value.district).toBe('Patna');
    expect(addressPayloadSchema.parse(payload).district).toBe('Patna');
    const { district: _, ...noDistrict } = payload;
    expect(addressPayloadSchema.parse(noDistrict).district).toBeUndefined();
  });
});

describe('admin service-area reassignment', () => {
  it('saves a verified area, reloads its district, and invalidates dependent views', async () => {
    const client = supabaseFixture({ areas: [{ id: AREA, name: 'Market', district: 'Saran', is_active: true }], retailers: [{ id: RETAILER, area_id: 'old-area' }] });
    state.client = client;
    expect(await reassignRetailerAreaAction(RETAILER, null, form({ areaId: AREA }))).toEqual({ success: 'Service area and district saved.' });
    expect(state.guard).toHaveBeenCalledWith('retailers.approve');
    const { data: retailer } = await client.from('retailers').select('area_id').eq('id', RETAILER).maybeSingle();
    expect(retailer?.area_id).toBe(AREA);
    const { data: area } = await client.from('areas').select('district').eq('id', retailer!.area_id).maybeSingle();
    expect(area?.district).toBe('Saran');
    expect(state.revalidate).toHaveBeenCalledWith('/retailer', 'layout');
  });
  it.each([false, null])('rejects an inactive/missing area (%s) without updating', async (active) => {
    const client = supabaseFixture({ areas: active === null ? [] : [{ id: AREA, is_active: active }], retailers: [{ id: RETAILER }] });
    state.client = client;
    expect(await reassignRetailerAreaAction(RETAILER, null, form({ areaId: AREA }))).toEqual({ error: 'Choose an active service area.' });
    expect(client.queries.some((q) => q.operation === 'update')).toBe(false);
  });
  it('validates UUIDs before querying', async () => {
    const client = supabaseFixture({}); state.client = client;
    expect(await reassignRetailerAreaAction(RETAILER, null, form({ areaId: 'forged' }))).toHaveProperty('error');
    expect(client.queries).toHaveLength(0);
  });
  it('does not report a successful save for an invisible/missing retailer', async () => {
    state.client = supabaseFixture({ areas: [{ id: AREA, is_active: true }], retailers: [] });
    expect(await reassignRetailerAreaAction(RETAILER, null, form({ areaId: AREA }))).toEqual({ error: 'Retailer not found or not permitted.' });
  });
  it('requires server permission before reading or changing assignments', async () => {
    const client = supabaseFixture({}); state.client = client;
    state.guard.mockRejectedValue(new Error('Not permitted'));
    await expect(reassignRetailerAreaAction(RETAILER, null, form({ areaId: AREA }))).rejects.toThrow('Not permitted');
    expect(client.queries).toHaveLength(0);
  });
});


describe('district create/edit actions and address persistence', () => {
  it('creates a trimmed area and reads it back in the configured directory', async () => {
    const client = supabaseFixture({ areas: [] }); state.client = client;
    expect(await createAreaAction(null, form({ name: ' New market ', district: ' Saran ' }))).toHaveProperty('success');
    expect(state.guard).toHaveBeenCalledWith('master_data.manage');
    const { data } = await client.from('areas').select('*');
    expect(data?.[0]).toMatchObject({ name: 'New market', district: 'Saran' });
  });
  it('edits one area without rewriting legacy records and refreshes dependent screens', async () => {
    const client = supabaseFixture({ areas: [{ id: AREA, name: 'Market', district: 'Khagaria' }, { id: 'other', name: 'Legacy market', district: 'Khagaria' }] });
    state.client = client;
    await expect(updateAreaAction(AREA, null, form({ name: 'Market', district: 'Patna' }))).rejects.toThrow('redirect:/admin/areas');
    const { data } = await client.from('areas').select('*');
    expect(data?.find((row) => row.id === AREA)?.district).toBe('Patna');
    expect(data?.find((row) => row.id === 'other')?.district).toBe('Khagaria');
    expect(state.revalidate).toHaveBeenCalledWith('/register-retailer');
  });
  it('refuses invalid or missing areas instead of claiming they were saved', async () => {
    state.client = supabaseFixture({ areas: [] });
    expect(await updateAreaAction('bad', null, form({ name: 'Market', district: 'Saran' }))).toHaveProperty('error');
    expect(await updateAreaAction(AREA, null, form({ name: 'Market', district: 'Saran' }))).toEqual({ error: 'Area not found or not permitted.' });
    expect(await createAreaAction(null, form({ name: 'Market', district: '  ' }))).toHaveProperty('error');
  });
  it('web address save/edit/reload persists the district and always scopes the owner', async () => {
    state.guard.mockResolvedValue({ id: RETAILER, role: 'retailer' });
    const client = supabaseFixture({ retailer_addresses: [] }); state.client = client;
    const payload = { label: 'Shop', receiverName: 'Owner', phone: '9000000000', line1: 'Market road', city: 'Town', pincode: '800001', district: ' Patna ' };
    const saved = await saveAddressAction(form(payload));
    expect(saved).toHaveProperty('success', true);
    const { data: rows } = await client.from('retailer_addresses').select('*');
    const row = rows?.[0];
    expect(row).toMatchObject({ retailer_id: RETAILER, district: 'Patna' });
    // This query double generates descriptive IDs, unlike PostgreSQL's UUID default.
    // Give the created fixture a database-shaped ID before exercising the real edit parser.
    const addressId = '33333333-3333-4333-8333-333333333333';
    await client.from('retailer_addresses').update({ id: addressId }).eq('id', row!.id);
    expect(await saveAddressAction(form({ ...payload, addressId, district: 'Khagaria' }))).toHaveProperty('success', true);
    const { data: reload } = await client.from('retailer_addresses').select('*').eq('id', addressId).maybeSingle();
    expect(reload?.district).toBe('Khagaria');
    const update = client.queries.find((q) => q.operation === 'update' && q.payload?.district === 'Khagaria');
    expect(update?.filters).toContainEqual({ op: 'eq', column: 'retailer_id', value: RETAILER });
  });
});
