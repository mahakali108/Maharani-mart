import {
  enforceRateLimit,
  jsonError,
  jsonOk,
  logServerError,
  newRequestId,
} from '@/lib/mobile';
import { requireRetailerCommerceSession } from '@/lib/mobile/commerce-route';
import { getRetailerWalletSummary } from '@/lib/retailer/wallet';
import { createClient } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';

/**
 * GET /api/mobile/v1/wallet
 *
 * The retailer's coin/wallet balance summary. Computed from the
 * authoritative wallet ledger RPCs — never from a client-supplied balance.
 *
 * Contract: docs/NATIVE_ANDROID_API_CONTRACT.md §2.9.
 */
export async function GET(request: Request): Promise<Response> {
  const requestId = newRequestId();

  const auth = await requireRetailerCommerceSession(request, requestId, ['orders.view.own']);
  if ('response' in auth) return auth.response;

  const limited = enforceRateLimit('read.orders', request, { requestId, keySuffix: auth.session.userId });
  if (limited) return limited;

  try {
    const supabase = auth.session.supabase as unknown as Awaited<ReturnType<typeof createClient>>;
    const summary = await getRetailerWalletSummary(supabase, auth.session.userId);
    return jsonOk(
      {
        creditLimitPaise: summary.creditLimitPaise,
        outstandingPaise: summary.outstandingPaise,
        availablePaise: summary.availablePaise,
        hasConfiguredLimit: summary.hasConfiguredLimit,
        isOverLimit: summary.isOverLimit,
        allowOverdue: summary.allowOverdue,
      },
      { requestId },
    );
  } catch (cause) {
    logServerError('wallet', requestId, cause);
    return jsonError('database_unavailable', 'Your wallet could not be loaded. Please try again.', {
      status: 503,
      requestId,
    });
  }
}