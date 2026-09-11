'use server';

import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { requirePermission } from '@/lib/admin/guard';
import { formatAddressLine, parseAddressForm } from '@/lib/retailer/address-shared';

export type AddressActionResult = { error?: string } | { success: true; addressId?: string };
export { formatAddressLine, parseAddressForm };

/**
 * Pure formatting used by both the checkout snapshot writer and the UI, so
 * the one-line address on an order/invoice is identical to what the retailer
 * saw when they picked the address.
 */
/** Clears is_default on the retailer's other addresses (default is exclusive). */
async function clearOtherDefaults(supabase: ReturnType<typeof createClient>, retailerId: string, keepId?: string) {
  const query = supabase.from('retailer_addresses').update({ is_default: false } as unknown as never).eq('retailer_id', retailerId);
  if (keepId) await query.neq('id', keepId);
  else await query;
}

/**
 * When no default exists, make the first-saved address the default so
 * checkout always has a deterministic preselected address.
 */
export async function ensureDefaultAddress(supabase: ReturnType<typeof createClient>, retailerId: string): Promise<void> {
  const { data: rows } = await supabase
    .from('retailer_addresses')
    .select('id, is_default')
    .eq('retailer_id', retailerId)
    .order('created_at', { ascending: true });
  const addresses = (rows ?? []) as unknown as { id: string; is_default: boolean }[];
  const first = addresses[0];
  if (!first || addresses.some((row) => row.is_default)) return;
  await supabase.from('retailer_addresses').update({ is_default: true } as unknown as never).eq('id', first.id);
}

export async function saveAddressAction(formData: FormData): Promise<AddressActionResult> {
  const user = await requirePermission('orders.create');
  if (user.role !== 'retailer') return { error: 'Only a retailer can manage delivery addresses.' };

  const parsed = parseAddressForm(formData);
  if (!parsed.ok) return { error: parsed.error };
  const value = parsed.value;

  const supabase = createClient();
  const payload = {
    retailer_id: user.id,
    label: value.label,
    receiver_name: value.receiverName,
    phone: value.phone,
    line1: value.line1,
    line2: value.line2 ?? null,
    landmark: value.landmark ?? null,
    city: value.city,
    district: value.district ?? null,
    state: value.state ?? 'Bihar',
    pincode: value.pincode,
    is_default: value.isDefault ?? false,
  };
  const updatePayload = { ...payload, updated_at: new Date().toISOString() };

  if (value.addressId) {
    // Ownership is re-checked by RLS (retailer_addresses_owner_update) and
    // the explicit .eq() below gives a clean error instead of a silent no-op.
    const { data, error } = await supabase
      .from('retailer_addresses')
      .update(updatePayload as unknown as never)
      .eq('id', value.addressId)
      .eq('retailer_id', user.id)
      .select('id')
      .maybeSingle<{ id: string }>();
    if (error) return { error: 'The address could not be updated.' };
    if (!data) return { error: 'Address not found.' };
    if (payload.is_default) await clearOtherDefaults(supabase, user.id, value.addressId);
    revalidateAddressPaths();
    return { success: true, addressId: value.addressId };
  }

  const { data, error } = await supabase
    .from('retailer_addresses')
    .insert(payload as unknown as never)
    .select('id')
    .maybeSingle<{ id: string }>();
  if (error) return { error: 'The address could not be saved.' };
  const newId = data?.id;
  if (payload.is_default) await clearOtherDefaults(supabase, user.id, newId);
  else await ensureDefaultAddress(supabase, user.id);
  revalidateAddressPaths();
  return { success: true, addressId: newId };
}

export async function setDefaultAddressAction(addressId: string): Promise<AddressActionResult> {
  const user = await requirePermission('orders.create');
  if (user.role !== 'retailer') return { error: 'Only a retailer can manage delivery addresses.' };
  const supabase = createClient();
  const { data, error } = await supabase
    .from('retailer_addresses')
    .update({ is_default: true } as unknown as never)
    .eq('id', addressId)
    .eq('retailer_id', user.id)
    .select('id')
    .maybeSingle<{ id: string }>();
  if (error) return { error: 'The default address could not be changed.' };
  if (!data) return { error: 'Address not found.' };
  await clearOtherDefaults(supabase, user.id, addressId);
  revalidateAddressPaths();
  return { success: true };
}

export async function deleteAddressAction(addressId: string): Promise<AddressActionResult> {
  const user = await requirePermission('orders.create');
  if (user.role !== 'retailer') return { error: 'Only a retailer can manage delivery addresses.' };
  const supabase = createClient();
  const { error } = await supabase
    .from('retailer_addresses')
    .delete()
    .eq('id', addressId)
    .eq('retailer_id', user.id);
  if (error) return { error: 'The address could not be deleted.' };
  // Keep a deterministic default after any delete.
  await ensureDefaultAddress(supabase, user.id);
  revalidateAddressPaths();
  return { success: true };
}

function revalidateAddressPaths() {
  revalidatePath('/retailer/account/addresses');
  revalidatePath('/retailer/checkout');
  revalidatePath('/retailer/account', 'layout');
}
