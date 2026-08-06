'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils/cn';

export interface NavItem {
  label: string;
  href: string;
  icon: LucideIcon;
}

export function MobileBottomNav({ navItems }: { navItems: NavItem[] }) {
  const pathname = usePathname();

  return (
    <nav className="fixed inset-x-0 bottom-0 z-30 flex h-16 items-stretch border-t border-ink-100 bg-white/95 backdrop-blur lg:hidden">
      {navItems.map((item) => {
        const active = pathname === item.href || pathname.startsWith(item.href + '/');
        const Icon = item.icon;
        return (
          <Link
            key={item.href}
            href={item.href}
            className={cn(
              'flex flex-1 flex-col items-center justify-center gap-1 text-[11px] font-medium',
              active ? 'text-primary-600' : 'text-ink-400'
            )}
          >
            <Icon className="h-5 w-5" />
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
