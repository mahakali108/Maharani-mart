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
    <header className="sticky top-0 z-30 flex h-16 items-center justify-between border-b border-ink-100 bg-white/95 px-4 backdrop-blur sm:px-6">
      <div className="flex items-center gap-3">
        {onMenuClick ? (
          <button
            onClick={onMenuClick}
            className="rounded-lg p-2 text-ink-500 hover:bg-ink-50 lg:hidden"
            aria-label="Open menu"
          >
            <Menu className="h-5 w-5" />
          </button>
        ) : null}
      </div>

      <div className="flex items-center gap-4">
        <button
          className="relative rounded-lg p-2 text-ink-500 hover:bg-ink-50"
          aria-label="Notifications"
        >
          <Bell className="h-5 w-5" />
        </button>

        <div className="flex items-center gap-3">
          <div className="hidden text-right sm:block">
            <p className="text-sm font-medium leading-tight text-ink-900">{fullName}</p>
            <p className="text-xs leading-tight text-ink-400">{ROLE_LABELS[role]}</p>
          </div>
          <div className="flex h-9 w-9 items-center justify-center rounded-full bg-primary-600 text-sm font-semibold text-white">
            {initials || 'U'}
          </div>
          <form action={logoutAction}>
            <button
              type="submit"
              className="rounded-lg border border-ink-200 px-3 py-1.5 text-xs font-medium text-ink-600 hover:bg-ink-50"
            >
              Sign out
            </button>
          </form>
        </div>
      </div>
    </header>
  );
}
