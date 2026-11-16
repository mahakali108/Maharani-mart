export type MembershipTierId = 'free' | 'silver' | 'gold';
export type MembershipRenewalMode = 'disabled' | 'manual_owner_approval';

export interface MembershipEligibilityRules {
  requireApprovedRetailer: boolean;
  allowedCategories: string[];
}

export interface MembershipPlanConfig {
  id: string;
  tier: MembershipTierId;
  name: string;
  description: string | null;
  price_paise: number;
  duration_days: number;
  discount_percent: number;
  product_discount_percent: number;
  order_value_discount_percent: number;
  min_order_value_paise: number;
  max_discount_paise: number;
  features: string[];
  eligibility_rules: MembershipEligibilityRules;
  expiry_behavior: 'immediate_stop';
  grace_period_days: 0;
  renewal_mode: MembershipRenewalMode;
  is_active: boolean;
  updated_at?: string;
}

export interface MembershipProgramSettings {
  program_enabled: boolean;
  live_payment_collection_enabled: false;
  owner_approval_reference: string | null;
  notes: string | null;
  updated_at?: string;
}

export interface RetailerMembershipCurrentView {
  membership_id: string | null;
  plan_id: string;
  plan_name: string;
  tier: MembershipTierId;
  status: 'active' | 'expired' | 'cancelled';
  starts_at: string | null;
  expires_at: string | null;
  is_expired: boolean;
  remaining_seconds: number | null;
  benefits_active: boolean;
  effective_product_discount_percent: number;
  effective_order_discount_percent: number;
  expiry_behavior: 'immediate_stop';
  renewal_mode: MembershipRenewalMode;
  features: string[];
}

export interface RetailerMembershipHistoryItem {
  id: string;
  plan_id: string;
  tier: string;
  status: string;
  starts_at: string;
  expires_at: string | null;
  notes: string | null;
  created_at: string;
}

export interface RetailerMembershipOverviewPayload {
  program_enabled: boolean;
  live_payment_collection_enabled: false;
  current: RetailerMembershipCurrentView;
  plans: MembershipPlanConfig[];
  history: RetailerMembershipHistoryItem[];
}

/**
 * Authoritative pure evaluator for membership expiry and benefits.
 * Enforces IMMEDIATE STOP on expiry (zero grace period): the instant
 * `expiresAt <= now` or `status !== 'active'`, all plan discounts drop to 0%.
 */
export function evaluateMembershipBenefits(
  input: {
    status: 'active' | 'expired' | 'cancelled';
    expiresAt: string | Date | null;
    productDiscountPercent: number;
    orderValueDiscountPercent: number;
  },
  now: Date = new Date()
): {
  isExpired: boolean;
  benefitsActive: boolean;
  remainingSeconds: number | null;
  remainingLabel: string;
  effectiveProductDiscountPercent: number;
  effectiveOrderDiscountPercent: number;
} {
  const expiryMs =
    input.expiresAt === null
      ? null
      : input.expiresAt instanceof Date
        ? input.expiresAt.getTime()
        : new Date(input.expiresAt).getTime();

  const expiredByTime = expiryMs !== null && Number.isFinite(expiryMs) && expiryMs <= now.getTime();
  const isExpired = input.status === 'expired' || expiredByTime;
  const benefitsActive = input.status === 'active' && !isExpired;

  if (!benefitsActive) {
    return {
      isExpired,
      benefitsActive: false,
      remainingSeconds: expiryMs !== null ? 0 : null,
      remainingLabel: isExpired ? 'Expired (benefits stopped immediately)' : 'Inactive',
      effectiveProductDiscountPercent: 0,
      effectiveOrderDiscountPercent: 0,
    };
  }

  if (expiryMs === null || !Number.isFinite(expiryMs)) {
    return {
      isExpired: false,
      benefitsActive: true,
      remainingSeconds: null,
      remainingLabel: 'No expiry',
      effectiveProductDiscountPercent: Number(input.productDiscountPercent) || 0,
      effectiveOrderDiscountPercent: Number(input.orderValueDiscountPercent) || 0,
    };
  }

  const remainingSeconds = Math.max(0, Math.floor((expiryMs - now.getTime()) / 1000));
  const days = Math.floor(remainingSeconds / 86_400);
  const hours = Math.floor((remainingSeconds % 86_400) / 3_600);
  const remainingLabel =
    days > 0 ? `${days} day${days === 1 ? '' : 's'} ${hours} hr remaining` : `${Math.max(1, hours)} hr remaining`;

  return {
    isExpired: false,
    benefitsActive: true,
    remainingSeconds,
    remainingLabel,
    effectiveProductDiscountPercent: Number(input.productDiscountPercent) || 0,
    effectiveOrderDiscountPercent: Number(input.orderValueDiscountPercent) || 0,
  };
}

/**
 * Computes capped order-value membership discount in integer paise.
 * Always returns 0 when expired, inactive, or below `minOrderValuePaise`.
 */
export function computeMembershipOrderDiscountPaise(
  subtotalPaise: number,
  plan: {
    status: 'active' | 'expired' | 'cancelled';
    expiresAt: string | Date | null;
    orderValueDiscountPercent: number;
    minOrderValuePaise: number;
    maxDiscountPaise: number;
  },
  now: Date = new Date()
): number {
  if (!Number.isFinite(subtotalPaise) || subtotalPaise <= 0) return 0;
  const evalResult = evaluateMembershipBenefits(
    {
      status: plan.status,
      expiresAt: plan.expiresAt,
      productDiscountPercent: 0,
      orderValueDiscountPercent: plan.orderValueDiscountPercent,
    },
    now
  );
  if (!evalResult.benefitsActive || evalResult.effectiveOrderDiscountPercent <= 0) return 0;
  if (subtotalPaise < Math.max(0, plan.minOrderValuePaise)) return 0;

  const rawDiscount = Math.floor((subtotalPaise * evalResult.effectiveOrderDiscountPercent) / 100);
  return Math.min(rawDiscount, Math.max(0, plan.maxDiscountPaise));
}

export function validateMembershipPlanConfigInput(input: {
  id: string;
  name: string;
  description?: string | null;
  priceRupees: number;
  durationDays: number;
  productDiscountPercent: number;
  orderValueDiscountPercent: number;
  minOrderValueRupees: number;
  maxDiscountRupees: number;
  featuresText: string;
  requireApprovedRetailer: boolean;
  allowedCategories: string[];
  renewalMode: string;
}):
  | {
      ok: true;
      value: {
        id: MembershipTierId;
        name: string;
        description: string | null;
        price_paise: number;
        duration_days: number;
        discount_percent: number;
        product_discount_percent: number;
        order_value_discount_percent: number;
        min_order_value_paise: number;
        max_discount_paise: number;
        features: string[];
        eligibility_rules: MembershipEligibilityRules;
        expiry_behavior: 'immediate_stop';
        grace_period_days: 0;
        renewal_mode: MembershipRenewalMode;
      };
    }
  | { ok: false; error: string } {
  if (input.id !== 'free' && input.id !== 'silver' && input.id !== 'gold') {
    return { ok: false, error: 'Plan must be free, silver, or gold.' };
  }
  const name = input.name.trim();
  if (name.length < 2 || name.length > 80) {
    return { ok: false, error: 'Plan name must be between 2 and 80 characters.' };
  }
  if (!Number.isFinite(input.priceRupees) || input.priceRupees < 0 || input.priceRupees > 1_000_000) {
    return { ok: false, error: 'Plan price must be between ₹0 and ₹10,00,000.' };
  }
  if (input.id === 'free' && input.priceRupees !== 0) {
    return { ok: false, error: 'The Free plan must always have ₹0 price.' };
  }
  if (!Number.isInteger(input.durationDays) || input.durationDays < 1 || input.durationDays > 3650) {
    return { ok: false, error: 'Plan duration must be a whole number between 1 and 3650 days.' };
  }
  if (
    !Number.isFinite(input.productDiscountPercent) ||
    input.productDiscountPercent < 0 ||
    input.productDiscountPercent > 50
  ) {
    return { ok: false, error: 'Product discount must be between 0% and 50%.' };
  }
  if (
    !Number.isFinite(input.orderValueDiscountPercent) ||
    input.orderValueDiscountPercent < 0 ||
    input.orderValueDiscountPercent > 50
  ) {
    return { ok: false, error: 'Order-value discount must be between 0% and 50%.' };
  }
  if (!Number.isFinite(input.minOrderValueRupees) || input.minOrderValueRupees < 0) {
    return { ok: false, error: 'Minimum order value must be ₹0 or more.' };
  }
  if (!Number.isFinite(input.maxDiscountRupees) || input.maxDiscountRupees < 0) {
    return { ok: false, error: 'Maximum discount cap must be ₹0 or more.' };
  }
  if (input.renewalMode !== 'disabled' && input.renewalMode !== 'manual_owner_approval') {
    return { ok: false, error: 'Renewal mode must be Disabled or Manual Owner Approval.' };
  }

  const features = input.featuresText
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .slice(0, 15);

  const validCategories = ['general', 'silver', 'gold'];
  const allowedCategories = Array.from(
    new Set(input.allowedCategories.filter((c) => validCategories.includes(c)))
  );
  if (allowedCategories.length === 0) {
    return { ok: false, error: 'Select at least one eligible retailer category.' };
  }

  return {
    ok: true,
    value: {
      id: input.id,
      name,
      description: (input.description ?? '').trim().slice(0, 400) || null,
      price_paise: Math.round(input.priceRupees * 100),
      duration_days: input.durationDays,
      discount_percent: Number(input.orderValueDiscountPercent.toFixed(2)),
      product_discount_percent: Number(input.productDiscountPercent.toFixed(2)),
      order_value_discount_percent: Number(input.orderValueDiscountPercent.toFixed(2)),
      min_order_value_paise: Math.round(input.minOrderValueRupees * 100),
      max_discount_paise: Math.round(input.maxDiscountRupees * 100),
      features,
      eligibility_rules: {
        requireApprovedRetailer: Boolean(input.requireApprovedRetailer),
        allowedCategories,
      },
      expiry_behavior: 'immediate_stop',
      grace_period_days: 0,
      renewal_mode: input.renewalMode,
    },
  };
}
