'use client';

import { useState } from 'react';
import { LayoutDashboard, ShoppingCart, Sparkles, Truck } from 'lucide-react';
import { Sidebar, type NavItem } from '@/components/layout/sidebar';
import { Topbar } from '@/components/layout/topbar';
import { PolicyLinks } from '@/components/legal/policy-links';
import type { UserRole } from '@/lib/auth/roles';
import type { FooterLink } from '@/lib/site-content/types';
import { can } from '@/lib/permissions/permissions';

function navigationForRole(role: UserRole): NavItem[] {
  const items: NavItem[] = [
    { label: 'Dashboard', href: '/staff/dashboard', icon: LayoutDashboard },
    { label: 'Warehouse Copilot', href: '/staff/ai', icon: Sparkles },
  ];

  if (can(role, 'orders.view.all')) {
    items.push({ label: 'Orders', href: '/staff/orders', icon: ShoppingCart });
  }
  if (can(role, 'deliveries.view.assigned')) {
    items.push({ label: 'Deliveries', href: '/staff/deliveries', icon: Truck });
  }

  return items;
}

export function StaffShell({
  fullName,
  role,
  footerLinks,
  children,
}: {
  fullName: string;
  role: UserRole;
  /** Footer navigation from managed website content (loadFooterLinks()). */
  footerLinks: FooterLink[];
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
        <main className="w-full min-w-0 flex-1 p-4 pb-[calc(1.5rem+env(safe-area-inset-bottom))] sm:p-6 lg:p-8">
          {children}
        </main>
        <footer className="border-t border-ink-100 px-4 py-3 sm:px-6"><PolicyLinks links={footerLinks} /></footer>
      </div>
    </div>
  );
}
