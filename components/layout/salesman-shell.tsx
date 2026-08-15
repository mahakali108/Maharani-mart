'use client';

import { ClipboardList, LayoutDashboard, PlusCircle, Store, UserCircle } from 'lucide-react';
import { Topbar } from '@/components/layout/topbar';
import { MobileBottomNav, type NavItem } from '@/components/layout/mobile-bottom-nav';
import type { UserRole } from '@/lib/auth/roles';

const NAV_ITEMS: NavItem[] = [
  { label: 'Home', href: '/salesman/dashboard', icon: LayoutDashboard },
  { label: 'Retailers', href: '/salesman/retailers', icon: Store },
  { label: 'New Order', href: '/salesman/orders/new', icon: PlusCircle },
  { label: 'Orders', href: '/salesman/orders', icon: ClipboardList },
  { label: 'Profile', href: '/salesman/profile', icon: UserCircle },
];

export function SalesmanShell({
  fullName,
  role,
  children,
}: {
  fullName: string;
  role: UserRole;
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-screen bg-ink-50 pb-20">
      <Topbar fullName={fullName} role={role} />
      <main className="mx-auto w-full max-w-6xl p-4 sm:p-6">{children}</main>
      <MobileBottomNav navItems={NAV_ITEMS} />
    </div>
  );
}
