import { NextResponse } from 'next/server';

import { getAppwriteDiagnostics } from '@/lib/media/appwrite/server';

/**
 * SAFE storage-configuration diagnostic for deploy debugging.
 *
 * GET /api/media/diagnostics
 *
 * Reports ONLY presence booleans — whether each required Appwrite server
 * variable is set on this deployment. It never returns the API key, the
 * project id, the bucket id, or any other value/prefix/length. Because the
 * response contains no secrets and no tenant data, it needs no auth and is
 * safe to hit on production to verify Vercel env configuration.
 *
 * `force-dynamic` guarantees process.env is read at request time on the
 * server, never baked in at build time.
 */
export const dynamic = 'force-dynamic';

export async function GET() {
  const diagnostics = getAppwriteDiagnostics();

  return NextResponse.json(
    {
      configured: diagnostics.configured,
      endpointConfigured: diagnostics.endpointConfigured,
      projectConfigured: diagnostics.projectConfigured,
      apiKeyConfigured: diagnostics.apiKeyConfigured,
      bucketConfigured: diagnostics.bucketConfigured,
    },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}
