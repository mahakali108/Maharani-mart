import {
  enforceRateLimit,
  failure,
  jsonError,
  jsonOk,
  logServerError,
  methodNotAllowed,
  mobileFailureResponse,
  newRequestId,
} from '@/lib/mobile';
import { createMobileAnonClient } from '@/lib/mobile/clients';

/**
 * GET /api/mobile/v1/pages/{slug}
 *
 * One published information page for the Android app (About Us, Contact, Terms,
 * Privacy Policy, grievance route, …), in a mobile-shaped body.
 *
 * Reads `public.published_page()` (0104) through the anonymous client, so:
 *   - a DRAFT is never returned; the endpoint answers `unpublished` instead
 *     (the app shows the same clean "not available" state as the website);
 *   - internal notes and owner decisions are not reachable at all;
 *   - the app has no hardcoded policy text and needs no release to pick up new
 *     wording the Super Admin publishes.
 *
 * Paragraph text may contain `[label](/path)` links; the app renders the label as
 * text and opens the path in the in-app page viewer. No HTML is sent.
 */
export const dynamic = 'force-dynamic';

export async function GET(
  request: Request,
  context: { params: Promise<{ slug: string }> },
): Promise<Response> {
  const requestId = newRequestId();
  const limited = enforceRateLimit('read.catalog', request, { requestId });
  if (limited) return limited;

  const { slug } = await context.params;
  if (!/^[a-z][a-z0-9]*(-[a-z0-9]+)*$/.test(slug)) {
    return jsonError('not_found', 'That page does not exist.', { status: 404, requestId });
  }

  try {
    const anon = createMobileAnonClient();
    const { data, error } = await anon.rpc('published_page' as never, { p_slug: slug } as never);
    if (error) {
      logServerError('page', requestId, error.message);
      return mobileFailureResponse(failure('database_unavailable'), requestId);
    }

    const record = (data ?? {}) as Record<string, unknown>;
    if (record.state === 'missing' || typeof record.state !== 'string') {
      return jsonError('not_found', 'That page does not exist.', { status: 404, requestId });
    }
    if (record.state === 'unpublished') {
      // Deliberately the `not_found` code with a machine-readable reason: the page
      // exists but is not published, and the app must show the same clean "not
      // available" state as the website without learning anything about a draft.
      return jsonError('not_found', 'This page is not available right now.', {
        status: 404,
        requestId,
        details: { slug, reason: 'unpublished' },
      });
    }

    const document = (record.page ?? {}) as Record<string, unknown>;
    const sections = Array.isArray(document.sections) ? document.sections : [];

    return jsonOk(
      {
        slug: typeof record.slug === 'string' ? record.slug : slug,
        kind: record.kind === 'legal' ? 'legal' : 'page',
        audience: record.audience === 'buyers' || record.audience === 'sellers' ? record.audience : 'everyone',
        navLabel: typeof record.nav_label === 'string' ? record.nav_label : '',
        title: typeof document.title === 'string' ? document.title : '',
        eyebrow: typeof document.eyebrow === 'string' ? document.eyebrow : null,
        intro: typeof document.intro === 'string' ? document.intro : '',
        version: typeof record.version === 'string' ? record.version : '',
        effectiveDate: typeof record.effective_date === 'string' ? record.effective_date : '',
        publishedAt: typeof record.published_at === 'string' ? record.published_at : '',
        showContactDetails: record.show_contact_details === true,
        relatedSlugs: Array.isArray(record.related_slugs) ? record.related_slugs : [],
        sections: sections.map((section) => {
          const row = section as Record<string, unknown>;
          return {
            heading: typeof row.heading === 'string' ? row.heading : '',
            paragraphs: Array.isArray(row.body) ? row.body.filter((item): item is string => typeof item === 'string') : [],
            bullets: Array.isArray(row.bullets) ? row.bullets.filter((item): item is string => typeof item === 'string') : [],
            tone: row.tone === 'highlight' ? 'highlight' : 'standard',
            imageUrl: typeof row.image_url === 'string' ? row.image_url : null,
            linkLabel: typeof row.link_label === 'string' ? row.link_label : null,
            linkHref: typeof row.link_href === 'string' ? row.link_href : null,
          };
        }),
      },
      { requestId },
    );
  } catch (cause) {
    logServerError('page', requestId, cause);
    return mobileFailureResponse(failure('internal_error'), requestId);
  }
}

export async function POST(): Promise<Response> {
  return methodNotAllowed(['GET'], newRequestId());
}
