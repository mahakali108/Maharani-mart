import { existsSync, readFileSync } from 'node:fs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  calculateDiscountPercent,
  exceedsDiscountCap,
  mapWholesalePricingDbError,
  validateGlobalWholesaleInput,
  validateProductLimitInput,
} from '@/lib/admin/wholesale-pricing-rules';
import {
  computeMembershipOrderDiscountPaise,
  evaluateMembershipBenefits,
  validateMembershipPlanConfigInput,
} from '@/lib/membership/rules';

const mocks = vi.hoisted(() => ({
  requireSuperAdmin: vi.fn(),
  requirePermission: vi.fn(),
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
vi.mock('@/lib/supabase/server', () => ({
  createClient: mocks.createClient,
  createServiceRoleClient: vi.fn(),
}));

import { markPackOutOfStockAction } from '@/lib/admin/products-actions';
import { updateGlobalWholesaleRulesAction } from '@/lib/admin/wholesale-pricing-actions';
import {
  reviewMembershipUpgradeRequestAction,
  updateMembershipPlanConfigAction,
} from '@/lib/admin/membership-actions';

const UUID_1 = '11111111-1111-4111-8111-111111111111';
const UUID_2 = '22222222-2222-4222-8222-222222222222';
const UUID_3 = '33333333-3333-4333-8333-333333333333';

describe('Phase 3 — Wholesale pricing rules engine (centrally-owned catalogue)', () => {
  it('validates global and pack-level rule bounds and maps DB error codes', () => {
    const validGlobal = validateGlobalWholesaleInput({
      defaultMinOrderQty: 6,
      maxDiscountPercent: 20,
      allowSellerCustomSlabs: false,
      allowSellerPriceOverride: false,
      enforcePackFloor: true,
      minOrderValueRupees: 500,
    });
    expect(validGlobal.ok).toBe(true);

    const badDiscount = validateGlobalWholesaleInput({
      defaultMinOrderQty: 6,
      maxDiscountPercent: 140,
      allowSellerCustomSlabs: false,
      allowSellerPriceOverride: false,
      enforcePackFloor: true,
      minOrderValueRupees: 500,
    });
    expect(badDiscount.ok).toBe(false);

    const validPackLimit = validateProductLimitInput({
      packId: '11111111-1111-4111-8111-111111111111',
      minOrderQty: 10,
      maxDiscountPercent: 12,
      allowSellerSlabs: true,
      notes: 'Festive slab',
    }, 20);
    expect(validPackLimit.ok).toBe(true);

    expect(calculateDiscountPercent(10000, 8500)).toBe(15);
    expect(exceedsDiscountCap(10000, 8000, 10)).toBe(true);
    expect(exceedsDiscountCap(10000, 9500, 10)).toBe(false);
    expect(mapWholesalePricingDbError('DISCOUNT_EXCEEDS_GLOBAL_LIMIT')).toContain('Super Admin');
    expect(mapWholesalePricingDbError('SOMETHING_ELSE')).toBeNull();
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

describe('Phase 3 — Server Action authorization & validation boundaries', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('rejects non-Super Admin callers on wholesale rules and membership controls', async () => {
    mocks.requireSuperAdmin.mockRejectedValue(new Error('Super Admin authorization required.'));

    await expect(updateGlobalWholesaleRulesAction(new FormData())).rejects.toThrow(
      'Super Admin authorization required.'
    );
    await expect(updateMembershipPlanConfigAction(new FormData())).rejects.toThrow(
      'Super Admin authorization required.'
    );
    await expect(reviewMembershipUpgradeRequestAction(UUID_1, 'rejected', 'Not eligible')).rejects.toThrow(
      'Super Admin authorization required.'
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
});

describe('Phase 3 — Page guard & no-fake-stats contract verification', () => {
  it('guards every surviving Super Admin page cleanly, and the retired seller pages no longer exist', () => {
    expect(readFileSync('app/admin/pricing/wholesale/page.tsx', 'utf8')).toContain('requireSuperAdminPage()');
    expect(readFileSync('app/admin/memberships/page.tsx', 'utf8')).toContain('requireSuperAdminPage()');
    expect(readFileSync('app/admin/pricing/page.tsx', 'utf8')).toContain("requirePagePermission('pricing.manage')");
    expect(readFileSync('app/admin/banners/page.tsx', 'utf8')).toContain("requirePagePermission('banners.manage')");
    // Seller portal, seller ad campaigns, seller offers and marketplace launch
    // were removed with the marketplace: there is no page left to guard.
    for (const retired of [
      'app/seller',
      'app/register-seller',
      'app/register-supplier',
      'app/admin/sellers',
      'app/admin/offers',
      'app/admin/banners/campaigns',
      'app/admin/marketplace-launch',
    ]) {
      expect(existsSync(retired), `${retired} must not exist`).toBe(false);
    }
  });

  it('keeps live payment collection disabled in Phase 3 modules', () => {
    const mig = readFileSync('supabase/migrations/0109_phase3_business_control.sql', 'utf8');
    expect(mig).toContain('live_payment_collection_enabled boolean not null default false check (live_payment_collection_enabled = false)');
    expect(mig).toContain('seller_ads_enabled boolean not null default false');
    expect(mig).toContain('program_enabled boolean not null default false');
  });
});
