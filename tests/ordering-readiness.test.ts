import { describe, expect, it } from 'vitest';
import {
  ORDERING_READINESS_CATEGORY_KEYS,
  type OrderingReadinessConfig,
} from '@/lib/admin/business-settings/types';
import { isOrderingReady, orderingIsReadyFromSettingsRows } from '@/lib/compliance/ordering-readiness';

const RECORDED_BY = '11111111-1111-4111-8111-111111111111';
const NOW = new Date('2026-10-29T12:00:00.000Z');

function businessProfile() {
  return {
    legalEntityName: 'Maharani Traders',
    publicBrandName: 'Maharani Traders',
    businessType: 'proprietorship',
    gstin: null,
    pan: null,
    registrationState: 'Bihar',
    registeredAddress: 'Owner-recorded registered address, Bihar',
    verificationStatus: 'verified',
    isGstRegistered: false,
    updatedAt: '2026-10-29T11:00:00.000Z',
    updatedBy: RECORDED_BY,
  };
}

function contactGrievance() {
  return {
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
    updatedAt: '2026-10-29T11:00:00.000Z',
    updatedBy: RECORDED_BY,
  };
}

function allApprovedReadiness(): OrderingReadinessConfig {
  return {
    businessIdentity: { status: 'approved', approvalReference: 'OWNER-REVIEW-001' },
    publicContacts: { status: 'approved', approvalReference: 'OWNER-REVIEW-002' },
    legalPolicies: { status: 'approved', approvalReference: 'OWNER-REVIEW-003' },
    gstInvoice: { status: 'approved', approvalReference: 'OWNER-REVIEW-004' },
    marketplaceTaxTcsSettlement: { status: 'approved', approvalReference: 'OWNER-REVIEW-005' },
    deliveryCodCancellationsRefunds: { status: 'approved', approvalReference: 'OWNER-REVIEW-006' },
    privacyReadiness: { status: 'approved', approvalReference: 'OWNER-REVIEW-007' },
    approvalValidityPolicy: {
      status: 'configured',
      validUntil: '2026-11-01T12:00:00.000Z',
      approvalReference: 'OWNER-POLICY-001',
    },
    schemaVersion: 1,
    recordedAt: '2026-10-29T00:00:00.000Z',
    recordedBy: RECORDED_BY,
  };
}

function rows(readiness: unknown = allApprovedReadiness(), overrides: Record<string, unknown> = {}) {
  return [
    { key: 'business_profile', value: businessProfile() },
    { key: 'contact_grievance', value: contactGrievance() },
    { key: 'ordering_launch_readiness', value: readiness },
  ].map((row) => ({ ...row, ...(overrides[row.key] as object | undefined) }));
}

function ready(rowsToCheck: unknown): boolean {
  return orderingIsReadyFromSettingsRows(rowsToCheck, NOW);
}

describe('server-only ordering launch readiness', () => {
  it('allows only an explicit, valid, owner-recorded all-approved configuration inside its configured validity period', () => {
    expect(ready(rows())).toBe(true);
  });

  it.each(ORDERING_READINESS_CATEGORY_KEYS)('fails closed while %s is pending', (category) => {
    const readiness = allApprovedReadiness();
    readiness[category] = { status: 'pending' };
    expect(ready(rows(readiness))).toBe(false);
  });

  it.each(ORDERING_READINESS_CATEGORY_KEYS)('fails closed when %s is absent', (category) => {
    const readiness = allApprovedReadiness() as unknown as Record<string, unknown>;
    delete readiness[category];
    expect(ready(rows(readiness))).toBe(false);
  });

  it('fails closed when an approved category or the validity policy has a missing or placeholder approval reference', () => {
    const missingCategoryReference = allApprovedReadiness() as unknown as {
      businessIdentity: Record<string, unknown>;
    };
    delete missingCategoryReference.businessIdentity.approvalReference;
    expect(ready(rows(missingCategoryReference))).toBe(false);

    const placeholderPolicyReference = allApprovedReadiness();
    placeholderPolicyReference.approvalValidityPolicy.approvalReference = 'TBD';
    expect(ready(rows(placeholderPolicyReference))).toBe(false);
  });

  it('fails closed when the owner-approved validity policy is missing, malformed, expired, or predates the record', () => {
    const missing = allApprovedReadiness() as unknown as Record<string, unknown>;
    delete missing.approvalValidityPolicy;
    expect(ready(rows(missing))).toBe(false);

    const malformed = allApprovedReadiness();
    malformed.approvalValidityPolicy.validUntil = 'not-a-timestamp';
    expect(ready(rows(malformed))).toBe(false);

    const expired = allApprovedReadiness();
    expired.approvalValidityPolicy.validUntil = '2026-10-29T11:59:59.999Z';
    expect(ready(rows(expired))).toBe(false);

    const predatesRecord = allApprovedReadiness();
    predatesRecord.approvalValidityPolicy.validUntil = '2026-10-28T23:59:59.999Z';
    expect(ready(rows(predatesRecord))).toBe(false);
  });

  it.each([
    '2023-02-29T00:00:00Z',
    '2026-02-30T00:00:00Z',
    '2026-04-31T00:00:00Z',
    '2026-10-30T24:00:00Z',
    '2026-10-30T12:60:00Z',
    '2026-10-30T12:00:60Z',
    '2026-10-30T12:00:00',
    '2026-10-30T12:00:00+05:30',
    '2026-10-30T12:00:00.1Z',
  ])('fails closed when recordedAt is an ISO-shaped but invalid UTC timestamp: %s', (invalidRecordedAt) => {
    const readiness = allApprovedReadiness();
    readiness.recordedAt = invalidRecordedAt;
    expect(ready(rows(readiness))).toBe(false);
  });

  it.each([
    '2023-02-29T00:00:00Z',
    '2026-02-30T00:00:00Z',
    '2026-04-31T00:00:00Z',
    '2026-10-30T24:00:00Z',
    '2026-10-30T12:60:00Z',
    '2026-10-30T12:00:60Z',
    '2026-10-30T12:00:00',
    '2026-10-30T12:00:00+05:30',
    '2026-10-30T12:00:00.1234Z',
  ])('fails closed when validUntil is an ISO-shaped but invalid UTC timestamp: %s', (invalidValidUntil) => {
    const readiness = allApprovedReadiness();
    readiness.approvalValidityPolicy.validUntil = invalidValidUntil;
    expect(ready(rows(readiness))).toBe(false);
  });

  it('fails closed for malformed, future-dated, or unknown readiness data', () => {
    expect(ready([])).toBe(false);
    expect(ready(rows(null))).toBe(false);
    expect(ready(rows({ schemaVersion: 1 }))).toBe(false);
    expect(ready(rows({ ...allApprovedReadiness(), unexpectedApproval: 'approved' }))).toBe(false);

    const futureRecordedAt = allApprovedReadiness();
    futureRecordedAt.recordedAt = '2026-10-29T12:00:00.001Z';
    expect(ready(rows(futureRecordedAt))).toBe(false);
  });

  it('fails closed when the independently protected business or public-contact facts are not verified', () => {
    expect(ready(rows(allApprovedReadiness(), {
      business_profile: { value: { ...businessProfile(), verificationStatus: 'pending_verification' } },
    }))).toBe(false);
    expect(ready(rows(allApprovedReadiness(), {
      contact_grievance: { value: { ...contactGrievance(), isConfigured: false } },
    }))).toBe(false);
  });

  it('fails closed when protected settings are unavailable or cannot be read', async () => {
    await expect(isOrderingReady(async () => ({ data: rows(), error: { message: 'read failed' } }))).resolves.toBe(false);
    await expect(isOrderingReady(async () => { throw new Error('network unavailable'); })).resolves.toBe(false);
  });
});
