import 'server-only';

import type { createClient } from '@/lib/supabase/server';
import type {
  ActiveMembershipInfo,
  LoyaltyLedgerEntry,
  MembershipPlan,
  RetailerMembership,
} from './types';

export async function getAuthoritativeActiveMembership(
  supabase: ReturnType<typeof createClient>,
  retailerId: string
): Promise<{ membership: ActiveMembershipInfo | null; error: string | null }> {
  try {
    const rawClient = supabase as unknown as {
      rpc: (fn: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: { message: string } | null }>;
    };

    const { data, error } = await rawClient.rpc('get_active_retailer_membership', {
      p_retailer_id: retailerId,
    });

    if (error) {
      return { membership: null, error: error.message };
    }

    const rows = data as Array<{
      membership_id: string;
      plan_id: string;
      tier: 'free' | 'silver' | 'gold';
      status: 'active' | 'pending_payment' | 'expired' | 'cancelled';
      starts_at: string;
      expires_at: string | null;
      discount_percent: number;
      points_multiplier: number;
    }> | null;

    if (!rows || rows.length === 0) {
      return {
        membership: {
          membership_id: 'default-free',
          plan_id: 'free',
          tier: 'free',
          status: 'active',
          starts_at: new Date(0).toISOString(),
          expires_at: null,
          discount_percent: 0,
          points_multiplier: 1.0,
          is_expired: false,
        },
        error: null,
      };
    }

    const row = rows[0];
    if (!row) {
      return {
        membership: {
          membership_id: 'default-free',
          plan_id: 'free',
          tier: 'free',
          status: 'active',
          starts_at: new Date(0).toISOString(),
          expires_at: null,
          discount_percent: 0,
          points_multiplier: 1.0,
          is_expired: false,
        },
        error: null,
      };
    }
    return {
      membership: {
        membership_id: row.membership_id,
        plan_id: row.plan_id,
        tier: row.tier,
        status: row.status,
        starts_at: row.starts_at,
        expires_at: row.expires_at,
        discount_percent: Number(row.discount_percent ?? 0),
        points_multiplier: Number(row.points_multiplier ?? 1.0),
        is_expired: false,
      },
      error: null,
    };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Membership read failed';
    return { membership: null, error: msg };
  }
}

export async function listAvailableMembershipPlans(
  supabase: ReturnType<typeof createClient>
): Promise<{ plans: MembershipPlan[]; error: string | null }> {
  const { data, error } = await supabase
    .from('membership_plans' as never)
    .select('*')
    .eq('is_active', true)
    .order('price_paise', { ascending: true });

  if (error) {
    return { plans: [], error: (error as { message: string }).message };
  }

  return { plans: (data as unknown as MembershipPlan[]) ?? [], error: null };
}

export async function getRetailerMembershipHistory(
  supabase: ReturnType<typeof createClient>,
  retailerId: string
): Promise<{ history: RetailerMembership[]; error: string | null }> {
  const { data, error } = await supabase
    .from('retailer_memberships' as never)
    .select('*')
    .eq('retailer_id', retailerId)
    .order('created_at', { ascending: false });

  if (error) {
    return { history: [], error: (error as { message: string }).message };
  }

  return { history: (data as unknown as RetailerMembership[]) ?? [], error: null };
}

export async function getRetailerLoyaltyPosition(
  supabase: ReturnType<typeof createClient>,
  retailerId: string
): Promise<{ balance: number; error: string | null }> {
  const rawClient = supabase as unknown as {
    rpc: (fn: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: { message: string } | null }>;
  };

  const { data, error } = await rawClient.rpc('get_retailer_loyalty_balance', {
    p_retailer_id: retailerId,
  });

  if (error) {
    return { balance: 0, error: error.message };
  }

  return { balance: Number(data ?? 0), error: null };
}

export async function getRetailerLoyaltyLedger(
  supabase: ReturnType<typeof createClient>,
  retailerId: string,
  limit = 50
): Promise<{ entries: LoyaltyLedgerEntry[]; error: string | null }> {
  const { data, error } = await supabase
    .from('loyalty_ledger' as never)
    .select('*')
    .eq('retailer_id', retailerId)
    .order('created_at', { ascending: false })
    .limit(limit);

  if (error) {
    return { entries: [], error: (error as { message: string }).message };
  }

  return { entries: (data as unknown as LoyaltyLedgerEntry[]) ?? [], error: null };
}
