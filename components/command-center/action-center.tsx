import Link from 'next/link';
import type { CommandCenterAction } from '@/lib/admin/command-center/types';
import { Card } from '@/components/ui/card';
import { SeverityBadge } from './shared';

/**
 * Executive Action Center list.
 *
 * Every row is a real signal: `source` names the table/view/pipeline that
 * produced it, `entityHref` points at the EXISTING screen that must act on
 * it, and `requiredApproval` names the human workflow — the platform never
 * performs the mutation itself.
 */
export function ActionCenterList({ actions, limit = 12 }: { actions: CommandCenterAction[]; limit?: number }) {
  const visible = actions.slice(0, limit);
  return (
    <div className="space-y-2">
      {visible.map((action, index) => (
        <Card
          key={action.id}
          className={`p-4 ${action.severity === 'urgent' ? 'border-red-200' : action.severity === 'high' ? 'border-amber-200' : ''}`}
        >
          <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-[10px] font-bold text-ink-300">#{index + 1}</span>
                <SeverityBadge severity={action.severity} />
                <span className="text-[10px] font-semibold uppercase tracking-wide text-ink-400">{action.category}</span>
              </div>
              <p className="mt-1 text-sm font-semibold text-ink-900">{action.entity}</p>
              <p className="mt-0.5 text-xs leading-5 text-ink-600">{action.reason}</p>
              <div className="mt-2 grid grid-cols-1 gap-1 text-[11px] text-ink-500 sm:grid-cols-2">
                <p>
                  <span className="font-semibold text-ink-700">Recommended:</span> {action.recommendedAction}
                </p>
                <p>
                  <span className="font-semibold text-ink-700">Approval:</span> {action.requiredApproval}
                </p>
              </div>
              <p className="mt-1.5 text-[10px] text-ink-400">
                Source: {action.source}
                {action.metric ? ` · ${action.metric}` : ''}
              </p>
            </div>
            {action.entityHref ? (
              <Link
                href={action.entityHref}
                className="shrink-0 self-start rounded-lg border border-ink-200 bg-white px-3 py-1.5 text-[11px] font-bold text-ink-700 transition hover:border-primary-300 hover:text-primary-700"
              >
                View
              </Link>
            ) : null}
          </div>
        </Card>
      ))}
      {actions.length > limit ? (
        <p className="text-center text-[11px] text-ink-400">
          Showing the {limit} most urgent of {actions.length} action(s) — the remaining items are medium priority.
        </p>
      ) : null}
    </div>
  );
}
