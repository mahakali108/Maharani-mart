import { Check, Clock3, PackageCheck, Truck, XCircle } from 'lucide-react';

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

const STAGES = [
  { key: 'pending', label: 'Placed', reachesRank: 0, icon: Clock3 },
  { key: 'confirmed', label: 'Confirmed', reachesRank: 1, icon: Check },
  { key: 'packed', label: 'Packed', reachesRank: 3, icon: PackageCheck },
  { key: 'dispatched', label: 'Shipped', reachesRank: 4, icon: Truck },
  { key: 'delivered', label: 'Delivered', reachesRank: 5, icon: Check },
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
  return new Date(iso).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });
}

export function OrderStatusTimeline({ status, history }: { status: TrackedStatus; history: StatusHistoryEntry[] }) {
  const currentRank = RANK[status];

  if (currentRank === null) {
    const label = status === 'cancelled' ? 'Cancelled' : 'Returned';
    return (
      <section className="overflow-hidden rounded-2xl border border-primary-200 bg-white shadow-sm">
        <div className="flex items-center gap-3 border-b border-primary-100 bg-primary-50 px-4 py-4 sm:px-5">
          <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary-600 text-white"><XCircle className="h-5 w-5" /></span>
          <div><h2 className="text-sm font-bold text-primary-900">Order {label.toLowerCase()}</h2><p className="mt-0.5 text-[10px] text-primary-700">See the recorded order events below.</p></div>
        </div>
        <ol className="divide-y divide-slate-100 px-4 sm:px-5">
          {history.map((entry) => (
            <li key={entry.id} className="flex items-start justify-between gap-3 py-3 text-xs">
              <div><p className="font-bold capitalize text-slate-800">{entry.status}</p>{entry.note ? <p className="mt-0.5 text-[10px] text-slate-500">{entry.note}</p> : null}</div>
              <p className="shrink-0 text-[9px] text-slate-400">{formatWhen(entry.created_at)}</p>
            </li>
          ))}
        </ol>
      </section>
    );
  }

  const reachedEvent = STAGES.map((stage) => history.find((entry) => {
    const rank = RANK[entry.status];
    return rank !== null && rank >= stage.reachesRank;
  }));

  return (
    <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
      <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3.5 sm:px-5">
        <div><h2 className="text-sm font-bold text-slate-900">Order tracking</h2><p className="mt-0.5 text-[10px] text-slate-500">Live progress from confirmed order events</p></div>
        <span className="rounded-full bg-emerald-50 px-2.5 py-1 text-[9px] font-bold capitalize text-emerald-700">{status === 'processing' ? 'Processing' : status}</span>
      </div>

      <div className="scrollbar-none overflow-x-auto p-4 sm:p-6">
        <ol className="relative grid min-w-[500px] grid-cols-5">
          <span className="absolute left-[10%] right-[10%] top-5 h-0.5 bg-slate-100" />
          <span className="absolute left-[10%] top-5 h-0.5 bg-emerald-500 transition-all" style={{ width: `${Math.min(80, (currentRank / 5) * 80)}%` }} />
          {STAGES.map((stage, index) => {
            const nextStage = STAGES[index + 1] ?? null;
            const reached = currentRank >= stage.reachesRank;
            const isCurrent = reached && (nextStage === null || currentRank < nextStage.reachesRank);
            const event = reachedEvent[index];
            const Icon = stage.icon;
            return (
              <li key={stage.key} className="relative z-10 flex flex-col items-center px-1 text-center">
                <span className={`flex h-10 w-10 items-center justify-center rounded-full border-4 border-white shadow-sm ${reached ? isCurrent ? 'bg-primary-600 text-white ring-2 ring-primary-100' : 'bg-emerald-600 text-white' : 'bg-slate-100 text-slate-400'}`}><Icon className="h-4 w-4" /></span>
                <p className={`mt-2 text-[10px] font-bold ${reached ? 'text-slate-800' : 'text-slate-400'}`}>{stage.label}</p>
                <p className="mt-0.5 text-[8px] leading-3 text-slate-400">{reached && event ? formatWhen(event.created_at) : 'Awaiting'}</p>
                {reached && event?.note ? <p className="mt-1 line-clamp-2 text-[8px] leading-3 text-slate-500">{event.note}</p> : null}
              </li>
            );
          })}
        </ol>
      </div>
    </section>
  );
}
