export const AD_PLACEMENTS = [
  'homepage_hero',
  'homepage_strip',
  'category_banner',
  'catalog_spotlight',
] as const;

export type AdPlacement = (typeof AD_PLACEMENTS)[number];

export const AD_PLACEMENT_LABELS: Record<AdPlacement, string> = {
  homepage_hero: 'Homepage Hero Carousel',
  homepage_strip: 'Homepage Promo Strip',
  category_banner: 'Category Page Banner',
  catalog_spotlight: 'Catalog Spotlight Slot',
};

export const AD_PAYMENT_STATUSES = [
  'unpaid',
  'pending_verification',
  'verified_offline',
  'waived',
  'refunded',
] as const;

export type AdPaymentStatus = (typeof AD_PAYMENT_STATUSES)[number];

export const AD_APPROVAL_STATUSES = [
  'draft',
  'pending_approval',
  'approved',
  'rejected',
  'paused',
  'ended',
] as const;

export type AdApprovalStatus = (typeof AD_APPROVAL_STATUSES)[number];

export interface AdProgramSettings {
  seller_ads_enabled: boolean;
  live_payment_collection_enabled: false;
  max_active_campaigns_per_placement: number;
  allowed_placements: AdPlacement[];
  owner_approval_reference: string | null;
  notes: string | null;
  updated_at?: string;
}

export interface SellerAdCampaignRow {
  id: string;
  seller_id: string;
  seller_name?: string;
  title: string;
  headline: string | null;
  artwork_url: string;
  destination_url: string | null;
  placement: AdPlacement;
  starts_at: string;
  ends_at: string;
  budget_paise: number;
  payment_status: AdPaymentStatus;
  payment_reference: string | null;
  approval_status: AdApprovalStatus;
  is_active: boolean;
  rejection_reason: string | null;
  reviewed_at: string | null;
  created_at: string;
}

export function isSafeCampaignUrl(raw: string): boolean {
  const trimmed = raw.trim();
  if (trimmed.length === 0 || trimmed.length > 1000) return false;
  if (trimmed.startsWith('/')) {
    return !trimmed.startsWith('//');
  }
  try {
    const parsed = new URL(trimmed);
    return parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

export function validateAdCampaignProposalInput(input: {
  title: string;
  headline?: string | null;
  artworkUrl: string;
  destinationUrl?: string | null;
  placement: string;
  startsAt: string;
  endsAt: string;
  budgetRupees: number;
}):
  | {
      ok: true;
      value: {
        title: string;
        headline: string | null;
        artwork_url: string;
        destination_url: string | null;
        placement: AdPlacement;
        starts_at: string;
        ends_at: string;
        budget_paise: number;
      };
    }
  | { ok: false; error: string } {
  const title = input.title.trim();
  if (title.length < 2 || title.length > 140) {
    return { ok: false, error: 'Campaign title must be between 2 and 140 characters.' };
  }
  const headline = (input.headline ?? '').trim().slice(0, 240) || null;
  const artworkUrl = input.artworkUrl.trim();
  if (!isSafeCampaignUrl(artworkUrl) || artworkUrl.length < 5) {
    return { ok: false, error: 'Artwork URL must be a valid https:// URL or relative site path.' };
  }
  const destRaw = (input.destinationUrl ?? '').trim();
  if (destRaw && !isSafeCampaignUrl(destRaw)) {
    return { ok: false, error: 'Destination link must be a valid https:// URL or relative site path.' };
  }
  if (!AD_PLACEMENTS.includes(input.placement as AdPlacement)) {
    return { ok: false, error: 'Select a valid advertisement placement.' };
  }
  const startDate = new Date(input.startsAt);
  const endDate = new Date(input.endsAt);
  if (Number.isNaN(startDate.getTime()) || Number.isNaN(endDate.getTime())) {
    return { ok: false, error: 'Enter valid start and end dates for the campaign.' };
  }
  if (endDate.getTime() <= startDate.getTime()) {
    return { ok: false, error: 'Campaign end date must be after the start date.' };
  }
  if (!Number.isFinite(input.budgetRupees) || input.budgetRupees < 0 || input.budgetRupees > 10_000_000) {
    return { ok: false, error: 'Planned budget must be between ₹0 and ₹1,00,00,000.' };
  }

  return {
    ok: true,
    value: {
      title,
      headline,
      artwork_url: artworkUrl,
      destination_url: destRaw || null,
      placement: input.placement as AdPlacement,
      starts_at: startDate.toISOString(),
      ends_at: endDate.toISOString(),
      budget_paise: Math.round(input.budgetRupees * 100),
    },
  };
}

export function validateAdProgramRulesInput(input: {
  maxActivePerPlacement: number;
  allowedPlacements: string[];
  notes?: string | null;
}):
  | {
      ok: true;
      value: {
        max_active_campaigns_per_placement: number;
        allowed_placements: AdPlacement[];
        notes: string | null;
      };
    }
  | { ok: false; error: string } {
  if (
    !Number.isInteger(input.maxActivePerPlacement) ||
    input.maxActivePerPlacement < 1 ||
    input.maxActivePerPlacement > 20
  ) {
    return { ok: false, error: 'Max active campaigns per placement must be between 1 and 20.' };
  }
  const allowedPlacements = Array.from(
    new Set(input.allowedPlacements.filter((p): p is AdPlacement => AD_PLACEMENTS.includes(p as AdPlacement)))
  );
  if (allowedPlacements.length === 0) {
    return { ok: false, error: 'Keep at least one allowed placement selected.' };
  }
  return {
    ok: true,
    value: {
      max_active_campaigns_per_placement: input.maxActivePerPlacement,
      allowed_placements: allowedPlacements,
      notes: (input.notes ?? '').trim().slice(0, 1000) || null,
    },
  };
}

export function mapAdCampaignDbError(message: string): string | null {
  if (/SELLER_ADS_DISABLED/.test(message)) {
    return 'Paid seller advertisements are disabled pending explicit owner approval. Campaigns cannot be approved or activated yet.';
  }
  if (/AD_PLACEMENT_CAP_EXCEEDED/.test(message)) {
    return 'This placement already has the maximum allowed active campaigns.';
  }
  if (/AD_PLACEMENT_NOT_ALLOWED/.test(message)) {
    return 'This advertisement placement is disabled in Super Admin ad program rules.';
  }
  return null;
}
