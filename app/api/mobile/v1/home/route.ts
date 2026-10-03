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
 *
 * DELIBERATELY NOT HERE (later phases, so they are not faked now): cart summary
 * and coin balance (Phase E/F), recent orders and reorders (Phase E), schemes
 * (Phase F). The web home remains the source of truth for those until they ship.
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
