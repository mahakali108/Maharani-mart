import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { firebaseConfigStatus } from '@/lib/firebase/config';

/**
 * Health check endpoint for uptime monitoring / Vercel deployment checks.
 * Verifies the app can reach Supabase, not just that Next.js is running.
 * GET /api/health
 *
 * The Supabase result stays authoritative for the HTTP status (Supabase is the
 * primary backend). The Firebase block reports *configuration presence only*
 * for the Phase 1 foundation: no SDK is initialised, no Firebase service is
 * contacted, no Firestore read/write happens, and no credential value (key or
 * service-account email) is ever included in the response.
 */
export async function GET() {
  const startedAt = Date.now();
  const firebase = firebaseConfigStatus(process.env);

  try {
    const supabase = createClient();
    const { error } = await supabase.from('areas').select('id', { count: 'exact', head: true });

    if (error) {
      return NextResponse.json(
        { status: 'degraded', database: 'unreachable', error: error.message, firebase },
        { status: 503 }
      );
    }

    return NextResponse.json({
      status: 'ok',
      database: 'reachable',
      latencyMs: Date.now() - startedAt,
      timestamp: new Date().toISOString(),
      firebase,
    });
  } catch (err) {
    return NextResponse.json(
      {
        status: 'error',
        error: err instanceof Error ? err.message : 'Unknown error',
        firebase,
      },
      { status: 500 }
    );
  }
}
