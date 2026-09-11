import { z } from 'zod';

/**
 * Pure address helpers shared by the server actions (lib/retailer/
 * address-actions.ts), the checkout snapshot writer and the tests. Kept out
 * of the 'use server' module because Next.js only allows async exports from
 * server-action files.
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
 * Parses and normalizes an address form submission. Shared by the server
 * action and the tests — one rule set, one error vocabulary.
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
