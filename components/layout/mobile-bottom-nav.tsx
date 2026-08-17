'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils/cn';

export interface NavItem {
  label: string;
  href: string;
  icon: LucideIcon;
  badge?: number;
}

export function MobileBottomNav({
  navItems,
  marketplace = false,
}: {
  navItems: NavItem[];
  marketplace?: boolean;
}) {
  const pathname = usePathname();

  return (
    <nav
      className={cn(
        'fixed inset-x-0 bottom-0 z-40 flex items-stretch border-t bg-white/95 backdrop-blur-xl lg:hidden',
        marketplace
          ? 'h-[calc(4.25rem+env(safe-area-inset-bottom))] border-slate-200 px-1 pb-[env(safe-area-inset-bottom)] shadow-[0_-8px_30px_rgba(15,23,42,0.08)]'
          : 'h-16 border-ink-100'
      )}
      aria-label="Primary navigation"
    >
      {navItems.map((item) => {
        const hasMoreSpecificMatch = navItems.some(
          (candidate) =>
            candidate.href !== item.href &&
            candidate.href.startsWith(item.href + '/') &&
            (pathname === candidate.href || pathname.startsWith(candidate.href + '/'))
        );
        const active = !hasMoreSpecificMatch && (pathname === item.href || pathname.startsWith(item.href + '/'));
        const Icon = item.icon;

        return (
          <Link
            key={item.href}
            href={item.href}
            className={cn(
              'group relative flex flex-1 flex-col items-center justify-center font-medium transition-colors',
              marketplace ? 'gap-0.5 text-[10px]' : 'gap-1 text-[11px]',
              active ? 'text-primary-600' : marketplace ? 'text-slate-500' : 'text-ink-400'
            )}
            aria-current={active ? 'page' : undefined}
          >
            {marketplace && active ? (
              <span className="absolute top-0 h-0.5 w-8 rounded-b-full bg-primary-600" />
            ) : null}
            <span
              className={cn(
                'relative flex items-center justify-center transition-transform group-active:scale-90',
                marketplace && active ? 'h-8 w-11 rounded-2xl bg-primary-50' : 'h-8 w-9'
              )}
            >
              <Icon className={cn('h-5 w-5', active && marketplace && 'stroke-[2.5]')} />
              {item.badge && item.badge > 0 ? (
                <span className="absolute -right-1 -top-0.5 flex min-w-[17px] items-center justify-center rounded-full border-2 border-white bg-primary-600 px-1 text-[9px] font-bold leading-[13px] text-white">
                  {item.badge > 99 ? '99+' : item.badge}
                </span>
              ) : null}
            </span>
            <span>{item.label}</span>
          </Link>
        );
      })}
    </nav>
  );
}
