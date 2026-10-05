import {
  enforceRateLimit,
  jsonOk,
  logServerError,
  newRequestId,
} from '@/lib/mobile';
import { requireRetailerCommerceSession, mobileCommerceErrorResponse } from '@/lib/mobile/commerce-route';
import { loadMobileShellCounts } from '@/lib/mobile/commerce-service';

export const dynamic = 'force-dynamic';

/**
 * GET /api/mobile/v1/shell/badges — the two counters the signed-in shell paints.
 *
 * The web retailer layout counts the caller's saved cart lines and their unread
 * notifications with two head-count queries; this endpoint is that same pair for
 * the native app, so a badge is a server fact rather than something the device
 * accumulates between screens. Only counts are returned — no cart contents, no
 * notification bodies — and both counts are owner-filtered and RLS-scoped.
 *
 * Deliberately cheap and pull-based: the app reads it when the shell appears, when
 * it resumes, and when the shopper leaves the cart or the alert feed — never on a
 * timer.
 */
export async function GET(request: Request): Promise<Response> {
  const requestId = newRequestId();
  const auth = await requireRetailerCommerceSession(request, requestId, ['orders.create', 'orders.view.own']);
  if ('response' in auth) return auth.response;
  const limited = enforceRateLimit('read.orders', request, { requestId, keySuffix: auth.session.userId });
  if (limited) return limited;

  try {
    const counts = await loadMobileShellCounts(auth.session);
    return jsonOk(counts, { requestId });
  } catch (cause) {
    logServerError('shell.badges', requestId, cause);
    return mobileCommerceErrorResponse(cause, requestId);
  }
}
