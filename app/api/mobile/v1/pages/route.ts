import {
  enforceRateLimit,
  failure,
  jsonOk,
  logServerError,
  methodNotAllowed,
  mobileFailureResponse,
  newRequestId,
} from '@/lib/mobile';
import { createMobileAnonClient } from '@/lib/mobile/clients';

/**
 * GET /api/mobile/v1/pages
 *
 * The published information pages (About, Contact and every policy) for the
 * Android app. Public: the app must be able to show the Terms, Privacy Policy and
 * grievance route before anyone signs in, exactly like the website does.
 *
 * Source of truth is `public.published_pages()` (migration 0104), the same
 * function the website calls, so the app can never drift from the website. Only
 * PUBLISHED pages are returned; a draft, an internal note or an owner decision is
 * unreachable from an anonymous caller.
 *
 * Contract: added to docs/NATIVE_ANDROID_API_CONTRACT.md §2.4.1.
 */
export const dynamic = 'force-dynamic';

export async function GET(request: Request): Promise<Response> {
  const requestId = newRequestId();
  const limited = enforceRateLimit('read.catalog', request, { requestId });
  if (limited) return limited;

  try {
    const anon = createMobileAnonClient();
    const { data, error } = await anon.rpc('published_pages' as never);
    if (error) {
      logServerError('pages', requestId, error.message);
      return mobileFailureResponse(failure('database_unavailable'), requestId);
    }
    const pages = Array.isArray(data) ? data : [];
    return jsonOk(
      {
        pages: pages.map((page) => {
          const row = page as Record<string, unknown>;
          return {
            slug: typeof row.slug === 'string' ? row.slug : '',
            kind: row.kind === 'legal' ? 'legal' : 'page',
            audience: row.audience === 'buyers' || row.audience === 'sellers' ? row.audience : 'everyone',
            navLabel: typeof row.nav_label === 'string' ? row.nav_label : '',
            shortLabel: typeof row.short_label === 'string' ? row.short_label : null,
            title: typeof row.title === 'string' ? row.title : '',
            summary: typeof row.summary === 'string' ? row.summary : null,
            version: typeof row.version === 'string' ? row.version : '',
            effectiveDate: typeof row.effective_date === 'string' ? row.effective_date : '',
          };
        }),
      },
      { requestId },
    );
  } catch (cause) {
    logServerError('pages', requestId, cause);
    return mobileFailureResponse(failure('internal_error'), requestId);
  }
}

export async function POST(): Promise<Response> {
  return methodNotAllowed(['GET'], newRequestId());
}
