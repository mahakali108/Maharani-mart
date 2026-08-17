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
    <div className="flex items-end justify-between gap-3">
      <div>
        {eyebrow ? (
          <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-primary-600">{eyebrow}</p>
        ) : null}
        <h2 className="mt-0.5 text-base font-bold tracking-tight text-slate-900 sm:text-xl">{title}</h2>
      </div>
      {href ? (
        <Link href={href} className="flex shrink-0 items-center gap-1 text-[11px] font-bold text-primary-600 hover:text-primary-700 sm:text-xs">
          {linkLabel}
          <ChevronRight className="h-3.5 w-3.5" />
        </Link>
      ) : null}
    </div>
  );
}
