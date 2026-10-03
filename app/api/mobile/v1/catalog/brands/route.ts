import {
  enforceRateLimit,
  jsonOk,
  logServerError,
  mobileFailureResponse,
  newRequestId,
  requireMobileRole,
  requireMobileSession,
} from '@/lib/mobile';
import { loadMobileTaxonomy } from '@/lib/mobile/catalog-service';

/**
 * GET /api/mobile/v1/catalog/brands
 *
 * The active brands, for the catalogue's brand filter. Same reasoning as the
 * categories endpoint: real master data, read under the caller's own token, so
 * the app never carries a brand list of its own.
 *
 * Contract: docs/NATIVE_ANDROID_API_CONTRACT.md §2.3.
 */
export const dynamic = 'force-dynamic';

export async function GET(request: Request): Promise<Response> {
  const requestId = newRequestId();

  const limited = enforceRateLimit('read.catalog', request, { requestId });
  if (limited) return limited;

  let resolved;
  try {
    resolved = await requireMobileSession(request);
  } catch (cause) {
    logServerError('catalog.brands', requestId, cause);
    return mobileFailureResponse(
      { code: 'internal_error', status: 500, message: 'Something went wrong. Please try again.' },
      requestId
    );
  }
  if (!resolved.ok) return mobileFailureResponse(resolved.failure, requestId);

  const forbidden = requireMobileRole(resolved.session, ['retailer']);
  if (forbidden) return mobileFailureResponse(forbidden, requestId);

  try {
    const { brands } = await loadMobileTaxonomy(resolved.session);
    return jsonOk({ brands }, { requestId });
  } catch (cause) {
    logServerError('catalog.brands', requestId, cause);
    return mobileFailureResponse(
      {
        code: 'database_unavailable',
        status: 503,
        message: 'Brands could not be loaded. Please try again.',
      },
      requestId
    );
  }
}
