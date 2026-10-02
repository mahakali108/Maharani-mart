import {
  enforceRateLimit,
  jsonOk,
  logServerError,
  mobileFailureResponse,
  newRequestId,
} from '@/lib/mobile';
import { createMobileAnonClient } from '@/lib/mobile/clients';

/**
 * GET /api/mobile/v1/areas
 *
 * The active service areas, for the address picker and the retailer
 * registration form. Public (no bearer token): a prospective retailer has no
 * account yet, and an area list is not sensitive.
 *
 * WHY THIS EXISTS
 * A registration form needs a real `areaId`, and the server's `handle_new_user()`
 * trigger rejects a missing, unknown or inactive area. Without this endpoint the
 * app would have to ship a hardcoded list — which would silently break every
 * time an admin adds or retires an area. This is the smallest addition that
 * keeps the client free of duplicated master data.
 *
 * Security: it reads through the CALLER-SCOPED anon client, so the existing RLS
 * policy `areas_read` (`is_active or is_staff_or_above()`) is what decides
 * visibility — this endpoint does not widen access, and inactive areas are
 * filtered out here as well so the list is exactly what a new account may pick.
 *
 * Contract: docs/NATIVE_ANDROID_API_CONTRACT.md §2.2.
 */
export const dynamic = 'force-dynamic';

interface AreaRow {
  id: string;
  name: string;
  district: string | null;
}

export async function GET(request: Request): Promise<Response> {
  const requestId = newRequestId();

  const limited = enforceRateLimit('read.catalog', request, { requestId });
  if (limited) return limited;

  try {
    const anon = createMobileAnonClient();
    const { data, error } = await anon
      .from('areas')
      .select('id, name, district')
      .eq('is_active', true)
      .order('name')
      .returns<AreaRow[]>();

    if (error) throw error;

    const response = jsonOk(
      {
        areas: (data ?? []).map((area) => ({
          id: area.id,
          name: area.name,
          district: area.district,
        })),
      },
      { requestId }
    );
    // Master data changes rarely; a short shared cache keeps the picker instant.
    response.headers.set('Cache-Control', 'public, max-age=300, stale-while-revalidate=600');
    return response;
  } catch (cause) {
    logServerError('areas', requestId, cause);
    return mobileFailureResponse(
      {
        code: 'database_unavailable',
        status: 503,
        message: 'The service is temporarily unavailable. Please try again.',
      },
      requestId
    );
  }
}
