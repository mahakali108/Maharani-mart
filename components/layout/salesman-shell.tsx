'use client';

import { LayoutDashboard, Route, Users, Clock } from 'lucide-react';
import { Topbar } from '@/components/layout/topbar';
import { MobileBottomNav, type NavItem } from '@/components/layout/mobile-bottom-nav';
import type { UserRole } from '@/lib/auth/roles';

const NAV_ITEMS: NavItem[] = [
  { label: 'Home', href: '/salesman/dashboard', icon: LayoutDashboard },
  { label: 'Routes', href: '/salesman/routes', icon: Route },
  { label: 'Visits', href: '/salesman/visits', icon: Users },
  { label: 'Attendance', href: '/salesman/attendance', icon: Clock },
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
    <div className="min-h-screen bg-ink-50 pb-16">
      <Topbar fullName={fullName} role={role} />
      <main className="p-4 sm:p-6">{children}</main>
      <MobileBottomNav navItems={NAV_ITEMS} />
    </div>
  );
}
