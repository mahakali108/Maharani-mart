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
  // Deliberately empty: the registered address is an owner input. Rendering
  // "Gaya, Bihar, India" here would publish an unverified legal address.
  registeredAddress: '',
  verificationStatus: 'unverified',
  isGstRegistered: false,
  notes: 'Owner verification pending. Legal entity details require PAN/GSTIN registration certificate upload.',
};

/**
 * No invented contact identity. A placeholder phone, mailbox or officer name in
 * a fallback object is exactly what ends up published on a grievance page, so
 * every identity field starts EMPTY and the UI renders "Owner Input Required".
 * The acknowledgement/resolution targets are workflow constants, not claims
 * about the business.
 */
export const DEFAULT_CONTACT_GRIEVANCE: ContactGrievanceConfig = {
  officialPhone: '',
  supportEmail: '',
  grievanceOfficerName: '',
  grievanceOfficerDesignation: 'Grievance Redressal Officer',
  grievanceEmail: '',
  grievancePhone: '',
  grievanceAddress: '',
  acknowledgementHours: 48,
  resolutionDays: 30,
  isConfigured: false, // False until the owner stores verified contacts
};

/** Every field a published grievance contact must actually have. */
const REQUIRED_CONTACT_FIELDS = [
  'officialPhone',
  'supportEmail',
  'grievanceOfficerName',
  'grievanceEmail',
  'grievancePhone',
  'grievanceAddress',
] as const;

/**
 * Defence in depth: `isConfigured` is only honoured when every required detail
 * is actually present. A stored `isConfigured: true` with empty fields can
 * therefore never publish a blank/invalid grievance contact.
 */
function contactIsPublishable(config: ContactGrievanceConfig): boolean {
  return (
    config.isConfigured === true &&
    REQUIRED_CONTACT_FIELDS.every((field) => config[field].trim().length > 0)
  );
}

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
  const merged = { ...DEFAULT_CONTACT_GRIEVANCE, ...(data.value as Partial<ContactGrievanceConfig>) };
  return { ...merged, isConfigured: contactIsPublishable(merged) };
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
  const merged = { ...DEFAULT_MARKETPLACE_COMPLIANCE, ...(data.value as Partial<MarketplaceComplianceConfig>) };
  // Retired by migration 0083: a legacy stored `true` can never take effect.
  return { ...merged, membershipDiscountCheckoutActive: false };
}
