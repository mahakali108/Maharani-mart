import { timingSafeEqual } from 'node:crypto';
import { NextResponse, type NextRequest } from 'next/server';
import { createServiceRoleClient } from '@/lib/supabase/server';
import { sweepTemporaryStorage, type StorageApi } from '@/lib/retention/storage-cleanup';
import type { CleanupRunReport } from '@/lib/retention/cleanup';

/**
 * Production data-retention scheduler endpoint (Vercel Cron → vercel.json).
 *
 *   schedule: daily 02:00 UTC (see CLEANUP_CRON_SCHEDULE)
 *   auth:     Authorization: Bearer ${CRON_SECRET} — if CRON_SECRET is not
 *             configured the endpoint refuses to run (fail closed), so an
 *             unauthenticated visitor can never trigger deletion.
 *
 * What it does on each tick (AFTER the 0059 migration):
 *   1. Refuses to run if any unapproved 120-day business cleanup rule is
 *      enabled. DB read failure also fails closed: protects against deploying
 *      this code before the safety migration.
 *   2. Runs only enabled temporary cleanup rules. The 120-day orders,
 *      payments, returns, wallet and inventory targets are paused by 0059.
 *   3. Storage sweeper has no eligible proof buckets while financial proof
 *      retention is under review (product images were always protected).
 *
 * If the DB run reports errors the route returns them with a 200 body that
 * marks `status: 'completed_with_errors'` (the run row recorded the details) —
 * a retry happens on the next scheduled tick. Idempotent: a repeated tick
 * deletes nothing twice.
 */

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

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

export async function GET(request: NextRequest) {
  if (!process.env.CRON_SECRET) {
    return NextResponse.json(
      { error: 'Cleanup scheduler disabled: CRON_SECRET is not configured.' },
      { status: 503 }
    );
  }
  if (!secretMatches(bearerToken(request), process.env.CRON_SECRET)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const supabase = createServiceRoleClient();

  // Code and migration must deploy together. A still-active financial rule or
  // an evidence-bearing 90-day rule (or a failed read) must fail closed.
  const [business, evidence] = await Promise.all([
    supabase.from('data_retention_rules').select('target_key')
      .eq('category', 'business_120').eq('enabled', true).limit(1),
    supabase.from('data_retention_rules').select('target_key')
      .in('target_key', ['expired_notifications', 'notification_logs', 'cleanup_run_logs'])
      .eq('enabled', true).limit(1),
  ]);
  if (business.error || evidence.error || !business.data || !evidence.data ||
      business.data.length > 0 || evidence.data.length > 0) {
    return NextResponse.json(
      { error: 'Cleanup paused: financial/evidence retention has not been reviewed or the safety migration is missing.' },
      { status: 503 }
    );
  }

  // 1. Database retention (only unheld temporary targets).
  const { data, error } = await supabase.rpc('run_data_cleanup' as never, {
    p_dry_run: false,
    p_triggered_by: 'cron',
    p_batch_size: 500,
    p_max_rows_per_target: 20000,
  } as never);
  if (error) {
    // The run itself failed to execute (connection/permission) — surface it.
    return NextResponse.json({ error: `Cleanup run failed: ${error.message}` }, { status: 500 });
  }
  const report = data as unknown as CleanupRunReport;

  // 2. No proof buckets are classified temporary under the interim hold;
  //    the allow-listed sweep returns no deletion targets.
  const storageResults = await sweepTemporaryStorage(supabase.storage as unknown as StorageApi);

  return NextResponse.json({
    ok: true,
    run_id: report.run_id,
    status: report.status,
    totals: report.totals,
    errors: report.errors,
    storage: storageResults,
  });
}
