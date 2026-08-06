'use client';

import { Home, LayoutGrid, ShoppingCart, ClipboardList, Bell } from 'lucide-react';
import { Topbar } from '@/components/layout/topbar';
import { MobileBottomNav, type NavItem } from '@/components/layout/mobile-bottom-nav';
import type { UserRole } from '@/lib/auth/roles';

const NAV_ITEMS: NavItem[] = [
  { label: 'Home', href: '/retailer/home', icon: Home },
  { label: 'Catalog', href: '/retailer/catalog', icon: LayoutGrid },
  { label: 'Cart', href: '/retailer/cart', icon: ShoppingCart },
  { label: 'Orders', href: '/retailer/orders', icon: ClipboardList },
  { label: 'Alerts', href: '/retailer/notifications', icon: Bell },
];

export function RetailerShell({
  fullName,
  role,
  children,
}: {
  fullName: string;
  role: UserRole;
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-screen bg-ink-50 pb-16">
      <Topbar fullName={fullName} role={role} />
      <main className="p-4 sm:p-6">{children}</main>
      <MobileBottomNav navItems={NAV_ITEMS} />
    </div>
  );
}
