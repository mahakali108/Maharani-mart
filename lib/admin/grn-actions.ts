'use server';

import { z } from 'zod';
import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { requirePermission } from '@/lib/admin/guard';

export type GrnActionResult = { error?: string; success?: boolean; grnId?: string } | null;

const grnLineSchema = z.object({
  productId: z.string().uuid('Select a product.'),
  batchNumber: z
    .string()
    .trim()
    .min(1, 'Batch number is required.')
    .max(60, 'Batch number is too long.'),
  manufacturingDate: z.string().optional().or(z.literal('')),
  expiryDate: z.string().optional().or(z.literal('')),
  receivedQuantity: z.coerce.number().int('Quantity must be a whole number.').positive('Quantity must be positive.'),
  unitCost: z.coerce.number().min(0, 'Cost cannot be negative.').max(10_000_000).optional().or(z.literal('')),
});

const grnSchema = z
  .object({
    warehouseId: z.string().uuid('Select a warehouse.'),
    supplierReference: z.string().trim().max(120).optional().or(z.literal('')),
    invoiceReference: z.string().trim().max(120).optional().or(z.literal('')),
    notes: z.string().trim().max(1000).optional().or(z.literal('')),
    lines: z
      .string()
      .min(2, 'Add at least one product line.')
      .refine((v) => {
        try {
          return Array.isArray(JSON.parse(v));
        } catch {
          return false;
        }
      }, 'Line data is malformed.'),
  })
  .transform((v) => ({ ...v, parsedLines: JSON.parse(v.lines) as unknown }));

/**
 * Creates a GRN in DRAFT state with its product/batch lines.
 * No stock moves until an admin/staff user explicitly confirms it
 * (confirmGrnAction → confirm_grn RPC, which is idempotent).
 */
export async function createGrnAction(
  _prevState: GrnActionResult,
  formData: FormData
): Promise<GrnActionResult> {
  const user = await requirePermission('inventory.manage');

  const parsed = grnSchema.safeParse({
    warehouseId: formData.get('warehouseId'),
    supplierReference: formData.get('supplierReference'),
    invoiceReference: formData.get('invoiceReference'),
    notes: formData.get('notes'),
    lines: formData.get('lines'),
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? 'Invalid input.' };
  }

  const linesResult = z.array(grnLineSchema).safeParse(parsed.data.parsedLines);
  if (!linesResult.success) {
    return { error: `Line ${linesResult.error.issues[0]?.path.join('.') || '?'}: ${linesResult.error.issues[0]?.message}` };
  }
  const lines = linesResult.data;
  if (lines.length === 0) return { error: 'Add at least one product line.' };
  if (lines.length > 200) return { error: 'A GRN can contain at most 200 lines.' };

  // Validate expiry > manufacturing per line server-side (never trust the form).
  for (const line of lines) {
    if (line.manufacturingDate && line.expiryDate && line.expiryDate <= line.manufacturingDate) {
      return { error: `Batch ${line.batchNumber}: expiry date must be after the manufacturing date.` };
    }
  }

  const supabase = createClient();
  const { data: grn, error: grnError } = await supabase
    .from('grns')
    .insert({
      warehouse_id: parsed.data.warehouseId,
      supplier_reference: parsed.data.supplierReference || null,
      invoice_reference: parsed.data.invoiceReference || null,
      notes: parsed.data.notes || null,
      created_by: user.id,
    } as unknown as never)
    .select('id, grn_number')
    .single<{ id: string; grn_number: string }>();

  if (grnError || !grn) return { error: grnError?.message ?? 'Failed to create GRN.' };

  const itemPayloads = lines.map((line) => ({
    grn_id: grn.id,
    product_id: line.productId,
    batch_number: line.batchNumber.trim(),
    manufacturing_date: line.manufacturingDate || null,
    expiry_date: line.expiryDate || null,
    received_quantity: line.receivedQuantity,
    unit_cost: typeof line.unitCost === 'number' ? line.unitCost : null,
  }));

  const { error: itemsError } = await supabase.from('grn_items').insert(itemPayloads as unknown as never);
  if (itemsError) {
    // Keep the draft header for auditability; the user can retry the lines.
    return { error: itemsError.message };
  }

  revalidatePath('/admin/inventory/grn');
  return { success: true, grnId: grn.id };
}

/**
 * Confirms a draft GRN atomically (confirm_grn RPC): creates/updates
 * batches, books GRN_RECEIPT movements, stamps the audit fields.
 * Idempotent — a repeated confirmation never increases stock twice.
 */
export async function confirmGrnAction(grnId: string): Promise<GrnActionResult> {
  await requirePermission('inventory.manage');
  if (!z.string().uuid().safeParse(grnId).success) return { error: 'Invalid GRN.' };

  const supabase = createClient();
  const { error } = await supabase.rpc('confirm_grn' as never, { p_grn_id: grnId } as never);
  if (error) {
    return { error: error.message.replace(/^.*confirm_grn: /, '') };
  }

  revalidatePath('/admin/inventory/grn');
  revalidatePath(`/admin/inventory/grn/${grnId}`);
  revalidatePath('/admin/inventory');
  revalidatePath('/admin/inventory/batches');
  return { success: true, grnId };
}

/** Cancels a GRN while it is still a DRAFT (no stock has moved yet). */
export async function cancelGrnAction(grnId: string, reason: string): Promise<GrnActionResult> {
  await requirePermission('inventory.manage');
  if (!z.string().uuid().safeParse(grnId).success) return { error: 'Invalid GRN.' };

  const supabase = createClient();
  const { error } = await supabase.rpc('cancel_grn' as never, {
    p_grn_id: grnId,
    p_reason: reason?.trim() || null,
  } as never);
  if (error) return { error: error.message };

  revalidatePath('/admin/inventory/grn');
  revalidatePath(`/admin/inventory/grn/${grnId}`);
  return { success: true, grnId };
}
