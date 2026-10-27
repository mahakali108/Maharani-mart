import { describe, expect, it, vi, beforeEach } from 'vitest';
import {
  updateBusinessProfileAction,
  updateContactGrievanceAction,
  updateMarketplaceComplianceAction,
} from '@/lib/admin/business-settings/actions';
import * as sessionModule from '@/lib/auth/session';
import * as supabaseServerModule from '@/lib/supabase/server';

describe('Super Admin Business Settings Authorization & Security Gates', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('blocks unauthenticated callers from modifying business settings', async () => {
    vi.spyOn(sessionModule, 'requireUser').mockRejectedValueOnce(new Error('Authentication required.'));

    const result = await updateBusinessProfileAction({
      legalEntityName: 'Malicious Corp',
      publicBrandName: 'Fake Mart',
      businessType: 'proprietorship',
      registrationState: 'Bihar',
      registeredAddress: 'Fake Street',
      isGstRegistered: false,
      verificationStatus: 'unverified',
      gstin: null,
      pan: null,
    });

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/Authentication required/i);
  });

  it('blocks regular Admins from modifying Super Admin business settings', async () => {
    vi.spyOn(sessionModule, 'requireUser').mockResolvedValueOnce({
      id: 'admin-user-uuid',
      role: 'admin',
      fullName: 'Regular Admin',
      phone: '+919999999999',
    } as any);

    const result = await updateBusinessProfileAction({
      legalEntityName: 'Unauthorized Update',
      publicBrandName: 'Maharani Traders',
      businessType: 'proprietorship',
      registrationState: 'Bihar',
      registeredAddress: 'Gaya, Bihar',
      isGstRegistered: false,
      verificationStatus: 'unverified',
      gstin: null,
      pan: null,
    });

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/Super Admin authorization required/i);
  });

  it('blocks Retailers from modifying contact and grievance particulars', async () => {
    vi.spyOn(sessionModule, 'requireUser').mockResolvedValueOnce({
      id: 'retailer-user-uuid',
      role: 'retailer',
      fullName: 'Retailer Shop',
      phone: '+918888888888',
    } as any);

    const result = await updateContactGrievanceAction({
      officialPhone: '+919431000000',
      supportEmail: 'retailer@hack.com',
      grievanceOfficerName: 'Rogue Officer',
      grievanceOfficerDesignation: 'Hacked',
      grievanceEmail: 'hack@hack.com',
      grievancePhone: '+919431000000',
      grievanceAddress: 'Gaya',
      acknowledgementHours: 48,
      resolutionDays: 30,
      isConfigured: true,
    });

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/Super Admin authorization required/i);
  });

  it('blocks activation of membership discounts in checkout when CA approval reference is missing', async () => {
    vi.spyOn(sessionModule, 'requireUser').mockResolvedValueOnce({
      id: 'super-admin-uuid',
      role: 'super_admin',
      fullName: 'Super Admin',
      phone: '+917777777777',
    } as any);

    const result = await updateMarketplaceComplianceAction({
      sellerFundedDiscountsAllowed: false,
      platformFundedDiscountsAllowed: true,
      productModerationRequired: true,
      membershipDiscountCheckoutActive: true, // Attempt to activate without CA reference
      caApprovalDocumentReference: '', // Missing / empty CA reference
      tcsDeductionPercent: 1.0,
    });

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/Chartered Accountant approval document reference/i);
  });

  it('fails setting update if audit logging throws an error', async () => {
    vi.spyOn(sessionModule, 'requireUser').mockResolvedValueOnce({
      id: 'super-admin-uuid',
      role: 'super_admin',
      fullName: 'Super Admin',
      phone: '+917777777777',
    } as any);

    const mockSupabase = {
      from: vi.fn((table: string) => {
        if (table === 'platform_settings') {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
            upsert: vi.fn().mockResolvedValue({ error: null }),
          };
        }
        if (table === 'super_admin_audit_logs') {
          return {
            insert: vi.fn().mockResolvedValue({ error: { message: 'Database disk full or audit write blocked' } }),
          };
        }
        return {};
      }),
    };

    vi.spyOn(supabaseServerModule, 'createClient').mockReturnValue(mockSupabase as any);

    const result = await updateBusinessProfileAction({
      legalEntityName: 'Ajay General',
      publicBrandName: 'Maharani Traders',
      businessType: 'proprietorship',
      registrationState: 'Bihar',
      registeredAddress: 'Gaya, Bihar',
      isGstRegistered: false,
      verificationStatus: 'unverified',
      gstin: null,
      pan: null,
    });

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/Audit log entry failed/i);
  });
});
