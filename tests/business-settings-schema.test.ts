import { describe, expect, it } from 'vitest';
import {
  businessProfileSchema,
  contactGrievanceSchema,
  strictUtcTimestampSchema,
} from '@/lib/admin/business-settings/types';

const ACTOR_ID = '11111111-1111-4111-8111-111111111111';

const validBusiness = {
  legalEntityName: 'Ajay General',
  publicBrandName: 'Maharani Traders',
  businessType: 'proprietorship' as const,
  gstin: null,
  pan: null,
  registrationState: 'Bihar',
  registeredAddress: 'Owner-recorded registered address, Bihar',
  verificationStatus: 'verified' as const,
  isGstRegistered: false,
  updatedAt: '2026-10-29T12:00:00.000Z',
  updatedBy: ACTOR_ID,
};

const validContact = {
  officialPhone: '+919876543210',
  supportEmail: 'support@maharanitraders.in',
  grievanceOfficerName: 'Owner Verified Officer',
  grievanceOfficerDesignation: 'Grievance Redressal Officer',
  grievanceEmail: 'grievance@maharanitraders.in',
  grievancePhone: '+919876543211',
  grievanceAddress: 'Owner-recorded grievance address, Bihar',
  acknowledgementHours: 48,
  resolutionDays: 30,
  isConfigured: true,
  updatedAt: '2026-10-29T12:00:00.000Z',
  updatedBy: ACTOR_ID,
};

describe('stored business and grievance settings schemas', () => {
  it('accepts only semantically valid UTC ISO timestamps, including a leap day', () => {
    expect(strictUtcTimestampSchema.safeParse('2024-02-29T23:59:59.123Z').success).toBe(true);
    expect(strictUtcTimestampSchema.safeParse('2026-10-29T12:00:00Z').success).toBe(true);

    for (const invalid of [
      '2023-02-29T00:00:00Z', // invalid leap day
      '2026-02-30T00:00:00Z', // impossible February date
      '2026-04-31T00:00:00Z', // impossible April date
      '2026-10-30T24:00:00Z', // hour 24 normalises in Date.parse
      '2026-10-30T12:60:00Z', // minute 60
      '2026-10-30T12:00:60Z', // leap seconds are outside the supported format
      '2026-10-30T12:00:00', // missing timezone
      '2026-10-30T12:00:00+05:30', // offset is not the required UTC Z form
      '2026-10-30T12:00:00.1Z', // fractional seconds must have exactly three digits
      '2026-10-30T12:00:00.1234Z',
    ]) {
      expect(strictUtcTimestampSchema.safeParse(invalid).success, invalid).toBe(false);
    }
  });

  it('uses the strict timestamp validator for accepted stored metadata', () => {
    expect(businessProfileSchema.safeParse({ ...validBusiness, updatedAt: '2026-02-30T00:00:00Z' }).success).toBe(false);
    expect(contactGrievanceSchema.safeParse({ ...validContact, updatedAt: '2026-10-30T24:00:00Z' }).success).toBe(false);
  });

  it('accepts valid existing metadata while retaining strict business/contact validation', () => {
    expect(businessProfileSchema.safeParse(validBusiness).success).toBe(true);
    expect(contactGrievanceSchema.safeParse(validContact).success).toBe(true);
  });

  it('rejects unexpected stored keys and malformed metadata', () => {
    expect(businessProfileSchema.safeParse({ ...validBusiness, unreviewedOverride: true }).success).toBe(false);
    expect(contactGrievanceSchema.safeParse({ ...validContact, unreviewedOverride: true }).success).toBe(false);
    expect(businessProfileSchema.safeParse({ ...validBusiness, updatedAt: 'tomorrow' }).success).toBe(false);
    expect(contactGrievanceSchema.safeParse({ ...validContact, updatedBy: 'not-a-uuid' }).success).toBe(false);
  });

  it('requires real identity/contact values and a GSTIN when GST registration is active', () => {
    expect(businessProfileSchema.safeParse({ ...validBusiness, legalEntityName: 'TBD' }).success).toBe(false);
    expect(businessProfileSchema.safeParse({ ...validBusiness, isGstRegistered: true, gstin: null }).success).toBe(false);
    expect(contactGrievanceSchema.safeParse({ ...validContact, grievanceOfficerDesignation: 'TODO' }).success).toBe(false);
    expect(contactGrievanceSchema.safeParse({ ...validContact, grievanceAddress: '---' }).success).toBe(false);
  });
});
