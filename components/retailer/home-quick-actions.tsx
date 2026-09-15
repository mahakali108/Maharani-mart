'use client';

import { useRef } from 'react';
import Link from 'next/link';
import { BadgePercent, Headset, LayoutGrid, RotateCcw, Search, ShoppingCart } from 'lucide-react';
import { SearchField } from '@/components/retailer/search-field';

const actions = [
  { label: 'Browse catalog', href: '/retailer/catalog', icon: LayoutGrid },
  { label: 'View cart', href: '/retailer/cart', icon: ShoppingCart },
  { label: 'Reorder', href: '#home-reorder', icon: RotateCcw },
  { label: 'View offers', href: '/retailer/schemes', icon: BadgePercent },
  { label: 'Contact support', href: '/retailer/help', icon: Headset },
];
const actionClass = 'group flex min-w-0 flex-col items-center justify-center gap-1.5 rounded-xl border border-slate-100 bg-white px-1.5 py-2.5 text-center sm:gap-2 sm:py-3 text-[10px] font-medium text-slate-700 transition hover:border-action-200 hover:bg-action-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-action-500 sm:text-xs';
const iconClass = 'flex h-8 w-8 items-center sm:h-9 sm:w-9 justify-center rounded-xl bg-action-50 text-action-700 group-hover:bg-white';

export function HomeQuickActions() {
  const input = useRef<HTMLInputElement>(null);
  return (
    <section aria-label="Search and quick actions" className="space-y-3">
      <SearchField variant="hero" inputRef={input} />
      <nav aria-label="Quick actions" className="grid grid-cols-3 gap-2 sm:grid-cols-6 sm:gap-3">
        <button type="button" onClick={() => input.current?.focus()} className={actionClass}>
          <span className={iconClass}><Search className="h-[18px] w-[18px]" aria-hidden="true" /></span><span>Search products</span>
        </button>
        {actions.map(({ label, href, icon: Icon }) => <Link href={href} key={label} className={actionClass}>
          <span className={iconClass}><Icon className="h-[18px] w-[18px]" aria-hidden="true" /></span><span>{label}</span>
        </Link>)}
      </nav>
    </section>
  );
}
