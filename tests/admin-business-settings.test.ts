import { describe, expect, it } from 'vitest';
import {
  businessProfileSchema,
  contactGrievanceSchema,
  marketplaceComplianceSchema,
} from '@/lib/admin/business-settings/types';

describe('Super Admin Business Settings Validation & Tax Gates', () => {
  it('validates business profile payload and enforces valid 15-char Indian GSTIN', () => {
    const validPayload = {
      legalEntityName: 'Ajay General',
      publicBrandName: 'Maharani Traders',
      businessType: 'proprietorship',
      gstin: '10ABCDE1234F1Z5',
      pan: 'ABCDE1234F',
      registrationState: 'Bihar',
      registeredAddress: 'Station Road, Gaya, Bihar - 823001',
      isGstRegistered: true,
      verificationStatus: 'verified',
      notes: 'Verified with official GSTIN portal certificate',
    };

    const result = businessProfileSchema.safeParse(validPayload);
    expect(result.success).toBe(true);
  });

  it('rejects invalid GSTIN format', () => {
    const invalidGstinPayload = {
      legalEntityName: 'Ajay General',
      publicBrandName: 'Maharani Traders',
      businessType: 'proprietorship',
      gstin: 'INVALID_GSTIN_123',
      pan: 'ABCDE1234F',
      registrationState: 'Bihar',
      registeredAddress: 'Station Road, Gaya, Bihar',
      isGstRegistered: true,
      verificationStatus: 'verified',
    };

    const result = businessProfileSchema.safeParse(invalidGstinPayload);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]?.message).toMatch(/Enter a valid 15-character GSTIN/i);
    }
  });

  it('allows null GSTIN and PAN when business is unverified or unregistered', () => {
    const unverifiedPayload = {
      legalEntityName: 'Ajay General',
      publicBrandName: 'Maharani Traders',
      businessType: 'proprietorship',
      gstin: null,
      pan: null,
      registrationState: 'Bihar',
      registeredAddress: 'Gaya, Bihar',
      isGstRegistered: false,
      verificationStatus: 'unverified',
    };

    const result = businessProfileSchema.safeParse(unverifiedPayload);
    expect(result.success).toBe(true);
  });

  it('validates contact and statutory grievance officer payload', () => {
    const validGrievance = {
      officialPhone: '+91 9430123456',
      supportEmail: 'support@maharanitraders.com',
      grievanceOfficerName: 'Ramesh Kumar',
      grievanceOfficerDesignation: 'Grievance Redressal Officer',
      grievanceEmail: 'grievance@maharanitraders.com',
      grievancePhone: '+91 9430123457',
      grievanceAddress: 'Maharani Hub, Gaya, Bihar',
      acknowledgementHours: 48,
      resolutionDays: 30,
      isConfigured: true,
    };

    const result = contactGrievanceSchema.safeParse(validGrievance);
    expect(result.success).toBe(true);
  });

  it('rejects invalid email for grievance contact', () => {
    const invalidEmail = {
      officialPhone: '+91 9430123456',
      supportEmail: 'support@maharanitraders.com',
      grievanceOfficerName: 'Ramesh Kumar',
      grievanceOfficerDesignation: 'Grievance Redressal Officer',
      grievanceEmail: 'not-an-email',
      grievancePhone: '+91 9430123457',
      grievanceAddress: 'Maharani Hub, Gaya, Bihar',
      acknowledgementHours: 48,
      resolutionDays: 30,
      isConfigured: true,
    };

    const result = contactGrievanceSchema.safeParse(invalidEmail);
    expect(result.success).toBe(false);
  });

  it('validates marketplace compliance and CA approval reference requirements', () => {
    const validMarketplace = {
      sellerFundedDiscountsAllowed: false,
      platformFundedDiscountsAllowed: true,
      productModerationRequired: true,
      membershipDiscountCheckoutActive: true,
      caApprovalDocumentReference: 'CA-OPINION-MAHARANI-2026-OCT-15',
      tcsDeductionPercent: 1.0,
    };

    const result = marketplaceComplianceSchema.safeParse(validMarketplace);
    expect(result.success).toBe(true);
  });

  it('ensures TCS deduction rate stays within statutory bounds (0% to 5%)', () => {
    const excessiveTcs = {
      sellerFundedDiscountsAllowed: false,
      platformFundedDiscountsAllowed: true,
      productModerationRequired: true,
      membershipDiscountCheckoutActive: false,
      caApprovalDocumentReference: null,
      tcsDeductionPercent: 10.0, // Invalid TCS
    };

    const result = marketplaceComplianceSchema.safeParse(excessiveTcs);
    expect(result.success).toBe(false);
  });
});
