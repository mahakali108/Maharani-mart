import type { ReactNode } from 'react';
import Link from 'next/link';
import type { LucideIcon } from 'lucide-react';
import { AlertTriangle, Inbox } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { cn } from '@/lib/utils/cn';
import type { SectionStatus, Severity } from '@/lib/admin/command-center/types';

/** Currency + percent formatters shared by all Command Center sections. */
export function inr(value: number): string {
  return `₹${Number(value ?? 0).toLocaleString('en-IN', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
}

export function inrExact(value: number): string {
  return `₹${Number(value ?? 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export function pct(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return '—';
  const sign = value > 0 ? '+' : '';
  return `${sign}${Math.round(value * 10) / 10}%`;
}

export function dateTime(iso: string): string {
  return new Date(iso).toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
}

export function dateOnly(iso: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
}

export function SeverityBadge({ severity }: { severity: Severity }) {
  const cls =
    severity === 'urgent'
      ? 'bg-red-600 text-white'
      : severity === 'high'
        ? 'bg-amber-100 text-amber-800'
        : 'bg-blue-50 text-blue-700';
  return <span className={cn('inline-flex shrink-0 rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide', cls)}>{severity}</span>;
}

export function TagPill({ label, tone = 'default' }: { label: string; tone?: 'default' | 'bad' | 'good' | 'warn' }) {
  const cls =
    tone === 'bad'
      ? 'bg-red-50 text-red-700'
      : tone === 'good'
        ? 'bg-emerald-50 text-emerald-700'
        : tone === 'warn'
          ? 'bg-amber-50 text-amber-700'
          : 'bg-ink-50 text-ink-600';
  return <span className={cn('inline-flex rounded-full px-2 py-0.5 text-[10px] font-semibold', cls)}>{label}</span>;
}

export function tagTone(tag: string): 'default' | 'bad' | 'good' | 'warn' {
  if (tag === 'Inactive' || tag === 'Declining' || tag === 'Over credit limit') return 'bad';
  if (tag === 'Increasing' || tag === 'High value') return 'good';
  if (tag === 'New') return 'warn';
  return 'default';
}

/** Section shell: title row + honest error handling for a degraded section. */
export function Section({
  title,
  subtitle,
  icon: Icon,
  status = 'ok',
  children,
  actions,
}: {
  title: string;
  subtitle?: string;
  icon: LucideIcon;
  status?: SectionStatus;
  children: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <section className="space-y-3" aria-label={title}>
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div className="flex items-center gap-2.5">
          <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary-50">
            <Icon className="h-4 w-4 text-primary-600" />
          </span>
          <div>
            <h2 className="text-sm font-semibold text-ink-900">{title}</h2>
            {subtitle ? <p className="text-xs text-ink-500">{subtitle}</p> : null}
          </div>
        </div>
        {actions ? <div className="flex items-center gap-2">{actions}</div> : null}
      </div>
      {status === 'unavailable' ? (
        <Card className="flex items-center gap-3 border-amber-200 bg-amber-50/50 p-4">
          <AlertTriangle className="h-5 w-5 shrink-0 text-amber-600" />
          <div>
            <p className="text-sm font-medium text-amber-900">This section could not be loaded.</p>
            <p className="text-xs text-amber-700">
              The underlying data source failed for this render — other sections are unaffected. Reload the page to retry.
            </p>
          </div>
        </Card>
      ) : (
        children
      )}
    </section>
  );
}

/** First-class empty state used by every data table/list in the Command Center. */
export function SectionEmptyState({ title, body }: { title: string; body: string }) {
  return (
    <Card className="flex flex-col items-center justify-center border-dashed p-10 text-center">
      <Inbox className="h-6 w-6 text-ink-300" />
      <p className="mt-2 text-sm font-semibold text-ink-700">{title}</p>
      <p className="mt-1 max-w-sm text-xs text-ink-500">{body}</p>
    </Card>
  );
}

/** Thin, accessible data table matching the admin visual language. */
export function DataTable({
  headers,
  children,
  caption,
}: {
  headers: string[];
  children: ReactNode;
  caption?: string;
}) {
  return (
    <Card className="overflow-hidden p-0">
      <div className="overflow-x-auto">
        <table className="w-full min-w-[640px] text-sm">
          {caption ? <caption className="sr-only">{caption}</caption> : null}
          <thead>
            <tr className="border-b border-ink-100 bg-ink-50/60 text-left">
              {headers.map((header) => (
                <th key={header} scope="col" className="px-4 py-2.5 text-[11px] font-semibold uppercase tracking-wide text-ink-500">
                  {header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-ink-50">{children}</tbody>
        </table>
      </div>
    </Card>
  );
}

export function Td({ children, className }: { children?: ReactNode; className?: string }) {
  return <td className={cn('px-4 py-2.5 align-top text-ink-800', className)}>{children}</td>;
}

export function LinkPill({ href, children }: { href: string; children: ReactNode }) {
  return (
    <Link
      href={href}
      className="inline-flex items-center rounded-lg border border-ink-200 bg-white px-2.5 py-1.5 text-xs font-semibold text-ink-700 transition hover:border-primary-300 hover:text-primary-700"
    >
      {children}
    </Link>
  );
}

export function GrowthText({ value }: { value: number | null }) {
  if (value === null) return <span className="text-xs text-ink-400">No prior data</span>;
  const cls = value > 0 ? 'text-emerald-600' : value < 0 ? 'text-red-600' : 'text-ink-500';
  return <span className={cn('text-xs font-semibold', cls)}>{pct(value)}</span>;
}
