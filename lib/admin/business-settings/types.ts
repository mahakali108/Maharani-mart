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
  legalEntityName: z.string().trim().min(2, 'Legal entity name is required.'),
  publicBrandName: z.string().trim().min(2, 'Public brand name is required.'),
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
  registeredAddress: z.string().trim().min(5, 'Registered address is required.'),
  isGstRegistered: z.boolean(),
  verificationStatus: z.enum(['unverified', 'pending_verification', 'verified', 'rejected']),
  notes: z.string().trim().max(1000).optional().nullable(),
});

/**
 * Placeholder-looking contact values are rejected outright. The platform must
 * never publish a phone number or mailbox that the owner has not supplied and
 * that does not actually work.
 */
const PLACEHOLDER_EMAIL = /(^|@)(example\.(com|org|net)|test\.com|localhost)$|\.example$/i;
const PLACEHOLDER_PHONE = /^(?:\+?91)?0*0{6,}$/;
const PLACEHOLDER_TEXT = /^(?:n\/?a|tbd|todo|placeholder|owner input required|x{2,}|-+)$/i;

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
  grievanceOfficerDesignation: z.string().trim().min(2, 'Grievance officer designation is required.'),
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
});

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
