import Link from 'next/link';
import { AlertTriangle, Clock, PackageCheck, ShieldAlert, Tag, UserCircle } from 'lucide-react';
import { requireSellerPage } from '@/lib/seller/guard';
import { listSellerOffers, listSellerOrders } from '@/lib/seller/queries';
import { Card } from '@/components/ui/card';
import { StatusBadge } from '@/components/admin/status-badge';
import { formatIndiaDateTime } from '@/lib/datetime/india';

export const dynamic = 'force-dynamic';

const inr = (paise: number) =>
  `₹${(paise / 100).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export default async function SellerDashboardPage() {
  const { seller } = await requireSellerPage();
  const [offers, orders] = await Promise.all([
    listSellerOffers(seller.id),
    listSellerOrders(seller.id, seller.status === 'active'),
  ]);

  const approvedActiveOffers = offers.filter((o) => o.is_active && o.moderation_status === 'approved').length;
  const pendingOffers = offers.filter((o) => o.moderation_status === 'pending').length;
  const openOrders = orders.filter((o) => ['pending', 'confirmed', 'processing', 'shipped'].includes(o.status)).length;
  const deliveredOrders = orders.filter((o) => o.status === 'delivered').length;
  const totalPayablePaise = orders
    .filter((o) => o.status !== 'cancelled' && o.status !== 'returned')
    .reduce((sum, o) => sum + o.payable_paise, 0);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Seller Dashboard</h1>
        <p className="mt-1 text-sm text-slate-500">
          Manage your marketplace offers, quantity-tier pricing, on-hand inventory, and sub-order fulfilment.
        </p>
      </div>

      {seller.status === 'pending' ? (
        <div className="flex items-start gap-3 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
          <Clock className="mt-0.5 h-5 w-5 shrink-0 text-amber-600" />
          <div>
            <p className="font-bold">Your seller application is pending admin review</p>
            <p className="mt-1 text-xs text-amber-800">
              You can complete or update your business profile now. Creating offers and fulfilling sub-orders will
              unlock automatically once an admin approves your seller account.
            </p>
          </div>
        </div>
      ) : null}

      {seller.status === 'rejected' ? (
        <div className="flex items-start gap-3 rounded-2xl border border-primary-200 bg-primary-50 p-4 text-sm text-primary-900">
          <ShieldAlert className="mt-0.5 h-5 w-5 shrink-0 text-primary-600" />
          <div>
            <p className="font-bold">Your seller application was not approved</p>
            {seller.rejection_reason ? (
              <p className="mt-1 text-xs text-primary-800">Reason: {seller.rejection_reason}</p>
            ) : null}
          </div>
        </div>
      ) : null}

      {seller.status === 'suspended' ? (
        <div className="flex items-start gap-3 rounded-2xl border border-primary-200 bg-primary-50 p-4 text-sm text-primary-900">
          <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-primary-600" />
          <div>
            <p className="font-bold">Seller account suspended (drain mode active)</p>
            <p className="mt-1 text-xs text-primary-800">
              {seller.suspension_reason
                ? `Reason: ${seller.suspension_reason}. `
                : ''}
              Active offers were automatically deactivated. Contact Maharani Traders admin for reinstatement.
            </p>
          </div>
        </div>
      ) : null}

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <Card className="p-4">
          <p className="text-xs font-medium text-slate-500">Live trading offers</p>
          <p className="mt-1 text-2xl font-bold text-slate-900">{approvedActiveOffers}</p>
          <p className="mt-0.5 text-[11px] text-slate-400">{offers.length} total offers</p>
        </Card>
        <Card className="p-4">
          <p className="text-xs font-medium text-slate-500">Pending moderation</p>
          <p className="mt-1 text-2xl font-bold text-amber-700">{pendingOffers}</p>
          <p className="mt-0.5 text-[11px] text-slate-400">Admin approval required</p>
        </Card>
        <Card className="p-4">
          <p className="text-xs font-medium text-slate-500">Open sub-orders</p>
          <p className="mt-1 text-2xl font-bold text-primary-700">{openOrders}</p>
          <p className="mt-0.5 text-[11px] text-slate-400">{deliveredOrders} delivered</p>
        </Card>
        <Card className="p-4">
          <p className="text-xs font-medium text-slate-500">Active order value</p>
          <p className="mt-1 text-2xl font-bold text-mint-700">{inr(totalPayablePaise)}</p>
          <p className="mt-0.5 text-[11px] text-slate-400">Across non-cancelled sub-orders</p>
        </Card>
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="p-5 flex flex-col justify-between">
          <div>
            <div className="flex items-center gap-2 text-primary-600">
              <Tag className="h-5 w-5" />
              <h2 className="text-sm font-bold text-slate-900">Offers, Stock &amp; Tier Pricing</h2>
            </div>
            <p className="mt-2 text-xs text-slate-600">
              Publish offers on central-catalogue packs, manage seller-owned stock, and set bulk quantity-tier slabs.
            </p>
          </div>
          <Link
            href="/seller/offers"
            className="mt-4 inline-flex items-center text-xs font-bold text-primary-600 hover:underline"
          >
            Manage offers &amp; tiers →
          </Link>
        </Card>

        <Card className="p-5 flex flex-col justify-between">
          <div>
            <div className="flex items-center gap-2 text-primary-600">
              <PackageCheck className="h-5 w-5" />
              <h2 className="text-sm font-bold text-slate-900">Sub-Order Fulfilment</h2>
            </div>
            <p className="mt-2 text-xs text-slate-600">
              Confirm, pack, and dispatch seller-fulfilled sub-orders with courier and AWB tracking.
            </p>
          </div>
          <Link
            href="/seller/orders"
            className="mt-4 inline-flex items-center text-xs font-bold text-primary-600 hover:underline"
          >
            Open sub-orders →
          </Link>
        </Card>

        <Card className="p-5 flex flex-col justify-between">
          <div>
            <div className="flex items-center gap-2 text-primary-600">
              <UserCircle className="h-5 w-5" />
              <h2 className="text-sm font-bold text-slate-900">Business Identity &amp; GSTIN</h2>
            </div>
            <p className="mt-2 text-xs text-slate-600">
              Keep your business name, GSTIN, PAN, contact person, and dispatch address up to date.
            </p>
          </div>
          <Link
            href="/seller/profile"
            className="mt-4 inline-flex items-center text-xs font-bold text-primary-600 hover:underline"
          >
            Edit business profile →
          </Link>
        </Card>
      </div>

      <Card className="p-5">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-bold text-slate-900">Recent Sub-Orders</h2>
          <Link href="/seller/orders" className="text-xs font-semibold text-primary-600 hover:underline">
            View all
          </Link>
        </div>
        {orders.length === 0 ? (
          <p className="mt-3 text-xs text-slate-500">
            No sub-orders yet. Approved active offers appear on retailer product pages automatically.
          </p>
        ) : (
          <div className="mt-3 divide-y divide-slate-100">
            {orders.slice(0, 5).map((order) => (
              <div key={order.sub_order_id} className="flex flex-wrap items-center justify-between gap-3 py-3 text-xs">
                <div>
                  <span className="font-mono font-bold text-slate-900">{order.order_number}</span>
                  <span className="ml-2 text-slate-500">{formatIndiaDateTime(order.placed_at)}</span>
                  <span className="ml-2 text-slate-500">
                    ({order.fulfilment_type === 'seller' ? 'Seller-fulfilled' : 'Maharani-fulfilled'})
                  </span>
                </div>
                <div className="flex items-center gap-3">
                  <span className="font-semibold text-slate-900">{inr(order.payable_paise)}</span>
                  <StatusBadge status={order.status} />
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}
