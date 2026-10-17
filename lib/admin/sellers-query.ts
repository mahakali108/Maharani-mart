import { createClient } from '@/lib/supabase/server';
import type {
  OfferPriceFloorRow,
  SellerMemberRow,
  SellerOfferRow,
  SellerRow,
} from '@/types/marketplace.types';

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

export async function listSellers({ q, status, page }: Required<SellerListParams>): Promise<{
  sellers: SellerRow[];
  total: number;
}> {
  const supabase = createClient();
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

  if (error) return { sellers: [], total: 0 };
  return {
    sellers: ((data ?? []) as unknown as SellerRow[]),
    total: count ?? 0,
  };
}

export async function getSellerDetail(sellerId: string): Promise<{
  seller: SellerRow | null;
  members: SellerMemberRow[];
  offers: SellerOfferRow[];
}> {
  const supabase = createClient();
  const [{ data: seller }, { data: members }, { data: offers }] = await Promise.all([
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
  ]);
  return {
    seller: (seller ?? null) as SellerRow | null,
    members: ((members ?? []) as unknown as SellerMemberRow[]),
    offers: ((offers ?? []) as unknown as SellerOfferRow[]),
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
}> {
  const supabase = createClient();
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

  if (error) return { offers: [], total: 0 };
  return {
    offers: ((data ?? []) as unknown as SellerOfferRow[]),
    total: count ?? 0,
  };
}

export async function listOfferFloors(packId: string): Promise<OfferPriceFloorRow[]> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from('offer_price_floors' as never)
    .select('*')
    .eq('pack_id', packId)
    .order('effective_from', { ascending: false });
  if (error) return [];
  return (data ?? []) as unknown as OfferPriceFloorRow[];
}
