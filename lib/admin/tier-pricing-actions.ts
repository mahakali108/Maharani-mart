'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { requirePermission } from '@/lib/admin/guard';
import { createClient } from '@/lib/supabase/server';

/**
 * Product-wise retailer category pricing (migration 0082).
 *
 * Writes go through the caller's RLS-scoped client, so Postgres denies a
 * non-admin outright and the ordering trigger (gold <= silver <= general)
 * re-validates every write. The action only shapes the input and translates
 * database errors into readable messages.
 *
 * Nothing here can change a seller's offer price or floor, and category
 * pricing never applies to third-party seller lines at checkout.
 */

type ActionResult = { error?: string; success?: string };

const priceSchema = z.coerce
  .number()
  .finite('Enter a valid amount.')
  .gt(0, 'A price must be greater than zero.')
  .max(1_000_000, 'That price looks too large — check the amount.')
  // Currency precision: two decimal places, compared in integer paise.
  .refine((value) => Math.abs(value * 100 - Math.round(value * 100)) < 1e-6, 'Use at most two decimal places.');

const upsertSchema = z.object({
  packId: z.string().uuid(),
  category: z.enum(['general', 'silver', 'gold']),
  price: priceSchema,
});

function revalidatePricingSurfaces() {
  revalidatePath('/admin/pricing/tiers');
  revalidatePath('/admin/pricing');
  revalidatePath('/retailer', 'layout');
  revalidatePath('/salesman', 'layout');
}

export async function upsertCategoryPriceAction(formData: FormData): Promise<ActionResult> {
  await requirePermission('pricing.manage');

  const parsed = upsertSchema.safeParse({
    packId: formData.get('packId'),
    category: formData.get('category'),
    price: formData.get('price'),
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? 'Check the price details.' };
  }

  const supabase = createClient();
  const { error } = await supabase.from('product_tier_prices' as never).upsert(
    {
      product_pack_id: parsed.data.packId,
      retailer_category: parsed.data.category,
      price_per_piece: parsed.data.price,
      is_active: true,
      updated_by: (await supabase.auth.getUser()).data.user?.id ?? null,
    } as never,
    { onConflict: 'product_pack_id,retailer_category' } as never
  );

  if (error) {
    if (/CATEGORY_PRICE_ORDER_INVALID/i.test(error.message)) {
      return {
        error:
          'Prices must satisfy Gold ≤ Silver ≤ General for the same pack. Lower the Silver/General price or raise the Gold price first.',
      };
    }
    if (/row-level security|permission denied/i.test(error.message)) {
      return { error: 'You are not allowed to change retailer prices.' };
    }
    return { error: error.message };
  }

  revalidatePricingSurfaces();
  return { success: 'Retailer category price saved.' };
}

export async function deactivateCategoryPriceAction(formData: FormData): Promise<ActionResult> {
  await requirePermission('pricing.manage');

  const parsed = z.object({ priceId: z.string().uuid() }).safeParse({ priceId: formData.get('priceId') });
  if (!parsed.success) return { error: 'Select a valid price row.' };

  const supabase = createClient();
  const { error } = await supabase
    .from('product_tier_prices' as never)
    .update({ is_active: false } as never)
    .eq('id', parsed.data.priceId);

  if (error) return { error: error.message };
  revalidatePricingSurfaces();
  return { success: 'Category price deactivated. The pack falls back to the general price (or its slab pricing).' };
}
