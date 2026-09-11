'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { requirePermission } from '@/lib/admin/guard';

export type AddressActionResult = { error?: string } | { success: true; addressId?: string };

/**
 * Pure formatting used by both the checkout snapshot writer and the UI, so
 * the one-line address on an order/invoice is identical to what the retailer
 * saw when they picked the address.
 */
export function formatAddressLine(input: {
  line1: string;
  line2?: string | null;
  landmark?: string | null;
  city: string;
  district?: string | null;
  state?: string | null;
  pincode: string;
}): string {
  return [input.line1, input.line2, input.landmark, input.city, input.district, input.state, input.pincode]
    .map((part) => part?.trim())
    .filter((part): part is string => !!part)
    .join(', ');
}

const addressSchema = z.object({
  addressId: z.string().uuid().optional(),
  label: z.string().trim().min(1, 'Give the address a label, e.g. Shop or Godown.').max(40),
  receiverName: z.string().trim().min(2, 'Enter the receiver name.').max(120),
  phone: z
    .string()
    .trim()
    .min(5, 'Enter a contact phone number.')
    .max(20)
    .regex(/^[0-9+\-\s]+$/, 'Phone can contain digits, spaces, + and - only.'),
  line1: z.string().trim().min(3, 'Enter the shop / building address.').max(200),
  line2: z.string().trim().max(200).optional(),
  landmark: z.string().trim().max(120).optional(),
  city: z.string().trim().min(2, 'Enter the city or town.').max(120),
  district: z.string().trim().max(120).optional(),
  state: z.string().trim().max(120).optional(),
  pincode: z.string().trim().regex(/^[0-9]{6}$/, 'PIN code must be exactly 6 digits.'),
  isDefault: z.boolean().optional(),
});

export type AddressInput = z.input<typeof addressSchema>;

/**
 * Parses and normalizes an address form submission. Exported for tests —
 * the server action and the tests share the exact same rule set.
 */
export function parseAddressForm(formData: FormData): { ok: true; value: AddressInput & { addressId?: string } } | { ok: false; error: string } {
  const parsed = addressSchema.safeParse({
    addressId: typeof formData.get('addressId') === 'string' && formData.get('addressId') ? formData.get('addressId') : undefined,
    label: formData.get('label'),
    receiverName: formData.get('receiverName'),
    phone: formData.get('phone'),
    line1: formData.get('line1'),
    line2: formData.get('line2') || undefined,
    landmark: formData.get('landmark') || undefined,
    city: formData.get('city'),
    district: formData.get('district') || undefined,
    state: formData.get('state') || undefined,
    pincode: formData.get('pincode'),
    isDefault: formData.get('isDefault') === 'on' || formData.get('isDefault') === 'true',
  });
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? 'Please check the address details.' };
  }
  return { ok: true, value: parsed.data };
}

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

  if (value.addressId) {
    // Ownership is re-checked by RLS (retailer_addresses_owner_update) and
    // the explicit .eq() below gives a clean error instead of a silent no-op.
    const { data, error } = await supabase
      .from('retailer_addresses')
      .update(payload as unknown as never)
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
