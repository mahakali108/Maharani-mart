/**
 * Supplier application — shared validation + vocabulary (pure).
 *
 * Used by the public application form (Server Action) AND unit tests, so a
 * value accepted in the browser is exactly what the server and the
 * migration-0059 CHECK constraints accept. The database remains the final
 * authority; this module exists for clean, immediate error messages.
 *
 * Nothing here fabricates data: optional fields stay null, GSTIN is
 * applicant-declared and format-checked only, and no verification status
 * can be expressed through this shape at all.
 */

export const SUPPLIER_APPLICATION_STATUSES = ['pending', 'approved', 'rejected', 'suspended'] as const;
export type SupplierApplicationStatus = (typeof SUPPLIER_APPLICATION_STATUSES)[number];

export const SUPPLIER_DOC_TYPES = [
  { value: 'gstin_certificate', label: 'GSTIN Certificate' },
  { value: 'pan_card', label: 'PAN Card' },
  { value: 'bank_proof', label: 'Bank Proof (cancelled cheque / statement)' },
  { value: 'trade_licence', label: 'Trade Licence' },
  { value: 'address_proof', label: 'Address Proof' },
  { value: 'other', label: 'Other' },
] as const;
export type SupplierDocType = (typeof SUPPLIER_DOC_TYPES)[number]['value'];

export function isSupplierDocType(v: string): v is SupplierDocType {
  return SUPPLIER_DOC_TYPES.some((t) => t.value === v);
}

export interface SupplierApplicationInput {
  businessName: string;
  legalName: string;
  contactName: string;
  phone: string;
  email: string;
  addressLine: string;
  city: string;
  state: string;
  pincode: string;
  gstin: string;
  productCategories: string;
  /** Honeypot — humans never see/fill this; bots do. */
  website: string;
}

export type SupplierApplicationErrors = Partial<Record<keyof SupplierApplicationInput, string>>;

export const PHONE_RE = /^[6-9][0-9]{9}$/;
export const GSTIN_RE = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;
export const PINCODE_RE = /^[0-9]{6}$/;
const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

const clean = (v: unknown) => (typeof v === 'string' ? v.trim().replace(/\s+/g, ' ') : '');

export function normalizeSupplierApplication(raw: Record<string, unknown>): SupplierApplicationInput {
  return {
    businessName: clean(raw.businessName).slice(0, 120),
    legalName: clean(raw.legalName).slice(0, 160),
    contactName: clean(raw.contactName).slice(0, 80),
    phone: clean(raw.phone).replace(/[\s-]/g, '').replace(/^\+91/, '').slice(0, 13),
    email: clean(raw.email).toLowerCase().slice(0, 160),
    addressLine: clean(raw.addressLine).slice(0, 300),
    city: clean(raw.city).slice(0, 80),
    state: clean(raw.state).slice(0, 80),
    pincode: clean(raw.pincode).replace(/\s/g, '').slice(0, 6),
    gstin: clean(raw.gstin).toUpperCase().replace(/\s/g, '').slice(0, 15),
    productCategories: clean(raw.productCategories).slice(0, 500),
    website: clean(raw.website),
  };
}

export function validateSupplierApplication(input: SupplierApplicationInput): SupplierApplicationErrors {
  const errors: SupplierApplicationErrors = {};
  if (input.businessName.length < 2) errors.businessName = 'Enter the business / firm name.';
  if (input.legalName && input.legalName.length < 2) errors.legalName = 'Legal name looks too short.';
  if (input.contactName.length < 2) errors.contactName = 'Enter the contact person’s name.';
  if (!PHONE_RE.test(input.phone)) errors.phone = 'Enter a valid 10-digit Indian mobile number.';
  if (input.email && !EMAIL_RE.test(input.email)) errors.email = 'Enter a valid email address, or leave it blank.';
  if (input.pincode && !PINCODE_RE.test(input.pincode)) errors.pincode = 'Enter a 6-digit PIN code, or leave it blank.';
  if (input.gstin && !GSTIN_RE.test(input.gstin))
    errors.gstin = 'GSTIN must be 15 characters (e.g. 10ABCDE1234F1Z5), or leave blank if not registered.';
  return errors;
}

export function isValidSupplierApplication(input: SupplierApplicationInput): boolean {
  return Object.keys(validateSupplierApplication(input)).length === 0;
}

/** Bounded, validated review-queue query params. */
export interface SupplierReviewQuery {
  status: SupplierApplicationStatus | 'all';
  page: number;
}
export const SUPPLIER_REVIEW_PAGE_SIZE = 25;
export const SUPPLIER_REVIEW_MAX_PAGE = 200;

export function parseSupplierReviewQuery(
  searchParams: Record<string, string | string[] | undefined>
): SupplierReviewQuery {
  const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
  const rawPage = Number(first(searchParams.page));
  const status = first(searchParams.status);
  return {
    status: (SUPPLIER_APPLICATION_STATUSES as readonly string[]).includes(status ?? '')
      ? (status as SupplierApplicationStatus)
      : 'pending',
    page: Number.isFinite(rawPage)
      ? Math.min(Math.max(Math.trunc(rawPage), 1), SUPPLIER_REVIEW_MAX_PAGE)
      : 1,
  };
}
