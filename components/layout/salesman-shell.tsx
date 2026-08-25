'use client';

import Link from 'next/link';
import { ClipboardList, LayoutDashboard, PlusCircle, Sparkles, Store, UserCircle } from 'lucide-react';
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
      <div className="mx-auto flex w-full max-w-6xl justify-end px-4 pt-3 sm:px-6"><Link href="/salesman/ai" className="flex h-9 items-center gap-1.5 rounded-xl bg-blue-700 px-3 text-[10px] font-bold text-white shadow-sm"><Sparkles className="h-3.5 w-3.5" /> Sales Copilot</Link></div>
      <main className="mx-auto w-full max-w-6xl p-4 sm:p-6">{children}</main>
      <MobileBottomNav navItems={NAV_ITEMS} />
    </div>
  );
}
