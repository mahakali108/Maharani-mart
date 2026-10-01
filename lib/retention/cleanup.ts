/**
 * Data retention — shared, isomorphic-safe types and pure helpers.
 *
 * The deletion engine itself lives in the database (run_data_cleanup, migration
 * 0055) and is service-role only. This module is the TypeScript side:
 *
 *   - the shape of the cleanup report the engine returns and the admin page
 *     renders,
 *   - the production schedule (Vercel Cron) and "next run" calculation,
 *   - small formatters so the status page stays presentational.
 *
 * No secrets, no Supabase clients, no `next/*` — safe to import anywhere.
 */

/** Retention classes approved by the data-retention specification. */
export type RetentionCategory = 'temporary_90' | 'business_120';

/** One cleanup target's outcome (or dry-run plan) inside a run. */
export interface CleanupTargetReport {
  target_key: string;
  category: RetentionCategory;
  /** Display table the rule points at. */
  table: string;
  retention_days: number;
  /** ISO cutoff: rows strictly older than this were eligible. */
  cutoff: string;
  action: 'DELETE';
  /** Dry runs only: how many rows WOULD be deleted. */
  eligible_rows: number | null;
  /** Executions only: how many rows were deleted. */
  deleted_rows: number;
  status: 'ok' | 'failed';
  /** Optional per-breakdown counts (e.g. order_items, coins by type). */
  breakdown?: Record<string, number>;
}

export interface CleanupRunError {
  target_key: string;
  message: string;
}

/** The full report run_data_cleanup stores on cleanup_runs and returns. */
export interface CleanupRunReport {
  run_id: string;
  dry_run: boolean;
  triggered_by: string;
  status: 'running' | 'completed' | 'completed_with_errors' | 'failed';
  started_at?: string;
  batch_size?: number;
  max_rows_per_target?: number;
  targets: CleanupTargetReport[];
  totals: { temporary: number; '120_day': number; deleted?: number; eligible?: number };
  errors: CleanupRunError[];
}

/** A stored cleanup_runs audit row (what the admin status page lists). */
export interface CleanupRunSummaryRow {
  run_id: string;
  dry_run: boolean;
  triggered_by: string;
  status: CleanupRunReport['status'];
  started_at: string;
  completed_at: string | null;
  summary: Partial<CleanupRunReport>;
  errors: CleanupRunError[];
}

/**
 * Production schedule: daily at 02:00 UTC (vercel.json → `crons`).
 * Kept in one place so the admin page and the docs cannot drift.
 */
export const CLEANUP_CRON_SCHEDULE = '0 2 * * *';
export const CLEANUP_CRON_SCHEDULE_LABEL = 'Daily at 02:00 UTC (Vercel Cron)';

/** The next scheduled cleanup instant after `now` (daily 02:00 UTC). */
export function nextCleanupRunAt(now: Date = new Date()): Date {
  const next = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 2, 0, 0, 0));
  if (next.getTime() <= now.getTime()) {
    next.setUTCDate(next.getUTCDate() + 1);
  }
  return next;
}

/** Human summary of a run's status for the admin list. */
export function cleanupStatusLabel(status: CleanupRunReport['status']): string {
  switch (status) {
    case 'completed':
      return 'Completed';
    case 'completed_with_errors':
      return 'Completed with errors';
    case 'failed':
      return 'Failed';
    default:
      return 'Running';
  }
}

/** Rows a run deleted (executions) or would delete (dry runs). */
export function cleanupRunRowCount(report: Partial<Pick<CleanupRunReport, 'totals'>>): number {
  const totals = report.totals ?? { temporary: 0, '120_day': 0 };
  return totals.temporary + totals['120_day'];
}
