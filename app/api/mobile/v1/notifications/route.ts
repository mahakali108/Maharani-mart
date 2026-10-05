import { z } from 'zod';
import {
  enforceRateLimit,
  jsonError,
  jsonOkPage,
  logServerError,
  newRequestId,
  requireMobileSession,
} from '@/lib/mobile';
import { mobileFailureResponse } from '@/lib/mobile/auth';

export const dynamic = 'force-dynamic';

const BATCH_SIZE = 20;

const querySchema = z.object({
  cursor: z.string().nullable().default(null),
  unreadOnly: z.enum(['1']).optional(),
}).strict();

/**
 * GET /api/mobile/v1/notifications
 *
 * The retailer's own notification feed, keyset-paginated newest-first.
 * RLS scopes `notifications` to `recipient_id = auth.uid()`, so the
 * cursor can only ever walk that user's own feed.
 *
 * Contract: docs/NATIVE_ANDROID_API_CONTRACT.md §2.8.
 */
export async function GET(request: Request): Promise<Response> {
  const requestId = newRequestId();

  const limited = enforceRateLimit('read.orders', request, { requestId });
  if (limited) return limited;

  let resolved;
  try {
    resolved = await requireMobileSession(request);
  } catch (cause) {
    logServerError('notifications', requestId, cause);
    return mobileFailureResponse(
      { code: 'internal_error', status: 500, message: 'Something went wrong. Please try again.' },
      requestId,
    );
  }
  if (!resolved.ok) return mobileFailureResponse(resolved.failure, requestId);

  const url = new URL(request.url);
  const parsed = querySchema.safeParse({
    cursor: url.searchParams.get('cursor'),
    unreadOnly: url.searchParams.get('unreadOnly') ?? undefined,
  });
  if (!parsed.success) {
    return jsonError('invalid_request', 'Invalid query parameters.', { status: 400, requestId });
  }

  const { session } = resolved;
  const supabase = session.supabase;

  try {
    let query = supabase
      .from('notifications')
      .select('id, title, body, link_url, is_read, created_at')
      .eq('recipient_id', session.userId)
      .order('created_at', { ascending: false })
      .order('id', { ascending: false })
      .limit(BATCH_SIZE + 1);

    if (parsed.data.unreadOnly === '1') {
      query = query.eq('is_read', false);
    }

    if (parsed.data.cursor) {
      try {
        const decoded = JSON.parse(Buffer.from(parsed.data.cursor, 'base64').toString());
        if (decoded.created_at && decoded.id) {
          query = query.or(
            `created_at.lt.${decoded.created_at},and(created_at.eq.${decoded.created_at},id.lt.${decoded.id})`,
          );
        }
      } catch {
        // Invalid cursor: return first page
      }
    }

    const { data: rows, error } = await query;
    if (error) throw error;

    const items = (rows ?? []).slice(0, BATCH_SIZE);
    const hasMore = (rows ?? []).length > BATCH_SIZE;
    const nextRow = hasMore ? items[items.length - 1] : null;
    const nextCursor = nextRow
      ? Buffer.from(JSON.stringify({ created_at: nextRow.created_at, id: nextRow.id })).toString('base64')
      : null;

    return jsonOkPage(
      items.map((row) => ({
        id: row.id,
        title: row.title,
        body: row.body,
        linkUrl: row.link_url,
        isRead: row.is_read,
        createdAt: row.created_at,
      })),
      { nextCursor, hasMore, limit: BATCH_SIZE },
      { requestId },
    );
  } catch (cause) {
    logServerError('notifications', requestId, cause);
    return jsonError('database_unavailable', 'Notifications could not be loaded. Please try again.', {
      status: 503,
      requestId,
    });
  }
}