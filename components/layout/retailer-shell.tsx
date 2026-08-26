'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  BadgeCheck,
  Bell,
  Home,
  LayoutGrid,
  LogOut,
  ShieldCheck,
  ShoppingCart,
  Sparkles,
  UserRound,
} from 'lucide-react';
import { logoutAction } from '@/lib/auth/actions';
import { ROLE_LABELS, type UserRole } from '@/lib/auth/roles';
import { cn } from '@/lib/utils/cn';
import { MobileBottomNav, type NavItem } from '@/components/layout/mobile-bottom-nav';
import { SearchField } from '@/components/retailer/search-field';

const DESKTOP_NAV = [
  { label: 'Home', href: '/retailer/home' },
  { label: 'Categories', href: '/retailer/categories' },
  { label: 'Brands', href: '/retailer/brands' },
  { label: 'Cart', href: '/retailer/cart' },
  { label: 'Account', href: '/retailer/account' },
];

function CountBadge({ count }: { count: number }) {
  if (count < 1) return null;
  return (
    <span className="absolute -right-1.5 -top-1.5 flex min-w-[18px] items-center justify-center rounded-full border-2 border-white bg-amber-400 px-1 text-[9px] font-bold leading-[14px] text-slate-950">
      {count > 99 ? '99+' : count}
    </span>
  );
}

export function RetailerShell({
  fullName,
  role,
  cartCount = 0,
  unreadCount = 0,
  children,
}: {
  fullName: string;
  role: UserRole;
  cartCount?: number;
  unreadCount?: number;
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const initials = fullName
    .split(' ')
    .map((part) => part[0])
    .filter(Boolean)
    .slice(0, 2)
    .join('')
    .toUpperCase();

  // Keep the primary retail IA reserved for shopping. Operational tools stay
  // in Account and contextual links rather than taking a bottom-nav slot.
  const mobileNav: NavItem[] = [
    { label: 'Home', href: '/retailer/home', icon: Home },
    { label: 'Categories', href: '/retailer/categories', icon: LayoutGrid },
    { label: 'Brands', href: '/retailer/brands', icon: BadgeCheck },
    { label: 'Cart', href: '/retailer/cart', icon: ShoppingCart, badge: cartCount },
    { label: 'Account', href: '/retailer/account', icon: UserRound },
  ];

  return (
    <div className="retailer-theme min-h-screen bg-[#f4f6f8] pb-24 text-slate-900 lg:pb-0">
      <div className="hidden bg-slate-950 text-white lg:block">
        <div className="mx-auto flex h-8 max-w-7xl items-center justify-between px-6 text-[11px]">
          <p className="flex items-center gap-2 text-slate-300">
            <ShieldCheck className="h-3.5 w-3.5 text-emerald-400" />
            Verified wholesale pricing · GST-ready orders · Secure retailer credit
          </p>
          <p className="text-slate-400">B2B marketplace for retailers</p>
        </div>
      </div>

      <header className="sticky top-0 z-40 border-b border-primary-700 bg-primary-600 text-white shadow-[0_4px_18px_rgba(30,64,175,0.18)] lg:border-slate-200 lg:bg-white lg:text-slate-900 lg:shadow-sm">
        <div className="mx-auto max-w-7xl px-4 sm:px-6">
          <div className="flex h-14 items-center gap-3 lg:h-[4.5rem] lg:gap-6">
            <Link href="/retailer/home" className="group flex shrink-0 items-center gap-2" aria-label="Maharani Traders home">
              <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-white text-base font-black text-primary-600 shadow-sm lg:bg-primary-600 lg:text-white">
                M
              </span>
              <span className="leading-none">
                <span className="block text-[15px] font-bold tracking-tight lg:text-lg">Maharani Traders</span>
                <span className="mt-1 hidden text-[9px] font-semibold uppercase tracking-[0.22em] text-primary-100 lg:block lg:text-primary-600">
                  Wholesale marketplace
                </span>
              </span>
            </Link>

            <div className="relative hidden flex-1 lg:block">
              <SearchField />
            </div>

            <div className="ml-auto flex items-center gap-1.5 lg:gap-2">
              <Link
                href="/retailer/notifications"
                className="relative flex h-10 w-10 items-center justify-center rounded-xl text-white transition hover:bg-white/10 lg:border lg:border-slate-200 lg:text-slate-600 lg:hover:bg-slate-50"
                aria-label="Notifications"
              >
                <Bell className="h-5 w-5" />
                <CountBadge count={unreadCount} />
              </Link>
              <Link
                href="/retailer/cart"
                className="relative flex h-10 w-10 items-center justify-center rounded-xl text-white transition hover:bg-white/10 lg:border lg:border-slate-200 lg:text-slate-600 lg:hover:bg-slate-50"
                aria-label="Cart"
              >
                <ShoppingCart className="h-5 w-5" />
                <CountBadge count={cartCount} />
              </Link>

              <Link
                href="/retailer/account"
                className="ml-1 flex h-10 w-10 items-center justify-center rounded-xl text-white transition hover:bg-white/10 lg:h-auto lg:w-auto lg:items-center lg:gap-2 lg:rounded-none lg:border-l lg:border-slate-200 lg:pl-3 lg:text-slate-900 lg:hover:bg-transparent"
                aria-label="Account"
              >
                <UserRound className="h-5 w-5 lg:hidden" />
                <span className="hidden h-9 w-9 items-center justify-center rounded-xl bg-primary-50 text-xs font-bold text-primary-700 lg:flex">
                  {initials || 'R'}
                </span>
                <span className="hidden max-w-[130px] leading-tight lg:block">
                  <span className="block truncate text-xs font-semibold text-slate-900">{fullName}</span>
                  <span className="mt-0.5 block text-[10px] text-slate-500">{ROLE_LABELS[role]}</span>
                </span>
              </Link>
              <form action={logoutAction} className="hidden lg:block">
                <button
                  type="submit"
                  className="ml-1 flex h-9 w-9 items-center justify-center rounded-lg text-slate-400 transition hover:bg-primary-50 hover:text-primary-600"
                  aria-label="Sign out"
                  title="Sign out"
                >
                  <LogOut className="h-4 w-4" />
                </button>
              </form>
            </div>
          </div>

          <div className="relative pb-3 lg:hidden">
            <SearchField />
          </div>
        </div>

        <div className="hidden border-t border-slate-100 lg:block">
          <div className="mx-auto flex h-11 max-w-7xl items-center justify-between px-6">
            <nav className="flex h-full items-center gap-7" aria-label="Marketplace navigation">
              {DESKTOP_NAV.map((item) => {
                const pathOnly = item.href.split('#')[0];
                const active = pathname === pathOnly || (pathOnly !== '/retailer/home' && pathname.startsWith(pathOnly + '/'));
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    className={cn(
                      'relative flex h-full items-center text-xs font-semibold transition-colors',
                      active ? 'text-primary-600' : 'text-slate-600 hover:text-primary-600'
                    )}
                  >
                    {item.label}
                    {active ? <span className="absolute inset-x-0 bottom-0 h-0.5 rounded-t bg-primary-600" /> : null}
                  </Link>
                );
              })}
            </nav>
            <Link href="/retailer/quick-order" className="flex items-center gap-1.5 text-xs font-semibold text-primary-600">
              <Sparkles className="h-3.5 w-3.5" />
              Order faster with Quick Order
            </Link>
          </div>
        </div>
      </header>

      <main className="mx-auto w-full max-w-7xl px-3 py-4 sm:px-6 sm:py-6 lg:py-8">{children}</main>
      <MobileBottomNav navItems={mobileNav} marketplace />
    </div>
  );
}
