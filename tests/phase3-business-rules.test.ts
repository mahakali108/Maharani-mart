import { readFileSync } from 'node:fs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_GLOBAL_WHOLESALE_RULES,
  calculateDiscountPercent,
  computeEffectiveWholesaleLimits,
  mapWholesalePricingDbError,
  validateGlobalWholesaleInput,
  validateProductLimitInput,
  validateSellerOfferAgainstLimits,
  validateSellerPermissionInput,
  validateSellerSlabAgainstLimits,
} from '@/lib/admin/wholesale-pricing-rules';
import {
  computeMembershipOrderDiscountPaise,
  evaluateMembershipBenefits,
  validateMembershipPlanConfigInput,
} from '@/lib/membership/rules';
import {
  isSafeCampaignUrl,
  mapAdCampaignDbError,
  validateAdCampaignProposalInput,
  validateAdProgramRulesInput,
} from '@/lib/admin/ad-campaign-rules';

const mocks = vi.hoisted(() => ({
  requireSuperAdmin: vi.fn(),
  requirePermission: vi.fn(),
  requireActiveSeller: vi.fn(),
  createClient: vi.fn(),
  revalidatePath: vi.fn(),
}));

vi.mock('next/cache', () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock('@/lib/admin/control-center/guard', () => ({
  requireSuperAdmin: mocks.requireSuperAdmin,
  requireSuperAdminPage: mocks.requireSuperAdmin,
}));
vi.mock('@/lib/admin/guard', () => ({
  requirePermission: mocks.requirePermission,
  requirePagePermission: mocks.requirePermission,
}));
vi.mock('@/lib/seller/guard', () => ({
  requireActiveSeller: mocks.requireActiveSeller,
  requireSeller: mocks.requireActiveSeller,
}));
vi.mock('@/lib/supabase/server', () => ({
  createClient: mocks.createClient,
  createServiceRoleClient: vi.fn(),
}));

import { removeProhibitedOfferAction } from '@/lib/admin/offer-actions';
import { markPackOutOfStockAction } from '@/lib/admin/products-actions';
import {
  updateGlobalWholesaleRulesAction,
  upsertSellerPricingPermissionAction,
} from '@/lib/admin/wholesale-pricing-actions';
import {
  reviewMembershipUpgradeRequestAction,
  updateMembershipPlanConfigAction,
} from '@/lib/admin/membership-actions';
import {
  moderateSellerAdCampaignAction,
  submitSellerAdCampaignAction,
} from '@/lib/admin/ad-campaign-actions';

const UUID_1 = '11111111-1111-4111-8111-111111111111';
const UUID_2 = '22222222-2222-4222-8222-222222222222';
const UUID_3 = '33333333-3333-4333-8333-333333333333';

describe('Phase 3 — Wholesale pricing rules engine', () => {
  it('composes tightest effective limits across global, seller, and pack rules', () => {
    const limits = computeEffectiveWholesaleLimits(
      { default_min_order_qty: 2, max_discount_percent: 25, allow_seller_custom_slabs: true },
      { can_set_custom_slabs: true, can_apply_discounts: true, max_discount_percent: 15, min_moq_override: 6 },
      { min_order_qty: 10, max_discount_percent: 12, allow_seller_slabs: false }
    );
    expect(limits).toEqual({
      minMoq: 10,
      maxDiscountPercent: 12,
      allowSellerCustomSlabs: false,
    });
  });

  it('drops max discount to 0% when seller cannot apply discounts', () => {
    const limits = computeEffectiveWholesaleLimits(DEFAULT_GLOBAL_WHOLESALE_RULES, {
      can_set_custom_slabs: true,
      can_apply_discounts: false,
      max_discount_percent: 20,
      min_moq_override: null,
    });
    expect(limits.maxDiscountPercent).toBe(0);
  });

  it('blocks offers below MOQ or above Super Admin discount cap', () => {
    const limits = { minMoq: 5, maxDiscountPercent: 15, allowSellerCustomSlabs: true };
    const lowMoq = validateSellerOfferAgainstLimits(
      { basePricePaise: 10000, unitPricePaise: 9000, moq: 3 },
      limits
    );
    expect(lowMoq.ok).toBe(false);
    if (!lowMoq.ok) expect(lowMoq.code).toBe('MOQ_BELOW_SUPER_ADMIN_MINIMUM');

    const overDiscount = validateSellerOfferAgainstLimits(
      { basePricePaise: 10000, unitPricePaise: 7000, moq: 5 },
      limits
    );
    expect(overDiscount.ok).toBe(false);
    if (!overDiscount.ok) expect(overDiscount.code).toBe('DISCOUNT_EXCEEDS_MAX_LIMIT');

    const okOffer = validateSellerOfferAgainstLimits(
      { basePricePaise: 10000, unitPricePaise: 8500, moq: 5 },
      limits
    );
    expect(okOffer.ok).toBe(true);
  });

  it('blocks custom slabs when disabled or exceeding discount limit', () => {
    const disabled = validateSellerSlabAgainstLimits(
      { offerUnitPricePaise: 10000, offerMoq: 5, slabMinQuantity: 10, slabUnitPricePaise: 9500 },
      { minMoq: 5, maxDiscountPercent: 15, allowSellerCustomSlabs: false }
    );
    expect(disabled.ok).toBe(false);
    if (!disabled.ok) expect(disabled.code).toBe('SELLER_CUSTOM_SLABS_NOT_ALLOWED');

    const overCap = validateSellerSlabAgainstLimits(
      { offerUnitPricePaise: 10000, offerMoq: 5, slabMinQuantity: 20, slabUnitPricePaise: 7500 },
      { minMoq: 5, maxDiscountPercent: 15, allowSellerCustomSlabs: true }
    );
    expect(overCap.ok).toBe(false);
    if (!overCap.ok) expect(overCap.code).toBe('DISCOUNT_EXCEEDS_MAX_LIMIT');
  });

  it('validates global, seller, and pack rule bounds and maps DB error codes', () => {
    expect(calculateDiscountPercent(10000, 8250)).toBe(17.5);
    expect(
      validateGlobalWholesaleInput({
        defaultMinOrderQty: 0,
        maxDiscountPercent: 10,
        minOrderValueRupees: 0,
        allowSellerCustomSlabs: true,
        allowSellerPriceOverride: false,
        enforcePackFloor: true,
      }).ok
    ).toBe(false);

    expect(
      validateSellerPermissionInput(
        {
          sellerId: UUID_1,
          canSetCustomSlabs: true,
          canApplyDiscounts: true,
          maxDiscountPercent: 30,
          minMoqOverride: null,
        },
        20
      ).ok
    ).toBe(false);

    expect(
      validateProductLimitInput(
        { packId: UUID_2, minOrderQty: 5, maxDiscountPercent: 25, allowSellerSlabs: true },
        15
      ).ok
    ).toBe(false);

    expect(mapWholesalePricingDbError('DISCOUNT_EXCEEDS_MAX_LIMIT: foo')).toContain('exceeds');
    expect(mapWholesalePricingDbError('MOQ_BELOW_SUPER_ADMIN_MINIMUM: bar')).toContain('minimum');
    expect(mapWholesalePricingDbError('SELLER_CUSTOM_SLABS_NOT_ALLOWED: baz')).toContain('disabled');
  });
});

describe('Phase 3 — Retailer membership rules & immediate expiry stop', () => {
  it('immediately stops benefits at and after expiresAt (zero grace period)', () => {
    const now = new Date('2026-11-16T12:00:00.000Z');
    const exactExpiry = evaluateMembershipBenefits(
      {
        status: 'active',
        expiresAt: '2026-11-16T12:00:00.000Z',
        productDiscountPercent: 5,
        orderValueDiscountPercent: 3,
      },
      now
    );
    expect(exactExpiry.isExpired).toBe(true);
    expect(exactExpiry.benefitsActive).toBe(false);
    expect(exactExpiry.effectiveProductDiscountPercent).toBe(0);
    expect(exactExpiry.effectiveOrderDiscountPercent).toBe(0);
    expect(exactExpiry.remainingSeconds).toBe(0);

    const pastExpiry = evaluateMembershipBenefits(
      {
        status: 'active',
        expiresAt: '2026-11-16T11:59:59.000Z',
        productDiscountPercent: 5,
        orderValueDiscountPercent: 3,
      },
      now
    );
    expect(pastExpiry.benefitsActive).toBe(false);
    expect(pastExpiry.effectiveOrderDiscountPercent).toBe(0);
  });

  it('computes active remaining validity and capped order discount', () => {
    const now = new Date('2026-11-16T12:00:00.000Z');
    const future = '2026-11-26T12:00:00.000Z';
    const active = evaluateMembershipBenefits(
      {
        status: 'active',
        expiresAt: future,
        productDiscountPercent: 2,
        orderValueDiscountPercent: 5,
      },
      now
    );
    expect(active.benefitsActive).toBe(true);
    expect(active.remainingSeconds).toBe(10 * 86_400);
    expect(active.effectiveOrderDiscountPercent).toBe(5);

    // 5% of ₹10,000 = ₹500 (50_000 paise), capped at ₹300 (30_000 paise)
    expect(
      computeMembershipOrderDiscountPaise(
        1_000_000,
        {
          status: 'active',
          expiresAt: future,
          orderValueDiscountPercent: 5,
          minOrderValuePaise: 500_000,
          maxDiscountPaise: 30_000,
        },
        now
      )
    ).toBe(30_000);

    // Expired immediately yields 0 discount
    expect(
      computeMembershipOrderDiscountPaise(
        1_000_000,
        {
          status: 'active',
          expiresAt: '2026-11-16T11:00:00.000Z',
          orderValueDiscountPercent: 5,
          minOrderValuePaise: 0,
          maxDiscountPaise: 30_000,
        },
        now
      )
    ).toBe(0);
  });

  it('enforces Free price = 0 and immediate_stop expiry in plan config validation', () => {
    const paidFree = validateMembershipPlanConfigInput({
      id: 'free',
      name: 'Free Tier',
      priceRupees: 499,
      durationDays: 365,
      productDiscountPercent: 0,
      orderValueDiscountPercent: 0,
      minOrderValueRupees: 0,
      maxDiscountRupees: 0,
      featuresText: 'Standard catalog',
      requireApprovedRetailer: true,
      allowedCategories: ['general'],
      renewalMode: 'manual_owner_approval',
    });
    expect(paidFree.ok).toBe(false);

    const validGold = validateMembershipPlanConfigInput({
      id: 'gold',
      name: 'Gold Wholesale',
      priceRupees: 2499,
      durationDays: 365,
      productDiscountPercent: 3,
      orderValueDiscountPercent: 5,
      minOrderValueRupees: 5000,
      maxDiscountRupees: 2500,
      featuresText: 'Priority support\nGold wholesale tier',
      requireApprovedRetailer: true,
      allowedCategories: ['silver', 'gold'],
      renewalMode: 'manual_owner_approval',
    });
    expect(validGold.ok).toBe(true);
    if (validGold.ok) {
      expect(validGold.value.expiry_behavior).toBe('immediate_stop');
      expect(validGold.value.grace_period_days).toBe(0);
    }
  });
});

describe('Phase 3 — Paid seller ad campaign validation', () => {
  it('rejects unsafe URLs (javascript:, data:, http:, //) and invalid windows', () => {
    expect(isSafeCampaignUrl('javascript:alert(1)')).toBe(false);
    expect(isSafeCampaignUrl('data:image/svg+xml,<svg/>')).toBe(false);
    expect(isSafeCampaignUrl('http://insecure.example/ad.png')).toBe(false);
    expect(isSafeCampaignUrl('//evil.example/ad.png')).toBe(false);
    expect(isSafeCampaignUrl('https://cdn.maharani.example/banner.png')).toBe(true);
    expect(isSafeCampaignUrl('/retailer/catalog')).toBe(true);

    const badWindow = validateAdCampaignProposalInput({
      title: 'Diwali Promo',
      artworkUrl: 'https://cdn.example.com/ad.png',
      placement: 'homepage_strip',
      startsAt: '2026-12-10T10:00:00Z',
      endsAt: '2026-12-09T10:00:00Z',
      budgetRupees: 5000,
    });
    expect(badWindow.ok).toBe(false);

    expect(
      validateAdProgramRulesInput({ maxActivePerPlacement: 0, allowedPlacements: ['homepage_hero'] }).ok
    ).toBe(false);
    expect(mapAdCampaignDbError('SELLER_ADS_DISABLED: blocked')).toContain('owner approval');
  });
});

describe('Phase 3 — Server Action authorization & validation boundaries', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('rejects non-Super Admin callers on prohibited offer removal, wholesale rules, membership, and ad moderation', async () => {
    mocks.requireSuperAdmin.mockRejectedValue(new Error('Super Admin authorization required.'));

    await expect(removeProhibitedOfferAction(UUID_1, 'Counterfeit brand claim')).rejects.toThrow(
      'Super Admin authorization required.'
    );
    await expect(updateGlobalWholesaleRulesAction(new FormData())).rejects.toThrow(
      'Super Admin authorization required.'
    );
    await expect(updateMembershipPlanConfigAction(new FormData())).rejects.toThrow(
      'Super Admin authorization required.'
    );
    await expect(reviewMembershipUpgradeRequestAction(UUID_1, 'rejected', 'Not eligible')).rejects.toThrow(
      'Super Admin authorization required.'
    );
    await expect(moderateSellerAdCampaignAction(UUID_1, 'approved')).rejects.toThrow(
      'Super Admin authorization required.'
    );
  });

  it('enforces mandatory policy reason on removeProhibitedOfferAction and logs Super Admin audit', async () => {
    mocks.requireSuperAdmin.mockResolvedValue({ id: UUID_3, role: 'super_admin' });
    const shortRes = await removeProhibitedOfferAction(UUID_1, 'bad');
    expect(shortRes.ok).toBe(false);

    const auditInsert = vi.fn().mockResolvedValue({ error: null });
    const selectMock = vi.fn().mockResolvedValue({
      data: [{ id: UUID_1, seller_id: UUID_2, pack_id: UUID_3 }],
      error: null,
    });
    mocks.createClient.mockResolvedValue({
      from: (table: string) => {
        if (table === 'super_admin_audit_logs') return { insert: auditInsert };
        return {
          update: () => ({
            eq: () => ({ select: selectMock }),
          }),
        };
      },
    });

    const okRes = await removeProhibitedOfferAction(UUID_1, 'Unlicensed medical claim prohibited under policy');
    expect(okRes.ok).toBe(true);
    expect(auditInsert).toHaveBeenCalledWith(
      expect.objectContaining({
        actor_id: UUID_3,
        action: 'OFFER_REMOVED_PROHIBITED',
      })
    );
  });

  it('rejects unauthorized callers on markPackOutOfStockAction and zeroes stock via RPC when authorized', async () => {
    mocks.requirePermission.mockRejectedValueOnce(new Error('Permission denied'));
    await expect(markPackOutOfStockAction(UUID_1)).rejects.toThrow('Permission denied');

    mocks.requirePermission.mockResolvedValue({ id: UUID_3, role: 'super_admin' });
    const rpcMock = vi.fn().mockResolvedValue({ data: 0, error: null });
    const insertMock = vi.fn().mockResolvedValue({ error: null });
    mocks.createClient.mockResolvedValue({
      from: (table: string) => {
        if (table === 'product_packs') {
          return {
            select: () => ({
              eq: () => ({
                maybeSingle: async () => ({ data: { product_id: UUID_2, pack_name: '100ml Pack' } }),
              }),
            }),
          };
        }
        return { insert: insertMock };
      },
      rpc: rpcMock,
    });

    const res = await markPackOutOfStockAction(UUID_1, 'Warehouse damaged stock');
    expect(res).toEqual({ success: true, quantity: 0 });
    expect(rpcMock).toHaveBeenCalledWith('admin_set_product_pack_stock', {
      p_pack_id: UUID_1,
      p_quantity: 0,
    });
  });

  it('rejects seller pricing permission exceeding global cap and rejects inactive sellers submitting ads', async () => {
    mocks.requireSuperAdmin.mockResolvedValue({ id: UUID_3, role: 'super_admin' });
    mocks.createClient.mockResolvedValue({
      from: () => ({
        select: () => ({
          eq: () => ({
            maybeSingle: async () => ({ data: { max_discount_percent: 15 } }),
          }),
        }),
      }),
    });

    const fd = new FormData();
    fd.set('sellerId', UUID_1);
    fd.set('maxDiscountPercent', '25');
    fd.set('canSetCustomSlabs', 'on');
    fd.set('canApplyDiscounts', 'on');
    const res = await upsertSellerPricingPermissionAction(fd);
    expect(res.ok).toBe(false);

    mocks.requireActiveSeller.mockRejectedValue(
      new Error('Your seller account must be approved and active to perform this action.')
    );
    await expect(submitSellerAdCampaignAction(new FormData())).rejects.toThrow('approved and active');
  });
});

describe('Phase 3 — Page guard & no-fake-stats contract verification', () => {
  it('guards every new Super Admin, Admin, and Seller page cleanly', () => {
    expect(readFileSync('app/admin/pricing/wholesale/page.tsx', 'utf8')).toContain('requireSuperAdminPage()');
    expect(readFileSync('app/admin/memberships/page.tsx', 'utf8')).toContain('requireSuperAdminPage()');
    expect(readFileSync('app/admin/banners/campaigns/page.tsx', 'utf8')).toContain('requireSuperAdminPage()');
    expect(readFileSync('app/admin/pricing/page.tsx', 'utf8')).toContain("requirePagePermission('pricing.manage')");
    expect(readFileSync('app/admin/banners/page.tsx', 'utf8')).toContain("requirePagePermission('banners.manage')");
    expect(readFileSync('app/seller/campaigns/page.tsx', 'utf8')).toContain('requireSellerPage()');
  });

  it('keeps live payment collection disabled in Phase 3 modules', () => {
    const mig = readFileSync('supabase/migrations/0109_phase3_business_control.sql', 'utf8');
    expect(mig).toContain('live_payment_collection_enabled boolean not null default false check (live_payment_collection_enabled = false)');
    expect(mig).toContain('seller_ads_enabled boolean not null default false');
    expect(mig).toContain('program_enabled boolean not null default false');
  });
});
