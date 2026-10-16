import { Database, ShieldCheck, CalendarClock } from 'lucide-react';
import { requirePermission } from '@/lib/admin/guard';
import { getCleanupOverview } from '@/lib/admin/cleanup-actions';
import { Card, CardTitle } from '@/components/ui/card';
import { formatIndiaDateTime } from '@/lib/datetime/india';
import { cleanupRunRowCount, cleanupStatusLabel } from '@/lib/retention/cleanup';
import { CleanupDryRunButton } from './client';

export const dynamic = 'force-dynamic';

/**
 * Admin-only data-retention status page (spec §23).
 *
 * Shows the last cleanup, next scheduled cleanup, status, run IDs, rows
 * cleaned and the historical 90/120-day summaries — plus latest errors.
 * Proposed 0059 pauses business + evidence targets if separately applied;
 * this UI is not proof of live deployment. The ONLY admin action is dry-run.
 */
export default async function CleanupStatusPage() {
  await requirePermission('cleanup.view');
  const overview = await getCleanupOverview();

  const lastRun = overview.lastRun;
  const lastSummary = lastRun?.summary;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2.5">
            <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-ink-950">
              <Database className="h-5 w-5 text-white" />
            </span>
            <h1 className="text-xl font-semibold text-ink-950 sm:text-2xl">Data Retention</h1>
          </div>
          <p className="mt-1 flex items-center gap-1.5 text-xs text-ink-500">
            <ShieldCheck className="h-3.5 w-3.5 text-mint-600" />
            Admin only · Proposed 0059 holds financial/evidence cleanup; verify DB and deployment before treating this as active. Product images are excluded from automatic sweeps.
          </p>
        </div>
        <CleanupDryRunButton />
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Card>
          <p className="text-xs font-medium uppercase tracking-wide text-ink-500">Last cleanup</p>
          <p className="mt-1 text-lg font-semibold text-ink-950">
            {lastRun ? formatIndiaDateTime(lastRun.started_at) : 'Not run yet'}
          </p>
          {lastRun ? (
            <p className="mt-0.5 text-xs text-ink-500">
              {cleanupStatusLabel(lastRun.status)} · {lastRun.dry_run ? 'dry run' : 'live'} · {lastRun.run_id}
            </p>
          ) : null}
        </Card>
        <Card>
          <p className="text-xs font-medium uppercase tracking-wide text-ink-500">Next cleanup</p>
          <p className="mt-1 flex items-center gap-1.5 text-lg font-semibold text-ink-950">
            <CalendarClock className="h-4 w-4 text-ink-400" />
            {formatIndiaDateTime(overview.schedule.nextRunAt)}
          </p>
          <p className="mt-0.5 text-xs text-ink-500">Configured schedule (not proof a deployment is running): {overview.schedule.label}</p>
        </Card>
        <Card>
          <p className="text-xs font-medium uppercase tracking-wide text-ink-500">Rows cleaned (last run)</p>
          <p className="mt-1 text-lg font-semibold text-ink-950">
            {lastRun ? cleanupRunRowCount(lastRun.summary) : 0}
          </p>
          <p className="mt-0.5 text-xs text-ink-500">
            90-day: {lastSummary?.totals?.temporary ?? 0} · 120-day: {lastSummary?.totals?.['120_day'] ?? 0}
          </p>
        </Card>
        <Card>
          <p className="text-xs font-medium uppercase tracking-wide text-ink-500">Latest status</p>
          <p className="mt-1 text-lg font-semibold text-ink-950">
            {lastRun ? cleanupStatusLabel(lastRun.status) : '—'}
          </p>
          <p className="mt-0.5 text-xs text-ink-500">
            {overview.latestErrors.length > 0
              ? `${overview.latestErrors.length} recorded error(s) — see below`
              : 'No recorded errors'}
          </p>
        </Card>
      </div>

      <Card>
        <CardTitle>Retention rules</CardTitle>
        <p className="mb-3 text-xs text-ink-500">
          Every cleanup target is explicitly registered here. Unlisted data — products, packs, stock, images,
          categories, brands, pricing — is never touched by cleanup.
        </p>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] text-left text-sm">
            <thead>
              <tr className="border-b border-ink-100 text-xs uppercase tracking-wide text-ink-500">
                <th className="py-2 pr-4">Category</th>
                <th className="py-2 pr-4">Table</th>
                <th className="py-2 pr-4">Retention</th>
                <th className="py-2 pr-4">Cutoff column</th>
                <th className="py-2 pr-4">Enabled</th>
                <th className="py-2">Rule</th>
              </tr>
            </thead>
            <tbody>
              {overview.rules.map((rule) => (
                <tr key={rule.target_key} className="border-b border-ink-50 align-top">
                  <td className="py-2 pr-4">
                    <span
                      className={
                        rule.category === 'temporary_90'
                          ? 'rounded-full bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-700'
                          : 'rounded-full bg-error-50 px-2 py-0.5 text-xs font-medium text-error-700'
                      }
                    >
                      {rule.category === 'temporary_90' ? '90-day temp' : '120-day'}
                    </span>
                  </td>
                  <td className="py-2 pr-4 font-mono text-xs text-ink-800">{rule.table_name}</td>
                  <td className="py-2 pr-4 text-ink-700">{rule.retention_days} days</td>
                  <td className="py-2 pr-4 font-mono text-xs text-ink-500">{rule.cutoff_column}</td>
                  <td className="py-2 pr-4 text-ink-700">{rule.enabled ? 'Yes' : 'No'}</td>
                  <td className="py-2 text-xs text-ink-500">{rule.description}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <Card>
        <CardTitle>Recent runs</CardTitle>
        {overview.recentRuns.length === 0 ? (
          <p className="text-sm text-ink-500">No cleanup runs recorded yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-left text-sm">
              <thead>
                <tr className="border-b border-ink-100 text-xs uppercase tracking-wide text-ink-500">
                  <th className="py-2 pr-4">Run ID</th>
                  <th className="py-2 pr-4">Started</th>
                  <th className="py-2 pr-4">Status</th>
                  <th className="py-2 pr-4">Kind</th>
                  <th className="py-2 pr-4">90-day rows</th>
                  <th className="py-2 pr-4">120-day rows</th>
                  <th className="py-2">Errors</th>
                </tr>
              </thead>
              <tbody>
                {overview.recentRuns.map((run) => (
                  <tr key={run.run_id} className="border-b border-ink-50">
                    <td className="py-2 pr-4 font-mono text-xs text-ink-800">{run.run_id}</td>
                    <td className="py-2 pr-4 text-ink-700">{formatIndiaDateTime(run.started_at)}</td>
                    <td className="py-2 pr-4 text-ink-700">{cleanupStatusLabel(run.status)}</td>
                    <td className="py-2 pr-4 text-ink-700">
                      {run.dry_run ? 'Dry run' : 'Live'} ({run.triggered_by})
                    </td>
                    <td className="py-2 pr-4 text-ink-700">{run.summary?.totals?.temporary ?? 0}</td>
                    <td className="py-2 pr-4 text-ink-700">{run.summary?.totals?.['120_day'] ?? 0}</td>
                    <td className="py-2 text-xs text-ink-500">
                      {run.errors.length > 0
                        ? run.errors.map((e) => `${e.target_key}: ${e.message}`).join(' · ')
                        : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {overview.latestErrors.length > 0 ? (
        <Card className="border-error-200">
          <CardTitle className="text-error-700">Latest errors</CardTitle>
          <ul className="space-y-1 text-sm text-ink-700">
            {overview.latestErrors.map((e, i) => (
              <li key={`${e.run_id}-${i}`} className="text-xs">
                <span className="font-mono text-ink-500">{e.run_id}</span> · <strong>{e.target_key}</strong>: {e.message}
              </li>
            ))}
          </ul>
        </Card>
      ) : null}
    </div>
  );
}
