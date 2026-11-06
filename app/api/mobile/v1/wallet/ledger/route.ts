import { z } from 'zod';
import {
  enforceRateLimit,
  jsonError,
  jsonOkPage,
  logServerError,
  newRequestId,
} from '@/lib/mobile';
import { requireRetailerCommerceSession } from '@/lib/mobile/commerce-route';
import { getRetailerLedgerBatch, WALLET_LEDGER_BATCH_SIZE } from '@/lib/retailer/wallet';
import { readCursor } from '@/lib/infinite-scroll/keyset';
import { createClient } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';

const querySchema = z.object({
  cursor: z.string().nullable().default(null),
}).strict();

/**
 * GET /api/mobile/v1/wallet/ledger
 *
 * The retailer's wallet/coin transaction history, keyset-paginated.
 * Every row is a server-authoritative ledger entry: debits, credits,
 * reversals, adjustments.
 *
 * Contract: docs/NATIVE_ANDROID_API_CONTRACT.md §2.10.
 */
export async function GET(request: Request): Promise<Response> {
  const requestId = newRequestId();

  const auth = await requireRetailerCommerceSession(request, requestId, ['orders.view.own']);
  if ('response' in auth) return auth.response;

  const limited = enforceRateLimit('read.orders', request, { requestId, keySuffix: auth.session.userId });
  if (limited) return limited;

  const url = new URL(request.url);
  const parsed = querySchema.safeParse({
    cursor: url.searchParams.get('cursor'),
  });
  if (!parsed.success) {
    return jsonError('invalid_request', 'Invalid query parameters.', { status: 400, requestId });
  }

  try {
    const supabase = auth.session.supabase as unknown as Awaited<ReturnType<typeof createClient>>;
    const { entries, nextCursor, total } = await getRetailerLedgerBatch(
      supabase,
      auth.session.userId,
      readCursor(parsed.data.cursor),
      WALLET_LEDGER_BATCH_SIZE,
    );

    return jsonOkPage(
      entries.map((entry) => ({
        id: entry.id,
        type: entry.transaction_type,
        amountPaise: entry.amount_paise,
        direction: entry.direction,
        description: entry.description,
        reason: entry.reason,
        referenceType: entry.reference_type,
        referenceId: entry.reference_id,
        isReversed: entry.is_reversed,
        createdAt: entry.created_at,
      })),
      { nextCursor, hasMore: nextCursor !== null, limit: WALLET_LEDGER_BATCH_SIZE },
      { requestId, meta: { total } },
    );
  } catch (cause) {
    logServerError('wallet.ledger', requestId, cause);
    return jsonError('database_unavailable', 'Your coin history could not be loaded. Please try again.', {
      status: 503,
      requestId,
    });
  }
}