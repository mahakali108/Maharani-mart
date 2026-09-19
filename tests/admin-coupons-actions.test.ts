import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createCouponAction,
  toggleCouponAction,
  updateCouponAction,
  type CouponFormInput,
} from '@/lib/admin/coupons-actions';
import { supabaseFixture } from './helpers/supabase-fixture';

const mocks = vi.hoisted(() => ({ client: vi.fn(), permission: vi.fn(), revalidate: vi.fn() }));
vi.mock('@/lib/supabase/server', () => ({ createClient: mocks.client }));
vi.mock('@/lib/admin/guard', () => ({ requirePermission: mocks.permission }));
vi.mock('next/cache', () => ({ revalidatePath: mocks.revalidate }));

const ADMIN = 'aaaaaa-0000-4000-8000-000000000001';
const COUPON_ID = 'bbbbbb-0000-4000-8000-000000000002';
const RETAILER = 'cccccc-0000-4000-8000-000000000003';

const validInput = {
  code: 'diwali10',
  title: 'Diwali 10% off',
  discountType: 'percentage' as const,
  discountValue: 10,
  minimumOrderValue: 1000,
  maximumDiscount: 500,
  usageLimit: 20,
  perRetailerLimit: 1,
  startsAt: '2026-10-01T00:00',
  expiresAt: '2026-11-01T00:00',
  isActive: true,
  firstOrderOnly: false,
  retailerId: '',
  categoryId: '',
  brandId: '',
  productId: '',
};

function db(extra: Record<string, object[]> = {}) {
  return supabaseFixture({ coupons: [], ...extra });
}

beforeEach(() => {
  vi.resetAllMocks();
  mocks.permission.mockResolvedValue({ id: ADMIN, role: 'admin', fullName: 'Fixture admin', email: null });
});

describe('createCouponAction', () => {
  it('requires pricing.manage and records created_by from the session', async () => {
    const fixture = db();
    mocks.client.mockReturnValue(fixture);
    expect(await createCouponAction(validInput)).toEqual({ success: true });
    expect(mocks.permission).toHaveBeenCalledWith('pricing.manage');
    expect(fixture.tables.coupons?.[0]).toMatchObject({
      code: 'DIWALI10',
      discount_type: 'percentage',
      discount_value: 10,
      minimum_order_value: 1000,
      maximum_discount: 500,
      usage_limit: 20,
      per_retailer_limit: 1,
      is_active: true,
      created_by: ADMIN,
    });
    expect(fixture.tables.coupons?.[0]).not.toHaveProperty('code_lower');
    expect(mocks.revalidate).toHaveBeenCalledWith('/admin/coupons');
    expect(mocks.revalidate).toHaveBeenCalledWith('/retailer/coupons');
  });

  it('normalizes mixed-case codes to the database storage form before any check', async () => {
    const fixture = db();
    mocks.client.mockReturnValue(fixture);
    await createCouponAction({ ...validInput, code: '  save500 ' });
    const codeQuery = fixture.queries.find((query) => query.table === 'coupons' && query.filters.some((f) => f.column === 'code'));
    expect(codeQuery?.filters.find((f) => f.column === 'code')?.value).toBe('SAVE500');
  });

  it('rejects a duplicate code without writing', async () => {
    const fixture = db({ coupons: [{ id: 'x', code: 'DIWALI10' }] });
    mocks.client.mockReturnValue(fixture);
    const result = await createCouponAction(validInput);
    expect(result).toMatchObject({ error: expect.stringContaining('already exists') });
  });

  it('rejects invalid shapes before any write', async () => {
    const fixture = db();
    mocks.client.mockReturnValue(fixture);
    const badInputs: CouponFormInput[] = [
      { ...validInput, code: 'has space' },
      { ...validInput, discountType: 'percentage', discountValue: 150 },
      { ...validInput, discountValue: 0 },
      { ...validInput, startsAt: '2026-11-01T00:00', expiresAt: '2026-10-01T00:00' },
      { ...validInput, perRetailerLimit: 0 },
      { ...validInput, usageLimit: 1.5 },
    ];
    for (const bad of badInputs) {
      expect(await createCouponAction(bad), JSON.stringify(bad)).toHaveProperty('error');
    }
    expect(fixture.queries.some((query) => query.operation === 'insert')).toBe(false);
  });

  it('drops the max-discount cap for fixed coupons (it only constrains percentages)', async () => {
    const fixture = db();
    mocks.client.mockReturnValue(fixture);
    await createCouponAction({ ...validInput, discountType: 'fixed', discountValue: 750, maximumDiscount: 500 });
    expect(fixture.tables.coupons?.[0]).toMatchObject({ discount_type: 'fixed', discount_value: 750, maximum_discount: null });
  });

  it('throws a permission error before touching the database', async () => {
    mocks.permission.mockRejectedValue(new Error('Permission denied'));
    await expect(createCouponAction(validInput)).rejects.toThrow('Permission denied');
    expect(mocks.client).not.toHaveBeenCalled();
  });
});

describe('updateCouponAction', () => {
  it('updates the target row and revalidates the coupon paths', async () => {
    const fixture = db({ coupons: [{ id: COUPON_ID, code: 'OLD', is_active: true }] });
    mocks.client.mockReturnValue(fixture);
    expect(await updateCouponAction(COUPON_ID, { ...validInput, code: 'NEW10' })).toEqual({ success: true });
    expect(fixture.tables.coupons?.[0]).toMatchObject({ id: COUPON_ID, code: 'NEW10' });
    expect(mocks.revalidate).toHaveBeenCalledWith('/admin/coupons');
  });

  it('rejects a code that another coupon already uses', async () => {
    const fixture = db({ coupons: [{ id: COUPON_ID, code: 'KEEP' }, { id: 'other', code: 'TAKEN' }] });
    mocks.client.mockReturnValue(fixture);
    const result = await updateCouponAction(COUPON_ID, { ...validInput, code: 'taken' });
    expect(result).toMatchObject({ error: expect.stringContaining('TAKEN') });
  });

  it('rejects unknown ids', async () => {
    const fixture = db();
    mocks.client.mockReturnValue(fixture);
    expect(await updateCouponAction('missing', validInput)).toMatchObject({ error: 'Coupon not found.' });
  });
});

describe('toggleCouponAction', () => {
  it('flips the active flag with the staff permission', async () => {
    const fixture = db({ coupons: [{ id: COUPON_ID, code: 'X', is_active: true }] });
    mocks.client.mockReturnValue(fixture);
    expect(await toggleCouponAction(COUPON_ID, false)).toEqual({ success: true });
    expect(fixture.tables.coupons?.[0]).toMatchObject({ is_active: false });
  });

  it('refuses the toggle without pricing.manage', async () => {
    mocks.permission.mockRejectedValue(new Error('Permission denied'));
    await expect(toggleCouponAction(COUPON_ID, true)).rejects.toThrow('Permission denied');
    expect(mocks.client).not.toHaveBeenCalled();
  });
});
