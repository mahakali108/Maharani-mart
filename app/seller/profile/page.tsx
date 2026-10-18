import { UserCircle } from 'lucide-react';
import { requireSellerPage } from '@/lib/seller/guard';
import { SellerProfileForm } from '@/components/seller/seller-profile-form';
import { Card } from '@/components/ui/card';
import { StatusBadge } from '@/components/admin/status-badge';
import { formatIndiaDateTime } from '@/lib/datetime/india';

export const dynamic = 'force-dynamic';

export default async function SellerProfilePage() {
  const { seller, memberRole } = await requireSellerPage();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="flex items-center gap-2 text-2xl font-bold text-slate-900">
          <UserCircle className="h-6 w-6 text-primary-600" /> Business Profile
        </h1>
        <p className="mt-1 text-sm text-slate-500">
          Your registered business name and GSTIN are disclosed to retailers on approved offers. Private contact,
          PAN, and address details remain restricted to your team and Maharani Traders admins.
        </p>
      </div>

      <Card className="p-5">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 pb-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wider text-slate-400">Account status</p>
            <div className="mt-1 flex items-center gap-2">
              <StatusBadge status={seller.status} />
              <span className="text-xs text-slate-500">Member role: {memberRole}</span>
            </div>
          </div>
          <div className="text-right text-xs text-slate-500">
            <p>Registered {formatIndiaDateTime(seller.created_at)}</p>
            {seller.reviewed_at ? <p>Last reviewed {formatIndiaDateTime(seller.reviewed_at)}</p> : null}
          </div>
        </div>

        <div className="mt-5">
          <SellerProfileForm seller={seller} />
        </div>
      </Card>
    </div>
  );
}
