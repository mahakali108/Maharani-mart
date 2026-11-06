import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

// Always evaluated per request — a health probe must never be prerendered.
// (createClient reads cookies; without this, the build attempts a static
// render and the catch below would swallow Next's DynamicServerError signal.)
export const dynamic = 'force-dynamic';

/**
 * Health check endpoint for uptime monitoring / Vercel deployment checks.
 * Verifies the app can reach Supabase, not just that Next.js is running.
 * GET /api/health
 */
export async function GET() {
  const startedAt = Date.now();

  try {
    const supabase = (await createClient());
    const { error } = await supabase.from('areas').select('id', { count: 'exact', head: true });

    if (error) {
      // Log the real reason server-side; never echo driver/SQL details to
      // an unauthenticated caller (this endpoint is public by design).
      console.error('[health] database check failed:', error.message);
      return NextResponse.json(
        { status: 'degraded', database: 'unreachable' },
        { status: 503 }
      );
    }

    return NextResponse.json({
      status: 'ok',
      database: 'reachable',
      latencyMs: Date.now() - startedAt,
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    console.error('[health] check threw:', err instanceof Error ? err.message : err);
    return NextResponse.json(
      { status: 'error' },
      { status: 500 }
    );
  }
}
