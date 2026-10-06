import { z } from 'zod';
import {
  enforceRateLimit,
  jsonError,
  jsonOk,
  logServerError,
  newRequestId,
  parseJsonBody,
} from '@/lib/mobile';
import { requireRetailerCommerceSession } from '@/lib/mobile/commerce-route';

export const dynamic = 'force-dynamic';

const requestSchema = z.object({
  requestType: z.enum(['account_deletion', 'data_export']),
  note: z.string().trim().max(500).default(''),
}).strict();

type AccountRequestRow = {
  id: string;
  request_type: 'account_deletion' | 'data_export';
  status: 'submitted' | 'reviewing' | 'completed' | 'rejected';
  created_at: string;
};

/** Recent account export/deletion requests; all rows are caller-owned and staff-reviewed. */
export async function GET(request: Request): Promise<Response> {
  const requestId = newRequestId();
  const auth = await requireRetailerCommerceSession(request, requestId, 'orders.create');
  if ('response' in auth) return auth.response;
  const limited = enforceRateLimit('read.orders', request, { requestId, keySuffix: auth.session.userId });
  if (limited) return limited;
  try {
    const { data, error } = await auth.session.supabase.from('retailer_account_requests')
      .select('id, request_type, status, created_at')
      .eq('retailer_id', auth.session.userId)
      .order('created_at', { ascending: false })
      .limit(5)
      .returns<AccountRequestRow[]>();
    if (error) throw error;
    return jsonOk({ requests: (data ?? []).map((row) => ({
      id: row.id,
      requestType: row.request_type,
      status: row.status,
      createdAt: row.created_at,
    })) }, { requestId });
  } catch (cause) {
    logServerError('account.requests.list', requestId, cause);
    return jsonError('database_unavailable', 'Your account requests could not be loaded. Please try again.', { status: 503, requestId });
  }
}

/** Record a staff-reviewed request. Never deletes or exports the account immediately. */
export async function POST(request: Request): Promise<Response> {
  const requestId = newRequestId();
  const auth = await requireRetailerCommerceSession(request, requestId, 'orders.create');
  if ('response' in auth) return auth.response;
  const limited = enforceRateLimit('write.orders', request, { requestId, keySuffix: auth.session.userId });
  if (limited) return limited;
  const body = await parseJsonBody(request, requestSchema, requestId);
  if (!body.ok) return body.response;

  try {
    const { data, error } = await auth.session.supabase.from('retailer_account_requests').insert({
      retailer_id: auth.session.userId,
      request_type: body.data.requestType,
      note: body.data.note || null,
    } as unknown as never).select('id, request_type, status, created_at').maybeSingle<AccountRequestRow>();
    if (error || !data) throw error ?? new Error('Missing account request row.');
    return jsonOk({
      id: data.id,
      requestType: data.request_type,
      status: data.status,
      createdAt: data.created_at,
    }, { requestId });
  } catch (cause) {
    logServerError('account.requests.create', requestId, cause);
    return jsonError('database_unavailable', 'Your request could not be submitted. Please try again.', { status: 503, requestId });
  }
}
