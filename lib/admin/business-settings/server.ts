import 'server-only';

import { createClient } from '@/lib/supabase/server';
import type {
  BusinessProfileConfig,
  ContactGrievanceConfig,
  MarketplaceComplianceConfig,
} from './types';

export const DEFAULT_BUSINESS_PROFILE: BusinessProfileConfig = {
  legalEntityName: 'Ajay General',
  publicBrandName: 'Maharani Traders',
  businessType: 'proprietorship',
  gstin: null,
  pan: null,
  registrationState: 'Bihar',
  registeredAddress: 'Gaya, Bihar, India',
  verificationStatus: 'pending_verification',
  isGstRegistered: false,
  notes: 'Owner verification pending. Legal entity details require PAN/GSTIN registration certificate upload.',
};

export const DEFAULT_CONTACT_GRIEVANCE: ContactGrievanceConfig = {
  officialPhone: '+91 9400000000',
  supportEmail: 'support@maharanitraders.com',
  grievanceOfficerName: 'Grievance Officer',
  grievanceOfficerDesignation: 'Grievance Redressal Officer',
  grievanceEmail: 'grievance@maharanitraders.com',
  grievancePhone: '+91 9400000000',
  grievanceAddress: 'Gaya Hub, Bihar, India',
  acknowledgementHours: 48,
  resolutionDays: 30,
  isConfigured: false, // Flagged false until owner fills in verified contacts
};

export const DEFAULT_MARKETPLACE_COMPLIANCE: MarketplaceComplianceConfig = {
  sellerFundedDiscountsAllowed: false,
  platformFundedDiscountsAllowed: true,
  productModerationRequired: true,
  membershipDiscountCheckoutActive: false, // Strictly false until written CA approval
  caApprovalDocumentReference: null,
  tcsDeductionPercent: 1.0,
};

interface SettingRow {
  value: Record<string, unknown>;
}

/** Load authoritative business profile from platform_settings or fallback */
export async function getAuthoritativeBusinessProfile(): Promise<BusinessProfileConfig> {
  const supabase = createClient();
  const { data } = await supabase
    .from('platform_settings' as never)
    .select('value')
    .eq('key', 'business_profile')
    .maybeSingle<SettingRow>();

  if (!data?.value || typeof data.value !== 'object') {
    return DEFAULT_BUSINESS_PROFILE;
  }
  return { ...DEFAULT_BUSINESS_PROFILE, ...(data.value as Partial<BusinessProfileConfig>) };
}

/** Load authoritative contact and grievance details */
export async function getAuthoritativeContactGrievance(): Promise<ContactGrievanceConfig> {
  const supabase = createClient();
  const { data } = await supabase
    .from('platform_settings' as never)
    .select('value')
    .eq('key', 'contact_grievance')
    .maybeSingle<SettingRow>();

  if (!data?.value || typeof data.value !== 'object') {
    return DEFAULT_CONTACT_GRIEVANCE;
  }
  return { ...DEFAULT_CONTACT_GRIEVANCE, ...(data.value as Partial<ContactGrievanceConfig>) };
}

/** Load authoritative marketplace compliance settings */
export async function getAuthoritativeMarketplaceCompliance(): Promise<MarketplaceComplianceConfig> {
  const supabase = createClient();
  const { data } = await supabase
    .from('platform_settings' as never)
    .select('value')
    .eq('key', 'marketplace_compliance')
    .maybeSingle<SettingRow>();

  if (!data?.value || typeof data.value !== 'object') {
    return DEFAULT_MARKETPLACE_COMPLIANCE;
  }
  return { ...DEFAULT_MARKETPLACE_COMPLIANCE, ...(data.value as Partial<MarketplaceComplianceConfig>) };
}
