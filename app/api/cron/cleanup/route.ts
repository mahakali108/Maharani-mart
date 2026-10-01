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
 * What it does on each tick:
 *   1. run_data_cleanup(false, 'cron') — the service-role-only SQL engine:
 *      90-day temporary cleanup + 120-day business cleanup, batched,
 *      idempotent, audited in `cleanup_runs`.
 *   2. sweepTemporaryStorage — bounded removal of EXPIRED proof objects from
 *      the explicitly-temporary buckets (delivery-proofs / payment-proofs).
 *      Permanent buckets (product images included) are never visited.
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

  // 1. Database retention (the authoritative cleanup).
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

  // 2. Temporary storage objects (proof buckets only; product images and all
  //    other permanent buckets are never touched).
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
