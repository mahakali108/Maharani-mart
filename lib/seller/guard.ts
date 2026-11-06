import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { requireUser } from '@/lib/auth/session';

export type SessionUser = Awaited<ReturnType<typeof requireUser>>;

export interface SellerTenant {
  id: string;
  business_name: string;
  gstin: string | null;
  pan: string | null;
  contact_name: string | null;
  phone: string | null;
  email: string | null;
  address_line: string | null;
  status: 'pending' | 'active' | 'rejected' | 'suspended';
  rejection_reason: string | null;
  suspension_reason: string | null;
  reviewed_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface SellerSessionContext {
  user: SessionUser;
  seller: SellerTenant;
  memberRole: 'owner' | 'member';
}

const SELLER_COLUMNS =
  'id, business_name, gstin, pan, contact_name, phone, email, address_line, status, rejection_reason, suspension_reason, reviewed_at, created_at, updated_at';

async function loadSellerForUser(userId: string): Promise<{
  seller: SellerTenant;
  memberRole: 'owner' | 'member';
} | null> {
  const supabase = (await createClient());
  const { data: membership } = await supabase
    .from('seller_members' as never)
    .select('seller_id, member_role')
    .eq('profile_id', userId)
    .maybeSingle<{ seller_id: string; member_role: 'owner' | 'member' }>();

  if (!membership?.seller_id) return null;

  const { data: seller } = await supabase
    .from('sellers' as never)
    .select(SELLER_COLUMNS)
    .eq('id', membership.seller_id)
    .maybeSingle<SellerTenant>();

  if (!seller) return null;
  return { seller, memberRole: membership.member_role };
}

/**
 * Page-level guard for `/seller/*` routes. Redirects non-sellers or
 * profiles without a seller membership to `/unauthorized`.
 */
export async function requireSellerPage({ allowInactive = false }: { allowInactive?: boolean } = {}): Promise<SellerSessionContext> {
  const user = await requireUser();
  if (user.role !== 'seller') {
    redirect('/unauthorized');
  }
  const loaded = await loadSellerForUser(user.id);
  if (!loaded) {
    redirect('/unauthorized');
  }
  if (!allowInactive && loaded.seller.status !== 'active') {
    redirect('/seller/status');
  }
  return { user, ...loaded };
}

/**
 * Server Action guard for seller self-service actions (e.g. profile update).
 * Throws a readable error when unauthorized.
 */
export async function requireSeller(): Promise<SellerSessionContext> {
  const user = await requireUser();
  if (user.role !== 'seller') {
    throw new Error('Seller authorization required.');
  }
  const loaded = await loadSellerForUser(user.id);
  if (!loaded) {
    throw new Error('Seller membership not found.');
  }
  return { user, ...loaded };
}

/**
 * Server Action guard for active trading actions (offers, tiers, stock,
 * sub-order fulfilment). Throws when the seller account is pending,
 * rejected, or suspended.
 */
export async function requireActiveSeller(): Promise<SellerSessionContext> {
  const ctx = await requireSeller();
  if (ctx.seller.status !== 'active') {
    throw new Error('Your seller account must be approved and active to perform this action.');
  }
  return ctx;
}
