/**
 * Minimal, dependency-free SVG charts for the Super Admin Command Center.
 *
 * The platform never shipped a chart library (package.json has no recharts),
 * so these are hand-rolled, accessible (aria-labelled, sr-only summary) and
 * render identical on server and client. They visualize REAL aggregated
 * series only — empty series render an honest empty note, never bars.
 */

import type { TrendPoint } from '@/lib/admin/command-center/types';

function pointsToPath(points: { x: number; y: number }[]): string {
  return points.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ');
}

function niceMax(value: number): number {
  if (value <= 0) return 1;
  const magnitude = 10 ** Math.floor(Math.log10(value));
  const norm = value / magnitude;
  const nice = norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 5 ? 5 : 10;
  return nice * magnitude;
}

/** Compact line + area trend (e.g. 14-day sales). */
export function TrendChart({ points, height = 120, color = '#C8102E' }: { points: TrendPoint[]; height?: number; color?: string }) {
  const width = 560;
  const pad = 8;
  const values = points.map((p) => p.sales);
  const max = niceMax(Math.max(...values, 0));
  const stepX = points.length > 1 ? (width - pad * 2) / (points.length - 1) : 0;
  const coords = points.map((p, i) => ({ x: pad + i * stepX, y: height - pad - (p.sales / max) * (height - pad * 2) }));
  const line = pointsToPath(coords);
  const area = coords.length ? `${line} L${(pad + (points.length - 1) * stepX).toFixed(1)},${height - pad} L${pad},${height - pad} Z` : '';
  const total = values.reduce((s, v) => s + v, 0);
  const summary = points.length ? `Trend: ${points.length} days, total ₹${Math.round(total).toLocaleString('en-IN')}.` : 'No data.';

  if (points.length === 0 || total === 0) {
    return (
      <div className="flex h-24 items-center justify-center rounded-xl border border-dashed border-ink-200 text-xs text-ink-400" role="img" aria-label={summary}>
        No sales recorded in this window yet
      </div>
    );
  }

  return (
    <div>
      <svg viewBox={`0 0 ${width} ${height}`} className="h-auto w-full" role="img" aria-label={summary}>
        <defs>
          <linearGradient id={`trend-${color.replace('#', '')}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity="0.18" />
            <stop offset="100%" stopColor={color} stopOpacity="0.02" />
          </linearGradient>
        </defs>
        {[0.25, 0.5, 0.75].map((f) => (
          <line key={f} x1={pad} x2={width - pad} y1={height - pad - f * (height - pad * 2)} y2={height - pad - f * (height - pad * 2)} stroke="#EEF0F3" strokeWidth="1" />
        ))}
        {area ? <path d={area} fill={`url(#trend-${color.replace('#', '')})`} /> : null}
        {line ? <path d={line} fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /> : null}
        {coords.map((c, i) => {
          const point = points[i];
          return point && point.sales > 0 ? <circle key={i} cx={c.x} cy={c.y} r="2.4" fill={color} /> : null;
        })}
      </svg>
      <div className="mt-1 flex justify-between text-[10px] text-ink-400">
        <span>{points[0]?.label}</span>
        <span>{points[Math.floor(points.length / 2)]?.label}</span>
        <span>{points[points.length - 1]?.label}</span>
      </div>
    </div>
  );
}

/** Vertical bars for weekly/bucketed totals. */
export function BarChart({ bars, height = 120, color = '#0B0B0B' }: { bars: { label: string; value: number }[]; height?: number; color?: string }) {
  const total = bars.reduce((s, b) => s + b.value, 0);
  const summary = bars.length ? `Bars: ${bars.map((b) => `${b.label} ₹${Math.round(b.value).toLocaleString('en-IN')}`).join(', ')}.` : 'No data.';
  if (bars.length === 0 || total === 0) {
    return (
      <div className="flex h-24 items-center justify-center rounded-xl border border-dashed border-ink-200 text-xs text-ink-400" role="img" aria-label={summary}>
        No recorded data in this window yet
      </div>
    );
  }
  const max = niceMax(Math.max(...bars.map((b) => b.value)));
  return (
    <div role="img" aria-label={summary}>
      <div className="flex items-end gap-2" style={{ height }}>
        {bars.map((bar) => {
          const h = Math.max(2, (bar.value / max) * (height - 24));
          return (
            <div key={bar.label} className="flex min-w-0 flex-1 flex-col items-center justify-end gap-1" title={`${bar.label}: ₹${Math.round(bar.value).toLocaleString('en-IN')}`}>
              <span className="max-w-full truncate text-[9px] font-semibold text-ink-500">
                {bar.value >= 1000 ? `${Math.round(bar.value / 1000)}k` : Math.round(bar.value)}
              </span>
              <div className="w-full rounded-t-md" style={{ height: h, backgroundColor: bar.value > 0 ? color : '#E5E7EB', opacity: bar.value > 0 ? 0.85 : 1 }} />
            </div>
          );
        })}
      </div>
      <div className="mt-1 flex gap-2">
        {bars.map((bar) => (
          <span key={bar.label} className="min-w-0 flex-1 truncate text-center text-[10px] text-ink-400">
            {bar.label}
          </span>
        ))}
      </div>
    </div>
  );
}

/** Horizontal top-N bars (div-based, inherently accessible). */
export function TopBars({ rows, formatValue }: { rows: { name: string; value: number; secondary?: string }[]; formatValue: (value: number) => string }) {
  if (rows.length === 0) {
    return <p className="rounded-xl border border-dashed border-ink-200 p-4 text-center text-xs text-ink-400">No data in this window yet.</p>;
  }
  const max = Math.max(...rows.map((r) => r.value), 0);
  return (
    <ul className="space-y-2" aria-label={`Top items: ${rows.map((r) => `${r.name} ${formatValue(r.value)}`).join(', ')}`}>
      {rows.map((row, index) => (
        <li key={`${row.name}-${index}`}>
          <div className="mb-0.5 flex items-baseline justify-between gap-2 text-xs">
            <span className="min-w-0 truncate font-medium text-ink-800">
              <span className="mr-1.5 text-ink-400">{index + 1}.</span>
              {row.name}
              {row.secondary ? <span className="ml-1.5 text-[10px] text-ink-400">{row.secondary}</span> : null}
            </span>
            <span className="shrink-0 font-semibold text-ink-900">{formatValue(row.value)}</span>
          </div>
          <div className="h-1.5 w-full overflow-hidden rounded-full bg-ink-50" aria-hidden="true">
            <div className="h-full rounded-full bg-primary-600/80" style={{ width: `${max > 0 ? Math.max(2, (row.value / max) * 100) : 0}%` }} />
          </div>
        </li>
      ))}
    </ul>
  );
}

/** Donut for credit utilization (or any single-ratio visual). */
export function Donut({ percent, size = 120, label }: { percent: number | null; size?: number; label: string }) {
  const r = 44;
  const c = 2 * Math.PI * r;
  const clamped = percent === null ? 0 : Math.min(100, Math.max(0, percent));
  const dash = (clamped / 100) * c;
  const tone = percent === null ? '#9CA3AF' : clamped > 100 ? '#DC2626' : clamped >= 80 ? '#D97706' : '#059669';
  return (
    <div className="flex items-center gap-4" role="img" aria-label={`${label}: ${percent === null ? 'not available' : `${Math.round(clamped)}%`}`}>
      <svg viewBox="0 0 110 110" width={size} height={size}>
        <circle cx="55" cy="55" r={r} fill="none" stroke="#F1F2F5" strokeWidth="12" />
        <circle
          cx="55"
          cy="55"
          r={r}
          fill="none"
          stroke={tone}
          strokeWidth="12"
          strokeLinecap="round"
          strokeDasharray={`${dash} ${c - dash}`}
          transform="rotate(-90 55 55)"
        />
        <text x="55" y="52" textAnchor="middle" className="fill-ink-900" style={{ font: '700 15px system-ui' }}>
          {percent === null ? 'n/a' : `${Math.round(clamped)}%`}
        </text>
        <text x="55" y="68" textAnchor="middle" className="fill-ink-400" style={{ font: '600 9px system-ui' }}>
          {label}
        </text>
      </svg>
    </div>
  );
}
