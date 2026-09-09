'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import {
  ArrowLeft,
  BadgeCheck,
  Bell,
  Heart,
  Home,
  LayoutGrid,
  LogOut,
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
    <span className="absolute -right-1.5 -top-1.5 flex min-w-[18px] items-center justify-center rounded-full border-2 border-white bg-primary-600 px-1 text-[9px] font-bold leading-[14px] text-white">
      {count > 99 ? '99+' : count}
    </span>
  );
}

export function RetailerShell({
  fullName,
  areaName,
  role,
  cartCount = 0,
  unreadCount = 0,
  children,
}: {
  fullName: string;
  /** Pre-resolved area label, when available. Falls back to a neutral label. */
  areaName?: string | null;
  role: UserRole;
  cartCount?: number;
  unreadCount?: number;
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const initials = fullName
    .split(' ')
    .map((part) => part[0])
    .filter(Boolean)
    .slice(0, 2)
    .join('')
    .toUpperCase();

  // Product detail pages (parent product id or an exact variant/pack route —
  // both shapes use /retailer/catalog/<uuid>) get a compact back button in
  // the header. Every other retailer page keeps the existing header layout.
  const isProductDetail =
    /^\/retailer\/catalog\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(pathname);

  function handleBack() {
    // In-app navigation (App Router maintains history.state.idx) → real back.
    // Deep link / fresh open → land on the catalog instead of leaving the app.
    const idx = (window.history.state as { idx?: number } | null)?.idx ?? 0;
    if (idx > 0) router.back();
    else router.replace('/retailer/catalog');
  }

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
    <div className="retailer-theme min-h-screen bg-[#fafafa] pb-24 text-slate-900 lg:pb-0">
      <header className="sticky top-0 z-40 border-b border-slate-200/80 bg-white/95 pt-[env(safe-area-inset-top)] text-slate-900 shadow-[0_1px_0_rgba(15,23,42,0.04)] backdrop-blur-md">
        <div className="mx-auto max-w-7xl px-3 sm:px-5">
          <div className="flex h-14 items-center gap-1.5 lg:h-16 lg:gap-5">
            {isProductDetail ? (
              <button
                type="button"
                onClick={handleBack}
                aria-label="Go back"
                className="-ml-1.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-slate-600 transition hover:bg-slate-50 hover:text-primary-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-300 lg:-ml-1"
              >
                <ArrowLeft className="h-5 w-5" aria-hidden="true" />
              </button>
            ) : null}
            <Link
              href="/retailer/home"
              className="group flex min-w-0 shrink items-center gap-2.5"
              aria-label="Maharani Traders home"
            >
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-primary-600 text-sm font-black text-white shadow-sm lg:h-10 lg:w-10 lg:text-base">
                M
              </span>
              <span className="min-w-0 leading-none">
                <span className="block truncate text-[14px] font-bold tracking-tight text-slate-900 lg:text-lg">
                  Maharani Traders
                </span>
                {areaName ? (
                  <span className="mt-0.5 hidden items-center gap-1 text-[10px] font-semibold text-slate-500 lg:flex">
                    <span className="h-1 w-1 rounded-full bg-emerald-500" aria-hidden="true" />
                    Delivering to {areaName}
                  </span>
                ) : null}
              </span>
            </Link>

            <div className="relative hidden flex-1 lg:block">
              <SearchField />
            </div>

            <div className="ml-auto flex shrink-0 items-center gap-0.5 sm:gap-1">
              <Link
                href="/retailer/notifications"
                className="relative flex h-10 w-10 items-center justify-center rounded-xl text-slate-600 transition hover:bg-slate-50 hover:text-primary-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-300"
                aria-label={`Notifications${unreadCount > 0 ? ` (${unreadCount} unread)` : ''}`}
              >
                <Bell className="h-[18px] w-[18px] lg:h-5 lg:w-5" aria-hidden="true" />
                <CountBadge count={unreadCount} />
              </Link>
              <Link
                href="/retailer/favorites"
                className="relative hidden h-10 w-10 items-center justify-center rounded-xl text-slate-600 transition hover:bg-slate-50 hover:text-primary-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-300 sm:flex"
                aria-label="Favourites"
              >
                <Heart className="h-[18px] w-[18px] lg:h-5 lg:w-5" aria-hidden="true" />
              </Link>
              <Link
                href="/retailer/cart"
                className="relative flex h-10 w-10 items-center justify-center rounded-xl text-slate-600 transition hover:bg-slate-50 hover:text-primary-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-300"
                aria-label={`Cart${cartCount > 0 ? ` (${cartCount} items)` : ''}`}
              >
                <ShoppingCart className="h-[18px] w-[18px] lg:h-5 lg:w-5" aria-hidden="true" />
                <CountBadge count={cartCount} />
              </Link>

              <Link
                href="/retailer/account"
                className="ml-0.5 flex h-10 w-10 items-center justify-center rounded-xl text-slate-600 transition hover:bg-slate-50 hover:text-primary-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-300 lg:ml-1 lg:h-auto lg:w-auto lg:items-center lg:gap-2 lg:rounded-xl lg:bg-slate-50 lg:px-2.5 lg:py-1.5 lg:text-slate-900 lg:hover:bg-slate-100"
                aria-label="Account"
              >
                <UserRound className="h-[18px] w-[18px] lg:hidden" aria-hidden="true" />
                <span className="hidden h-7 w-7 items-center justify-center rounded-lg bg-primary-50 text-[11px] font-bold text-primary-700 lg:flex">
                  {initials || 'R'}
                </span>
                <span className="hidden max-w-[140px] leading-tight lg:block">
                  <span className="block truncate text-[12px] font-semibold text-slate-900">{fullName}</span>
                  <span className="mt-0.5 block text-[10px] text-slate-500">{ROLE_LABELS[role]}</span>
                </span>
              </Link>
              <form action={logoutAction} className="hidden lg:block">
                <button
                  type="submit"
                  className="ml-1 flex h-10 w-10 items-center justify-center rounded-xl text-slate-400 transition hover:bg-slate-50 hover:text-primary-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-300"
                  aria-label="Sign out"
                  title="Sign out"
                >
                  <LogOut className="h-4 w-4" aria-hidden="true" />
                </button>
              </form>
            </div>
          </div>

          <div className="relative pb-3 pt-1 lg:hidden">
            <SearchField />
          </div>
        </div>

        <div className="hidden border-t border-slate-100 bg-white lg:block">
          <div className="mx-auto flex h-11 max-w-7xl items-center justify-between px-5">
            <nav className="flex h-full items-center gap-7" aria-label="Marketplace navigation">
              {DESKTOP_NAV.map((item) => {
                const pathOnly = item.href.split('#')[0];
                const active =
                  pathname === pathOnly || (pathOnly !== '/retailer/home' && pathname.startsWith(pathOnly + '/'));
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    className={cn(
                      'relative flex h-full items-center text-[12px] font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-300 focus-visible:ring-offset-2',
                      active ? 'text-primary-600' : 'text-slate-600 hover:text-primary-600'
                    )}
                    aria-current={active ? 'page' : undefined}
                  >
                    {item.label}
                    {active ? (
                      <span className="absolute inset-x-0 bottom-0 h-0.5 rounded-t bg-primary-600" aria-hidden="true" />
                    ) : null}
                  </Link>
                );
              })}
            </nav>
            <Link
              href="/retailer/quick-order"
              className="flex items-center gap-1.5 text-[11px] font-semibold text-primary-600 hover:text-primary-700"
            >
              <Sparkles className="h-3.5 w-3.5" aria-hidden="true" />
              Quick order
            </Link>
          </div>
        </div>
      </header>

      <main className="mx-auto w-full max-w-7xl px-3 py-4 sm:px-5 sm:py-6 lg:py-7">{children}</main>
      <MobileBottomNav navItems={mobileNav} marketplace />
    </div>
  );
}
