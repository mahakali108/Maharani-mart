import {
  enforceRateLimit,
  jsonOk,
  logServerError,
  mobileFailureResponse,
  newRequestId,
  requireMobileRole,
  requireMobileSession,
} from '@/lib/mobile';
import { DEFAULT_MOBILE_CATALOG_FILTERS } from '@/lib/mobile/catalog';
import { loadMobileHome } from '@/lib/mobile/catalog-service';

/**
 * GET /api/mobile/v1/home
 *
 * The retailer home payload: admin-configured banners, the real category strip
 * and the first batch of the real catalogue.
 *
 * WHAT IS HERE, AND WHY IT IS ALL THERE IS
 * Banners are the rows an admin actually published, filtered by the SAME
 * scheduler the web storefront uses (`isBannerVisible`: active + area targeting
 * + the IST start/end window) and passed through `resolveBannerTarget`, which
 * only ever yields a rooted app route or an http(s) URL. An empty `banners`
 * array is a normal answer — the app then shows its own fallback. No banner id,
 * title or image is hardcoded anywhere in the client.
 * `schemes` are the admin's LIVE offers under the same rule the web home and the
 * mobile `/schemes` endpoint already use (active + inside the start/end window,
 * soonest-ending first), so the native offers rail and ticker read published
 * merchandising rather than invented copy.
 *
 * DELIBERATELY NOT HERE: the Phase E cart, checkout and order history use
 * dedicated endpoints rather than duplicating commerce data in `/home`, and the
 * Deals / Best-sellers / New-arrivals RAILS are ordinary `GET /catalog/products`
 * batches (`offers=1`, `sort=frequent`, `sort=newest`) so they stay on the one
 * priced, paginated list path. This endpoint stays a discovery-only payload.
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
    logServerError('home', requestId, cause);
    return mobileFailureResponse(
      { code: 'internal_error', status: 500, message: 'Something went wrong. Please try again.' },
      requestId
    );
  }
  if (!resolved.ok) return mobileFailureResponse(resolved.failure, requestId);

  const forbidden = requireMobileRole(resolved.session, ['retailer']);
  if (forbidden) return mobileFailureResponse(forbidden, requestId);

  try {
    const home = await loadMobileHome(resolved.session, DEFAULT_MOBILE_CATALOG_FILTERS);

    return jsonOk(
      {
        banners: home.banners,
        categories: home.categories,
        brands: home.brands,
        products: home.products,
        nextCursor: home.nextCursor,
        // The admin's live offers, in-window and active. Empty is a normal
        // answer ("no offer is running"); `schemesUnavailable` says the read
        // itself failed, so the app never reports an outage as "no offers".
        schemes: home.schemes,
        schemesUnavailable: home.schemesUnavailable,
      },
      { requestId }
    );
  } catch (cause) {
    logServerError('home', requestId, cause);
    return mobileFailureResponse(
      {
        code: 'database_unavailable',
        status: 503,
        message: 'The home screen could not be loaded. Please try again.',
      },
      requestId
    );
  }
}
