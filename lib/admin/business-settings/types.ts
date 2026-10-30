import { z } from 'zod';

export type BusinessType = 'proprietorship' | 'partnership' | 'llp' | 'pvt_ltd' | 'public_ltd' | 'other';
export type VerificationStatus = 'unverified' | 'pending_verification' | 'verified' | 'rejected';

export interface BusinessProfileConfig {
  legalEntityName: string;
  publicBrandName: string;
  businessType: BusinessType;
  gstin: string | null;
  pan: string | null;
  registrationState: string;
  registeredAddress: string;
  verificationStatus: VerificationStatus;
  isGstRegistered: boolean;
  notes?: string | null;
  updatedAt?: string;
  updatedBy?: string | null;
}

/**
 * Placeholder-looking values must never be treated as verified business or
 * grievance information. These expressions are deliberately shared by the
 * stored-setting schemas and launch-readiness approval references.
 */
const PLACEHOLDER_EMAIL = /(^|@)(example\.(com|org|net)|test\.com|localhost)$|\.example$/i;
const PLACEHOLDER_PHONE = /^(?:\+?91)?0*0{6,}$/;
const PLACEHOLDER_TEXT = /^(?:n\/?a|tbd|todo|placeholder|owner input required|x{2,}|-+)$/i;
const ISO_UTC_TIMESTAMP = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{3}))?Z$/;

/**
 * Strictly validate the UTC timestamps stored in protected platform settings.
 * Date.parse alone is intentionally insufficient: JavaScript normalises values
 * such as 2026-02-30 and 24:00 instead of rejecting them. The supported stored
 * representation is precisely YYYY-MM-DDTHH:mm:ss[.SSS]Z.
 */
export function isStrictUtcIsoTimestamp(value: string): boolean {
  const match = ISO_UTC_TIMESTAMP.exec(value);
  if (!match) return false;

  const [, yearText, monthText, dayText, hourText, minuteText, secondText, millisecondText] = match;
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  const hour = Number(hourText);
  const minute = Number(minuteText);
  const second = Number(secondText);
  const millisecond = millisecondText === undefined ? 0 : Number(millisecondText);

  if (![year, month, day, hour, minute, second, millisecond].every(Number.isFinite)) return false;
  if (month < 1 || month > 12 || hour > 23 || minute > 59 || second > 59 || millisecond > 999) return false;

  const isLeapYear = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const daysInMonth = [31, isLeapYear ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  if (day < 1 || day > daysInMonth[month - 1]!) return false;

  const parsedMs = Date.parse(value);
  if (!Number.isFinite(parsedMs)) return false;
  const parsed = new Date(parsedMs);
  if (
    parsed.getUTCFullYear() !== year ||
    parsed.getUTCMonth() + 1 !== month ||
    parsed.getUTCDate() !== day ||
    parsed.getUTCHours() !== hour ||
    parsed.getUTCMinutes() !== minute ||
    parsed.getUTCSeconds() !== second ||
    parsed.getUTCMilliseconds() !== millisecond
  ) return false;

  // Round-trip the exact supported representation so parsing cannot silently
  // accept an equivalent-but-differently-formatted or normalised instant.
  const canonical = millisecondText === undefined
    ? parsed.toISOString().replace(/\.000Z$/, 'Z')
    : parsed.toISOString();
  return canonical === value;
}

function isPlaceholderEmail(value: string): boolean {
  return PLACEHOLDER_EMAIL.test(value.trim().split('@')[1] ?? '') || PLACEHOLDER_EMAIL.test(value.trim());
}

function isPlaceholderPhone(value: string): boolean {
  const digits = value.replace(/\D/g, '');
  // Strip the optional 91 country prefix before inspecting the subscriber part.
  const local = digits.length > 10 ? digits.slice(-10) : digits;
  return (
    local.length < 10 ||
    /^(\d)\1+$/.test(local) || // 9999999999 / 0000000000
    /(\d)\1{5,}/.test(local) || // a run of 6+ identical digits (…9400000000)
    PLACEHOLDER_PHONE.test(digits)
  );
}

/** Reused by stored metadata and the protected ordering-readiness record. */
export const strictUtcTimestampSchema = z
  .string()
  .refine(isStrictUtcIsoTimestamp, 'Use a valid ISO UTC timestamp.');

const storedMetadataSchema = {
  updatedAt: strictUtcTimestampSchema.optional(),
  updatedBy: z.string().uuid('Invalid stored updater.').nullable().optional(),
};

export interface ContactGrievanceConfig {
  officialPhone: string;
  supportEmail: string;
  grievanceOfficerName: string;
  grievanceOfficerDesignation: string;
  grievanceEmail: string;
  grievancePhone: string;
  grievanceAddress: string;
  acknowledgementHours: number;
  resolutionDays: number;
  isConfigured: boolean;
  updatedAt?: string;
  updatedBy?: string | null;
}

export interface MarketplaceComplianceConfig {
  sellerFundedDiscountsAllowed: boolean;
  platformFundedDiscountsAllowed: boolean;
  productModerationRequired: boolean;
  /**
   * RETIRED (migration 0083). Paid membership — and with it the membership
   * checkout discount — no longer exists, so this flag can never be activated.
   * It is kept as a read-only, always-false field so older stored settings and
   * existing payloads keep parsing; the server forces it to false.
   */
  membershipDiscountCheckoutActive: boolean;
  caApprovalDocumentReference?: string | null;
  tcsDeductionPercent: number; // statutory default 1.0% (0.5% CGST + 0.5% SGST)
  updatedAt?: string;
  updatedBy?: string | null;
}

export const businessProfileSchema = z.object({
  legalEntityName: z
    .string()
    .trim()
    .min(2, 'Legal entity name is required.')
    .refine((value) => !PLACEHOLDER_TEXT.test(value), 'Enter the real legal entity name.'),
  publicBrandName: z
    .string()
    .trim()
    .min(2, 'Public brand name is required.')
    .refine((value) => !PLACEHOLDER_TEXT.test(value), 'Enter the real public brand name.'),
  businessType: z.enum(['proprietorship', 'partnership', 'llp', 'pvt_ltd', 'public_ltd', 'other']),
  gstin: z
    .string()
    .trim()
    .regex(/^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$/, 'Enter a valid 15-character GSTIN.')
    .nullable()
    .or(z.literal('')),
  pan: z
    .string()
    .trim()
    .regex(/^[A-Z]{5}[0-9]{4}[A-Z]{1}$/, 'Enter a valid 10-character PAN.')
    .nullable()
    .or(z.literal('')),
  registrationState: z.string().trim().min(2, 'Registration state is required.'),
  registeredAddress: z
    .string()
    .trim()
    .min(5, 'Registered address is required.')
    .refine((value) => !PLACEHOLDER_TEXT.test(value), 'Enter the real registered address.'),
  isGstRegistered: z.boolean(),
  verificationStatus: z.enum(['unverified', 'pending_verification', 'verified', 'rejected']),
  notes: z.string().trim().max(1000).optional().nullable(),
  ...storedMetadataSchema,
}).strict().superRefine((value, context) => {
  if (value.isGstRegistered && !value.gstin) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['gstin'],
      message: 'A GSTIN is required when GST registration is marked as active.',
    });
  }
});

/**
 * Placeholder-looking contact values are rejected outright. The platform must
 * never publish a phone number or mailbox that the owner has not supplied and
 * that does not actually work.
 */
export const contactGrievanceSchema = z.object({
  officialPhone: z
    .string()
    .trim()
    .min(10, 'Official contact phone must be at least 10 digits.')
    .refine((value) => !isPlaceholderPhone(value), 'Enter the owner-verified phone number, not a placeholder.'),
  supportEmail: z
    .string()
    .trim()
    .email('Valid support email required.')
    .refine((value) => !isPlaceholderEmail(value), 'Enter the owner-verified support mailbox, not a placeholder.'),
  grievanceOfficerName: z
    .string()
    .trim()
    .min(2, 'Grievance officer name is required.')
    .refine((value) => !PLACEHOLDER_TEXT.test(value), 'Enter the real grievance officer name.'),
  grievanceOfficerDesignation: z
    .string()
    .trim()
    .min(2, 'Grievance officer designation is required.')
    .refine((value) => !PLACEHOLDER_TEXT.test(value), 'Enter the real grievance officer designation.'),
  grievanceEmail: z
    .string()
    .trim()
    .email('Valid grievance email required.')
    .refine((value) => !isPlaceholderEmail(value), 'Enter the owner-verified grievance mailbox, not a placeholder.'),
  grievancePhone: z
    .string()
    .trim()
    .min(10, 'Grievance phone must be at least 10 digits.')
    .refine((value) => !isPlaceholderPhone(value), 'Enter the owner-verified phone number, not a placeholder.'),
  grievanceAddress: z
    .string()
    .trim()
    .min(5, 'Grievance office address is required.')
    .refine((value) => !PLACEHOLDER_TEXT.test(value), 'Enter the real business address.'),
  acknowledgementHours: z.number().int().min(1).max(72),
  resolutionDays: z.number().int().min(1).max(30),
  isConfigured: z.boolean(),
  ...storedMetadataSchema,
}).strict();

export const marketplaceComplianceSchema = z.object({
  sellerFundedDiscountsAllowed: z.boolean(),
  platformFundedDiscountsAllowed: z.boolean(),
  productModerationRequired: z.boolean(),
  // Accepted for backwards compatibility, but a `true` value is REFUSED by the
  // action: membership (and its checkout discount) is retired.
  membershipDiscountCheckoutActive: z.boolean().optional().default(false),
  caApprovalDocumentReference: z.string().trim().max(200).optional().nullable(),
  tcsDeductionPercent: z.number().min(0).max(5),
});

/**
 * The launch gate is deliberately separate from customer-facing policy text
 * and operating settings. Each value is an owner-recorded approval reference,
 * not an assertion generated by the application. It starts pending and a
 * server-side order writer treats absent, malformed or unknown data as not
 * approved.
 */
export const ORDERING_READINESS_CATEGORY_KEYS = [
  'businessIdentity',
  'publicContacts',
  'legalPolicies',
  'gstInvoice',
  'marketplaceTaxTcsSettlement',
  'deliveryCodCancellationsRefunds',
  'privacyReadiness',
] as const;

export type OrderingReadinessCategoryKey = (typeof ORDERING_READINESS_CATEGORY_KEYS)[number];

export interface OrderingReadinessApproval {
  status: 'approved';
  approvalReference: string;
}

export interface OrderingReadinessPending {
  status: 'pending';
}

export type OrderingReadinessCategory = OrderingReadinessApproval | OrderingReadinessPending;

/**
 * The owner must explicitly set an expiry for the approval record. There is no
 * application default duration: without this policy, or after its valid-until
 * instant, ordering is blocked.
 */
export interface OrderingApprovalValidityPolicy {
  status: 'configured';
  validUntil: string;
  approvalReference: string;
}

export type OrderingReadinessPayload = Record<OrderingReadinessCategoryKey, OrderingReadinessCategory> & {
  approvalValidityPolicy: OrderingApprovalValidityPolicy;
};

export interface OrderingReadinessConfig extends OrderingReadinessPayload {
  schemaVersion: 1;
  recordedAt: string;
  recordedBy: string;
}

const approvalReferenceSchema = z
  .string()
  .trim()
  .min(3, 'An owner-recorded approval reference is required.')
  .max(200, 'Approval references must be 200 characters or fewer.')
  .refine((value) => !PLACEHOLDER_TEXT.test(value), 'Approval references cannot be placeholders.');

const orderingReadinessCategorySchema = z.discriminatedUnion('status', [
  z.object({ status: z.literal('pending') }).strict(),
  z.object({ status: z.literal('approved'), approvalReference: approvalReferenceSchema }).strict(),
]);

const orderingApprovalValidityPolicySchema = z.object({
  status: z.literal('configured'),
  validUntil: strictUtcTimestampSchema,
  approvalReference: approvalReferenceSchema,
}).strict();

const orderingReadinessCategoriesSchema = z.object({
  businessIdentity: orderingReadinessCategorySchema,
  publicContacts: orderingReadinessCategorySchema,
  legalPolicies: orderingReadinessCategorySchema,
  gstInvoice: orderingReadinessCategorySchema,
  marketplaceTaxTcsSettlement: orderingReadinessCategorySchema,
  deliveryCodCancellationsRefunds: orderingReadinessCategorySchema,
  privacyReadiness: orderingReadinessCategorySchema,
  approvalValidityPolicy: orderingApprovalValidityPolicySchema,
}).strict();

/** Payload accepted only from the Super Admin server action. */
export const orderingReadinessPayloadSchema = orderingReadinessCategoriesSchema;

/** Stored shape read by the server-only order writer. */
export const orderingReadinessConfigSchema = orderingReadinessCategoriesSchema.extend({
  schemaVersion: z.literal(1),
  recordedAt: strictUtcTimestampSchema,
  recordedBy: z.string().uuid('Invalid readiness record owner.'),
}).strict();
