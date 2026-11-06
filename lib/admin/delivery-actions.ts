'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { requirePermission } from '@/lib/admin/guard';
import { districtSchema } from '@/lib/areas/district';

export type DeliveryPinFormState = { success?: string; error?: string } | null;

// Convert rupees to integer paise without floating-point rounding. Deliberate
// upper bound keeps values well within PostgreSQL bigint / JS safe integers.
function parsePaise(raw: FormDataEntryValue | null): number | null {
  const value = typeof raw === 'string' ? raw.trim() : '';
  if (!/^(0|[1-9][0-9]{0,6})(\.[0-9]{1,2})?$/.test(value)) return null;
  const [rupees, fractional = ''] = value.split('.');
  return Number(rupees) * 100 + Number(fractional.padEnd(2, '0'));
}

const pinSchema = z.object({
  id: z.string().uuid().optional(),
  district: districtSchema.pipe(z.string().min(2)),
  state: districtSchema.pipe(z.string().min(2)),
  pincode: z.string().regex(/^[0-9]{6}$/, 'Enter an exact 6-digit PIN.'),
  minimumOrderPaise: z.number().int().min(0),
  deliveryFeePaise: z.number().int().min(0),
  isActive: z.boolean(),
});

export async function saveDeliveryPinAction(
  _previous: DeliveryPinFormState, form: FormData
): Promise<DeliveryPinFormState> {
  const actor = await requirePermission('master_data.manage');
  if (actor.role !== 'admin' && actor.role !== 'super_admin') {
    return { error: 'Only an Admin can manage delivery PINs.' };
  }
  const parsed = pinSchema.safeParse({
    id: form.get('id') || undefined,
    district: form.get('district'),
    state: form.get('state'),
    pincode: form.get('pincode'),
    minimumOrderPaise: parsePaise(form.get('minimumOrder')),
    deliveryFeePaise: parsePaise(form.get('deliveryFee')),
    isActive: form.get('isActive') === 'on',
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? 'Check the PIN and delivery terms.' };

  const value = parsed.data;
  const supabase = (await createClient());
  const payload = {
    district: value.district,
    state: value.state,
    pincode: value.pincode,
    minimum_order_paise: value.minimumOrderPaise,
    delivery_fee_paise: value.deliveryFeePaise,
    is_active: value.isActive,
    updated_by: actor.id,
    updated_at: new Date().toISOString(),
  };
  if (value.id) {
    const { data, error } = await supabase.from('delivery_service_areas' as never)
      .update(payload as never).eq('id', value.id).select('id').maybeSingle();
    if (error) return { error: error.code === '23505' ? 'This district/state/PIN is already configured.' : 'Delivery terms could not be updated.' };
    if (!data) return { error: 'Delivery PIN not found or not permitted.' };
  } else {
    const { error } = await supabase.from('delivery_service_areas' as never)
      .insert({ ...payload, created_by: actor.id } as never);
    if (error) return { error: error.code === '23505' ? 'This district/state/PIN is already configured.' : 'Delivery PIN could not be saved.' };
  }
  revalidatePath('/admin/areas');
  revalidatePath('/retailer/checkout');
  return { success: `${value.pincode} ${value.isActive ? 'is active' : 'is saved as inactive'}. Online orders are still rechecked at placement.` };
}

export async function setDeliveryPinActiveAction(id: string, active: boolean): Promise<DeliveryPinFormState> {
  const actor = await requirePermission('master_data.manage');
  if (actor.role !== 'admin' && actor.role !== 'super_admin') return { error: 'Only an Admin can manage delivery PINs.' };
  if (!z.string().uuid().safeParse(id).success || typeof active !== 'boolean') return { error: 'Invalid delivery PIN.' };
  const { data, error } = await (await createClient()).from('delivery_service_areas' as never)
    .update({ is_active: active, updated_by: actor.id, updated_at: new Date().toISOString() } as never)
    .eq('id', id).select('id').maybeSingle();
  if (error || !data) return { error: 'Delivery PIN could not be changed. Please retry.' };
  revalidatePath('/admin/areas');
  revalidatePath('/retailer/checkout');
  return { success: active ? 'PIN activated.' : 'PIN deactivated. New self-checkout orders are blocked.' };
}
