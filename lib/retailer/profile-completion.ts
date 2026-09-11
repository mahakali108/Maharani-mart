/**
 * Pure profile-completion math for the retailer account. Shared by the
 * account page (indicator) and unit-tested, so the "X% complete" label can
 * never disagree between surfaces. A field counts only when a REAL value
 * exists — placeholders never count.
 */
export interface CompletionInput {
  fullName: string | null | undefined;
  phone: string | null | undefined;
  shopName: string | null | undefined;
  address: string | null | undefined;
  gstin: string | null | undefined;
  addressCount?: number;
}

export interface CompletionResult {
  /** 0–100. */
  percent: number;
  /** Which high-value fields are still missing. */
  missing: string[];
}

const FIELDS: { key: keyof CompletionInput; label: string; weight: number }[] = [
  { key: 'fullName', label: 'Owner name', weight: 15 },
  { key: 'phone', label: 'Phone number', weight: 15 },
  { key: 'shopName', label: 'Shop name', weight: 20 },
  { key: 'address', label: 'Shop address', weight: 20 },
  { key: 'gstin', label: 'GSTIN', weight: 20 },
];

export function computeProfileCompletion(input: CompletionInput): CompletionResult {
  let percent = 0;
  const missing: string[] = [];
  for (const field of FIELDS) {
    const value = input[field.key];
    if (typeof value === 'string' && value.trim().length > 0) {
      percent += field.weight;
    } else {
      missing.push(field.label);
    }
  }
  // A saved address-book entry rounds out delivery readiness.
  if ((input.addressCount ?? 0) > 0) {
    percent += 10;
  } else {
    missing.push('Delivery address');
  }
  return { percent: Math.min(100, percent), missing };
}
