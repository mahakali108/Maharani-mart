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
 * GET /api/mobile/v1/catalog/categories
 *
 * The active category tree the app's category strip renders.
 *
 * WHY THIS EXISTS: the app must not ship a hardcoded category list. An admin
 * adds or retires a category in the existing admin workspace, and the app has to
 * follow — a baked-in list would silently drift and send shoppers to categories
 * that no longer exist.
 *
 * Counts are the real active-product aggregates for the category and its active
 * children (the same scope convention the web home and the `categoryId` filter
 * use). `productCount: null` means the aggregate could not be read — it is never
 * rounded to a fake zero.
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
    logServerError('catalog.categories', requestId, cause);
    return mobileFailureResponse(
      { code: 'internal_error', status: 500, message: 'Something went wrong. Please try again.' },
      requestId
    );
  }
  if (!resolved.ok) return mobileFailureResponse(resolved.failure, requestId);

  const forbidden = requireMobileRole(resolved.session, ['retailer']);
  if (forbidden) return mobileFailureResponse(forbidden, requestId);

  try {
    const { categories } = await loadMobileTaxonomy(resolved.session);
    return jsonOk({ categories }, { requestId });
  } catch (cause) {
    logServerError('catalog.categories', requestId, cause);
    return mobileFailureResponse(
      {
        code: 'database_unavailable',
        status: 503,
        message: 'Categories could not be loaded. Please try again.',
      },
      requestId
    );
  }
}
