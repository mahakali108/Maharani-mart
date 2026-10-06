import {
  enforceRateLimit,
  jsonError,
  jsonOk,
  logServerError,
  newRequestId,
} from '@/lib/mobile';
import { requireRetailerCommerceSession } from '@/lib/mobile/commerce-route';

export const dynamic = 'force-dynamic';

type SchemeRow = {
  id: string;
  name: string;
  description: string | null;
  is_festival: boolean;
  starts_at: string;
  ends_at: string;
};

/** GET /api/mobile/v1/schemes — the same active/in-window rows as the PWA. */
export async function GET(request: Request): Promise<Response> {
  const requestId = newRequestId();
  const auth = await requireRetailerCommerceSession(request, requestId, 'orders.view.own');
  if ('response' in auth) return auth.response;
  const limited = enforceRateLimit('read.orders', request, { requestId, keySuffix: auth.session.userId });
  if (limited) return limited;

  const nowIso = new Date().toISOString();
  try {
    const { data, error } = await auth.session.supabase.from('schemes')
      .select('id, name, description, is_festival, starts_at, ends_at')
      .eq('is_active', true)
      .lte('starts_at', nowIso)
      .gte('ends_at', nowIso)
      .order('ends_at', { ascending: true })
      .returns<SchemeRow[]>();
    if (error) throw error;
    return jsonOk({ schemes: (data ?? []).map((scheme) => ({
      id: scheme.id,
      name: scheme.name,
      description: scheme.description,
      isFestival: scheme.is_festival,
      startsAt: scheme.starts_at,
      endsAt: scheme.ends_at,
    })) }, { requestId });
  } catch (cause) {
    logServerError('schemes', requestId, cause);
    return jsonError('database_unavailable', 'Schemes could not be loaded. Please try again.', {
      status: 503,
      requestId,
    });
  }
}
