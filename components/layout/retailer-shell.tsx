'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useRef, useState } from 'react';
import {
  ArrowLeft,
  ClipboardList,
  Bell,
  Heart,
  Home,
  LayoutGrid,
  LogOut,
  MapPin,
  Search,
  ShoppingCart,
  Sparkles,
  UserRound,
} from 'lucide-react';
import { logoutAction } from '@/lib/auth/actions';
import { ROLE_LABELS, type UserRole } from '@/lib/auth/roles';
import { cn } from '@/lib/utils/cn';
import { PolicyLinks } from '@/components/legal/policy-links';
import type { FooterLink } from '@/lib/site-content/types';
import { MobileBottomNav, type NavItem } from '@/components/layout/mobile-bottom-nav';
import { SearchField } from '@/components/retailer/search-field';
import { BRAND, BRAND_WITH_TRADING_STYLE } from '@/lib/brand';

const DESKTOP_NAV = [
  { label: 'Home', href: '/retailer/home' },
  { label: 'Catalogue', href: '/retailer/catalog' },
  { label: 'Categories', href: '/retailer/categories' },
  { label: 'Brands', href: '/retailer/brands' },
  { label: 'Cart', href: '/retailer/cart' },
  { label: 'Orders', href: '/retailer/orders' },
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
  footerLinks,
  children,
}: {
  fullName: string;
  /** Pre-resolved area label. Missing profile information is not invented. */
  areaName?: string | null;
  role: UserRole;
  cartCount?: number;
  unreadCount?: number;
  /** Footer navigation from managed website content (loadFooterLinks()). */
  footerLinks: FooterLink[];
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const router = useRouter();
  // Mobile search bar visibility: the header keeps a dedicated search icon
  // that toggles the field row and hands focus straight to the input, so the
  // icon is a real control (never decorative) and the header stays compact.
  const [searchOpen, setSearchOpen] = useState(false);
  const searchInputRef = useRef<HTMLInputElement>(null);
  // Reset on a pathname change during render, before showing the next page.
  // This also keeps search closed when returning to a previously visited path.
  const [searchPathname, setSearchPathname] = useState(pathname);
  if (pathname !== searchPathname) {
    setSearchPathname(pathname);
    setSearchOpen(false);
  }
  function handleSearchToggle() {
    const next = !searchOpen;
    setSearchOpen(next);
    if (next) {
      // Wait for the row to mount before focusing the freshly rendered input.
      window.requestAnimationFrame(() => searchInputRef.current?.focus());
    }
  }
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

  // Primary shopping routes. Brands remain in desktop navigation and on home.
  const mobileNav: NavItem[] = [
    { label: 'Home', href: '/retailer/home', icon: Home },
    { label: 'Catalogue', href: '/retailer/catalog', icon: LayoutGrid },
    { label: 'Cart', href: '/retailer/cart', icon: ShoppingCart, badge: cartCount },
    { label: 'Orders', href: '/retailer/orders', icon: ClipboardList },
    { label: 'Account', href: '/retailer/account', icon: UserRound },
  ];

  return (
    <div className="retailer-theme min-h-screen min-w-0 w-full bg-ivory-100 pb-24 text-slate-900 lg:pb-0">
      <a href="#retailer-main" className="sr-only z-50 rounded-lg bg-white p-3 text-action-700 focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:inline-flex focus:min-h-11 focus:items-center">Skip to content</a>
      <div className="hidden border-b border-mint-200 bg-mint-100 px-5 py-2 text-center text-[11px] font-medium text-mint-700 lg:block">Made for your everyday business · Wholesale piece pricing · Packs &amp; MOQ clearly shown</div>
      <header className="sticky top-0 z-40 border-b border-slate-200/80 bg-white/95 pt-[env(safe-area-inset-top)] text-slate-900 shadow-[0_1px_0_rgba(15,23,42,0.04)] backdrop-blur-md">
        <div className="mx-auto max-w-7xl px-3 sm:px-5">
          <div className="flex h-14 items-center gap-1.5 lg:h-16 lg:gap-5">
            {isProductDetail ? (
              <button
                type="button"
                onClick={handleBack}
                aria-label="Go back"
                className="-ml-1.5 flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-slate-700 transition hover:bg-slate-100 hover:text-primary-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-600 lg:-ml-1"
              >
                <ArrowLeft className="h-6 w-6" aria-hidden="true" strokeWidth={2.25} />
              </button>
            ) : null}
            <Link
              href="/retailer/home"
              className="group flex min-h-11 min-w-0 shrink items-center gap-1.5 rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-action-500 lg:gap-2.5"
              aria-label={`${BRAND.name} home`}
            >
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-lavender-100 text-sm font-black text-primary-600 shadow-sm lg:h-11 lg:w-11 lg:text-lg">
                M
              </span>
              <span className="min-w-0 leading-none">
                <span className="block truncate text-xs font-bold leading-4 text-slate-900 sm:hidden">Maharani</span>
                <span className="block truncate text-[10px] font-medium leading-3 text-slate-600 sm:hidden">Traders</span>
                <span className="hidden truncate text-[14px] font-bold tracking-tight text-slate-900 sm:block lg:text-lg">
                  {BRAND.name}
                </span>
                {areaName ? (
                  <span className="mt-0.5 hidden max-w-[240px] items-center gap-1 truncate text-[10px] font-semibold text-slate-500 lg:flex">
                    <span className="h-1 w-1 rounded-full bg-mint-500" aria-hidden="true" />
                    Delivering to {areaName}
                  </span>
                ) : null}
              </span>
            </Link>

            <div className="relative hidden flex-1 lg:block">
              <SearchField />
            </div>

            <div className="ml-auto flex shrink-0 items-center gap-0.5 sm:gap-1">
              <button
                type="button"
                onClick={handleSearchToggle}
                aria-label="Search"
                aria-expanded={searchOpen}
                aria-controls="retailer-mobile-search"
                className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-slate-700 transition hover:bg-slate-100 hover:text-primary-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-600 lg:hidden"
              >
                <Search className="h-[18px] w-[18px]" aria-hidden="true" />
              </button>
              <Link
                href="/retailer/notifications"
                className="relative flex h-11 w-11 items-center justify-center rounded-xl text-slate-600 transition hover:bg-slate-50 hover:text-primary-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-600"
                aria-label={`Notifications${unreadCount > 0 ? ` (${unreadCount} unread)` : ''}`}
              >
                <Bell className="h-[18px] w-[18px] lg:h-5 lg:w-5" aria-hidden="true" />
                <CountBadge count={unreadCount} />
              </Link>
              <Link
                href="/retailer/favorites"
                className="relative hidden h-11 w-11 items-center justify-center rounded-xl text-slate-600 transition hover:bg-slate-50 hover:text-primary-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-600 sm:flex"
                aria-label="Favourites"
              >
                <Heart className="h-[18px] w-[18px] lg:h-5 lg:w-5" aria-hidden="true" />
              </Link>
              <Link
                href="/retailer/cart"
                className="relative flex h-11 w-11 items-center justify-center rounded-xl text-slate-600 transition hover:bg-slate-50 hover:text-primary-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-600"
                aria-label={`Cart${cartCount > 0 ? ` (${cartCount} items)` : ''}`}
              >
                <ShoppingCart className="h-[18px] w-[18px] lg:h-5 lg:w-5" aria-hidden="true" />
                <CountBadge count={cartCount} />
              </Link>

              <Link
                href="/retailer/account"
                className="ml-0.5 flex h-11 w-11 items-center justify-center rounded-xl text-slate-600 transition hover:bg-slate-50 hover:text-primary-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-600 lg:ml-1 lg:h-auto lg:w-auto lg:min-h-11 lg:items-center lg:gap-2 lg:rounded-xl lg:bg-slate-50 lg:px-2.5 lg:py-1.5 lg:text-slate-900 lg:hover:bg-slate-100"
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
                  className="ml-1 flex h-11 w-11 items-center justify-center rounded-xl text-slate-400 transition hover:bg-slate-50 hover:text-primary-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-600"
                  aria-label="Sign out"
                  title="Sign out"
                >
                  <LogOut className="h-4 w-4" aria-hidden="true" />
                </button>
              </form>
            </div>
          </div>

          {searchOpen ? (
            <div id="retailer-mobile-search" className="relative pb-3 pt-1 lg:hidden">
              <SearchField inputRef={searchInputRef} />
            </div>
          ) : null}
          {areaName ? (
            <Link
              href="/retailer/account/addresses"
              className="flex min-h-11 items-center gap-2 border-t border-slate-100 py-1.5 text-[11px] text-slate-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-600 lg:hidden"
              aria-label={`Delivery area: ${areaName}. Manage delivery addresses`}
            >
              <MapPin className="h-4 w-4 shrink-0 text-sky-800" aria-hidden="true" />
              <span className="truncate">Delivering to <strong className="font-semibold text-slate-800">{areaName}</strong></span>
            </Link>
          ) : null}
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
                      'relative flex h-full min-w-11 items-center justify-center px-1 text-[12px] font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-600 focus-visible:ring-offset-2',
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
              className="flex min-h-11 items-center gap-1.5 px-2 text-[11px] font-semibold text-primary-600 hover:text-primary-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-600"
            >
              <Sparkles className="h-3.5 w-3.5" aria-hidden="true" />
              Quick order
            </Link>
          </div>
        </div>
      </header>

      <main id="retailer-main" tabIndex={-1} className="mx-auto min-w-0 w-full scroll-mt-20 lg:scroll-mt-32 max-w-7xl px-3 py-4 sm:px-5 sm:py-6 lg:py-8">{children}</main>
      <footer className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-2 border-t border-slate-200 px-5 pb-24 pt-4 text-xs text-slate-500 lg:pb-5">
        <span>{BRAND_WITH_TRADING_STYLE} · Wholesale PWA</span>
        <nav aria-label="Support and policies" className="flex flex-wrap items-center gap-x-4">
          <Link href="/retailer/help" className="inline-flex min-h-11 items-center hover:text-primary-600">Help</Link>
          <PolicyLinks links={footerLinks} ariaLabel="Support and policies" className="" linkClassName="inline-flex min-h-11 items-center hover:text-primary-600" />
        </nav>
      </footer>
      <MobileBottomNav navItems={mobileNav} marketplace />
    </div>
  );
}
