import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

/**
 * Health check endpoint for uptime monitoring / Vercel deployment checks.
 * Verifies the app can reach Supabase, not just that Next.js is running.
 * GET /api/health
 */
export async function GET() {
  const startedAt = Date.now();

  try {
    const supabase = createClient();
    const { error } = await supabase.from('areas').select('id', { count: 'exact', head: true });

    if (error) {
      return NextResponse.json(
        { status: 'degraded', database: 'unreachable', error: error.message },
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
    return NextResponse.json(
      { status: 'error', error: err instanceof Error ? err.message : 'Unknown error' },
      { status: 500 }
    );
  }
}
