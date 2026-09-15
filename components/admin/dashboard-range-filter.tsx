import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { indiaTodayDateKey } from '@/lib/datetime/india';
import { dashboardRangeHref } from '@/lib/admin/dashboard/range';
import type { DashboardRange } from '@/lib/admin/dashboard/types';

const PRESETS: { preset: 'today' | '7d' | '30d'; label: string }[] = [
  { preset: 'today', label: 'Today' },
  { preset: '7d', label: '7 Days' },
  { preset: '30d', label: '30 Days' },
];

export function DashboardRangeFilter({ range }: { range: DashboardRange }) {
  const today = indiaTodayDateKey();
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        {PRESETS.map((item) => {
          const active = range.preset === item.preset;
          return (
            <Link
              key={item.preset}
              href={dashboardRangeHref(item.preset)}
              className={`rounded-full px-3 py-1.5 text-xs font-medium transition-colors ${
                active ? 'bg-ink-950 text-white' : 'bg-ink-100 text-ink-600 hover:bg-ink-200'
              }`}
            >
              {item.label}
            </Link>
          );
        })}
        <span
          className={`rounded-full px-3 py-1.5 text-xs font-medium ${
            range.preset === 'custom' ? 'bg-primary-50 text-primary-700' : 'text-ink-400'
          }`}
        >
          {range.preset === 'custom' ? range.label : 'Custom'}
        </span>
      </div>
      <form method="get" action="/admin/dashboard" className="flex flex-wrap items-end gap-2">
        <input type="hidden" name="range" value="custom" />
        <div>
          <label htmlFor="dashboard-from" className="mb-1 block text-[11px] font-medium text-ink-500">
            From
          </label>
          <input
            id="dashboard-from"
            name="from"
            type="date"
            defaultValue={range.fromKey}
            max={today}
            className="h-10 rounded-xl border border-ink-200 bg-white px-3 text-sm text-ink-900 focus:border-transparent focus:outline-none focus:ring-2 focus:ring-primary-600"
          />
        </div>
        <div>
          <label htmlFor="dashboard-to" className="mb-1 block text-[11px] font-medium text-ink-500">
            To
          </label>
          <input
            id="dashboard-to"
            name="to"
            type="date"
            defaultValue={range.toKey}
            max={today}
            className="h-10 rounded-xl border border-ink-200 bg-white px-3 text-sm text-ink-900 focus:border-transparent focus:outline-none focus:ring-2 focus:ring-primary-600"
          />
        </div>
        <Button type="submit" size="sm" variant="secondary">
          Apply
        </Button>
      </form>
      {range.error ? <p className="text-xs text-primary-700">{range.error}</p> : null}
      {range.truncatedWindow ? (
        <p className="text-xs text-amber-700">Custom range was limited to the last 90 India calendar days.</p>
      ) : null}
    </div>
  );
}
