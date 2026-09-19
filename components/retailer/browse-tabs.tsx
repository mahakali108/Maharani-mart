import Link from 'next/link';
import { BadgeCheck, LayoutGrid } from 'lucide-react';
import { cn } from '@/lib/utils/cn';

/**
 * The two independent catalog dimensions: Categories and Brands.
 *
 * Rendered side by side on both directory pages so a retailer can switch
 * between the two with one tap (mobile-first). They are siblings — a brand is
 * never entered through a category and vice versa.
 */
export function BrowseTabs({ active }: { active: 'categories' | 'brands' }) {
  const tabs = [
    { id: 'categories' as const, label: 'Categories', href: '/retailer/categories', Icon: LayoutGrid },
    { id: 'brands' as const, label: 'Brands', href: '/retailer/brands', Icon: BadgeCheck },
  ];

  return (
    <nav aria-label="Browse the catalog" className="grid grid-cols-2 gap-1 rounded-2xl border border-slate-200 bg-slate-50 p-1">
      {tabs.map(({ id, label, href, Icon }) => {
        const isActive = id === active;
        return (
          <Link
            key={id}
            href={href}
            aria-current={isActive ? 'page' : undefined}
            className={cn(
              'flex min-h-11 items-center justify-center gap-1.5 rounded-xl px-2 text-xs font-bold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-300',
              isActive
                ? 'bg-white text-primary-700 shadow-sm ring-1 ring-slate-200'
                : 'text-slate-600 hover:text-primary-700'
            )}
          >
            <Icon className="h-4 w-4" aria-hidden="true" />
            {label}
          </Link>
        );
      })}
    </nav>
  );
}
