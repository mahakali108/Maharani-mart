'use client';

import { useState } from 'react';
import { LayoutDashboard, Warehouse, ShoppingCart } from 'lucide-react';
import { Sidebar, type NavItem } from '@/components/layout/sidebar';
import { Topbar } from '@/components/layout/topbar';
import type { UserRole } from '@/lib/auth/roles';
import { can } from '@/lib/permissions/permissions';

function navigationForRole(role: UserRole): NavItem[] {
  const items: NavItem[] = [
    { label: 'Dashboard', href: '/staff/dashboard', icon: LayoutDashboard },
  ];

  if (can(role, 'inventory.view')) {
    items.push({ label: 'Inventory', href: '/staff/inventory', icon: Warehouse });
  }
  if (can(role, 'orders.view.all')) {
    items.push({ label: 'Orders', href: '/staff/orders', icon: ShoppingCart });
  }

  return items;
}

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
  const navItems = navigationForRole(role);

  return (
    <div className="flex min-h-screen bg-ink-50">
      <Sidebar
        navItems={navItems}
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
