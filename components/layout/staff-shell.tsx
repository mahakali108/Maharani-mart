'use client';

import { useState } from 'react';
import { LayoutDashboard, Package, Warehouse, ShoppingCart, BarChart3 } from 'lucide-react';
import { Sidebar, type NavItem } from '@/components/layout/sidebar';
import { Topbar } from '@/components/layout/topbar';
import type { UserRole } from '@/lib/auth/roles';

const NAV_ITEMS: NavItem[] = [
  { label: 'Dashboard', href: '/staff/dashboard', icon: LayoutDashboard },
  { label: 'Products', href: '/staff/products', icon: Package },
  { label: 'Inventory', href: '/staff/inventory', icon: Warehouse },
  { label: 'Orders', href: '/staff/orders', icon: ShoppingCart },
  { label: 'Performance', href: '/staff/performance', icon: BarChart3 },
];

export function StaffShell({
  fullName,
  role,
  children,
}: {
  fullName: string;
  role: UserRole;
  children: React.ReactNode;
}) {
  const [mobileNavOpen, setMobileNavOpen] = useState(false);

  return (
    <div className="flex min-h-screen bg-ink-50">
      <Sidebar
        navItems={NAV_ITEMS}
        brandLabel="Staff Console"
        open={mobileNavOpen}
        onClose={() => setMobileNavOpen(false)}
      />
      <div className="flex min-w-0 flex-1 flex-col">
        <Topbar fullName={fullName} role={role} onMenuClick={() => setMobileNavOpen(true)} />
        <main className="flex-1 p-4 sm:p-6 lg:p-8">{children}</main>
      </div>
    </div>
  );
}
