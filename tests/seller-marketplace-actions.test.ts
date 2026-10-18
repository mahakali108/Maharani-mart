/**
 * Seller Marketplace admin actions (0062–0068 app layer).
 * Pins: sellers.* permissions are Admin+ only; every action re-checks its
 * permission server-side; transitions carry their status guards in the update
 * filter (the DB trigger is the real boundary); validation is fail-closed.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createSellerAction,
  reviewSellerAction,
  suspendSellerAction,
  reinstateSellerAction,
} from '@/lib/admin/seller-actions';
import {
  createOfferAction,
  moderateOfferAction,
  setOfferActiveAction,
  setOfferFloorAction,
} from '@/lib/admin/offer-actions';
import {
  normalizeSellerInput,
  parsePaise,
  validateSellerInput,
} from '@/lib/admin/seller-validation';
import {
  sellerCreateOfferAction,
  sellerReplaceOfferTiersAction,
  sellerSetOfferActiveAction,
  sellerSetOfferStockAction,
  sellerUpdateOfferTermsAction,
  sellerUpdateSubOrderAction,
  updateSellerProfileAction,
} from '@/lib/seller/actions';
import { resolveOfferUnitPricePaise } from '@/lib/retailer/marketplace-offers';
import { can } from '@/lib/permissions/permissions';
import { supabaseFixture } from './helpers/supabase-fixture';

const mocks = vi.hoisted(() => ({
  client: vi.fn(),
  permission: vi.fn(),
  superAdminGuard: vi.fn(),
  sellerGuard: vi.fn(),
  activeSellerGuard: vi.fn(),
  revalidate: vi.fn(),
}));
vi.mock('@/lib/supabase/server', () => ({
  createClient: mocks.client,
  createServiceRoleClient: mocks.client,
}));
vi.mock('@/lib/admin/guard', () => ({ requirePermission: mocks.permission }));
vi.mock('@/lib/admin/control-center/guard', () => ({ requireSuperAdmin: mocks.superAdminGuard }));
vi.mock('@/lib/seller/guard', () => ({
  requireSeller: mocks.sellerGuard,
  requireActiveSeller: mocks.activeSellerGuard,
}));
vi.mock('next/cache', () => ({ revalidatePath: mocks.revalidate }));

const ADMIN = 'aaaaaaaa-0000-4000-8000-000000000001';
const SELLER_ID = 'bbbbbbbb-0000-4000-8000-000000000002';
const OFFER_ID = 'cccccccc-0000-4000-8000-000000000003';
const PACK_ID = 'dddddddd-0000-4000-8000-000000000004';

beforeEach(() => {
  vi.resetAllMocks();
  mocks.permission.mockResolvedValue({ id: ADMIN, role: 'admin', fullName: 'Fixture admin', email: null });
  mocks.superAdminGuard.mockResolvedValue({ id: ADMIN, role: 'super_admin', fullName: 'Fixture owner', email: null });
  mocks.sellerGuard.mockResolvedValue({
    user: { id: SELLER_ID, role: 'seller', fullName: 'Seller Owner', email: 'seller@test.local' },
    seller: { id: SELLER_ID, business_name: 'Bazaar Traders', status: 'active' },
    memberRole: 'owner',
  });
  mocks.activeSellerGuard.mockResolvedValue({
    user: { id: SELLER_ID, role: 'seller', fullName: 'Seller Owner', email: 'seller@test.local' },
    seller: { id: SELLER_ID, business_name: 'Bazaar Traders', status: 'active' },
    memberRole: 'owner',
  });
});

describe('seller permission matrix (Admin + Super Admin only)', () => {
  it('sellers.view / sellers.review / sellers.manage are admin+ — nobody else', () => {
    for (const permission of ['sellers.view', 'sellers.review', 'sellers.manage'] as const) {
      expect(can('super_admin', permission)).toBe(true);
      expect(can('admin', permission)).toBe(true);
      expect(can('staff', permission)).toBe(false);
      expect(can('salesman', permission)).toBe(false);
      expect(can('retailer', permission)).toBe(false);
      expect(can('seller', permission)).toBe(false);
    }
  });

  it('the seller role has NO web permissions (login surface is gated)', () => {
    expect(can('seller', 'products.view')).toBe(false);
    expect(can('seller', 'orders.view.own')).toBe(false);
  });
});

describe('seller account invitations', () => {
  it('requires the Super Admin guard and requires an email for Auth invitation', async () => {
    const form = new FormData();
    form.set('businessName', 'Example Wholesale');
    expect(await createSellerAction(form)).toEqual({
      ok: false,
      error: 'Seller email is required for the secure account invitation.',
    });
    expect(mocks.superAdminGuard).toHaveBeenCalledOnce();
    expect(mocks.permission).not.toHaveBeenCalled();
  });

  it('fails closed when Super Admin authorization is denied', async () => {
    mocks.superAdminGuard.mockRejectedValueOnce(new Error('Access denied'));
    await expect(createSellerAction(new FormData())).rejects.toThrow('Access denied');
  });
});

describe('seller review actions', () => {
  it('reviewSellerAction guards the pending state in the update filter', async () => {
    const fixture = supabaseFixture({ sellers: [{ id: SELLER_ID, status: 'pending' }] });
    mocks.client.mockReturnValue(fixture);
    const result = await reviewSellerAction(SELLER_ID, 'active');
    expect(result).toEqual({ ok: true });
    expect(mocks.permission).toHaveBeenCalledWith('sellers.review');
    const update = fixture.queries.find((q) => q.operation === 'update');
    expect(update?.table).toBe('sellers');
    expect(update?.payload).toMatchObject({ status: 'active', rejection_reason: null });
    expect(update?.filters).toContainEqual({ op: 'eq', column: 'status', value: 'pending' });
  });

  it('rejection requires a reason before any database write', async () => {
    const fixture = supabaseFixture({ sellers: [] });
    mocks.client.mockReturnValue(fixture);
    const result = await reviewSellerAction(SELLER_ID, 'rejected', 'x');
    expect(result).toEqual({ ok: false, error: expect.stringContaining('reason') });
    expect(fixture.queries).toEqual([]);
  });

  it('suspendSellerAction requires a reason and only moves active → suspended', async () => {
    const fixture = supabaseFixture({ sellers: [{ id: SELLER_ID, status: 'active' }] });
    mocks.client.mockReturnValue(fixture);
    const result = await suspendSellerAction(SELLER_ID, 'compliance hold');
    expect(result).toEqual({ ok: true });
    const update = fixture.queries.find((q) => q.operation === 'update');
    expect(update?.payload).toMatchObject({ status: 'suspended', suspension_reason: 'compliance hold' });
    expect(update?.filters).toContainEqual({ op: 'eq', column: 'status', value: 'active' });
  });

  it('reinstateSellerAction only moves suspended → active (offers stay off)', async () => {
    const fixture = supabaseFixture({ sellers: [{ id: SELLER_ID, status: 'suspended' }] });
    mocks.client.mockReturnValue(fixture);
    const result = await reinstateSellerAction(SELLER_ID);
    expect(result).toEqual({ ok: true });
    const update = fixture.queries.find((q) => q.operation === 'update');
    expect(update?.payload).toMatchObject({ status: 'active' });
    expect(update?.filters).toContainEqual({ op: 'eq', column: 'status', value: 'suspended' });
  });

  it('rejects non-uuid ids before touching the database', async () => {
    const fixture = supabaseFixture({ sellers: [] });
    mocks.client.mockReturnValue(fixture);
    expect(await suspendSellerAction("x' or 1=1 --", 'reason here')).toEqual({
      ok: false,
      error: 'Invalid seller record.',
    });
    expect(fixture.queries).toEqual([]);
  });
});

describe('offer moderation and floors', () => {
  it('moderateOfferAction stamps moderation fields under sellers.manage', async () => {
    const fixture = supabaseFixture({ seller_offers: [{ id: OFFER_ID }] });
    mocks.client.mockReturnValue(fixture);
    const result = await moderateOfferAction(OFFER_ID, 'approved');
    expect(result).toEqual({ ok: true });
    expect(mocks.permission).toHaveBeenCalledWith('sellers.manage');
    const update = fixture.queries.find((q) => q.operation === 'update');
    expect(update?.payload).toMatchObject({
      moderation_status: 'approved',
      moderation_by: ADMIN,
      moderation_reason: null,
    });
  });

  it('setOfferActiveAction deactivates (history preserved — no delete call exists)', async () => {
    const fixture = supabaseFixture({ seller_offers: [{ id: OFFER_ID }] });
    mocks.client.mockReturnValue(fixture);
    const result = await setOfferActiveAction(OFFER_ID, false);
    expect(result).toEqual({ ok: true });
    const update = fixture.queries.find((q) => q.operation === 'update');
    expect(update?.payload).toMatchObject({ is_active: false });
    expect(fixture.queries.some((q) => q.operation === 'delete')).toBe(false);
  });

  it('setOfferFloorAction parses rupees to integer paise', async () => {
    const fixture = supabaseFixture({ offer_price_floors: [] });
    mocks.client.mockReturnValue(fixture);
    const result = await setOfferFloorAction(PACK_ID, '95.50', 'Diwali floor');
    expect(result).toEqual({ ok: true });
    const insert = fixture.queries.find((q) => q.operation === 'insert');
    expect(insert?.table).toBe('offer_price_floors');
    expect(insert?.payload).toMatchObject({ pack_id: PACK_ID, floor_paise: 9550 });
  });

  it('createOfferAction derives the product identity from the pack, never the client', async () => {
    const fixture = supabaseFixture({
      product_packs: [{ id: PACK_ID, product_id: 'eeeeeeee-0000-4000-8000-000000000005', is_active: true }],
      seller_offers: [{ id: OFFER_ID }],
    });
    mocks.client.mockReturnValue(fixture);
    const formData = new FormData();
    formData.set('sellerId', SELLER_ID);
    formData.set('packId', PACK_ID);
    formData.set('productId', 'client-forged-product-id');
    formData.set('fulfilmentType', 'seller');
    formData.set('unitPrice', '120');
    formData.set('moq', '2');
    formData.set('stockQuantity', '40');
    const result = await createOfferAction(formData);
    expect(result).toEqual({ ok: true });
    const insert = fixture.queries.find((q) => q.operation === 'insert' && q.table === 'seller_offers');
    expect(insert?.payload).toMatchObject({
      seller_id: SELLER_ID,
      pack_id: PACK_ID,
      product_id: 'eeeeeeee-0000-4000-8000-000000000005',
      unit_price_paise: 12000,
      moq: 2,
      stock_quantity: 40,
      moderation_status: 'pending',
    });
  });
});

describe('seller input validation (fail-closed)', () => {
  it('normalizes and validates business identity fields', () => {
    const input = normalizeSellerInput({
      businessName: '  Bazaar Traders  ',
      gstin: '29abcde1234fz1z',
      pan: 'abcde1234f',
      phone: '+91 98765 43210',
      email: ' Shop@Example.COM ',
    });
    expect(input.gstin).toBe('29ABCDE1234FZ1Z');
    expect(input.pan).toBe('ABCDE1234F');
    expect(input.phone).toBe('9876543210');
    expect(input.email).toBe('shop@example.com');
    expect(validateSellerInput(input)).toEqual({ gstin: expect.any(String) });
    expect(validateSellerInput(normalizeSellerInput({ businessName: 'Bazaar Traders' }))).toEqual({});
  });

  it('parsePaise accepts ₹ with up to 2 decimals and rejects everything else', () => {
    expect(parsePaise('95.5')).toBe(9550);
    expect(parsePaise('0.05')).toBe(5);
    expect(parsePaise('0')).toBeNull();
    expect(parsePaise('-5')).toBeNull();
    expect(parsePaise('1.234')).toBeNull();
    expect(parsePaise('abc')).toBeNull();
    expect(parsePaise('')).toBeNull();
  });
});

describe('seller portal self-service actions and tier pricing', () => {
  it('sellerCreateOfferAction derives product_id from pack and starts in pending moderation', async () => {
    const fixture = supabaseFixture({
      product_packs: [{ id: PACK_ID, product_id: 'eeeeeeee-0000-4000-8000-000000000005', is_active: true }],
      seller_offers: [],
    });
    mocks.client.mockReturnValue(fixture);
    const formData = new FormData();
    formData.set('packId', PACK_ID);
    formData.set('fulfilmentType', 'seller');
    formData.set('unitPrice', '110');
    formData.set('moq', '3');
    formData.set('stockQuantity', '25');
    formData.set('sellerSku', 'SKU-1');
    const result = await sellerCreateOfferAction(formData);
    expect(result).toEqual({ ok: true });
    expect(mocks.activeSellerGuard).toHaveBeenCalled();
    const insert = fixture.queries.find((q) => q.operation === 'insert' && q.table === 'seller_offers');
    expect(insert?.payload).toMatchObject({
      seller_id: SELLER_ID,
      pack_id: PACK_ID,
      product_id: 'eeeeeeee-0000-4000-8000-000000000005',
      unit_price_paise: 11000,
      moq: 3,
      stock_quantity: 25,
      moderation_status: 'pending',
    });
  });

  it('sellerUpdateOfferTermsAction never sends moderation_status and scopes to seller_id', async () => {
    const fixture = supabaseFixture({
      seller_offers: [{ id: OFFER_ID, seller_id: SELLER_ID }],
    });
    mocks.client.mockReturnValue(fixture);
    const formData = new FormData();
    formData.set('offerId', OFFER_ID);
    formData.set('unitPrice', '105.50');
    formData.set('moq', '2');
    formData.set('sellerSku', 'SKU-2');
    const result = await sellerUpdateOfferTermsAction(formData);
    expect(result).toEqual({ ok: true });
    const update = fixture.queries.find((q) => q.operation === 'update' && q.table === 'seller_offers');
    expect(update?.payload).toEqual({
      unit_price_paise: 10550,
      moq: 2,
      seller_sku: 'SKU-2',
    });
    expect(update?.filters).toContainEqual({ op: 'eq', column: 'seller_id', value: SELLER_ID });
  });

  it('sellerReplaceOfferTiersAction validates non-overlapping slabs and calls RPC', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: 2, error: null });
    mocks.client.mockReturnValue({ rpc });

    const invalid = await sellerReplaceOfferTiersAction(OFFER_ID, [
      { minQuantity: 5, maxQuantity: 12, unitPriceRupees: '98' },
      { minQuantity: 10, maxQuantity: null, unitPriceRupees: '95' },
    ]);
    expect(invalid.ok).toBe(false);
    expect(rpc).not.toHaveBeenCalled();

    const valid = await sellerReplaceOfferTiersAction(OFFER_ID, [
      { minQuantity: 5, maxQuantity: 11, unitPriceRupees: '98' },
      { minQuantity: 12, maxQuantity: null, unitPriceRupees: '95.50' },
    ]);
    expect(valid).toEqual({ ok: true });
    expect(rpc).toHaveBeenCalledWith('seller_replace_offer_tiers', {
      p_offer_id: OFFER_ID,
      p_tiers: [
        { min_quantity: 5, max_quantity: 11, unit_price_paise: 9800 },
        { min_quantity: 12, max_quantity: null, unit_price_paise: 9550 },
      ],
    });
  });

  it('sellerSetOfferStockAction, sellerSetOfferActiveAction, sellerUpdateSubOrderAction and updateSellerProfileAction enforce guards', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: 30, error: null });
    mocks.client.mockReturnValue({ rpc });
    expect(await sellerSetOfferStockAction(OFFER_ID, 30)).toEqual({ ok: true });
    expect(rpc).toHaveBeenCalledWith('seller_set_offer_stock', { p_offer_id: OFFER_ID, p_stock_quantity: 30 });

    const subId = 'ffffffff-0000-4000-8000-000000000006';
    expect(await sellerUpdateSubOrderAction(subId, 'shipped', 'Delhivery', 'AWB123')).toEqual({ ok: true });
    expect(rpc).toHaveBeenCalledWith('seller_update_sub_order', {
      p_sub_order_id: subId,
      p_status: 'shipped',
      p_courier: 'Delhivery',
      p_awb: 'AWB123',
    });

    const profileForm = new FormData();
    profileForm.set('businessName', 'Bazaar Traders Updated');
    profileForm.set('phone', '+91 98765 43210');
    expect(await updateSellerProfileAction(profileForm)).toEqual({ ok: true });
    expect(mocks.sellerGuard).toHaveBeenCalled();

    const fixture = supabaseFixture({ seller_offers: [{ id: OFFER_ID, seller_id: SELLER_ID }] });
    mocks.client.mockReturnValue(fixture);
    expect(await sellerSetOfferActiveAction(OFFER_ID, false)).toEqual({ ok: true });
  });

  it('resolveOfferUnitPricePaise selects the matching quantity slab or base price', () => {
    const offer = {
      unitPricePaise: 10000,
      tiers: [
        { minQuantity: 6, maxQuantity: 11, unitPricePaise: 9700 },
        { minQuantity: 12, maxQuantity: null, unitPricePaise: 9400 },
      ],
    };
    expect(resolveOfferUnitPricePaise(offer, 2)).toBe(10000);
    expect(resolveOfferUnitPricePaise(offer, 6)).toBe(9700);
    expect(resolveOfferUnitPricePaise(offer, 11)).toBe(9700);
    expect(resolveOfferUnitPricePaise(offer, 12)).toBe(9400);
    expect(resolveOfferUnitPricePaise(offer, 50)).toBe(9400);
  });
});
