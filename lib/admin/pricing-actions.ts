'use server';

import { z } from 'zod';
import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { requirePermission } from '@/lib/admin/guard';
import type { Database } from '@/types/database.types';

export type PriceListFormState = { error?: string } | null;

type PriceListInsert = Database['public']['Tables']['price_lists']['Insert'];

/**
 * Scope is intentionally restricted to base/area/retailer here.
 * 'scheme' and 'festival' scopes reference the `schemes` table, which
 * has no RLS policy yet (flagged in 0005/0006 as a deliberate gap —
 * do not build against it until it gets its own reviewed migration).
 */
const priceListSchema = z.object({
  productId: z.string().uuid('Select a product.'),
  scope: z.enum(['base', 'area', 'retailer']),
  areaId: z.string().uuid().optional().or(z.literal('')),
  retailerId: z.string().uuid().optional().or(z.literal('')),
  price: z.coerce.number().min(0, 'Enter a valid price.'),
  priority: z.coerce.number().int().default(0),
});

export async function createPriceListAction(
  _prevState: PriceListFormState,
  formData: FormData
): Promise<PriceListFormState> {
  const user = await requirePermission('pricing.manage');

  const parsed = priceListSchema.safeParse({
    productId: formData.get('productId'),
    scope: formData.get('scope'),
    areaId: formData.get('areaId'),
    retailerId: formData.get('retailerId'),
    price: formData.get('price'),
    priority: formData.get('priority') || 0,
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? 'Invalid input.' };
  }
  const d = parsed.data;

  if (d.scope === 'area' && !d.areaId) {
    return { error: 'Select an area for an area-scoped price.' };
  }
  if (d.scope === 'retailer' && !d.retailerId) {
    return { error: 'Select a retailer for a retailer-scoped price.' };
  }

  const supabase = createClient();
  const payload: PriceListInsert = {
    product_id: d.productId,
    scope: d.scope,
    area_id: d.scope === 'area' ? d.areaId || null : null,
    retailer_id: d.scope === 'retailer' ? d.retailerId || null : null,
    price: d.price,
    priority: d.priority,
    created_by: user.id,
  };

  const { error } = await supabase.from('price_lists').insert(payload as unknown as never);
  if (error) return { error: error.message };

  revalidatePath('/admin/pricing');
  return null;
}

export async function deactivatePriceListAction(priceListId: string) {
  await requirePermission('pricing.manage');
  const supabase = createClient();

  const { error } = await supabase
    .from('price_lists')
    .update({ is_active: false } as unknown as never)
    .eq('id', priceListId);
  if (error) throw new Error(error.message);

  revalidatePath('/admin/pricing');
}

export type PricePreviewState = { price: number | null; error?: string } | null;

export async function previewEffectivePriceAction(
  _prevState: PricePreviewState,
  formData: FormData
): Promise<PricePreviewState> {
  await requirePermission('pricing.manage');

  const productId = formData.get('productId');
const retailerId = formData.get('retailerId');

if (typeof productId !== 'string' || typeof retailerId !== 'string') {
  return { price: null, error: 'Select both a product and a retailer.' };
}

const supabase = createClient();

const { data, error } = await supabase.rpc('get_effective_price' as never, {
  p_product_id: productId,
  p_retailer_id: retailerId,
} as never);

  if (error) return { price: null, error: error.message };
  return { price: data };
}
