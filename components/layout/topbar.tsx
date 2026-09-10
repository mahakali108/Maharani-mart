'use client';

import { Bell, Menu } from 'lucide-react';
import { logoutAction } from '@/lib/auth/actions';
import { ROLE_LABELS, type UserRole } from '@/lib/auth/roles';

export function Topbar({
  fullName,
  role,
  onMenuClick,
}: {
  fullName: string;
  role: UserRole;
  onMenuClick?: () => void;
}) {
  const initials = fullName
    .split(' ')
    .map((p) => p[0])
    .slice(0, 2)
    .join('')
    .toUpperCase();

  return (
    <header className="sticky top-0 z-30 flex min-h-[4rem] items-center justify-between gap-2 border-b border-ink-100 bg-white/95 px-3 pb-0 pt-[env(safe-area-inset-top)] backdrop-blur sm:px-6">
      <div className="flex min-w-0 items-center gap-1">
        {onMenuClick ? (
          <button
            onClick={onMenuClick}
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-ink-500 transition hover:bg-ink-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-300 lg:hidden"
            aria-label="Open menu"
          >
            <Menu className="h-5 w-5" />
          </button>
        ) : null}
        {/* Compact brand on phones so the drawer-driven consoles still feel
            like an app; hidden on desktop where the sidebar shows it. */}
        <span className="truncate text-sm font-bold tracking-tight text-ink-900 lg:hidden">
          Maharani Traders
        </span>
      </div>

      <div className="flex min-w-0 shrink-0 items-center gap-1 sm:gap-2">
        <button
          className="relative flex h-11 w-11 items-center justify-center rounded-xl text-ink-500 transition hover:bg-ink-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-300"
          aria-label="Notifications"
        >
          <Bell className="h-5 w-5" />
        </button>

        <div className="flex min-w-0 items-center gap-2">
          <div className="hidden min-w-0 text-right sm:block">
            <p className="max-w-[160px] truncate text-sm font-medium leading-tight text-ink-900">{fullName}</p>
            <p className="text-xs leading-tight text-ink-400">{ROLE_LABELS[role]}</p>
          </div>
          <div
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary-600 text-sm font-semibold text-white"
            aria-hidden="true"
          >
            {initials || 'U'}
          </div>
          <form action={logoutAction} className="shrink-0">
            <button
              type="submit"
              className="flex h-9 items-center rounded-lg border border-ink-200 px-2.5 text-xs font-medium text-ink-600 transition hover:bg-ink-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-300 sm:px-3"
            >
              Sign out
            </button>
          </form>
        </div>
      </div>
    </header>
  );
}
