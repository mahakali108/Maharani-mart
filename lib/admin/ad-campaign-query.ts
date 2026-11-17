import 'server-only';
import { createClient } from '@/lib/supabase/server';
import {
  AD_PLACEMENTS,
  type AdPlacement,
  type AdProgramSettings,
  type SellerAdCampaignRow,
} from '@/lib/admin/ad-campaign-rules';

export interface AdCampaignAuditRow {
  id: string;
  campaign_id: string;
  action: string;
  previous_status: string | null;
  new_status: string | null;
  previous_payment_status: string | null;
  new_payment_status: string | null;
  reason: string | null;
  created_at: string;
}

export interface AdminAdCampaignOverview {
  settings: AdProgramSettings;
  campaigns: SellerAdCampaignRow[];
  audit: AdCampaignAuditRow[];
  failed: boolean;
  failureMessage: string | null;
}

const DEFAULT_AD_SETTINGS: AdProgramSettings = {
  seller_ads_enabled: false,
  live_payment_collection_enabled: false,
  max_active_campaigns_per_placement: 3,
  allowed_placements: [...AD_PLACEMENTS],
  owner_approval_reference: null,
  notes: null,
};

export async function getAdminAdCampaignOverview(): Promise<AdminAdCampaignOverview> {
  const supabase = await createClient();

  const [settingsRes, campaignsRes, sellersRes, auditRes] = await Promise.all([
    supabase
      .from('ad_program_settings' as never)
      .select(
        'seller_ads_enabled, live_payment_collection_enabled, max_active_campaigns_per_placement, allowed_placements, owner_approval_reference, notes, updated_at'
      )
      .eq('id', 1)
      .maybeSingle<AdProgramSettings>(),
    supabase
      .from('seller_ad_campaigns' as never)
      .select('*')
      .order('created_at', { ascending: false })
      .limit(100),
    supabase.from('sellers' as never).select('id, business_name').limit(300),
    supabase
      .from('seller_ad_campaign_audit' as never)
      .select('id, campaign_id, action, previous_status, new_status, previous_payment_status, new_payment_status, reason, created_at')
      .order('created_at', { ascending: false })
      .limit(40),
  ]);

  if (campaignsRes.error) {
    return {
      settings: DEFAULT_AD_SETTINGS,
      campaigns: [],
      audit: [],
      failed: true,
      failureMessage: campaignsRes.error.message,
    };
  }

  const sellerNameById = new Map(
    ((sellersRes.data ?? []) as unknown as Array<{ id: string; business_name: string }>).map((s) => [
      s.id,
      s.business_name,
    ])
  );

  const campaigns: SellerAdCampaignRow[] = (
    (campaignsRes.data ?? []) as unknown as SellerAdCampaignRow[]
  ).map((row) => ({
    ...row,
    budget_paise: Number(row.budget_paise ?? 0),
    seller_name: sellerNameById.get(row.seller_id) ?? row.seller_id,
  }));

  const settings: AdProgramSettings = settingsRes.data
    ? {
        seller_ads_enabled: Boolean(settingsRes.data.seller_ads_enabled),
        live_payment_collection_enabled: false,
        max_active_campaigns_per_placement: Number(
          settingsRes.data.max_active_campaigns_per_placement ?? 3
        ),
        allowed_placements: Array.isArray(settingsRes.data.allowed_placements)
          ? (settingsRes.data.allowed_placements as AdPlacement[])
          : [...AD_PLACEMENTS],
        owner_approval_reference: settingsRes.data.owner_approval_reference ?? null,
        notes: settingsRes.data.notes ?? null,
        updated_at: settingsRes.data.updated_at,
      }
    : DEFAULT_AD_SETTINGS;

  return {
    settings,
    campaigns,
    audit: (auditRes.data ?? []) as unknown as AdCampaignAuditRow[],
    failed: false,
    failureMessage: null,
  };
}

export async function getSellerOwnCampaigns(sellerId: string): Promise<{
  settings: AdProgramSettings;
  campaigns: SellerAdCampaignRow[];
  failed: boolean;
  failureMessage: string | null;
}> {
  const supabase = await createClient();
  const [settingsRes, campaignsRes] = await Promise.all([
    supabase
      .from('ad_program_settings' as never)
      .select(
        'seller_ads_enabled, live_payment_collection_enabled, max_active_campaigns_per_placement, allowed_placements, notes'
      )
      .eq('id', 1)
      .maybeSingle<AdProgramSettings>(),
    supabase
      .from('seller_ad_campaigns' as never)
      .select('*')
      .eq('seller_id', sellerId)
      .order('created_at', { ascending: false })
      .limit(50),
  ]);

  if (campaignsRes.error) {
    return {
      settings: DEFAULT_AD_SETTINGS,
      campaigns: [],
      failed: true,
      failureMessage: campaignsRes.error.message,
    };
  }

  return {
    settings: settingsRes.data
      ? {
          seller_ads_enabled: Boolean(settingsRes.data.seller_ads_enabled),
          live_payment_collection_enabled: false,
          max_active_campaigns_per_placement: Number(
            settingsRes.data.max_active_campaigns_per_placement ?? 3
          ),
          allowed_placements: Array.isArray(settingsRes.data.allowed_placements)
            ? (settingsRes.data.allowed_placements as AdPlacement[])
            : [...AD_PLACEMENTS],
          owner_approval_reference: null,
          notes: settingsRes.data.notes ?? null,
        }
      : DEFAULT_AD_SETTINGS,
    campaigns: ((campaignsRes.data ?? []) as unknown as SellerAdCampaignRow[]).map((c) => ({
      ...c,
      budget_paise: Number(c.budget_paise ?? 0),
    })),
    failed: false,
    failureMessage: null,
  };
}
