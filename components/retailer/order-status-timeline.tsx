import { Check, XCircle } from 'lucide-react';
import { Card, CardHeader, CardTitle } from '@/components/ui/card';

export type TrackedStatus =
  | 'pending'
  | 'confirmed'
  | 'processing'
  | 'packed'
  | 'dispatched'
  | 'delivered'
  | 'cancelled'
  | 'returned';

export interface StatusHistoryEntry {
  id: string;
  status: TrackedStatus;
  note: string | null;
  created_at: string;
}

/**
 * Step-based order tracking timeline (Requirement D).
 *
 * Every status and step shown here already exists in the database
 * order_status enum (0001_init.sql) — nothing is invented:
 *   main path: pending → confirmed → packed → dispatched → delivered
 *   terminal branches: cancelled / returned
 *
 * 'processing' is deliberately folded into the progression (it ranks
 * between confirmed and packed) rather than displayed as its own
 * retailer-facing step, since that enum value is staff workflow
 * detail; the timestamps still come from real order_status_history
 * rows written by the trg_log_order_status_* triggers.
 */

const STAGES: { key: string; label: string; reachesRank: number }[] = [
  { key: 'pending', label: 'Pending', reachesRank: 0 },
  { key: 'confirmed', label: 'Confirmed', reachesRank: 1 },
  { key: 'packed', label: 'Packed', reachesRank: 3 },
  { key: 'dispatched', label: 'Dispatched', reachesRank: 4 },
  { key: 'delivered', label: 'Delivered', reachesRank: 5 },
];

const RANK: Record<TrackedStatus, number | null> = {
  pending: 0,
  confirmed: 1,
  processing: 2,
  packed: 3,
  dispatched: 4,
  delivered: 5,
  cancelled: null,
  returned: null,
};

function formatWhen(iso: string) {
  return new Date(iso).toLocaleString('en-IN', {
    day: 'numeric',
    month: 'short',
    hour: 'numeric',
    minute: '2-digit',
  });
}

export function OrderStatusTimeline({
  status,
  history,
}: {
  status: TrackedStatus;
  history: StatusHistoryEntry[];
}) {
  const currentRank = RANK[status];

  if (currentRank === null) {
    // Cancelled / returned orders: show the terminal state prominently,
    // then the event log (with reasons) underneath.
    const label = status === 'cancelled' ? 'Cancelled' : 'Returned';
    return (
      <Card>
        <CardHeader>
          <CardTitle>Order tracking</CardTitle>
        </CardHeader>
        <div className="flex items-center gap-2 rounded-xl border border-primary-200 bg-primary-50 px-4 py-3">
          <XCircle className="h-5 w-5 text-primary-600" />
          <p className="text-sm font-medium text-primary-700">Order {label.toLowerCase()}</p>
        </div>
        <ol className="mt-3 space-y-2">
          {history.map((h) => (
            <li key={h.id} className="flex items-baseline justify-between gap-3 text-sm">
              <div className="min-w-0">
                <p className="font-medium text-ink-800">
                  {h.status.charAt(0).toUpperCase() + h.status.slice(1)}
                </p>
                {h.note ? <p className="text-xs text-ink-500">{h.note}</p> : null}
              </div>
              <p className="shrink-0 text-xs text-ink-400">{formatWhen(h.created_at)}</p>
            </li>
          ))}
        </ol>
      </Card>
    );
  }

  // Timestamps/notes come from actual history rows: each stage shows
  // the earliest recorded event that reached (or passed) its rank.
  const reachedEvent = STAGES.map((stage) =>
    history.find((h) => {
      const rank = RANK[h.status];
      return rank !== null && rank >= stage.reachesRank;
    })
  );

  return (
    <Card>
      <CardHeader>
        <CardTitle>Order tracking</CardTitle>
      </CardHeader>
      <ol>
        {STAGES.map((stage, index) => {
          const nextStage = STAGES[index + 1] ?? null;
          const reached = currentRank >= stage.reachesRank;
          const isCurrent = reached && (nextStage === null || currentRank < nextStage.reachesRank);
          const event = reachedEvent[index];
          return (
            <li key={stage.key} className="flex gap-3">
              <div className="flex flex-col items-center">
                <span
                  className={`flex h-6 w-6 items-center justify-center rounded-full border ${
                    reached
                      ? isCurrent
                        ? 'border-primary-600 bg-primary-600 text-white'
                        : 'border-green-600 bg-green-600 text-white'
                      : 'border-ink-200 bg-white text-ink-300'
                  }`}
                >
                  <Check className="h-3.5 w-3.5" />
                </span>
                {nextStage !== null ? (
                  <span className={`mt-1 w-px flex-1 ${currentRank >= nextStage.reachesRank ? 'bg-green-300' : 'bg-ink-100'}`} />
                ) : null}
              </div>
              <div className={index < STAGES.length - 1 ? 'pb-4' : ''}>
                <p className={`text-sm font-medium ${reached ? 'text-ink-900' : 'text-ink-400'}`}>{stage.label}</p>
                {reached && event ? (
                  <p className="text-xs text-ink-400">{formatWhen(event.created_at)}</p>
                ) : (
                  <p className="text-xs text-ink-300">—</p>
                )}
                {reached && event?.note ? <p className="mt-0.5 text-xs text-ink-500">{event.note}</p> : null}
              </div>
            </li>
          );
        })}
      </ol>
    </Card>
  );
}
