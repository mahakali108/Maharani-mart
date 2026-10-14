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
import { loadMobileSearchSuggestions } from '@/lib/mobile/search-service';

/**
 * GET /api/mobile/v1/catalog/search?q=…
 *
 * Cross-entity search suggestions: PRODUCTS (by name or product barcode), PACKS
 * (by pack name or pack barcode, folded onto their parent product), BRANDS and
 * CATEGORIES — the same four reads the web storefront's own suggestion loader
 * runs (`lib/retailer/search-actions.ts`), answered to the bearer-token app.
 *
 * WHY A SEPARATE ENDPOINT AND NOT `?q=` ON `/catalog/products`
 * `/catalog/products` returns PRICED, PAGINATED catalogue rows: it is the result
 * list. This endpoint returns navigation targets — ids and names only — so the
 * app can offer "Brand: X" and "Category: Y" while the shopper types, and can
 * find a product by the barcode printed on a sachet. Mixing the two would either
 * price rows the shopper only wanted as a suggestion, or drop the taxonomy the
 * storefront does offer.
 *
 * SAFETY / HONESTY
 *   - identity comes from the verified bearer session; there is no retailer, area
 *     or role parameter, and every query runs under the caller's own RLS;
 *   - the term is sanitized by the catalogue's own `sanitizeSearchTerm` before it
 *     reaches a query, so `%`, `_` and quotes cannot widen an `ilike`;
 *   - a term shorter than two characters answers `searched: false` with empty
 *     lists — a normal answer, not an error;
 *   - a FAILED read answers 503 `database_unavailable` with a retry, never an
 *     empty list. "No match" and "the read did not happen" stay distinguishable;
 *   - no price, stock or MOQ crosses this boundary. Opening a suggestion loads
 *     the priced row, so a suggestion can never quote a stale number.
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
    logServerError('catalog.search', requestId, cause);
    return mobileFailureResponse(
      { code: 'internal_error', status: 500, message: 'Something went wrong. Please try again.' },
      requestId
    );
  }
  if (!resolved.ok) return mobileFailureResponse(resolved.failure, requestId);

  const forbidden = requireMobileRole(resolved.session, ['retailer']);
  if (forbidden) return mobileFailureResponse(forbidden, requestId);

  const url = new URL(request.url);
  const rawQuery = url.searchParams.get('q') ?? '';

  try {
    const suggestions = await loadMobileSearchSuggestions(resolved.session, rawQuery);
    return jsonOk(suggestions, { requestId });
  } catch (cause) {
    logServerError('catalog.search', requestId, cause);
    return jsonError('database_unavailable', 'Search could not be loaded. Please try again.', {
      status: 503,
      requestId,
    });
  }
}
