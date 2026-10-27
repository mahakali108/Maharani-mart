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
  membershipDiscountCheckoutActive: boolean; // GATED: strictly false until written CA approval
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

export const contactGrievanceSchema = z.object({
  officialPhone: z.string().trim().min(10, 'Official contact phone must be at least 10 digits.'),
  supportEmail: z.string().trim().email('Valid support email required.'),
  grievanceOfficerName: z.string().trim().min(2, 'Grievance officer name is required.'),
  grievanceOfficerDesignation: z.string().trim().min(2, 'Grievance officer designation is required.'),
  grievanceEmail: z.string().trim().email('Valid grievance email required.'),
  grievancePhone: z.string().trim().min(10, 'Grievance phone must be at least 10 digits.'),
  grievanceAddress: z.string().trim().min(5, 'Grievance office address is required.'),
  acknowledgementHours: z.number().int().min(1).max(72),
  resolutionDays: z.number().int().min(1).max(30),
  isConfigured: z.boolean(),
});

export const marketplaceComplianceSchema = z.object({
  sellerFundedDiscountsAllowed: z.boolean(),
  platformFundedDiscountsAllowed: z.boolean(),
  productModerationRequired: z.boolean(),
  membershipDiscountCheckoutActive: z.boolean(),
  caApprovalDocumentReference: z.string().trim().max(200).optional().nullable(),
  tcsDeductionPercent: z.number().min(0).max(5),
});
