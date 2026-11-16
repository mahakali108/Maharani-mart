import { createClient } from '@/lib/supabase/server';
import type {
  OfferPriceFloorRow,
  SellerMemberRow,
  SellerOfferRow,
  SellerRow,
} from '@/types/marketplace.types';

export interface SellerInviteStatus {
  consumed_at: string | null;
  invitation_sent_at: string | null;
  expires_at: string;
  auth_user_id: string | null;
}

/**
 * Admin list/detail reads for the seller marketplace. RLS gives admin-or-above
 * full visibility and sellers ONLY their own rows (0062/0063); these helpers
 * run on the caller-scoped client so RLS stays the boundary.
 */

export interface SellerListParams {
  q?: string;
  status?: string;
  page?: number;
}

export const SELLERS_PER_PAGE = 20;

export function sanitizeSellerSearch(value: unknown): string {
  return typeof value === 'string' ? value.trim().slice(0, 80) : '';
}

export function parseSellerListParams(query: {
  q?: string | string[] | undefined;
  status?: string | string[] | undefined;
  page?: string | string[] | undefined;
}): Required<SellerListParams> & { status: string } {
  const statusRaw = typeof query.status === 'string' ? query.status : 'all';
  const status = ['pending', 'active', 'rejected', 'suspended', 'all'].includes(statusRaw)
    ? statusRaw
    : 'all';
  const pageRaw = typeof query.page === 'string' ? Number.parseInt(query.page, 10) : 1;
  const page = Number.isFinite(pageRaw) && pageRaw >= 1 ? Math.min(pageRaw, 10_000) : 1;
  return { q: sanitizeSellerSearch(query.q), status, page };
}

export function sellerListHref(params: Required<SellerListParams>, page: number): string {
  const search = new URLSearchParams();
  if (params.q) search.set('q', params.q);
  if (params.status !== 'all') search.set('status', params.status);
  if (page > 1) search.set('page', String(page));
  const qs = search.toString();
  return qs ? `/admin/sellers?${qs}` : '/admin/sellers';
}

/**
 * Seller directory page.
 *
 * `failed` is part of the contract on purpose: the previous version returned
 * `{ sellers: [], total: 0 }` on a query error, which the page rendered as
 * "No sellers yet" — a failed read and an empty marketplace looked identical.
 */
export async function listSellers({ q, status, page }: Required<SellerListParams>): Promise<{
  sellers: SellerRow[];
  total: number;
  failed: boolean;
  failureMessage: string | null;
}> {
  const supabase = (await createClient());
  let query = supabase
    .from('sellers' as never)
    .select('*', { count: 'exact' });

  if (status !== 'all') query = query.eq('status', status);
  if (q) {
    const like = `%${q.replace(/[%_]/g, ' ')}%`;
    query = query.or(
      `business_name.ilike.${like},contact_name.ilike.${like},phone.ilike.${like},email.ilike.${like}`
    );
  }

  const from = (page - 1) * SELLERS_PER_PAGE;
  const { data, error, count } = await query
    .order('created_at', { ascending: false })
    .range(from, from + SELLERS_PER_PAGE - 1);

  if (error) {
    return { sellers: [], total: 0, failed: true, failureMessage: error.message };
  }
  return {
    sellers: ((data ?? []) as unknown as SellerRow[]),
    total: count ?? 0,
    failed: false,
    failureMessage: null,
  };
}

export async function getSellerDetail(sellerId: string): Promise<{
  seller: SellerRow | null;
  members: SellerMemberRow[];
  offers: SellerOfferRow[];
  invite: SellerInviteStatus | null;
  /** Set when the seller row read FAILED (as opposed to returning no row). */
  failureMessage: string | null;
}> {
  const supabase = (await createClient());
  const [{ data: seller, error: sellerError }, { data: members }, { data: offers }, { data: invite }] = await Promise.all([
    supabase
      .from('sellers' as never)
      .select('*')
      .eq('id', sellerId)
      .maybeSingle(),
    supabase
      .from('seller_members' as never)
      .select('*')
      .eq('seller_id', sellerId)
      .order('created_at', { ascending: true }),
    supabase
      .from('seller_offers' as never)
      .select('*')
      .eq('seller_id', sellerId)
      .order('created_at', { ascending: false }),
    supabase
      .from('seller_account_invites' as never)
      .select('consumed_at, invitation_sent_at, expires_at, auth_user_id')
      .eq('seller_id', sellerId)
      .maybeSingle<SellerInviteStatus>(),
  ]);
  return {
    seller: (seller ?? null) as SellerRow | null,
    members: ((members ?? []) as unknown as SellerMemberRow[]),
    offers: ((offers ?? []) as unknown as SellerOfferRow[]),
    invite: invite ?? null,
    failureMessage: sellerError?.message ?? null,
  };
}

export interface OfferListParams {
  q?: string;
  moderation?: string;
  sellerId?: string | null;
  page?: number;
}

export const OFFERS_PER_PAGE = 20;

export function parseOfferListParams(query: {
  q?: string | string[] | undefined;
  moderation?: string | string[] | undefined;
  page?: string | string[] | undefined;
}): Required<OfferListParams> & { sellerId: string | null } {
  const moderationRaw = typeof query.moderation === 'string' ? query.moderation : 'all';
  const moderation = ['pending', 'approved', 'rejected', 'all'].includes(moderationRaw)
    ? moderationRaw
    : 'all';
  const pageRaw = typeof query.page === 'string' ? Number.parseInt(query.page, 10) : 1;
  const page = Number.isFinite(pageRaw) && pageRaw >= 1 ? Math.min(pageRaw, 10_000) : 1;
  return { q: sanitizeSellerSearch(query.q), moderation, page, sellerId: null };
}

export function offerListHref(
  params: Required<OfferListParams> & { sellerId: string | null },
  page: number
): string {
  const search = new URLSearchParams();
  if (params.q) search.set('q', params.q);
  if (params.moderation !== 'all') search.set('moderation', params.moderation);
  if (params.sellerId) search.set('seller', params.sellerId);
  if (page > 1) search.set('page', String(page));
  const qs = search.toString();
  return qs ? `/admin/offers?${qs}` : '/admin/offers';
}

export async function listOffers({
  q,
  moderation,
  sellerId,
  page,
}: Required<OfferListParams> & { sellerId: string | null }): Promise<{
  offers: SellerOfferRow[];
  total: number;
  /** True when the read failed — the page must not render an empty queue. */
  failed: boolean;
  failureMessage: string | null;
}> {
  const supabase = (await createClient());
  let query = supabase
    .from('seller_offers' as never)
    .select('*', { count: 'exact' });

  if (moderation !== 'all') query = query.eq('moderation_status', moderation);
  if (sellerId) query = query.eq('seller_id', sellerId);
  if (q) {
    const like = `%${q.replace(/[%_]/g, ' ')}%`;
    query = query.or(`seller_sku.ilike.${like}`);
  }

  const from = (page - 1) * OFFERS_PER_PAGE;
  const { data, error, count } = await query
    .order('created_at', { ascending: false })
    .range(from, from + OFFERS_PER_PAGE - 1);

  // Moderation is a queue with consequences: reporting a failed read as
  // "no offers to review" hides pending listings from the reviewer.
  if (error) {
    return { offers: [], total: 0, failed: true, failureMessage: error.message };
  }
  return {
    offers: ((data ?? []) as unknown as SellerOfferRow[]),
    total: count ?? 0,
    failed: false,
    failureMessage: null,
  };
}

export async function listOfferFloors(packId: string): Promise<OfferPriceFloorRow[]> {
  const supabase = (await createClient());
  const { data, error } = await supabase
    .from('offer_price_floors' as never)
    .select('*')
    .eq('pack_id', packId)
    .order('effective_from', { ascending: false });
  if (error) return [];
  return (data ?? []) as unknown as OfferPriceFloorRow[];
}

export interface SellerComplianceSummary {
  review_status: string;
  business_identity_verified: boolean;
  business_address_verified: boolean;
  business_contact_verified: boolean;
  gst_applicable: boolean;
  gstin_verified: boolean;
  settlement_verified: boolean;
  cosmetics_authorization_required: boolean;
  cosmetics_authorization_verified: boolean;
  seller_agreement_version: string | null;
  seller_agreement_accepted_at: string | null;
  reviewed_at: string | null;
  review_reason: string | null;
}

export interface SellerComplianceDocument {
  id: string;
  evidence_type: string;
  file_name: string | null;
  content_type: string | null;
  created_at: string;
}

export interface SellerOrderStats {
  totalSubOrders: number;
  deliveredSubOrders: number;
  cancelledSubOrders: number;
  pendingSubOrders: number;
  grossPaise: number;
  deliveredPayablePaise: number;
  ledgerEntryCount: number;
  ledgerNetPaise: number;
}

export interface SellerPricingPermissionSummary {
  can_set_custom_slabs: boolean;
  can_apply_discounts: boolean;
  max_discount_percent: number;
  min_moq_override: number | null;
  notes: string | null;
}

export interface SellerHistoryEvent {
  id: string;
  source: 'seller_audit' | 'offer_moderation';
  action: string;
  summary: string;
  reason: string | null;
  created_at: string;
}

/**
 * Loads real DB compliance, sub-order sales stats, ledger summary, pricing
 * permissions, and action history for `/admin/sellers/[id]`.
 */
export async function getSellerGovernanceOverview(sellerId: string): Promise<{
  compliance: SellerComplianceSummary | null;
  documents: SellerComplianceDocument[];
  stats: SellerOrderStats;
  pricingPermission: SellerPricingPermissionSummary | null;
  history: SellerHistoryEvent[];
}> {
  const supabase = await createClient();

  const [
    complianceRes,
    docsRes,
    subOrdersRes,
    ledgerRes,
    pricingPermRes,
    auditRes,
    moderationRes,
  ] = await Promise.all([
    supabase
      .from('seller_compliance_reviews' as never)
      .select(
        'review_status, business_identity_verified, business_address_verified, business_contact_verified, gst_applicable, gstin_verified, settlement_verified, cosmetics_authorization_required, cosmetics_authorization_verified, seller_agreement_version, seller_agreement_accepted_at, reviewed_at, review_reason'
      )
      .eq('seller_id', sellerId)
      .maybeSingle<SellerComplianceSummary>(),
    supabase
      .from('seller_compliance_evidence' as never)
      .select('id, evidence_type, file_name, content_type, created_at')
      .eq('seller_id', sellerId)
      .order('created_at', { ascending: false })
      .limit(50),
    supabase
      .from('sub_orders' as never)
      .select('status, gross_paise, payable_paise')
      .eq('seller_id', sellerId)
      .limit(2000),
    supabase
      .from('seller_ledger' as never)
      .select('amount_paise')
      .eq('seller_id', sellerId)
      .limit(2000),
    supabase
      .from('seller_pricing_permissions' as never)
      .select('can_set_custom_slabs, can_apply_discounts, max_discount_percent, min_moq_override, notes')
      .eq('seller_id', sellerId)
      .maybeSingle<SellerPricingPermissionSummary>(),
    supabase
      .from('audit_logs' as never)
      .select('id, action, table_name, new_data, old_data, created_at')
      .eq('table_name', 'sellers')
      .eq('record_id', sellerId)
      .order('created_at', { ascending: false })
      .limit(30),
    supabase
      .from('product_moderation_history' as never)
      .select('id, action, previous_status, new_status, reason, created_at')
      .eq('seller_id', sellerId)
      .order('created_at', { ascending: false })
      .limit(30),
  ]);

  const subOrders = ((subOrdersRes.data ?? []) as unknown as Array<{
    status: string;
    gross_paise: number | null;
    payable_paise: number | null;
  }>);

  let deliveredSubOrders = 0;
  let cancelledSubOrders = 0;
  let pendingSubOrders = 0;
  let grossPaise = 0;
  let deliveredPayablePaise = 0;

  for (const row of subOrders) {
    const gross = Number(row.gross_paise ?? 0);
    const payable = Number(row.payable_paise ?? 0);
    if (row.status === 'delivered') {
      deliveredSubOrders += 1;
      grossPaise += gross;
      deliveredPayablePaise += payable;
    } else if (row.status === 'cancelled' || row.status === 'returned' || row.status === 'failed') {
      cancelledSubOrders += 1;
    } else {
      pendingSubOrders += 1;
      grossPaise += gross;
    }
  }

  const ledgerRows = ((ledgerRes.data ?? []) as unknown as Array<{ amount_paise: number | null }>);
  const ledgerNetPaise = ledgerRows.reduce((acc, row) => acc + Number(row.amount_paise ?? 0), 0);

  const auditEvents: SellerHistoryEvent[] = ((auditRes.data ?? []) as unknown as Array<{
    id: string;
    action: string;
    old_data: Record<string, unknown> | null;
    new_data: Record<string, unknown> | null;
    created_at: string;
  }>).map((row) => {
    const oldStatus = typeof row.old_data?.status === 'string' ? row.old_data.status : null;
    const newStatus = typeof row.new_data?.status === 'string' ? row.new_data.status : null;
    const reasonVal =
      (typeof row.new_data?.suspension_reason === 'string' && row.new_data.suspension_reason) ||
      (typeof row.new_data?.rejection_reason === 'string' && row.new_data.rejection_reason) ||
      null;
    const summary =
      oldStatus && newStatus && oldStatus !== newStatus
        ? `Seller status changed: ${oldStatus} → ${newStatus}`
        : `Seller record ${row.action.toLowerCase()}`;
    return {
      id: `audit-${row.id}`,
      source: 'seller_audit',
      action: row.action,
      summary,
      reason: reasonVal,
      created_at: row.created_at,
    };
  });

  const moderationEvents: SellerHistoryEvent[] = ((moderationRes.data ?? []) as unknown as Array<{
    id: string;
    action: string;
    previous_status: string | null;
    new_status: string | null;
    reason: string | null;
    created_at: string;
  }>).map((row) => ({
    id: `mod-${row.id}`,
    source: 'offer_moderation',
    action: row.action,
    summary: `Offer ${row.action.replace(/_/g, ' ')}${row.previous_status && row.new_status ? ` (${row.previous_status} → ${row.new_status})` : ''}`,
    reason: row.reason,
    created_at: row.created_at,
  }));

  const history = [...auditEvents, ...moderationEvents]
    .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
    .slice(0, 40);

  return {
    compliance: complianceRes.error ? null : (complianceRes.data ?? null),
    documents: docsRes.error ? [] : ((docsRes.data ?? []) as unknown as SellerComplianceDocument[]),
    stats: {
      totalSubOrders: subOrders.length,
      deliveredSubOrders,
      cancelledSubOrders,
      pendingSubOrders,
      grossPaise,
      deliveredPayablePaise,
      ledgerEntryCount: ledgerRows.length,
      ledgerNetPaise,
    },
    pricingPermission: pricingPermRes.error ? null : (pricingPermRes.data ?? null),
    history,
  };
}
