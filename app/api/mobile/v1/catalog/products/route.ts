import {
  enforceRateLimit,
  jsonError,
  jsonOkPage,
  logServerError,
  mobileFailureResponse,
  newRequestId,
  requireMobileRole,
  requireMobileSession,
} from '@/lib/mobile';
import { parseCatalogQuery } from '@/lib/mobile/catalog';
import {
  MOBILE_CATALOG_PAGE_SIZE,
  loadMobileCatalogPage,
} from '@/lib/mobile/catalog-service';
import { readContinuation } from '@/lib/infinite-scroll/keyset';

/**
 * GET /api/mobile/v1/catalog/products
 *
 * The paginated product catalogue: search, category/brand filtering, sorting and
 * an in-stock filter, priced for the CALLING retailer.
 *
 * Server-authoritative by construction:
 *   - prices come from `lib/retailer/catalog` (pack price → retailer/area
 *     override → slab tiers), returned as integer paise;
 *   - availability comes from `get_retailer_pack_availability`, so it is the
 *     two-state customer vocabulary and never an exact stock count;
 *   - identity comes from the verified bearer token. There is no `retailerId`,
 *     `areaId` or `role` parameter, and none is read from the query string.
 *
 * Pagination is the same opaque cursor the web catalogue uses
 * (`lib/infinite-scroll/keyset`): a keyset cursor when the sort is expressible
 * as SQL, an offset cursor when a per-retailer price or stock filter binds. The
 * client must not decode it; a cursor it cannot advance means "stop".
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
    logServerError('catalog.products', requestId, cause);
    return mobileFailureResponse(
      { code: 'internal_error', status: 500, message: 'Something went wrong. Please try again.' },
      requestId
    );
  }
  if (!resolved.ok) return mobileFailureResponse(resolved.failure, requestId);

  const { session } = resolved;
  const forbidden = requireMobileRole(session, ['retailer']);
  if (forbidden) return mobileFailureResponse(forbidden, requestId);

  const url = new URL(request.url);

  const parsed = parseCatalogQuery(url);
  if (!parsed.ok) {
    return jsonError('invalid_request', 'That catalogue filter is not valid.', {
      status: 400,
      details: { fields: { [parsed.field]: 'Not a valid value.' } },
      requestId,
    });
  }

  const continuation = readContinuation(url.searchParams.get('cursor'));
  if (!continuation.ok) {
    return jsonError('invalid_request', 'That page reference is no longer valid. Please reload the list.', {
      status: 400,
      details: { fields: { cursor: 'Not a valid cursor.' } },
      requestId,
    });
  }

  try {
    const batch = await loadMobileCatalogPage(session, parsed.filters, continuation.cursor);

    return jsonOkPage(
      batch.products,
      {
        nextCursor: batch.nextCursor,
        hasMore: batch.nextCursor !== null,
        // The batch size is the shared catalogue service's, not the client's:
        // the cursor is aligned to it, so it is reported rather than accepted.
        limit: MOBILE_CATALOG_PAGE_SIZE,
      },
      {
        requestId,
        meta: { resultCount: batch.resultCount, resultCapped: batch.resultCapped },
      }
    );
  } catch (cause) {
    logServerError('catalog.products', requestId, cause);
    return mobileFailureResponse(
      {
        code: 'database_unavailable',
        status: 503,
        message: 'The catalogue is temporarily unavailable. Please try again.',
      },
      requestId
    );
  }
}
