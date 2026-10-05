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
import { loadMobileQuickOrderProducts } from '@/lib/mobile/quick-order-service';

export const dynamic = 'force-dynamic';

/**
 * GET /api/mobile/v1/quick-order?q=…
 *
 * Quick-order search: the native screen's equivalent of the web page's search
 * box. Active products whose name matches, with every active pack priced for
 * the calling retailer at its MOQ — the same engine and the same 30-result cap
 * the web page uses.
 *
 * A term is required; an empty search answers an empty list rather than the
 * whole catalogue, because quick order is for restocking what you already know.
 */
export async function GET(request: Request): Promise<Response> {
  const requestId = newRequestId();

  const limited = enforceRateLimit('read.catalog', request, { requestId });
  if (limited) return limited;

  let resolved;
  try {
    resolved = await requireMobileSession(request);
  } catch (cause) {
    logServerError('quick_order.search', requestId, cause);
    return mobileFailureResponse(
      { code: 'internal_error', status: 500, message: 'Something went wrong. Please try again.' },
      requestId,
    );
  }
  if (!resolved.ok) return mobileFailureResponse(resolved.failure, requestId);

  const { session } = resolved;
  const forbidden = requireMobileRole(session, ['retailer']);
  if (forbidden) return mobileFailureResponse(forbidden, requestId);

  const term = new URL(request.url).searchParams.get('q') ?? '';

  try {
    const result = await loadMobileQuickOrderProducts(session, term);
    return jsonOk(result, { requestId });
  } catch (cause) {
    logServerError('quick_order.search', requestId, cause);
    return jsonError('database_unavailable', 'Product search could not be loaded. Please try again.', {
      status: 503,
      requestId,
    });
  }
}
