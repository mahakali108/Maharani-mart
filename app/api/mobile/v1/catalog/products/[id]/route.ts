import {
  enforceRateLimit,
  jsonError,
  jsonOk,
  logServerError,
  mobileFailureResponse,
  newRequestId,
  requireMobileRole,
  requireMobileSession,
} from '@/lib/mobile';
import { loadMobileProductDetail } from '@/lib/mobile/catalog-service';

/**
 * GET /api/mobile/v1/catalog/products/{id}
 *
 * One product with every active pack priced for the CALLING retailer.
 *
 * `{id}` may be a product id or a pack id — the catalogue links to the variant
 * the shopper was looking at, and a pack id additionally marks that pack
 * `selected`. This mirrors the web PDP (`/retailer/catalog/[id]`) exactly, so
 * the two surfaces cannot disagree about which variant a link means.
 *
 * `404 not_found` is returned for an id that does not exist AND for one the
 * caller may not see: existence is never leaked.
 *
 * Every price here is produced by the same engine checkout uses, at each pack's
 * own MOQ. The client renders them; it never recomputes or supplies one.
 *
 * Contract: docs/NATIVE_ANDROID_API_CONTRACT.md §2.3.
 */
export const dynamic = 'force-dynamic';

export async function GET(
  request: Request,
  { params }: { params: { id: string } }
): Promise<Response> {
  const requestId = newRequestId();

  const limited = enforceRateLimit('read.catalog', request, { requestId });
  if (limited) return limited;

  let resolved;
  try {
    resolved = await requireMobileSession(request);
  } catch (cause) {
    logServerError('catalog.product', requestId, cause);
    return mobileFailureResponse(
      { code: 'internal_error', status: 500, message: 'Something went wrong. Please try again.' },
      requestId
    );
  }
  if (!resolved.ok) return mobileFailureResponse(resolved.failure, requestId);

  const { session } = resolved;
  const forbidden = requireMobileRole(session, ['retailer']);
  if (forbidden) return mobileFailureResponse(forbidden, requestId);

  try {
    const detail = await loadMobileProductDetail(session, params.id);

    if (!detail) {
      return jsonError('not_found', 'This product is no longer available.', {
        status: 404,
        requestId,
      });
    }

    return jsonOk(detail, { requestId });
  } catch (cause) {
    logServerError('catalog.product', requestId, cause);
    return mobileFailureResponse(
      {
        code: 'database_unavailable',
        status: 503,
        message: 'This product could not be loaded. Please try again.',
      },
      requestId
    );
  }
}
