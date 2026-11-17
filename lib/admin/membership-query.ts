import 'server-only';
import { createClient } from '@/lib/supabase/server';
import type { MembershipPlanConfig, MembershipProgramSettings } from '@/lib/membership/rules';

export interface AdminRetailerMembershipRow {
  id: string;
  retailer_id: string;
  shop_name: string;
  plan_id: string;
  tier: string;
  status: string;
  starts_at: string;
  expires_at: string | null;
  notes: string | null;
  created_at: string;
}

export interface AdminMembershipUpgradeRequestRow {
  id: string;
  retailer_id: string;
  shop_name: string;
  requested_plan_id: string;
  status: string;
  notes: string | null;
  review_note: string | null;
  created_at: string;
}

export interface AdminMembershipOverview {
  settings: MembershipProgramSettings;
  plans: MembershipPlanConfig[];
  memberships: AdminRetailerMembershipRow[];
  upgradeRequests: AdminMembershipUpgradeRequestRow[];
  counts: {
    activePlans: number;
    configuredPlans: number;
    activeRetailerMemberships: number;
    expiredRetailerMemberships: number;
    pendingUpgradeRequests: number;
  };
  failed: boolean;
  failureMessage: string | null;
}

export async function getAdminMembershipOverview(): Promise<AdminMembershipOverview> {
  const supabase = await createClient();

  const [settingsRes, plansRes, membershipsRes, requestsRes, retailersRes] = await Promise.all([
    supabase
      .from('membership_program_settings' as never)
      .select('program_enabled, live_payment_collection_enabled, owner_approval_reference, notes, updated_at')
      .eq('id', 1)
      .maybeSingle<MembershipProgramSettings>(),
    supabase
      .from('membership_plans' as never)
      .select(
        'id, tier, name, description, price_paise, duration_days, discount_percent, product_discount_percent, order_value_discount_percent, min_order_value_paise, max_discount_paise, features, eligibility_rules, expiry_behavior, grace_period_days, renewal_mode, is_active, updated_at'
      )
      .order('price_paise', { ascending: true }),
    supabase
      .from('retailer_memberships' as never)
      .select('id, retailer_id, plan_id, tier, status, starts_at, expires_at, notes, created_at')
      .order('created_at', { ascending: false })
      .limit(100),
    supabase
      .from('membership_upgrade_requests' as never)
      .select('id, retailer_id, requested_plan_id, status, notes, review_note, created_at')
      .order('created_at', { ascending: false })
      .limit(50),
    supabase
      .from('retailers')
      .select('id, shop_name')
      .limit(500),
  ]);

  if (plansRes.error) {
    return {
      settings: {
        program_enabled: false,
        live_payment_collection_enabled: false,
        owner_approval_reference: null,
        notes: null,
      },
      plans: [],
      memberships: [],
      upgradeRequests: [],
      counts: {
        activePlans: 0,
        configuredPlans: 0,
        activeRetailerMemberships: 0,
        expiredRetailerMemberships: 0,
        pendingUpgradeRequests: 0,
      },
      failed: true,
      failureMessage: plansRes.error.message,
    };
  }

  const shopById = new Map(
    ((retailersRes.data ?? []) as unknown as Array<{ id: string; shop_name: string }>).map((r) => [
      r.id,
      r.shop_name,
    ])
  );

  const plans = ((plansRes.data ?? []) as unknown as Array<Record<string, unknown>>).map((row) => ({
    id: String(row.id),
    tier: row.tier as MembershipPlanConfig['tier'],
    name: String(row.name),
    description: typeof row.description === 'string' ? row.description : null,
    price_paise: Number(row.price_paise ?? 0),
    duration_days: Number(row.duration_days ?? 365),
    discount_percent: Number(row.discount_percent ?? 0),
    product_discount_percent: Number(row.product_discount_percent ?? 0),
    order_value_discount_percent: Number(row.order_value_discount_percent ?? 0),
    min_order_value_paise: Number(row.min_order_value_paise ?? 0),
    max_discount_paise: Number(row.max_discount_paise ?? 500_000),
    features: Array.isArray(row.features) ? row.features.map(String) : [],
    eligibility_rules:
      row.eligibility_rules && typeof row.eligibility_rules === 'object'
        ? {
            requireApprovedRetailer: Boolean(
              (row.eligibility_rules as Record<string, unknown>).requireApprovedRetailer ?? true
            ),
            allowedCategories: Array.isArray(
              (row.eligibility_rules as Record<string, unknown>).allowedCategories
            )
              ? ((row.eligibility_rules as Record<string, unknown>).allowedCategories as unknown[]).map(String)
              : ['general', 'silver', 'gold'],
          }
        : { requireApprovedRetailer: true, allowedCategories: ['general', 'silver', 'gold'] },
    expiry_behavior: 'immediate_stop' as const,
    grace_period_days: 0 as const,
    renewal_mode:
      row.renewal_mode === 'disabled' ? ('disabled' as const) : ('manual_owner_approval' as const),
    is_active: Boolean(row.is_active),
    updated_at: typeof row.updated_at === 'string' ? row.updated_at : undefined,
  }));

  const nowMs = Date.now();
  const memberships: AdminRetailerMembershipRow[] = (
    (membershipsRes.data ?? []) as unknown as Array<Record<string, unknown>>
  ).map((row) => {
    const expiresAt = typeof row.expires_at === 'string' ? row.expires_at : null;
    const rawStatus = String(row.status);
    const effectiveStatus =
      rawStatus === 'active' && expiresAt !== null && new Date(expiresAt).getTime() <= nowMs
        ? 'expired'
        : rawStatus;
    return {
      id: String(row.id),
      retailer_id: String(row.retailer_id),
      shop_name: shopById.get(String(row.retailer_id)) ?? String(row.retailer_id),
      plan_id: String(row.plan_id),
      tier: String(row.tier),
      status: effectiveStatus,
      starts_at: String(row.starts_at),
      expires_at: expiresAt,
      notes: typeof row.notes === 'string' ? row.notes : null,
      created_at: String(row.created_at),
    };
  });

  const upgradeRequests: AdminMembershipUpgradeRequestRow[] = (
    (requestsRes.data ?? []) as unknown as Array<Record<string, unknown>>
  ).map((row) => ({
    id: String(row.id),
    retailer_id: String(row.retailer_id),
    shop_name: shopById.get(String(row.retailer_id)) ?? String(row.retailer_id),
    requested_plan_id: String(row.requested_plan_id),
    status: String(row.status),
    notes: typeof row.notes === 'string' ? row.notes : null,
    review_note: typeof row.review_note === 'string' ? row.review_note : null,
    created_at: String(row.created_at),
  }));

  return {
    settings: settingsRes.data
      ? {
          program_enabled: Boolean(settingsRes.data.program_enabled),
          live_payment_collection_enabled: false,
          owner_approval_reference: settingsRes.data.owner_approval_reference ?? null,
          notes: settingsRes.data.notes ?? null,
          updated_at: settingsRes.data.updated_at,
        }
      : {
          program_enabled: false,
          live_payment_collection_enabled: false,
          owner_approval_reference: null,
          notes: null,
        },
    plans,
    memberships,
    upgradeRequests,
    counts: {
      activePlans: plans.filter((p) => p.is_active).length,
      configuredPlans: plans.length,
      activeRetailerMemberships: memberships.filter((m) => m.status === 'active').length,
      expiredRetailerMemberships: memberships.filter((m) => m.status === 'expired').length,
      pendingUpgradeRequests: upgradeRequests.filter((r) => r.status === 'pending_review').length,
    },
    failed: false,
    failureMessage: null,
  };
}
