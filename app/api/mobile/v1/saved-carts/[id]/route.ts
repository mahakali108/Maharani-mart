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
import { isSaveForLaterCartName, SAVE_FOR_LATER_CART_NAME } from '@/lib/retailer/saved-cart-constants';

export const dynamic = 'force-dynamic';

const uuidSchema = z.string().uuid();
const renameSchema = z.object({ name: z.string().trim().min(1).max(60) }).strict();

/** Rename or delete one saved cart owned by the bearer-session retailer. */
export async function PATCH(request: Request, context: { params: { id: string } }): Promise<Response> {
  const requestId = newRequestId();
  const auth = await requireRetailerCommerceSession(request, requestId, 'orders.create');
  if ('response' in auth) return auth.response;
  const limited = enforceRateLimit('write.cart', request, { requestId, keySuffix: auth.session.userId });
  if (limited) return limited;
  if (!uuidSchema.safeParse(context.params.id).success) {
    return jsonError('invalid_request', 'Saved cart id is invalid.', { status: 400, requestId });
  }
  const body = await parseJsonBody(request, renameSchema, requestId);
  if (!body.ok) return body.response;
  const name = body.data.name.replace(/\s+/g, ' ').slice(0, 60);
  if (isSaveForLaterCartName(name)) {
    return jsonError('invalid_request', 'That list name is reserved for items saved for later.', { status: 400, requestId });
  }
  try {
    const { data: existing, error: lookupError } = await auth.session.supabase.from('retailer_saved_carts')
      .select('id, name')
      .eq('id', context.params.id)
      .eq('retailer_id', auth.session.userId)
      .maybeSingle<{ id: string; name: string }>();
    if (lookupError) throw lookupError;
    if (!existing || isSaveForLaterCartName(existing.name)) {
      return jsonError('not_found', 'Saved cart not found.', { status: 404, requestId });
    }
    const { data, error } = await auth.session.supabase.from('retailer_saved_carts')
      .update({ name, updated_at: new Date().toISOString() } as unknown as never)
      .eq('id', context.params.id)
      .eq('retailer_id', auth.session.userId)
      .neq('name', SAVE_FOR_LATER_CART_NAME)
      .select('id')
      .maybeSingle<{ id: string }>();
    if (error) throw error;
    if (!data) return jsonError('not_found', 'Saved cart not found.', { status: 404, requestId });
    return jsonOk({ ok: true }, { requestId });
  } catch (cause) {
    logServerError('saved-carts.rename', requestId, cause);
    return jsonError('database_unavailable', 'The saved cart could not be renamed. Please try again.', { status: 503, requestId });
  }
}

export async function DELETE(request: Request, context: { params: { id: string } }): Promise<Response> {
  const requestId = newRequestId();
  const auth = await requireRetailerCommerceSession(request, requestId, 'orders.create');
  if ('response' in auth) return auth.response;
  const limited = enforceRateLimit('write.cart', request, { requestId, keySuffix: auth.session.userId });
  if (limited) return limited;
  if (!uuidSchema.safeParse(context.params.id).success) {
    return jsonError('invalid_request', 'Saved cart id is invalid.', { status: 400, requestId });
  }
  try {
    const { data: existing, error: lookupError } = await auth.session.supabase.from('retailer_saved_carts')
      .select('id, name')
      .eq('id', context.params.id)
      .eq('retailer_id', auth.session.userId)
      .maybeSingle<{ id: string; name: string }>();
    if (lookupError) throw lookupError;
    if (!existing || isSaveForLaterCartName(existing.name)) {
      return jsonError('not_found', 'Saved cart not found.', { status: 404, requestId });
    }
    const { data, error } = await auth.session.supabase.from('retailer_saved_carts')
      .delete()
      .eq('id', context.params.id)
      .eq('retailer_id', auth.session.userId)
      .neq('name', SAVE_FOR_LATER_CART_NAME)
      .select('id')
      .maybeSingle<{ id: string }>();
    if (error) throw error;
    if (!data) return jsonError('not_found', 'Saved cart not found.', { status: 404, requestId });
    return jsonOk({ ok: true }, { requestId });
  } catch (cause) {
    logServerError('saved-carts.delete', requestId, cause);
    return jsonError('database_unavailable', 'The saved cart could not be deleted. Please try again.', { status: 503, requestId });
  }
}
