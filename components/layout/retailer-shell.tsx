'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  Bell,
  ChevronRight,
  ClipboardList,
  Home,
  LayoutGrid,
  LogOut,
  Search,
  ShieldCheck,
  ShoppingCart,
  Sparkles,
  Zap,
} from 'lucide-react';
import { logoutAction } from '@/lib/auth/actions';
import { ROLE_LABELS, type UserRole } from '@/lib/auth/roles';
import { cn } from '@/lib/utils/cn';
import { MobileBottomNav, type NavItem } from '@/components/layout/mobile-bottom-nav';

const DESKTOP_NAV = [
  { label: 'Home', href: '/retailer/home' },
  { label: 'All products', href: '/retailer/catalog' },
  { label: 'Quick order', href: '/retailer/quick-order' },
  { label: 'Deals & offers', href: '/retailer/home#deals' },
  { label: 'My orders', href: '/retailer/orders' },
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

  const mobileNav: NavItem[] = [
    { label: 'Home', href: '/retailer/home', icon: Home },
    { label: 'Products', href: '/retailer/catalog', icon: LayoutGrid },
    { label: 'Quick', href: '/retailer/quick-order', icon: Zap },
    { label: 'Orders', href: '/retailer/orders', icon: ClipboardList },
    { label: 'Cart', href: '/retailer/cart', icon: ShoppingCart, badge: cartCount },
  ];

  return (
    <div className="min-h-screen bg-[#f4f6f8] pb-24 text-slate-900 lg:pb-0">
      <div className="hidden bg-slate-950 text-white lg:block">
        <div className="mx-auto flex h-8 max-w-7xl items-center justify-between px-6 text-[11px]">
          <p className="flex items-center gap-2 text-slate-300">
            <ShieldCheck className="h-3.5 w-3.5 text-emerald-400" />
            Verified wholesale pricing · GST-ready orders · Secure retailer credit
          </p>
          <p className="text-slate-400">B2B marketplace for retailers</p>
        </div>
      </div>

      <header className="sticky top-0 z-40 border-b border-primary-700 bg-primary-600 text-white shadow-[0_4px_18px_rgba(127,29,29,0.18)] lg:border-slate-200 lg:bg-white lg:text-slate-900 lg:shadow-sm">
        <div className="mx-auto max-w-7xl px-4 sm:px-6">
          <div className="flex h-14 items-center gap-3 lg:h-[4.5rem] lg:gap-6">
            <Link href="/retailer/home" className="group flex shrink-0 items-center gap-2" aria-label="Maharani Mart home">
              <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-white text-base font-black text-primary-600 shadow-sm lg:bg-primary-600 lg:text-white">
                M
              </span>
              <span className="leading-none">
                <span className="block text-[15px] font-bold tracking-tight lg:text-lg">Maharani Mart</span>
                <span className="mt-1 hidden text-[9px] font-semibold uppercase tracking-[0.22em] text-primary-100 lg:block lg:text-primary-600">
                  Wholesale marketplace
                </span>
              </span>
            </Link>

            <form action="/retailer/catalog" method="get" className="relative hidden flex-1 lg:block">
              <Search className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <input
                name="q"
                type="search"
                placeholder="Search products, brands or SKU codes"
                className="h-11 w-full rounded-xl border border-slate-200 bg-slate-50 pl-11 pr-28 text-sm text-slate-900 outline-none transition focus:border-primary-300 focus:bg-white focus:ring-4 focus:ring-primary-50"
              />
              <button
                type="submit"
                className="absolute right-1.5 top-1.5 h-8 rounded-lg bg-primary-600 px-5 text-xs font-semibold text-white transition hover:bg-primary-700"
              >
                Search
              </button>
            </form>

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

              <div className="ml-1 hidden items-center gap-2 border-l border-slate-200 pl-3 lg:flex">
                <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary-50 text-xs font-bold text-primary-700">
                  {initials || 'R'}
                </span>
                <div className="max-w-[130px] leading-tight">
                  <p className="truncate text-xs font-semibold text-slate-900">{fullName}</p>
                  <p className="mt-0.5 text-[10px] text-slate-500">{ROLE_LABELS[role]}</p>
                </div>
                <form action={logoutAction}>
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
          </div>

          <form action="/retailer/catalog" method="get" className="relative pb-3 lg:hidden">
            <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-[calc(50%+0.375rem)] text-slate-400" />
            <input
              name="q"
              type="search"
              placeholder="Search products, brands or SKU"
              className="h-10 w-full rounded-xl border-0 bg-white pl-10 pr-12 text-sm text-slate-900 shadow-sm outline-none placeholder:text-slate-400 focus:ring-2 focus:ring-amber-300"
            />
            <button
              type="submit"
              className="absolute right-1.5 top-1.5 flex h-7 w-9 items-center justify-center rounded-lg bg-slate-900 text-white"
              aria-label="Search"
            >
              <ChevronRight className="h-4 w-4" />
            </button>
          </form>
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
