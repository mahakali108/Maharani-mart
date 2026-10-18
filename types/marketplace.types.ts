/**
 * Seller Marketplace local types (0062–0068).
 *
 * The generated `types/database.types.ts` is refreshed only by the repo's
 * mobile/DB pipeline and currently carries the protected bundle's pending
 * changes; new marketplace tables are therefore typed here and used through
 * the established `as never` table-cast pattern (see lib/admin/supplier-actions.ts).
 * A later types refresh can absorb these shapes into `Database`.
 */

export type SellerStatus = 'pending' | 'active' | 'rejected' | 'suspended';
export type SellerOfferModeration = 'pending' | 'approved' | 'rejected';
export type OfferFulfilmentType = 'seller' | 'maharani';
export type SubOrderStatus =
  | 'pending'
  | 'confirmed'
  | 'processing'
  | 'shipped'
  | 'delivered'
  | 'cancelled'
  | 'returned'
  | 'failed';
export type FulfilmentProfile = 'all_seller' | 'mixed' | 'all_maharani';

export interface SellerRow {
  id: string;
  business_name: string;
  gstin: string | null;
  pan: string | null;
  contact_name: string | null;
  phone: string | null;
  email: string | null;
  address_line: string | null;
  status: SellerStatus;
  rejection_reason: string | null;
  suspension_reason: string | null;
  reviewed_by: string | null;
  reviewed_at: string | null;
  suspended_by: string | null;
  suspended_at: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface SellerMemberRow {
  id: string;
  seller_id: string;
  profile_id: string;
  member_role: 'owner' | 'member';
  created_by: string | null;
  created_at: string;
}

export interface SellerOfferRow {
  id: string;
  seller_id: string;
  product_id: string;
  pack_id: string;
  fulfilment_type: OfferFulfilmentType;
  seller_sku: string | null;
  unit_price_paise: number;
  moq: number;
  stock_quantity: number | null;
  is_active: boolean;
  moderation_status: SellerOfferModeration;
  moderation_by: string | null;
  moderated_at: string | null;
  moderation_reason: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface OfferPriceFloorRow {
  id: string;
  pack_id: string;
  floor_paise: number;
  effective_from: string;
  set_by: string | null;
  note: string | null;
  created_at: string;
}

export interface SubOrderRow {
  id: string;
  parent_order_id: string;
  seller_id: string | null;
  fulfilment_type: OfferFulfilmentType;
  status: SubOrderStatus;
  sort_index: number;
  gross_paise: number;
  gst_paise: number;
  coupon_share_paise: number;
  coins_share_paise: number;
  payable_paise: number;
  commission_rate_bp: number | null;
  commission_basis: string;
  needs_admin_review: boolean;
  created_at: string;
  updated_at: string;
}

/** One line of the create_order_atomic_v2 `p_order_items` payload. */
export interface AtomicOrderItemV2 {
  pack_id: string;
  seller_offer_id: string | null;
  quantity: number;
  unit_price: number;
  gst_percent: number;
  line_total: number;
}

export interface SubOrderSnapshot {
  id: string;
  sellerId: string | null;
  fulfilmentType: OfferFulfilmentType;
  sortIndex: number;
  grossPaise: number;
  gstPaise: number;
  couponSharePaise: number;
  coinsSharePaise: number;
  payablePaise: number;
}

/** create_order_atomic_v2 response payload (superset of the v1 row). */
export interface AtomicOrderRowV2 {
  id: string;
  orderNumber: string;
  status: string;
  grandTotalPaise: number;
  coinsUsedPaise: number;
  coinsBalanceAfterPaise: number | null;
  placedAt: string;
  replayed: boolean;
  fulfilmentProfile?: FulfilmentProfile;
  subOrders?: SubOrderSnapshot[];
}
