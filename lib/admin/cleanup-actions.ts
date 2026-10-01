'use server';

import { requirePermission } from '@/lib/admin/guard';
import { createServiceRoleClient } from '@/lib/supabase/server';
import {
  CLEANUP_CRON_SCHEDULE_LABEL,
  nextCleanupRunAt,
  type CleanupRunReport,
  type CleanupRunSummaryRow,
} from '@/lib/retention/cleanup';

/**
 * Data-retention admin surface (spec §20/§23).
 *
 * Read-only status plus ONE safe action: a dry-run audit. There is deliberately
 * NO "delete everything now" control — production deletion is owned by the
 * scheduled cleanup (Vercel Cron → /api/cron/cleanup) calling the
 * service-role-only engine. All reads go through the service client in server
 * code after the `cleanup.view` permission check; cleanup_runs has no client
 * policies at all.
 */

export interface RetentionRuleRow {
  target_key: string;
  category: 'temporary_90' | 'business_120';
  table_name: string;
  retention_days: number;
  cutoff_column: string;
  deletion_order: number;
  enabled: boolean;
  description: string;
}

export interface CleanupOverview {
  lastRun: CleanupRunSummaryRow | null;
  recentRuns: CleanupRunSummaryRow[];
  rules: RetentionRuleRow[];
  schedule: {
    label: string;
    nextRunAt: string;
  };
  latestErrors: { run_id: string; target_key: string; message: string }[];
}

export async function getCleanupOverview(): Promise<CleanupOverview> {
  await requirePermission('cleanup.view');
  const supabase = createServiceRoleClient();

  const [{ data: runs, error: runsError }, { data: rules, error: rulesError }] = await Promise.all([
    supabase
      .from('cleanup_runs')
      .select('run_id, dry_run, triggered_by, status, started_at, completed_at, summary, errors')
      .order('started_at', { ascending: false })
      .limit(20),
    supabase
      .from('data_retention_rules')
      .select('target_key, category, table_name, retention_days, cutoff_column, deletion_order, enabled, description')
      .order('deletion_order', { ascending: true }),
  ]);
  if (runsError) throw new Error(`Cleanup runs could not be read: ${runsError.message}`);
  if (rulesError) throw new Error(`Retention rules could not be read: ${rulesError.message}`);

  const recentRuns = ((runs ?? []) as unknown as CleanupRunSummaryRow[]).map((run) => ({
    ...run,
    summary: (run.summary ?? {}) as Partial<CleanupRunReport>,
    errors: Array.isArray(run.errors) ? run.errors : [],
  }));

  const latestErrors = recentRuns
    .flatMap((run) => (run.errors ?? []).map((e) => ({ run_id: run.run_id, target_key: e.target_key, message: e.message })))
    .slice(0, 10);

  return {
    lastRun: recentRuns[0] ?? null,
    recentRuns,
    rules: (rules ?? []) as unknown as RetentionRuleRow[],
    schedule: {
      label: CLEANUP_CRON_SCHEDULE_LABEL,
      nextRunAt: nextCleanupRunAt().toISOString(),
    },
    latestErrors,
  };
}

export type DryRunResult = { ok: true; report: CleanupRunReport } | { ok: false; error: string };

/**
 * Run a DRY-RUN audit: counts eligible rows per retention rule and plans
 * actions. Deletes nothing (p_dry_run => true). Still admin-gated and
 * recorded in the cleanup audit log like any other run.
 */
export async function runCleanupDryRun(): Promise<DryRunResult> {
  await requirePermission('cleanup.view');
  const supabase = createServiceRoleClient();

  const { data, error } = await supabase.rpc('run_data_cleanup' as never, {
    p_dry_run: true,
    p_triggered_by: 'manual',
    p_batch_size: 500,
    p_max_rows_per_target: 100000,
  } as never);
  if (error) return { ok: false, error: error.message };
  return { ok: true, report: data as unknown as CleanupRunReport };
}
