import { timingSafeEqual } from 'node:crypto';
import { NextResponse, type NextRequest } from 'next/server';
import { createServiceRoleClient } from '@/lib/supabase/server';

/**
 * AI-only data retention scheduler (migration 0084).
 *
 *   schedule: NOT SCHEDULED BY THIS PR. The route exists and is fully
 *             implemented, but no `crons` entry for /api/cron/ai-cleanup is
 *             registered in vercel.json, so a deploy of this branch cannot
 *             start deleting AI data on its own. A SEPARATE, explicitly
 *             approved change may add:
 *                 { "path": "/api/cron/ai-cleanup", "schedule": "30 2 * * *" }
 *             and only after all three of these are true:
 *               1. migration 0084 is applied to the target project,
 *               2. one authorised ?dry_run=1 run has been reviewed,
 *               3. the owner has given written sign-off to arm it.
 *   auth:     Authorization: Bearer ${CRON_SECRET} — fail closed when unset
 *             (503). Until the schedule is armed, a manual invocation is the
 *             ONLY way this can run, and it still requires the secret.
 *
 * This endpoint calls ONE function, run_ai_data_cleanup, which can only delete
 * from the five AI-owned tables and only rows strictly older than 14 days. It
 * is intentionally separate from /api/cron/cleanup (the 90/120-day business
 * retention engine), which is not modified, re-scheduled or re-parameterised
 * by this change.
 *
 * A dry run can be requested with ?dry_run=1 for operator verification; it
 * deletes nothing and writes an audit row like every other run.
 */
export const dynamic = 'force-dynamic';
export const maxDuration = 120;

function secretMatches(provided: string | null, expected: string | undefined): boolean {
  if (!provided || !expected) return false;
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

function bearerToken(request: NextRequest): string | null {
  const header = request.headers.get('authorization');
  if (!header) return null;
  const match = /^Bearer\s+(.+)$/i.exec(header.trim());
  return match ? match[1]! : null;
}

export async function GET(request: NextRequest) {
  if (!process.env.CRON_SECRET) {
    return NextResponse.json(
      { error: 'AI cleanup scheduler disabled: CRON_SECRET is not configured.' },
      { status: 503 }
    );
  }
  if (!secretMatches(bearerToken(request), process.env.CRON_SECRET)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const dryRun = request.nextUrl.searchParams.get('dry_run') === '1';
  const supabase = createServiceRoleClient();

  const { data, error } = await supabase.rpc('run_ai_data_cleanup' as never, {
    p_dry_run: dryRun,
    p_triggered_by: 'cron',
    p_batch_size: 500,
    p_max_rows_per_target: 20000,
  } as never);

  if (error) {
    return NextResponse.json({ error: `AI cleanup run failed: ${error.message}` }, { status: 500 });
  }

  return NextResponse.json({ ok: true, result: data });
}
