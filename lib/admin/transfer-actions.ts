'use server';

import { z } from 'zod';
import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { requirePermission } from '@/lib/admin/guard';

export type TransferActionResult = { error?: string; success?: boolean; transferId?: string } | null;

const transferLineSchema = z.object({
  batchId: z.string().uuid('Select a batch.'),
  quantity: z.coerce.number().int('Quantity must be a whole number.').positive('Quantity must be positive.'),
});

const transferSchema = z
  .object({
    sourceWarehouseId: z.string().uuid('Select a source warehouse.'),
    destinationWarehouseId: z.string().uuid('Select a destination warehouse.'),
    notes: z.string().trim().max(1000).optional().or(z.literal('')),
    lines: z.string().min(2, 'Add at least one batch line.'),
  })
  .refine((v) => v.sourceWarehouseId !== v.destinationWarehouseId, {
    message: 'Source and destination warehouses must be different.',
  })
  .transform((v) => ({ ...v, parsedLines: JSON.parse(v.lines) as unknown }));

/**
 * Creates a PENDING transfer. No stock moves until executeTransferAction
 * runs the execute_stock_transfer RPC, which atomically validates
 * availability and books paired TRANSFER_OUT / TRANSFER_IN movements
 * sharing one reference.
 */
export async function createTransferAction(
  _prevState: TransferActionResult,
  formData: FormData
): Promise<TransferActionResult> {
  const user = await requirePermission('inventory.manage');

  let parsed;
  try {
    parsed = transferSchema.safeParse({
      sourceWarehouseId: formData.get('sourceWarehouseId'),
      destinationWarehouseId: formData.get('destinationWarehouseId'),
      notes: formData.get('notes'),
      lines: formData.get('lines'),
    });
  } catch {
    return { error: 'Line data is malformed.' };
  }
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? 'Invalid input.' };
  }

  const linesResult = z.array(transferLineSchema).safeParse(parsed.data.parsedLines);
  if (!linesResult.success) {
    return { error: linesResult.error.issues[0]?.message ?? 'Invalid line.' };
  }
  const lines = linesResult.data;
  if (lines.length === 0) return { error: 'Add at least one batch line.' };
  if (lines.length > 200) return { error: 'A transfer can contain at most 200 lines.' };

  const supabase = createClient();

  // Server-side sanity check: every selected batch must live in the source
  // warehouse (the RPC re-validates this under lock — this only produces a
  // better error message for honest mistakes).
  const { data: batchData } = await supabase
    .from('inventory_batches')
    .select('id, warehouse_id, product_id')
    .in('id', lines.map((l) => l.batchId));
  const batches = (batchData ?? []) as unknown as { id: string; warehouse_id: string; product_id: string }[];
  const batchById = new Map(batches.map((b) => [b.id, b]));
  for (const line of lines) {
    const b = batchById.get(line.batchId);
    if (!b) return { error: 'One of the selected batches no longer exists.' };
    if (b.warehouse_id !== parsed.data.sourceWarehouseId) {
      return { error: 'All selected batches must belong to the source warehouse.' };
    }
  }

  const { data: transfer, error: transferError } = await supabase
    .from('stock_transfers')
    .insert({
      source_warehouse_id: parsed.data.sourceWarehouseId,
      destination_warehouse_id: parsed.data.destinationWarehouseId,
      notes: parsed.data.notes || null,
      created_by: user.id,
    } as unknown as never)
    .select('id, transfer_number')
    .single<{ id: string; transfer_number: string }>();

  if (transferError || !transfer) return { error: transferError?.message ?? 'Failed to create transfer.' };

  const itemPayloads = lines.map((line) => ({
    transfer_id: transfer.id,
    product_id: batchById.get(line.batchId)?.product_id ?? null,
    batch_id: line.batchId,
    quantity: line.quantity,
  }));
  if (itemPayloads.some((p) => p.product_id === null)) {
    await supabase
      .from('stock_transfers')
      .update({ status: 'cancelled', cancellation_reason: 'Invalid batch line' } as unknown as never)
      .eq('id', transfer.id);
    return { error: 'One of the selected batches no longer exists.' };
  }

  const { error: itemsError } = await supabase.from('stock_transfer_items').insert(itemPayloads as unknown as never);
  if (itemsError) return { error: itemsError.message };

  revalidatePath('/admin/inventory/transfers');
  return { success: true, transferId: transfer.id };
}

/** Executes a pending transfer atomically (execute_stock_transfer RPC). */
export async function executeTransferAction(transferId: string): Promise<TransferActionResult> {
  await requirePermission('inventory.manage');
  if (!z.string().uuid().safeParse(transferId).success) return { error: 'Invalid transfer.' };

  const supabase = createClient();
  const { error } = await supabase.rpc('execute_stock_transfer' as never, { p_transfer_id: transferId } as never);
  if (error) {
    const msg = error.message;
    const match = msg.match(/INSUFFICIENT_STOCK:\s*(.+)$/);
    return { error: match?.[1] ? match[1].trim() : msg };
  }

  revalidatePath('/admin/inventory/transfers');
  revalidatePath('/admin/inventory');
  return { success: true, transferId };
}

/** Cancels a transfer that has not been executed yet. */
export async function cancelTransferAction(transferId: string, reason: string): Promise<TransferActionResult> {
  await requirePermission('inventory.manage');
  if (!z.string().uuid().safeParse(transferId).success) return { error: 'Invalid transfer.' };

  const supabase = createClient();
  const { error } = await supabase.rpc('cancel_stock_transfer' as never, {
    p_transfer_id: transferId,
    p_reason: reason?.trim() || null,
  } as never);
  if (error) return { error: error.message };

  revalidatePath('/admin/inventory/transfers');
  return { success: true, transferId };
}
