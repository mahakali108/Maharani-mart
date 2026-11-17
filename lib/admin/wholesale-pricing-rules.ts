export interface WholesaleGlobalRules {
  default_min_order_qty: number;
  max_discount_percent: number;
  allow_seller_custom_slabs: boolean;
  allow_seller_price_override: boolean;
  enforce_pack_floor: boolean;
  min_order_value_paise: number;
  notes: string | null;
  updated_at?: string;
}

export interface SellerPricingPermission {
  seller_id: string;
  can_set_custom_slabs: boolean;
  can_apply_discounts: boolean;
  max_discount_percent: number;
  min_moq_override: number | null;
  notes: string | null;
  updated_at?: string;
}

export interface ProductWholesaleLimit {
  pack_id: string;
  min_order_qty: number;
  max_discount_percent: number;
  allow_seller_slabs: boolean;
  notes: string | null;
  updated_at?: string;
}

export interface EffectiveWholesaleLimits {
  minMoq: number;
  maxDiscountPercent: number;
  allowSellerCustomSlabs: boolean;
}

export const DEFAULT_GLOBAL_WHOLESALE_RULES: WholesaleGlobalRules = {
  default_min_order_qty: 1,
  max_discount_percent: 25,
  allow_seller_custom_slabs: true,
  allow_seller_price_override: false,
  enforce_pack_floor: true,
  min_order_value_paise: 0,
  notes: null,
};

export function computeEffectiveWholesaleLimits(
  globalRules: Pick<WholesaleGlobalRules, 'default_min_order_qty' | 'max_discount_percent' | 'allow_seller_custom_slabs'>,
  sellerPermission?: Pick<
    SellerPricingPermission,
    'can_set_custom_slabs' | 'can_apply_discounts' | 'max_discount_percent' | 'min_moq_override'
  > | null,
  packLimit?: Pick<ProductWholesaleLimit, 'min_order_qty' | 'max_discount_percent' | 'allow_seller_slabs'> | null
): EffectiveWholesaleLimits {
  let minMoq = Math.max(1, Math.trunc(globalRules.default_min_order_qty || 1));
  let maxDiscountPercent = Math.min(80, Math.max(0, Number(globalRules.max_discount_percent ?? 25)));
  let allowSellerCustomSlabs = Boolean(globalRules.allow_seller_custom_slabs);

  if (sellerPermission) {
    allowSellerCustomSlabs = allowSellerCustomSlabs && Boolean(sellerPermission.can_set_custom_slabs);
    if (sellerPermission.min_moq_override != null) {
      minMoq = Math.max(minMoq, Math.trunc(sellerPermission.min_moq_override));
    }
    if (!sellerPermission.can_apply_discounts) {
      maxDiscountPercent = 0;
    } else {
      maxDiscountPercent = Math.min(maxDiscountPercent, Math.max(0, Number(sellerPermission.max_discount_percent)));
    }
  }

  if (packLimit) {
    allowSellerCustomSlabs = allowSellerCustomSlabs && Boolean(packLimit.allow_seller_slabs);
    minMoq = Math.max(minMoq, Math.trunc(packLimit.min_order_qty));
    maxDiscountPercent = Math.min(maxDiscountPercent, Math.max(0, Number(packLimit.max_discount_percent)));
  }

  return {
    minMoq,
    maxDiscountPercent: Number(maxDiscountPercent.toFixed(2)),
    allowSellerCustomSlabs,
  };
}

export function calculateDiscountPercent(basePricePaise: number, offeredPricePaise: number): number {
  if (!Number.isFinite(basePricePaise) || basePricePaise <= 0) return 0;
  if (!Number.isFinite(offeredPricePaise) || offeredPricePaise >= basePricePaise) return 0;
  return Number((((basePricePaise - offeredPricePaise) * 100) / basePricePaise).toFixed(2));
}

/**
 * Exact rational ceiling test: `(base - offered) * 100 > base * maxDiscountPercent`
 * (scaled by 100 to keep integer arithmetic exact for 2-decimal percentages) so
 * rounding down to 2 decimals never lets an off-by-one paise discount slip past.
 */
export function exceedsDiscountCap(
  basePricePaise: number,
  offeredPricePaise: number,
  maxDiscountPercent: number
): boolean {
  if (!Number.isFinite(basePricePaise) || basePricePaise <= 0) return false;
  if (!Number.isFinite(offeredPricePaise) || offeredPricePaise >= basePricePaise) return false;
  const maxPctBasisPoints = Math.round(maxDiscountPercent * 100);
  return (basePricePaise - offeredPricePaise) * 10_000 > basePricePaise * maxPctBasisPoints;
}

export function validateSellerOfferAgainstLimits(
  offer: { basePricePaise: number; unitPricePaise: number; moq: number },
  limits: EffectiveWholesaleLimits
): { ok: true } | { ok: false; code: string; error: string } {
  if (!Number.isInteger(offer.moq) || offer.moq < limits.minMoq) {
    return {
      ok: false,
      code: 'MOQ_BELOW_SUPER_ADMIN_MINIMUM',
      error: `Minimum order quantity must be at least ${limits.minMoq} pieces under Super Admin wholesale rules.`,
    };
  }
  if (exceedsDiscountCap(offer.basePricePaise, offer.unitPricePaise, limits.maxDiscountPercent)) {
    const discountPct = calculateDiscountPercent(offer.basePricePaise, offer.unitPricePaise);
    return {
      ok: false,
      code: 'DISCOUNT_EXCEEDS_MAX_LIMIT',
      error: `Offer discount (${discountPct}%) exceeds the Super Admin maximum discount limit (${limits.maxDiscountPercent}%).`,
    };
  }
  return { ok: true };
}

export function validateSellerSlabAgainstLimits(
  slab: {
    offerUnitPricePaise: number;
    offerMoq: number;
    slabMinQuantity: number;
    slabUnitPricePaise: number;
    packBasePricePaise?: number;
  },
  limits: EffectiveWholesaleLimits
): { ok: true } | { ok: false; code: string; error: string } {
  if (!limits.allowSellerCustomSlabs) {
    return {
      ok: false,
      code: 'SELLER_CUSTOM_SLABS_NOT_ALLOWED',
      error: 'Custom wholesale quantity slabs are disabled for this seller or pack by Super Admin.',
    };
  }
  const minQty = Math.max(slab.offerMoq, limits.minMoq);
  if (!Number.isInteger(slab.slabMinQuantity) || slab.slabMinQuantity < minQty) {
    return {
      ok: false,
      code: 'MOQ_BELOW_SUPER_ADMIN_MINIMUM',
      error: `Slab minimum quantity must be at least ${minQty} pieces.`,
    };
  }
  if (exceedsDiscountCap(slab.offerUnitPricePaise, slab.slabUnitPricePaise, limits.maxDiscountPercent)) {
    const discountPct = calculateDiscountPercent(slab.offerUnitPricePaise, slab.slabUnitPricePaise);
    return {
      ok: false,
      code: 'DISCOUNT_EXCEEDS_MAX_LIMIT',
      error: `Slab discount (${discountPct}%) exceeds the Super Admin maximum discount limit (${limits.maxDiscountPercent}%).`,
    };
  }
  if (
    slab.packBasePricePaise != null &&
    exceedsDiscountCap(slab.packBasePricePaise, slab.slabUnitPricePaise, limits.maxDiscountPercent)
  ) {
    const combinedPct = calculateDiscountPercent(slab.packBasePricePaise, slab.slabUnitPricePaise);
    return {
      ok: false,
      code: 'DISCOUNT_EXCEEDS_MAX_LIMIT',
      error: `Combined offer and slab discount (${combinedPct}%) relative to pack base price exceeds the Super Admin maximum discount limit (${limits.maxDiscountPercent}%).`,
    };
  }
  return { ok: true };
}

export function validateGlobalWholesaleInput(input: {
  defaultMinOrderQty: number;
  maxDiscountPercent: number;
  minOrderValueRupees: number;
  allowSellerCustomSlabs: boolean;
  allowSellerPriceOverride: boolean;
  enforcePackFloor: boolean;
  notes?: string | null;
}): { ok: true; value: WholesaleGlobalRules } | { ok: false; error: string } {
  if (!Number.isInteger(input.defaultMinOrderQty) || input.defaultMinOrderQty < 1 || input.defaultMinOrderQty > 100_000) {
    return { ok: false, error: 'Default MOQ must be a whole number between 1 and 100,000.' };
  }
  if (!Number.isFinite(input.maxDiscountPercent) || input.maxDiscountPercent < 0 || input.maxDiscountPercent > 80) {
    return { ok: false, error: 'Maximum discount percent must be between 0% and 80%.' };
  }
  if (!Number.isFinite(input.minOrderValueRupees) || input.minOrderValueRupees < 0 || input.minOrderValueRupees > 10_000_000) {
    return { ok: false, error: 'Minimum order value must be between ₹0 and ₹1,00,00,000.' };
  }
  const notes = (input.notes ?? '').trim().slice(0, 1000) || null;
  return {
    ok: true,
    value: {
      default_min_order_qty: input.defaultMinOrderQty,
      max_discount_percent: Number(input.maxDiscountPercent.toFixed(2)),
      min_order_value_paise: Math.round(input.minOrderValueRupees * 100),
      allow_seller_custom_slabs: Boolean(input.allowSellerCustomSlabs),
      allow_seller_price_override: Boolean(input.allowSellerPriceOverride),
      enforce_pack_floor: Boolean(input.enforcePackFloor),
      notes,
    },
  };
}

export function validateSellerPermissionInput(
  input: {
    sellerId: string;
    canSetCustomSlabs: boolean;
    canApplyDiscounts: boolean;
    maxDiscountPercent: number;
    minMoqOverride: number | null;
    notes?: string | null;
  },
  globalMaxDiscountPercent: number
): { ok: true; value: SellerPricingPermission } | { ok: false; error: string } {
  if (!Number.isFinite(input.maxDiscountPercent) || input.maxDiscountPercent < 0 || input.maxDiscountPercent > 80) {
    return { ok: false, error: 'Seller max discount must be between 0% and 80%.' };
  }
  if (input.maxDiscountPercent > globalMaxDiscountPercent) {
    return {
      ok: false,
      error: `Seller max discount (${input.maxDiscountPercent}%) cannot exceed the global Super Admin cap (${globalMaxDiscountPercent}%).`,
    };
  }
  if (
    input.minMoqOverride !== null &&
    (!Number.isInteger(input.minMoqOverride) || input.minMoqOverride < 1 || input.minMoqOverride > 100_000)
  ) {
    return { ok: false, error: 'Seller MOQ override must be empty or a whole number between 1 and 100,000.' };
  }
  return {
    ok: true,
    value: {
      seller_id: input.sellerId,
      can_set_custom_slabs: Boolean(input.canSetCustomSlabs),
      can_apply_discounts: Boolean(input.canApplyDiscounts),
      max_discount_percent: Number(input.maxDiscountPercent.toFixed(2)),
      min_moq_override: input.minMoqOverride,
      notes: (input.notes ?? '').trim().slice(0, 500) || null,
    },
  };
}

export function validateProductLimitInput(
  input: {
    packId: string;
    minOrderQty: number;
    maxDiscountPercent: number;
    allowSellerSlabs: boolean;
    notes?: string | null;
  },
  globalMaxDiscountPercent: number
): { ok: true; value: ProductWholesaleLimit } | { ok: false; error: string } {
  if (!Number.isInteger(input.minOrderQty) || input.minOrderQty < 1 || input.minOrderQty > 100_000) {
    return { ok: false, error: 'Pack minimum order quantity must be between 1 and 100,000.' };
  }
  if (!Number.isFinite(input.maxDiscountPercent) || input.maxDiscountPercent < 0 || input.maxDiscountPercent > 80) {
    return { ok: false, error: 'Pack max discount must be between 0% and 80%.' };
  }
  if (input.maxDiscountPercent > globalMaxDiscountPercent) {
    return {
      ok: false,
      error: `Pack max discount (${input.maxDiscountPercent}%) cannot exceed the global Super Admin cap (${globalMaxDiscountPercent}%).`,
    };
  }
  return {
    ok: true,
    value: {
      pack_id: input.packId,
      min_order_qty: input.minOrderQty,
      max_discount_percent: Number(input.maxDiscountPercent.toFixed(2)),
      allow_seller_slabs: Boolean(input.allowSellerSlabs),
      notes: (input.notes ?? '').trim().slice(0, 500) || null,
    },
  };
}

export function mapWholesalePricingDbError(message: string): string | null {
  if (/DISCOUNT_EXCEEDS_GLOBAL_LIMIT/.test(message)) {
    return 'Configured discount cap exceeds the global Super Admin maximum discount limit.';
  }
  if (/DISCOUNT_EXCEEDS_MAX_LIMIT/.test(message)) {
    return 'Discount exceeds the Super Admin wholesale discount limit for this seller or pack.';
  }
  if (/MOQ_BELOW_SUPER_ADMIN_MINIMUM/.test(message)) {
    return 'Minimum order quantity is below the Super Admin wholesale minimum.';
  }
  if (/SELLER_CUSTOM_SLABS_NOT_ALLOWED/.test(message)) {
    return 'Custom wholesale slabs are disabled for this seller or pack by Super Admin.';
  }
  return null;
}
