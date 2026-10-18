/**
 * Pure validation/normalisation for seller management (0062).
 * Server actions re-validate everything here; form client checks are cosmetic.
 * Keep this module free of I/O so it stays trivially unit-testable.
 */

import { normalizePhone } from '@/lib/utils/phone';

export interface SellerInput {
  businessName: string;
  gstin: string;
  pan: string;
  contactName: string;
  phone: string;
  email: string;
  addressLine: string;
}

export type SellerFieldErrors = Partial<Record<keyof SellerInput | 'form', string>>;

const GSTIN_RE = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][0-9A-Z]Z[0-9A-Z]$/;
const PAN_RE = /^[A-Z]{5}[0-9]{4}[A-Z]$/;
const PHONE_RE = /^[6-9][0-9]{9}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function normalizeSellerInput(raw: {
  businessName?: unknown;
  gstin?: unknown;
  pan?: unknown;
  contactName?: unknown;
  phone?: unknown;
  email?: unknown;
  addressLine?: unknown;
}): SellerInput {
  const text = (value: unknown): string =>
    typeof value === 'string' ? value.trim().slice(0, 300) : '';
  const phone = text(raw.phone);
  return {
    businessName: text(raw.businessName),
    gstin: text(raw.gstin).toUpperCase().replace(/\s+/g, ''),
    pan: text(raw.pan).toUpperCase().replace(/\s+/g, ''),
    contactName: text(raw.contactName),
    // Keep all application entry points on the same canonical India-phone
    // rule: optional +91/91 prefixes are removed, storage is always 10 digits.
    // Preserve invalid digits when normalisation fails so validation can report
    // the field rather than silently turning bad input into an optional blank.
    phone: normalizePhone(phone) ?? phone.replace(/\D/g, ''),
    email: text(raw.email).toLowerCase(),
    addressLine: text(raw.addressLine),
  };
}

export function validateSellerInput(input: SellerInput): SellerFieldErrors {
  const errors: SellerFieldErrors = {};
  if (input.businessName.length < 2 || input.businessName.length > 160) {
    errors.businessName = 'Business name must be 2–160 characters.';
  }
  if (input.gstin && !GSTIN_RE.test(input.gstin)) {
    errors.gstin = 'GSTIN must be a valid 15-character GSTIN.';
  }
  if (input.pan && !PAN_RE.test(input.pan)) {
    errors.pan = 'PAN must look like ABCDE1234F.';
  }
  if (input.contactName && (input.contactName.length < 2 || input.contactName.length > 120)) {
    errors.contactName = 'Contact name must be 2–120 characters.';
  }
  if (input.phone && !PHONE_RE.test(input.phone)) {
    errors.phone = 'Phone must be a 10-digit Indian mobile number.';
  }
  if (input.email && !EMAIL_RE.test(input.email)) {
    errors.email = 'Email address does not look valid.';
  }
  if (input.addressLine && input.addressLine.length > 300) {
    errors.addressLine = 'Address must be 300 characters or fewer.';
  }
  return errors;
}

export function validateSellerReason(reason: string, label: string): string | null {
  const trimmed = (reason ?? '').trim().slice(0, 500);
  if (trimmed.length < 3) return `Give a short reason for ${label} (at least 3 characters).`;
  return null;
}

/** Integer paise from a rupee form value; rejects negatives and overflows. */
export function parsePaise(value: unknown): number | null {
  const raw = typeof value === 'string' ? value.trim() : typeof value === 'number' ? String(value) : '';
  if (!/^\d{1,10}(\.\d{1,2})?$/.test(raw)) return null;
  const [rupees, fraction = ''] = raw.split('.');
  const paise = Number(rupees) * 100 + Number((fraction + '00').slice(0, 2));
  if (!Number.isSafeInteger(paise) || paise <= 0) return null;
  return paise;
}

export function parseWholeQuantity(value: unknown, max = 2_000_000_000): number | null {
  const raw = typeof value === 'string' ? value.trim() : typeof value === 'number' ? String(value) : '';
  if (!/^\d{1,10}$/.test(raw)) return null;
  const n = Number(raw);
  return Number.isSafeInteger(n) && n >= 0 && n <= max ? n : null;
}

export function parsePositiveInt(value: unknown, max = 100_000): number | null {
  const n = parseWholeQuantity(value, max);
  return n !== null && n >= 1 ? n : null;
}
