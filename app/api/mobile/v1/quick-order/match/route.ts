import { z } from 'zod';
import {
  enforceRateLimit,
  jsonError,
  jsonOk,
  logServerError,
  mobileFailureResponse,
  newRequestId,
  parseJsonBody,
  requireMobileRole,
  requireMobileSession,
} from '@/lib/mobile';
import { matchMobileBulkLines, QUICK_ORDER_MAX_BULK_LINES } from '@/lib/mobile/quick-order-service';

export const dynamic = 'force-dynamic';

const bodySchema = z
  .object({
    // The parser itself caps lines and term length; the schema only refuses a
    // payload that could never be a pasted list.
    raw: z.string().min(1).max(4000),
  })
  .strict();

/**
 * POST /api/mobile/v1/quick-order/match
 *
 * Resolve a pasted order list to real products and packs, exactly like the web
 * bulk panel: up to 20 lines, `2 x tea 250g` / `tea 250g x 24` / a bare term,
 * each answered with up to three orderable packs and a per-line error when
 * nothing matches. Prices are the server's own, for this retailer only.
 *
 * Matching never writes: the client confirms and adds through the cart
 * endpoint, which revalidates MOQ, piece steps and availability.
 */
export async function POST(request: Request): Promise<Response> {
  const requestId = newRequestId();

  const limited = enforceRateLimit('read.catalog', request, { requestId });
  if (limited) return limited;

  let resolved;
  try {
    resolved = await requireMobileSession(request);
  } catch (cause) {
    logServerError('quick_order.match', requestId, cause);
    return mobileFailureResponse(
      { code: 'internal_error', status: 500, message: 'Something went wrong. Please try again.' },
      requestId,
    );
  }
  if (!resolved.ok) return mobileFailureResponse(resolved.failure, requestId);

  const { session } = resolved;
  const forbidden = requireMobileRole(session, ['retailer']);
  if (forbidden) return mobileFailureResponse(forbidden, requestId);

  const body = await parseJsonBody(request, bodySchema, requestId);
  if (!body.ok) return body.response;

  const lines = body.data.raw.split('\n').filter((line) => line.trim().length > 0);
  if (lines.length > QUICK_ORDER_MAX_BULK_LINES) {
    return jsonError(
      'validation_failed',
      `Paste at most ${QUICK_ORDER_MAX_BULK_LINES} lines at a time.`,
      { status: 400, requestId },
    );
  }

  try {
    const result = await matchMobileBulkLines(session, body.data.raw);
    if (result.matches.length === 0) {
      return jsonError('validation_failed', 'Paste at least one line, e.g. `2 x tea 250g`.', {
        status: 400,
        requestId,
      });
    }
    return jsonOk(result, { requestId });
  } catch (cause) {
    logServerError('quick_order.match', requestId, cause);
    return jsonError('database_unavailable', 'The pasted list could not be matched. Please try again.', {
      status: 503,
      requestId,
    });
  }
}
