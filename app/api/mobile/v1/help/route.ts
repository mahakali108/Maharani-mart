import {
  enforceRateLimit,
  jsonError,
  jsonOk,
  logServerError,
  newRequestId,
} from '@/lib/mobile';
import { requireRetailerCommerceSession } from '@/lib/mobile/commerce-route';

export const dynamic = 'force-dynamic';

/** GET /api/mobile/v1/help — deployment-configured support contact, if set. */
export async function GET(request: Request): Promise<Response> {
  const requestId = newRequestId();
  const auth = await requireRetailerCommerceSession(request, requestId, 'orders.view.own');
  if ('response' in auth) return auth.response;
  const limited = enforceRateLimit('read.orders', request, { requestId, keySuffix: auth.session.userId });
  if (limited) return limited;

  try {
    return jsonOk({
      companyName: process.env.COMPANY_NAME?.trim() || 'Maharani Traders',
      supportPhone: process.env.COMPANY_PHONE?.trim() || null,
    }, { requestId });
  } catch (cause) {
    logServerError('help', requestId, cause);
    return jsonError('internal_error', 'Help details could not be loaded. Please try again.', {
      status: 500,
      requestId,
    });
  }
}
