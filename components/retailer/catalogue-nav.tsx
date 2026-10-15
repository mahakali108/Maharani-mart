import Link from 'next/link';
import { Grid2X2, LayoutGrid, Tags } from 'lucide-react';
import { cn } from '@/lib/utils/cn';

/** All discovery modes are first-class members of Catalogue, on every device. */
export function CatalogueNav({ active }: { active: 'products' | 'categories' | 'brands' }) {
  return <nav aria-label="Catalogue sections" className="grid grid-cols-3 gap-1 rounded-2xl border border-slate-200 bg-white p-1.5 shadow-card sm:max-w-lg">
    {([
      ['products', 'Products', '/retailer/catalog', Grid2X2],
      ['categories', 'Categories', '/retailer/categories', LayoutGrid],
      ['brands', 'Brands', '/retailer/brands', Tags],
    ] as const).map(([key, label, href, Icon]) => <Link key={key} href={href} aria-current={active === key ? 'page' : undefined}
      className={cn('flex min-h-11 min-w-0 items-center justify-center gap-1.5 rounded-xl px-1 text-xs font-semibold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-600',
        active === key ? 'bg-blush-100 text-primary-700' : 'text-slate-600 hover:bg-ivory-100')}>
      <Icon className="hidden h-4 w-4 min-[360px]:block" aria-hidden="true" />{label}
    </Link>)}
  </nav>;
}
