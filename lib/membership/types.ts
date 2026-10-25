export type MembershipTier = 'free' | 'silver' | 'gold';

export type MembershipStatus = 'active' | 'pending_payment' | 'expired' | 'cancelled';

export interface MembershipPlan {
  id: string;
  tier: MembershipTier;
  name: string;
  description: string | null;
  price_paise: number;
  duration_days: number;
  discount_percent: number;
  points_multiplier: number;
  features: string[];
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface RetailerMembership {
  id: string;
  retailer_id: string;
  plan_id: string;
  tier: MembershipTier;
  status: MembershipStatus;
  starts_at: string;
  expires_at: string | null;
  amount_paid_paise: number;
  payment_reference: string | null;
  notes: string | null;
  activated_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface ActiveMembershipInfo {
  membership_id: string;
  plan_id: string;
  tier: MembershipTier;
  status: MembershipStatus;
  starts_at: string;
  expires_at: string | null;
  discount_percent: number;
  points_multiplier: number;
  is_expired: boolean;
}

export type LoyaltyEntryType =
  | 'ORDER_EARN'
  | 'ORDER_REVERSAL'
  | 'REDEMPTION'
  | 'MANUAL_CREDIT'
  | 'MANUAL_DEBIT'
  | 'EXPIRY';

export interface LoyaltyLedgerEntry {
  id: string;
  retailer_id: string;
  points: number;
  entry_type: LoyaltyEntryType;
  reference_type: string | null;
  reference_id: string | null;
  reason: string;
  idempotency_key: string | null;
  created_by: string | null;
  created_at: string;
}
