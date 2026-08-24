'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn } from '@/lib/utils/cn';

const TABS = [
  { label: 'Overview', href: '/admin/inventory' },
  { label: 'Products', href: '/admin/inventory/products' },
  { label: 'Batches', href: '/admin/inventory/batches' },
  { label: 'Movements', href: '/admin/inventory/movements' },
  { label: 'Expiry', href: '/admin/inventory/expiry' },
  { label: 'Low Stock', href: '/admin/inventory/low-stock' },
  { label: 'GRNs', href: '/admin/inventory/grn' },
  { label: 'Transfers', href: '/admin/inventory/transfers' },
  { label: 'Reports', href: '/admin/inventory/reports' },
];

/**
 * Sub-navigation for the Inventory Management section. Lives inside the
 * existing admin layout — this is a tab bar, not a second admin system.
 */
export function InventoryNav() {
  const pathname = usePathname();

  return (
    <div className="scrollbar-thin -mx-1 flex gap-1 overflow-x-auto px-1 pb-1">
      {TABS.map((tab) => {
        const active =
          tab.href === '/admin/inventory'
            ? pathname === '/admin/inventory'
            : pathname === tab.href || pathname.startsWith(tab.href + '/');
        return (
          <Link
            key={tab.href}
            href={tab.href}
            className={cn(
              'whitespace-nowrap rounded-lg px-3 py-1.5 text-sm font-medium transition-colors',
              active ? 'bg-primary-600 text-white' : 'bg-white text-ink-600 hover:bg-ink-100'
            )}
          >
            {tab.label}
          </Link>
        );
      })}
    </div>
  );
}
