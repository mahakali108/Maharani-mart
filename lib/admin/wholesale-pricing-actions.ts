'use server';

import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { requireSuperAdmin } from '@/lib/admin/control-center/guard';
import { recordSuperAdminAudit } from '@/lib/admin/super-admin-audit';
import {
  mapWholesalePricingDbError,
  validateGlobalWholesaleInput,
  validateProductLimitInput,
  validateSellerPermissionInput,
} from '@/lib/admin/wholesale-pricing-rules';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type WholesaleActionResult = { ok: true; message: string } | { ok: false; error: string };

function revalidateWholesalePages() {
  revalidatePath('/admin/pricing/wholesale');
  revalidatePath('/admin/pricing');
  revalidatePath('/admin/offers');
}

export async function updateGlobalWholesaleRulesAction(
  formData: FormData
): Promise<WholesaleActionResult> {
  const actor = await requireSuperAdmin();

  const parsed = validateGlobalWholesaleInput({
    defaultMinOrderQty: Number(formData.get('defaultMinOrderQty') ?? 1),
    maxDiscountPercent: Number(formData.get('maxDiscountPercent') ?? 25),
    minOrderValueRupees: Number(formData.get('minOrderValueRupees') ?? 0),
    allowSellerCustomSlabs: formData.get('allowSellerCustomSlabs') === 'on',
    allowSellerPriceOverride: formData.get('allowSellerPriceOverride') === 'on',
    enforcePackFloor: formData.get('enforcePackFloor') === 'on',
    notes: String(formData.get('notes') ?? ''),
  });
  if (!parsed.ok) return { ok: false, error: parsed.error };

  const supabase = await createClient();
  const { data: before } = await supabase
    .from('wholesale_pricing_rules' as never)
    .select('default_min_order_qty, max_discount_percent, allow_seller_custom_slabs, min_order_value_paise')
    .eq('id', 1)
    .maybeSingle<Record<string, unknown>>();

  const { error } = await supabase
    .from('wholesale_pricing_rules' as never)
    .upsert({ id: 1, ...parsed.value } as never, { onConflict: 'id' });
  if (error) {
    return { ok: false, error: mapWholesalePricingDbError(error.message) ?? error.message };
  }

  await recordSuperAdminAudit(supabase, {
    actorId: actor.id,
    actorRole: actor.role,
    action: 'WHOLESALE_GLOBAL_RULES_UPDATED',
    beforeData: before ?? null,
    afterData: parsed.value as unknown as Record<string, unknown>,
    reason: parsed.value.notes ?? 'Global wholesale pricing rules updated',
  });

  revalidateWholesalePages();
  return { ok: true, message: 'Global wholesale pricing rules saved.' };
}

export async function upsertSellerPricingPermissionAction(
  formData: FormData
): Promise<WholesaleActionResult> {
  const actor = await requireSuperAdmin();

  const sellerId = String(formData.get('sellerId') ?? '').trim();
  if (!UUID_RE.test(sellerId)) return { ok: false, error: 'Select a valid seller.' };

  const rawMoq = String(formData.get('minMoqOverride') ?? '').trim();
  const minMoqOverride = rawMoq === '' ? null : Number(rawMoq);

  const supabase = await createClient();
  const { data: globalRow } = await supabase
    .from('wholesale_pricing_rules' as never)
    .select('max_discount_percent')
    .eq('id', 1)
    .maybeSingle<{ max_discount_percent: number }>();
  const globalMax = Number(globalRow?.max_discount_percent ?? 25);

  const parsed = validateSellerPermissionInput(
    {
      sellerId,
      canSetCustomSlabs: formData.get('canSetCustomSlabs') === 'on',
      canApplyDiscounts: formData.get('canApplyDiscounts') === 'on',
      maxDiscountPercent: Number(formData.get('maxDiscountPercent') ?? 0),
      minMoqOverride,
      notes: String(formData.get('notes') ?? ''),
    },
    globalMax
  );
  if (!parsed.ok) return { ok: false, error: parsed.error };

  const { error } = await supabase
    .from('seller_pricing_permissions' as never)
    .upsert(parsed.value as never, { onConflict: 'seller_id' });
  if (error) {
    return { ok: false, error: mapWholesalePricingDbError(error.message) ?? error.message };
  }

  await recordSuperAdminAudit(supabase, {
    actorId: actor.id,
    actorRole: actor.role,
    action: 'SELLER_PRICING_PERMISSION_UPDATED',
    afterData: parsed.value as unknown as Record<string, unknown>,
    reason: parsed.value.notes ?? 'Seller wholesale pricing permissions updated',
  });

  revalidateWholesalePages();
  revalidatePath(`/admin/sellers/${sellerId}`);
  return { ok: true, message: 'Seller wholesale pricing permissions saved.' };
}

export async function deleteSellerPricingPermissionAction(
  sellerId: string
): Promise<WholesaleActionResult> {
  const actor = await requireSuperAdmin();
  if (!UUID_RE.test(sellerId)) return { ok: false, error: 'Invalid seller.' };

  const supabase = await createClient();
  const { error } = await supabase
    .from('seller_pricing_permissions' as never)
    .delete()
    .eq('seller_id', sellerId);
  if (error) return { ok: false, error: error.message };

  await recordSuperAdminAudit(supabase, {
    actorId: actor.id,
    actorRole: actor.role,
    action: 'SELLER_PRICING_PERMISSION_RESET',
    afterData: { seller_id: sellerId },
    reason: 'Seller pricing permission override removed (reverts to global rules)',
  });

  revalidateWholesalePages();
  revalidatePath(`/admin/sellers/${sellerId}`);
  return { ok: true, message: 'Seller permission override removed; global wholesale rules apply.' };
}

export async function upsertProductWholesaleLimitAction(
  formData: FormData
): Promise<WholesaleActionResult> {
  const actor = await requireSuperAdmin();

  const packId = String(formData.get('packId') ?? '').trim();
  if (!UUID_RE.test(packId)) return { ok: false, error: 'Select a valid product pack.' };

  const supabase = await createClient();
  const { data: globalRow } = await supabase
    .from('wholesale_pricing_rules' as never)
    .select('max_discount_percent')
    .eq('id', 1)
    .maybeSingle<{ max_discount_percent: number }>();
  const globalMax = Number(globalRow?.max_discount_percent ?? 25);

  const parsed = validateProductLimitInput(
    {
      packId,
      minOrderQty: Number(formData.get('minOrderQty') ?? 1),
      maxDiscountPercent: Number(formData.get('maxDiscountPercent') ?? 0),
      allowSellerSlabs: formData.get('allowSellerSlabs') === 'on',
      notes: String(formData.get('notes') ?? ''),
    },
    globalMax
  );
  if (!parsed.ok) return { ok: false, error: parsed.error };

  const { error } = await supabase
    .from('product_wholesale_limits' as never)
    .upsert(parsed.value as never, { onConflict: 'pack_id' });
  if (error) {
    return { ok: false, error: mapWholesalePricingDbError(error.message) ?? error.message };
  }

  await recordSuperAdminAudit(supabase, {
    actorId: actor.id,
    actorRole: actor.role,
    action: 'PRODUCT_WHOLESALE_LIMIT_UPDATED',
    afterData: parsed.value as unknown as Record<string, unknown>,
    reason: parsed.value.notes ?? 'Product pack wholesale limit updated',
  });

  revalidateWholesalePages();
  return { ok: true, message: 'Product pack wholesale limit saved.' };
}

export async function deleteProductWholesaleLimitAction(
  packId: string
): Promise<WholesaleActionResult> {
  const actor = await requireSuperAdmin();
  if (!UUID_RE.test(packId)) return { ok: false, error: 'Invalid pack.' };

  const supabase = await createClient();
  const { error } = await supabase
    .from('product_wholesale_limits' as never)
    .delete()
    .eq('pack_id', packId);
  if (error) return { ok: false, error: error.message };

  await recordSuperAdminAudit(supabase, {
    actorId: actor.id,
    actorRole: actor.role,
    action: 'PRODUCT_WHOLESALE_LIMIT_RESET',
    afterData: { pack_id: packId },
    reason: 'Product pack wholesale limit removed (reverts to global rules)',
  });

  revalidateWholesalePages();
  return { ok: true, message: 'Product pack wholesale limit removed.' };
}
