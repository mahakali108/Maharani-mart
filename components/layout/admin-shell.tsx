'use client';

import { useState } from 'react';
import {
  PackageCheck, BadgeIndianRupee,
  LayoutDashboard,
  Gauge,
  Package,
  Tags,
  Warehouse,
  Tag,
  ShoppingCart,
  Users,
  UserCog,
  BarChart3,
  Database,
  Image as ImageIcon,
  Bell,
  BellRing,
  MapPin,
  Sparkles,
  Settings,
  ScrollText,
  Wallet,
  Target,
  IndianRupee,
  Headset,
  Ticket,
  ClipboardCheck,
  Scale,
  FileText,
  SlidersHorizontal,
  Crown,
  Megaphone,
} from 'lucide-react';

import { Sidebar, type NavItem } from '@/components/layout/sidebar';
import { Topbar } from '@/components/layout/topbar';
import type { UserRole } from '@/lib/auth/roles';
import { PolicyLinks } from '@/components/legal/policy-links';
import type { FooterLink } from '@/lib/site-content/types';

const NAV_ITEMS: NavItem[] = [
  { label: 'Dashboard', href: '/admin/dashboard', icon: LayoutDashboard },
  { label: 'Control Center', href: '/admin/control-center', icon: Settings, roles: ['super_admin'] },
  { label: 'Command Center', href: '/admin/command-center', icon: Gauge, roles: ['super_admin'] },
  { label: 'Business Copilot', href: '/admin/ai', icon: Sparkles },
  { label: 'Products', href: '/admin/products', icon: Package },
  { label: 'Categories & Brands', href: '/admin/catalog', icon: Tags },
  { label: 'Areas', href: '/admin/areas', icon: MapPin },
  { label: 'Warehouses', href: '/admin/warehouses', icon: Warehouse },
  { label: 'Pricing & Schemes', href: '/admin/pricing', icon: Tag },
  { label: 'Wholesale Pricing', href: '/admin/pricing/wholesale', icon: SlidersHorizontal, roles: ['super_admin'] },
  { label: 'Category Pricing', href: '/admin/pricing/tiers', icon: IndianRupee, roles: ['super_admin', 'admin'] },
  { label: 'Memberships', href: '/admin/memberships', icon: Crown, roles: ['super_admin'] },
  { label: 'Retailer Approvals', href: '/admin/retailer-applications', icon: ClipboardCheck, roles: ['super_admin', 'admin'] },
  { label: 'Coupons', href: '/admin/coupons', icon: Ticket },
  { label: 'Orders', href: '/admin/orders', icon: ShoppingCart },
  { label: 'Delivered Orders', href: '/admin/delivered', icon: PackageCheck },
  { label: 'Wallets', href: '/admin/wallets', icon: Wallet },
  { label: 'Collections', href: '/admin/collections', icon: BadgeIndianRupee },
  { label: 'Retailers', href: '/admin/retailers', icon: Users },
  { label: 'Staff & Salesmen', href: '/admin/team', icon: UserCog },
  { label: 'Targets', href: '/admin/targets', icon: Target },
  { label: 'Commissions', href: '/admin/commissions', icon: IndianRupee },
  { label: 'Follow-ups', href: '/admin/follow-ups', icon: BellRing },
  { label: 'Support', href: '/admin/support', icon: Headset },
  { label: 'Website Content', href: '/admin/content', icon: FileText, roles: ['super_admin'] },
  { label: 'Banners', href: '/admin/banners', icon: ImageIcon },
  { label: 'Ad Campaigns', href: '/admin/banners/campaigns', icon: Megaphone, roles: ['super_admin'] },
  { label: 'Reports', href: '/admin/reports', icon: BarChart3 },
  { label: 'Notifications', href: '/admin/notifications', icon: Bell },
  { label: 'Data Retention', href: '/admin/cleanup', icon: Database, roles: ['admin', 'super_admin'] },
  { label: 'Compliance', href: '/admin/compliance', icon: Scale, roles: ['super_admin'] },
  { label: 'Audit Log', href: '/admin/audit-logs', icon: ScrollText },
];

export function AdminShell({
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
  const visibleNavItems = NAV_ITEMS.filter((item) => !item.roles || item.roles.includes(role));

  return (
    <div className="flex min-h-screen bg-ink-50">
      <Sidebar
        navItems={visibleNavItems}
        brandLabel={role === 'super_admin' ? 'Super Admin Console' : 'Admin Console'}
        open={mobileNavOpen}
        onClose={() => setMobileNavOpen(false)}
      />
      <div className="flex min-w-0 flex-1 flex-col">
        <Topbar fullName={fullName} role={role} onMenuClick={() => setMobileNavOpen(true)} />
        <main className="w-full min-w-0 flex-1 p-4 pb-[calc(1.5rem+env(safe-area-inset-bottom))] sm:p-6 lg:p-8">
          {children}
        </main>
        <footer className="flex flex-wrap items-center gap-x-4 border-t border-ink-100 px-4 py-3 text-xs text-ink-600 sm:px-6">
          <PolicyLinks
            links={footerLinks}
            ariaLabel="Public information"
            linkClassName="inline-flex min-h-11 items-center hover:text-primary-700"
          />
        </footer>
      </div>
    </div>
  );
}
