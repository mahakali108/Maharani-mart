import { z } from 'zod';
import {
  enforceRateLimit,
  jsonError,
  jsonOk,
  logServerError,
  newRequestId,
  requireMobileSession,
} from '@/lib/mobile';
import { mobileFailureResponse } from '@/lib/mobile/auth';

export const dynamic = 'force-dynamic';

/**
 * GET /api/mobile/v1/favorites
 *
 * The retailer's favorite product IDs. RLS scopes favorites to the
 * authenticated user only.
 */
export async function GET(request: Request): Promise<Response> {
  const requestId = newRequestId();

  const limited = enforceRateLimit('read.catalog', request, { requestId });
  if (limited) return limited;

  let resolved;
  try {
    resolved = await requireMobileSession(request);
  } catch (cause) {
    logServerError('favorites', requestId, cause);
    return mobileFailureResponse(
      { code: 'internal_error', status: 500, message: 'Something went wrong. Please try again.' },
      requestId,
    );
  }
  if (!resolved.ok) return mobileFailureResponse(resolved.failure, requestId);

  const { session } = resolved;

  try {
    const { data, error } = await session.supabase
      .from('retailer_favorites')
      .select('product_id')
      .eq('retailer_id', session.userId);

    if (error) throw error;

    return jsonOk(
      { productIds: (data ?? []).map((row: { product_id: string }) => row.product_id) },
      { requestId },
    );
  } catch (cause) {
    logServerError('favorites', requestId, cause);
    return jsonError('database_unavailable', 'Your favourites could not be loaded.', {
      status: 503,
      requestId,
    });
  }
}

const toggleSchema = z.object({
  productId: z.string().uuid(),
}).strict();

/**
 * POST /api/mobile/v1/favorites — toggle a product as favorite.
 * If already favorited, removes it; otherwise adds it.
 * Returns the new favorite state.
 */
export async function POST(request: Request): Promise<Response> {
  const requestId = newRequestId();

  const limited = enforceRateLimit('write.orders', request, { requestId });
  if (limited) return limited;

  let resolved;
  try {
    resolved = await requireMobileSession(request);
  } catch (cause) {
    logServerError('favorites.toggle', requestId, cause);
    return mobileFailureResponse(
      { code: 'internal_error', status: 500, message: 'Something went wrong. Please try again.' },
      requestId,
    );
  }
  if (!resolved.ok) return mobileFailureResponse(resolved.failure, requestId);

  let body;
  try {
    const raw = await request.text();
    const parsed = JSON.parse(raw || '{}');
    const result = toggleSchema.safeParse(parsed);
    if (!result.success) {
      return jsonError('validation_failed', 'Please provide a product ID.', {
        status: 400,
        requestId,
      });
    }
    body = result.data;
  } catch {
    return jsonError('invalid_json', 'The request body is not valid JSON.', {
      status: 400,
      requestId,
    });
  }

  const { session } = resolved;

  try {
    // Check if already favorited
    const { data: existing } = await session.supabase
      .from('retailer_favorites')
      .select('product_id')
      .eq('retailer_id', session.userId)
      .eq('product_id', body.productId)
      .maybeSingle();

    if (existing) {
      // Remove favorite
      const { error } = await session.supabase
        .from('retailer_favorites')
        .delete()
        .eq('retailer_id', session.userId)
        .eq('product_id', body.productId);
      if (error) throw error;
      return jsonOk({ isFavorite: false }, { requestId });
    } else {
      // Add favorite
      const { error } = await session.supabase
        .from('retailer_favorites')
        .insert({ retailer_id: session.userId, product_id: body.productId });
      if (error) throw error;
      return jsonOk({ isFavorite: true }, { requestId });
    }
  } catch (cause) {
    logServerError('favorites.toggle', requestId, cause);
    return jsonError('database_unavailable', 'Your favourite could not be updated.', {
      status: 503,
      requestId,
    });
  }
}