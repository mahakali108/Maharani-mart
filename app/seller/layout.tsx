import Link from 'next/link';
import { Store, LayoutDashboard, Tag, PackageCheck, UserCircle, LogOut } from 'lucide-react';
import { requireSellerPage } from '@/lib/seller/guard';
import { logoutAction } from '@/lib/auth/actions';
import { StatusBadge } from '@/components/admin/status-badge';
import { Button } from '@/components/ui/button';

export const dynamic = 'force-dynamic';

export default async function SellerPortalLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { seller } = await requireSellerPage();

  const navItems = [
    { href: '/seller/dashboard', label: 'Dashboard', icon: LayoutDashboard },
    { href: '/seller/offers', label: 'Offers & Tiers', icon: Tag },
    { href: '/seller/orders', label: 'Sub-Orders', icon: PackageCheck },
    { href: '/seller/profile', label: 'Business Profile', icon: UserCircle },
  ];

  return (
    <div className="min-h-screen bg-slate-50">
      <header className="sticky top-0 z-30 border-b border-slate-200 bg-white/95 backdrop-blur">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 px-4 py-3 sm:px-6">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary-50 text-primary-600">
              <Store className="h-5 w-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <p className="text-sm font-bold text-slate-900">{seller.business_name}</p>
                <StatusBadge status={seller.status} />
              </div>
              <p className="text-[11px] text-slate-500">
                Maharani Marketplace Seller Portal{seller.gstin ? ` · GSTIN ${seller.gstin}` : ''}
              </p>
            </div>
          </div>

          <nav className="flex flex-wrap items-center gap-1.5" aria-label="Seller navigation">
            {navItems.map((item) => {
              const Icon = item.icon;
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className="inline-flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-xs font-semibold text-slate-700 transition hover:bg-slate-100 hover:text-primary-600"
                >
                  <Icon className="h-3.5 w-3.5" />
                  {item.label}
                </Link>
              );
            })}
            <form action={logoutAction}>
              <Button type="submit" variant="outline" size="sm" className="ml-1 gap-1.5 text-xs">
                <LogOut className="h-3.5 w-3.5" /> Sign out
              </Button>
            </form>
          </nav>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-4 py-6 sm:px-6">{children}</main>
    </div>
  );
}
