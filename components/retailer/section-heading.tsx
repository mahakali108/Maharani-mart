import Link from 'next/link';
import { ChevronRight } from 'lucide-react';

export function SectionHeading({
  eyebrow,
  title,
  href,
  linkLabel = 'View all',
}: {
  eyebrow?: string;
  title: string;
  href?: string;
  linkLabel?: string;
}) {
  return (
    <div className="flex min-w-0 flex-wrap items-end justify-between gap-x-3 gap-y-1">
      <div className="min-w-0">
        {eyebrow ? (
          <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-primary-600">{eyebrow}</p>
        ) : null}
        <h2 className="mt-0.5 text-base font-bold tracking-tight text-slate-900 sm:text-xl">{title}</h2>
      </div>
      {href ? (
        <Link href={href} className="flex min-h-11 max-w-full items-center gap-1 rounded text-[11px] font-semibold text-action-700 hover:text-action-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-action-500 sm:text-xs">
          {linkLabel}
          <ChevronRight aria-hidden="true" className="h-3.5 w-3.5" />
        </Link>
      ) : null}
    </div>
  );
}
