'use server';

import { z } from 'zod';
import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { requirePermission } from '@/lib/admin/guard';
import { notifyLowStockIfNeeded } from '@/lib/inventory/alerts';

export type StockAdjustmentFormState = { error?: string } | null;

const adjustmentSchema = z.object({
  productId: z.string().uuid('Select a product.'),
  warehouseId: z.string().uuid('Select a warehouse.'),
  quantity: z.coerce
    .number()
    .int('Enter a whole number.')
    .refine((v) => v !== 0, 'Quantity cannot be zero.'),
  reason: z.string().min(3, 'Enter a reason for this adjustment.'),
});

function rpcErrorMessage(error: { message?: string } | null): string {
  const raw = error?.message ?? 'The operation failed.';
  // Surface the human-readable part of Postgres RAISE messages.
  const match = raw.match(/INSUFFICIENT_STOCK:\s*(.+)$/);
  if (match?.[1]) return match[1].trim();
  return raw;
}

/**
 * Records a stock adjustment through the adjust_product_stock RPC —
 * inventory is NEVER edited directly; every change flows through the
 * stock_movements ledger (apply_stock_movement trigger). Positive
 * quantity increases stock, negative decreases it. The RPC enforces
 * server-side that stock can never go negative.
 */
export async function createStockAdjustmentAction(
  _prevState: StockAdjustmentFormState,
  formData: FormData
): Promise<StockAdjustmentFormState> {
  const user = await requirePermission('inventory.adjust');
  void user;

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
  const { error } = await supabase.rpc('adjust_product_stock' as never, {
    p_product_id: d.productId,
    p_warehouse_id: d.warehouseId,
    p_quantity: d.quantity,
    p_reason: d.reason,
  } as never);

  if (error) return { error: rpcErrorMessage(error) };

  await notifyLowStockIfNeeded([d.productId]);
  revalidatePath('/admin/inventory');
  return null;
}

const thresholdsSchema = z.object({
  minStock: z.coerce.number().int().min(0).max(1_000_000),
  reorderLevel: z.coerce.number().int().min(0).max(1_000_000),
  maxStock: z.coerce.number().int().min(0).max(1_000_000),
});

/** Per-product stock thresholds driving LOW STOCK / OUT OF STOCK status. */
export async function updateProductThresholdsAction(
  productId: string,
  _prevState: StockAdjustmentFormState,
  formData: FormData
): Promise<StockAdjustmentFormState> {
  await requirePermission('inventory.manage');

  const parsed = thresholdsSchema.safeParse({
    minStock: formData.get('minStock') ?? 0,
    reorderLevel: formData.get('reorderLevel') ?? 0,
    maxStock: formData.get('maxStock') ?? 0,
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? 'Invalid input.' };
  }
  if (!z.string().uuid().safeParse(productId).success) {
    return { error: 'Invalid product.' };
  }

  const supabase = createClient();
  const { error } = await supabase
    .from('products')
    .update({
      min_stock: parsed.data.minStock,
      reorder_level: parsed.data.reorderLevel,
      max_stock: parsed.data.maxStock,
    } as unknown as never)
    .eq('id', productId);

  if (error) return { error: error.message };

  revalidatePath('/admin/inventory/products');
  revalidatePath('/admin/inventory/low-stock');
  revalidatePath(`/admin/products/${productId}`);
  return null;
}

const settingsSchema = z
  .object({
    expiryCriticalDays: z.coerce.number().int().min(0).max(365),
    expiryWarningDays: z.coerce.number().int().min(0).max(730),
    cooldownHours: z.coerce.number().int().min(0).max(24 * 30),
  })
  .refine((v) => v.expiryCriticalDays <= v.expiryWarningDays, {
    message: 'The critical window must be shorter than (or equal to) the warning window.',
  });

/** Global inventory settings singleton (expiry windows, alert cooldown). */
export async function updateInventorySettingsAction(
  _prevState: StockAdjustmentFormState,
  formData: FormData
): Promise<StockAdjustmentFormState> {
  const user = await requirePermission('inventory.manage');
  // RLS already limits settings writes to admin/super_admin — mirror that
  // here so staff get a clear message instead of a silent no-op.
  if (user.role !== 'admin' && user.role !== 'super_admin') {
    return { error: 'Only administrators can change inventory settings.' };
  }

  const parsed = settingsSchema.safeParse({
    expiryCriticalDays: formData.get('expiryCriticalDays'),
    expiryWarningDays: formData.get('expiryWarningDays'),
    cooldownHours: formData.get('cooldownHours'),
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? 'Invalid input.' };
  }

  const supabase = createClient();
  const { error } = await supabase
    .from('inventory_settings')
    .update({
      expiry_critical_days: parsed.data.expiryCriticalDays,
      expiry_warning_days: parsed.data.expiryWarningDays,
      low_stock_alert_cooldown_hours: parsed.data.cooldownHours,
    } as unknown as never)
    .eq('id', true);

  if (error) return { error: error.message };

  revalidatePath('/admin/inventory/expiry');
  revalidatePath('/admin/inventory');
  return null;
}

const batchLossSchema = z.object({
  batchId: z.string().uuid('Select a batch.'),
  quantity: z.coerce.number().int('Enter a whole number.').positive('Quantity must be positive.'),
  reason: z.string().min(3, 'Enter a reason for this write-off.'),
});

/**
 * Writes damaged or expired units off a batch via the record_batch_loss
 * RPC. Reserved stock can never be written off (the RPC enforces this).
 */
export async function recordBatchLossAction(
  lossType: 'damage' | 'expiry',
  _prevState: StockAdjustmentFormState,
  formData: FormData
): Promise<StockAdjustmentFormState> {
  await requirePermission('inventory.manage');

  const parsed = batchLossSchema.safeParse({
    batchId: formData.get('batchId'),
    quantity: formData.get('quantity'),
    reason: formData.get('reason'),
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? 'Invalid input.' };
  }
  const d = parsed.data;

  const supabase = createClient();
  const { error } = await supabase.rpc('record_batch_loss' as never, {
    p_batch_id: d.batchId,
    p_quantity: d.quantity,
    p_loss_type: lossType,
    p_reason: d.reason,
  } as never);

  if (error) return { error: rpcErrorMessage(error) };

  revalidatePath('/admin/inventory/batches');
  revalidatePath('/admin/inventory/expiry');
  revalidatePath('/admin/inventory');
  return null;
}
