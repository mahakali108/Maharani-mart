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

export function Sidebar({
  navItems,
  brandLabel,
  open,
  onClose,
}: {
  navItems: NavItem[];
  brandLabel: string;
  open?: boolean;
  onClose?: () => void;
}) {
  const pathname = usePathname();

  return (
    <>
      {/* Mobile overlay */}
      {open ? (
        <div
          className="fixed inset-0 z-40 bg-black/40 lg:hidden"
          onClick={onClose}
          aria-hidden="true"
        />
      ) : null}

      <aside
        className={cn(
          'fixed inset-y-0 left-0 z-50 flex w-64 flex-col bg-ink-950 text-white transition-transform duration-200 lg:static lg:translate-x-0',
          open ? 'translate-x-0' : '-translate-x-full'
        )}
      >
        <div className="flex h-16 items-center gap-3 border-b border-white/10 px-5">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary-600 font-bold">
            MK
          </div>
          <div>
            <p className="text-sm font-semibold leading-tight">Maa Kali B2B</p>
            <p className="text-xs leading-tight text-ink-400">{brandLabel}</p>
          </div>
        </div>

        <nav className="flex-1 space-y-1 overflow-y-auto px-3 py-4 scrollbar-thin">
          {navItems.map((item) => {
            const active = pathname === item.href || pathname.startsWith(item.href + '/');
            const Icon = item.icon;
            return (
              <Link
                key={item.href}
                href={item.href}
                onClick={onClose}
                className={cn(
                  'flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-colors',
                  active
                    ? 'bg-primary-600 text-white'
                    : 'text-ink-300 hover:bg-white/5 hover:text-white'
                )}
              >
                <Icon className="h-[18px] w-[18px] shrink-0" />
                {item.label}
              </Link>
            );
          })}
        </nav>

        <div className="border-t border-white/10 px-5 py-4">
          <p className="text-xs text-ink-500">Khagaria District FMCG Network</p>
        </div>
      </aside>
    </>
  );
}
