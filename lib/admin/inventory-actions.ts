'use server';

import { z } from 'zod';
import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { requirePermission } from '@/lib/admin/guard';
import type { Database } from '@/types/database.types';

export type StockAdjustmentFormState = { error?: string } | null;

type StockMovementInsert = Database['public']['Tables']['stock_movements']['Insert'];

const adjustmentSchema = z.object({
  productId: z.string().uuid('Select a product.'),
  warehouseId: z.string().uuid('Select a warehouse.'),
  quantity: z.coerce
    .number()
    .int('Enter a whole number.')
    .refine((v) => v !== 0, 'Quantity cannot be zero.'),
  reason: z.string().min(3, 'Enter a reason for this adjustment.'),
});

/**
 * Records a stock adjustment as a `stock_movements` row — inventory
 * quantity is NEVER edited directly (see apply_stock_movement()
 * trigger in 0001_init.sql), so this is the only correct way to
 * change on-hand stock outside of normal inward/outward/damage/
 * return/transfer flows. Positive quantity increases stock, negative
 * decreases it (e.g. for a stock count correction).
 */
export async function createStockAdjustmentAction(
  _prevState: StockAdjustmentFormState,
  formData: FormData
): Promise<StockAdjustmentFormState> {
  const user = await requirePermission('inventory.manage');

  const parsed = adjustmentSchema.safeParse({
    productId: formData.get('productId'),
    warehouseId: formData.get('warehouseId'),
    quantity: formData.get('quantity'),
    reason: formData.get('reason'),
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? 'Invalid input.' };
  }
  const d = parsed.data;

  const supabase = createClient();
  const payload: StockMovementInsert = {
    product_id: d.productId,
    warehouse_id: d.warehouseId,
    movement_type: 'adjustment',
    quantity: d.quantity,
    reason: d.reason,
    performed_by: user.id,
  };

  const { error } = await supabase.from('stock_movements').insert(payload as unknown as never);
  if (error) return { error: error.message };

  revalidatePath('/admin/inventory');
  return null;
}
