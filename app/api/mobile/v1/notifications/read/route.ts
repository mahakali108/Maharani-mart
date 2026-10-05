import { z } from 'zod';
import {
  enforceRateLimit,
  jsonError,
  jsonOk,
  logServerError,
  newRequestId,
  requireMobileSession,
} from '@/lib/mobile';
import { mobileFailureResponse } from '@/lib/mobile/auth';

export const dynamic = 'force-dynamic';

const bodySchema = z.object({
  ids: z.array(z.string().uuid()).min(1).max(100),
}).strict();

/**
 * POST /api/mobile/v1/notifications/read
 *
 * Mark one or more notifications as read. RLS ensures the caller
 * can only update their own notifications.
 */
export async function POST(request: Request): Promise<Response> {
  const requestId = newRequestId();

  const limited = enforceRateLimit('write.orders', request, { requestId });
  if (limited) return limited;

  let resolved;
  try {
    resolved = await requireMobileSession(request);
  } catch (cause) {
    logServerError('notifications.read', requestId, cause);
    return mobileFailureResponse(
      { code: 'internal_error', status: 500, message: 'Something went wrong. Please try again.' },
      requestId,
    );
  }
  if (!resolved.ok) return mobileFailureResponse(resolved.failure, requestId);

  let body;
  try {
    const raw = await request.text();
    const parsed = JSON.parse(raw || '{}');
    const result = bodySchema.safeParse(parsed);
    if (!result.success) {
      return jsonError('validation_failed', 'Please provide notification IDs.', {
        status: 400,
        requestId,
      });
    }
    body = result.data;
  } catch {
    return jsonError('invalid_json', 'The request body is not valid JSON.', {
      status: 400,
      requestId,
    });
  }

  const { session } = resolved;
  const supabase = session.supabase;

  try {
    const { error } = await supabase
      .from('notifications')
      .update({ is_read: true })
      .eq('recipient_id', session.userId)
      .in('id', body.ids);

    if (error) throw error;
    return jsonOk({ marked: body.ids.length }, { requestId });
  } catch (cause) {
    logServerError('notifications.read', requestId, cause);
    return jsonError('database_unavailable', 'Notifications could not be updated. Please try again.', {
      status: 503,
      requestId,
    });
  }
}