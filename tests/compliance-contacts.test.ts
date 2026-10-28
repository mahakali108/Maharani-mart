import { describe, expect, it, vi } from 'vitest';
import {
  contactGrievanceSchema,
  marketplaceComplianceSchema,
} from '@/lib/admin/business-settings/types';
import { getAuthoritativeContactGrievance } from '@/lib/admin/business-settings/server';

// The server loader reads platform_settings through the request-scoped
// Supabase client. Here it must see "no stored settings" so the fallback path
// (the one that used to publish a fake phone number) is exercised.
vi.mock('@/lib/supabase/server', () => ({
  createClient: () => ({
    from: () => ({
      select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null, error: null }) }) }),
    }),
  }),
}));

/**
 * Owner requirement: never publish invented contact details, and never let a
 * retired feature be switched back on.
 *
 * These assertions cover the two failure modes that existed before:
 *   1. a fallback grievance phone/mailbox that looked operational,
 *   2. a CA-reference field that could activate a membership discount.
 */

const VALID_CONTACT = {
  officialPhone: '+91 9430123456',
  supportEmail: 'support@maharanitraders.com',
  grievanceOfficerName: 'Ramesh Kumar',
  grievanceOfficerDesignation: 'Grievance Redressal Officer',
  grievanceEmail: 'grievance@maharanitraders.com',
  grievancePhone: '+91 9430123456',
  grievanceAddress: 'Shop 12, Station Road, Gaya, Bihar 823001',
  acknowledgementHours: 48,
  resolutionDays: 30,
  isConfigured: true,
};

describe('grievance contact validation', () => {
  it('accepts owner-supplied, real-looking contact details', () => {
    expect(contactGrievanceSchema.safeParse(VALID_CONTACT).success).toBe(true);
  });

  it('rejects placeholder phone numbers', () => {
    for (const phone of ['+91 9400000000', '9999999999', '0000000000', '12345']) {
      const parsed = contactGrievanceSchema.safeParse({ ...VALID_CONTACT, officialPhone: phone });
      expect(parsed.success, phone).toBe(false);
    }
  });

  it('rejects placeholder mailboxes', () => {
    for (const email of ['support@example.com', 'owner@test.com', 'x@something.example']) {
      const parsed = contactGrievanceSchema.safeParse({ ...VALID_CONTACT, supportEmail: email });
      expect(parsed.success, email).toBe(false);
    }
  });

  it('rejects placeholder text in the officer name and address', () => {
    expect(contactGrievanceSchema.safeParse({ ...VALID_CONTACT, grievanceOfficerName: 'TBD' }).success).toBe(false);
    expect(contactGrievanceSchema.safeParse({ ...VALID_CONTACT, grievanceAddress: 'N/A' }).success).toBe(false);
  });
});

describe('publishable contact details', () => {
  it('falls back to EMPTY identity fields, never a fake phone or mailbox', async () => {
    const contact = await getAuthoritativeContactGrievance();
    expect(contact.isConfigured).toBe(false);
    expect(contact.officialPhone).toBe('');
    expect(contact.supportEmail).toBe('');
    expect(contact.grievanceEmail).toBe('');
    expect(contact.grievancePhone).toBe('');
    expect(contact.grievanceOfficerName).toBe('');
    expect(contact.grievanceAddress).toBe('');
    // Workflow targets are constants, not identity claims.
    expect(contact.acknowledgementHours).toBe(48);
    expect(contact.resolutionDays).toBe(30);
  });
});

describe('membership discount is a retired, non-activatable field', () => {
  it('parses without the retired field at all', () => {
    const parsed = marketplaceComplianceSchema.safeParse({
      sellerFundedDiscountsAllowed: false,
      platformFundedDiscountsAllowed: true,
      productModerationRequired: true,
      caApprovalDocumentReference: null,
      tcsDeductionPercent: 1.0,
    });
    expect(parsed.success).toBe(true);
    expect(parsed.success && parsed.data.membershipDiscountCheckoutActive).toBe(false);
  });

  it('still parses a legacy payload so the action can refuse it explicitly', () => {
    const parsed = marketplaceComplianceSchema.safeParse({
      sellerFundedDiscountsAllowed: false,
      platformFundedDiscountsAllowed: true,
      productModerationRequired: true,
      membershipDiscountCheckoutActive: true,
      caApprovalDocumentReference: 'CA-OPINION-2026',
      tcsDeductionPercent: 1.0,
    });
    expect(parsed.success).toBe(true);
  });
});
