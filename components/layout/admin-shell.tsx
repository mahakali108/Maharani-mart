'use client';

import { useState } from 'react';
import {
  LayoutDashboard,
  Package,
  Tags,
  Warehouse,
  Tag,
  ShoppingCart,
  Users,
  UserCog,
  BarChart3,
  Image as ImageIcon,
  Bell,
  MapPin,
} from 'lucide-react';
import { Sidebar, type NavItem } from '@/components/layout/sidebar';
import { Topbar } from '@/components/layout/topbar';
import type { UserRole } from '@/lib/auth/roles';

const NAV_ITEMS: NavItem[] = [
  { label: 'Dashboard', href: '/admin/dashboard', icon: LayoutDashboard },
  { label: 'Products', href: '/admin/products', icon: Package },
  { label: 'Categories & Brands', href: '/admin/catalog', icon: Tags },
  { label: 'Areas', href: '/admin/areas', icon: MapPin },
  { label: 'Warehouses', href: '/admin/warehouses', icon: Warehouse },
  { label: 'Pricing & Schemes', href: '/admin/pricing', icon: Tag },
  { label: 'Inventory', href: '/admin/inventory', icon: Warehouse },
  { label: 'Orders', href: '/admin/orders', icon: ShoppingCart },
  { label: 'Retailers', href: '/admin/retailers', icon: Users },
  { label: 'Staff & Salesmen', href: '/admin/team', icon: UserCog },
  { label: 'Banners', href: '/admin/banners', icon: ImageIcon },
  { label: 'Reports', href: '/admin/reports', icon: BarChart3 },
  { label: 'Notifications', href: '/admin/notifications', icon: Bell },
];

export function AdminShell({
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
        brandLabel="Admin Console"
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
