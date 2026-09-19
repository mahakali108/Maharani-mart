'use server';

import { z } from 'zod';
import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { requirePermission } from '@/lib/admin/guard';
import { normalizeCouponCode } from '@/lib/coupons/engine';
import type { Database } from '@/types/database.types';

export type CouponActionResult = { error?: string } | { success: true };

type CouponInsert = Database['public']['Tables']['coupons']['Insert'];

/**
 * Admin coupon management (0051). Reuses the existing `pricing.manage`
 * permission (super_admin + admin) — no new permission model. All writes are
 * audited by trg_audit_coupons / trg_audit_coupon_redemptions /
 * trg_audit_retailer_active_coupons (generic log_audit triggers).
 */
const CODE_PATTERN = /^[A-Z0-9][A-Z0-9-]{1,39}$/;

const couponSchema = z
  .object({
    code: z
      .string()
      .trim()
      .min(2, 'Codes need at least 2 characters.')
      .max(40, 'Codes can be at most 40 characters.')
      .regex(CODE_PATTERN, 'Use letters, numbers and hyphens only — no spaces or lower case.'),
    title: z.string().trim().min(3, 'Give the coupon a short name (at least 3 characters).').max(120),
    description: z.string().trim().max(500).optional(),
    discountType: z.enum(['percentage', 'fixed']),
    discountValue: z.coerce.number().positive('The discount must be greater than zero.'),
    minimumOrderValue: z.coerce.number().nonnegative().default(0),
    maximumDiscount: z.coerce.number().nonnegative().nullable().optional(),
    usageLimit: z.coerce.number().int().min(1).nullable().optional(),
    perRetailerLimit: z.coerce.number().int().min(1).default(1),
    startsAt: z.string().min(1, 'Choose a start date and time.'),
    expiresAt: z.string().min(1, 'Choose an expiry date and time.'),
    isActive: z.boolean().default(true),
    firstOrderOnly: z.boolean().default(false),
    retailerId: z.string().trim().optional(),
    categoryId: z.string().trim().optional(),
    brandId: z.string().trim().optional(),
    productId: z.string().trim().optional(),
  })
  .refine((data) => new Date(data.expiresAt).getTime() > new Date(data.startsAt).getTime(), {
    message: 'The coupon must expire after it starts.',
  })
  .refine((data) => (data.discountType === 'percentage' ? data.discountValue <= 100 : true), {
    message: 'A percentage discount cannot exceed 100%.',
  });

export type CouponFormInput = z.input<typeof couponSchema>;

function parseDateTime(value: string): Date | null {
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function revalidateCouponPaths() {
  revalidatePath('/admin/coupons');
  revalidatePath('/retailer/coupons');
}

/**
 * Creates a coupon. The code is normalized to UPPERCASE (the same rule the
 * database unique index uses) and uniqueness is checked server-side — a
 * conflicting code is rejected with a readable message.
 */
export async function createCouponAction(input: CouponFormInput): Promise<CouponActionResult> {
  const user = await requirePermission('pricing.manage');

  // Normalize first so the schema's uppercase contract holds for any caller.
  const parsed = couponSchema.safeParse({ ...input, code: normalizeCouponCode(input.code) });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? 'Check the coupon details.' };

  const startsAt = parseDateTime(parsed.data.startsAt);
  const expiresAt = parseDateTime(parsed.data.expiresAt);
  if (!startsAt || !expiresAt) return { error: 'Choose valid start and expiry date/times.' };

  const supabase = createClient();
  const code = normalizeCouponCode(parsed.data.code);

  const { data: existing } = await supabase
    .from('coupons')
    .select('code')
    .eq('code', code)
    .maybeSingle<{ code: string }>();
  if (existing) return { error: `A coupon with the code ${existing.code} already exists.` };

  const payload: CouponInsert = {
    code,
    title: parsed.data.title,
    description: parsed.data.description || null,
    discount_type: parsed.data.discountType,
    discount_value: parsed.data.discountValue,
    minimum_order_value: parsed.data.minimumOrderValue,
    maximum_discount: parsed.data.discountType === 'percentage' ? (parsed.data.maximumDiscount ?? null) : null,
    usage_limit: parsed.data.usageLimit ?? null,
    per_retailer_limit: parsed.data.perRetailerLimit,
    starts_at: startsAt.toISOString(),
    expires_at: expiresAt.toISOString(),
    is_active: parsed.data.isActive,
    first_order_only: parsed.data.firstOrderOnly,
    retailer_id: parsed.data.retailerId || null,
    category_id: parsed.data.categoryId || null,
    brand_id: parsed.data.brandId || null,
    product_id: parsed.data.productId || null,
    created_by: user.id,
  };

  const { error } = await supabase.from('coupons').insert(payload as unknown as never);
  if (error) {
    if (error.code === '23505') return { error: `A coupon with the code ${code} already exists.` };
    return { error: error.message };
  }

  revalidateCouponPaths();
  return { success: true };
}

/**
 * Updates a coupon. Discount math fields are re-validated with the same
 * schema as creation; an active→inactive change simply stops the validator
 * from accepting the code (existing orders are unaffected).
 */
export async function updateCouponAction(id: string, input: CouponFormInput): Promise<CouponActionResult> {
  const user = await requirePermission('pricing.manage');
  if (!user) return { error: 'You are not signed in.' };

  const parsed = couponSchema.safeParse({ ...input, code: normalizeCouponCode(input.code) });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? 'Check the coupon details.' };

  const startsAt = parseDateTime(parsed.data.startsAt);
  const expiresAt = parseDateTime(parsed.data.expiresAt);
  if (!startsAt || !expiresAt) return { error: 'Choose valid start and expiry date/times.' };

  const supabase = createClient();
  const code = normalizeCouponCode(parsed.data.code);

  const { data: conflict } = await supabase
    .from('coupons')
    .select('id')
    .eq('code', code)
    .neq('id', id)
    .maybeSingle<{ id: string }>();
  if (conflict) return { error: `Another coupon already uses the code ${code}.` };

  const { data: current } = await supabase
    .from('coupons')
    .select('id')
    .eq('id', id)
    .maybeSingle<{ id: string }>();
  if (!current) return { error: 'Coupon not found.' };

  // Changing the window or scoping of an already-used coupon is allowed, but
  // the used_count is never reset from this form — usage history stays honest.
  const payload: CouponInsert = {
    code,
    title: parsed.data.title,
    description: parsed.data.description || null,
    discount_type: parsed.data.discountType,
    discount_value: parsed.data.discountValue,
    minimum_order_value: parsed.data.minimumOrderValue,
    maximum_discount: parsed.data.discountType === 'percentage' ? (parsed.data.maximumDiscount ?? null) : null,
    usage_limit: parsed.data.usageLimit ?? null,
    per_retailer_limit: parsed.data.perRetailerLimit,
    starts_at: startsAt.toISOString(),
    expires_at: expiresAt.toISOString(),
    is_active: parsed.data.isActive,
    first_order_only: parsed.data.firstOrderOnly,
    retailer_id: parsed.data.retailerId || null,
    category_id: parsed.data.categoryId || null,
    brand_id: parsed.data.brandId || null,
    product_id: parsed.data.productId || null,
  };

  const { error } = await supabase.from('coupons').update(payload as unknown as never).eq('id', id);
  if (error) {
    if (error.code === '23505') return { error: `Another coupon already uses the code ${code}.` };
    return { error: error.message };
  }

  revalidateCouponPaths();
  return { success: true };
}

/** Quick enable/disable without opening the full form. */
export async function toggleCouponAction(id: string, isActive: boolean): Promise<CouponActionResult> {
  const user = await requirePermission('pricing.manage');
  if (!user) return { error: 'You are not signed in.' };

  const supabase = createClient();
  const { error } = await supabase.from('coupons').update({ is_active: isActive } as unknown as never).eq('id', id);
  if (error) return { error: error.message };

  revalidateCouponPaths();
  return { success: true };
}
