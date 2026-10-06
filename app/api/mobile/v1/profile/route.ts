import { z } from 'zod';
import {
  enforceRateLimit,
  jsonError,
  jsonOk,
  logServerError,
  newRequestId,
  parseJsonBody,
} from '@/lib/mobile';
import { requireRetailerCommerceSession } from '@/lib/mobile/commerce-route';

export const dynamic = 'force-dynamic';

const profilePatchSchema = z.discriminatedUnion('section', [
  z.object({
    section: z.literal('shop'),
    shopName: z.string().trim().min(2).max(120),
    address: z.string().trim().max(500),
  }).strict(),
  z.object({
    section: z.literal('contact'),
    fullName: z.string().trim().min(2).max(120),
    phone: z.string().trim().min(10).max(15).regex(/^[0-9+\-\s]+$/),
  }).strict(),
]);

type ShopRow = {
  shop_name: string | null;
  address: string | null;
  gstin: string | null;
  status: string;
};

type ProfileRow = { full_name: string | null; phone: string | null };

/**
 * GET /api/mobile/v1/profile — the caller's own shop and contact details.
 * PATCH /api/mobile/v1/profile — updates exactly one of the two self-service
 * sections. Shop fields go through update_my_shop_profile; contact fields use
 * the caller's own profiles row. Protected finance, area, GSTIN, approval and
 * status fields are neither accepted nor writable here.
 */
export async function GET(request: Request): Promise<Response> {
  const requestId = newRequestId();
  const auth = await requireRetailerCommerceSession(request, requestId, 'orders.create');
  if ('response' in auth) return auth.response;
  const limited = enforceRateLimit('read.orders', request, { requestId, keySuffix: auth.session.userId });
  if (limited) return limited;

  try {
    const [shopResult, profileResult] = await Promise.all([
      auth.session.supabase.from('retailers')
        .select('shop_name, address, gstin, status')
        .eq('id', auth.session.userId)
        .maybeSingle<ShopRow>(),
      auth.session.supabase.from('profiles')
        .select('full_name, phone')
        .eq('id', auth.session.userId)
        .maybeSingle<ProfileRow>(),
    ]);
    if (shopResult.error || profileResult.error) throw shopResult.error ?? profileResult.error;
    if (!shopResult.data || !profileResult.data) {
      return jsonError('not_found', 'Your profile could not be found.', { status: 404, requestId });
    }
    return jsonOk({
      shopName: shopResult.data.shop_name,
      address: shopResult.data.address,
      gstin: shopResult.data.gstin,
      status: shopResult.data.status,
      fullName: profileResult.data.full_name,
      phone: profileResult.data.phone,
    }, { requestId });
  } catch (cause) {
    logServerError('profile.read', requestId, cause);
    return jsonError('database_unavailable', 'Your profile could not be loaded. Please try again.', {
      status: 503,
      requestId,
    });
  }
}

export async function PATCH(request: Request): Promise<Response> {
  const requestId = newRequestId();
  const auth = await requireRetailerCommerceSession(request, requestId, 'orders.create');
  if ('response' in auth) return auth.response;
  const limited = enforceRateLimit('write.orders', request, { requestId, keySuffix: auth.session.userId });
  if (limited) return limited;

  const body = await parseJsonBody(request, profilePatchSchema, requestId);
  if (!body.ok) return body.response;

  try {
    if (body.data.section === 'shop') {
      const rpc = auth.session.supabase as unknown as {
        rpc: (name: string, args: Record<string, unknown>) => Promise<{ error: { message: string } | null }>;
      };
      const { error } = await rpc.rpc('update_my_shop_profile', {
        p_shop_name: body.data.shopName,
        p_address: body.data.address,
      });
      if (error) {
        // The RPC validates this same shape; keep provider/database details
        // server-side and let the form show a safe, retryable message.
        logServerError('profile.shop.update', requestId, error);
        return jsonError('database_unavailable', 'Shop details could not be saved. Please try again.', {
          status: 503,
          requestId,
        });
      }
      return jsonOk({ ok: true, section: 'shop' }, { requestId });
    }

    const { error } = await auth.session.supabase.from('profiles')
      .update({ full_name: body.data.fullName, phone: body.data.phone } as unknown as never)
      .eq('id', auth.session.userId);
    if (error) throw error;
    return jsonOk({ ok: true, section: 'contact' }, { requestId });
  } catch (cause) {
    logServerError('profile.update', requestId, cause);
    return jsonError('database_unavailable', 'Contact details could not be saved. Please try again.', {
      status: 503,
      requestId,
    });
  }
}
