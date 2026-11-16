import Link from 'next/link';
import { Megaphone } from 'lucide-react';
import { requireSuperAdminPage } from '@/lib/admin/control-center/guard';
import { getAdminAdCampaignOverview } from '@/lib/admin/ad-campaign-query';
import { AdCampaignsManager } from '@/components/admin/ad-campaigns-manager';
import { ReadFailureNotice } from '@/components/ui/read-failure-notice';

export const dynamic = 'force-dynamic';

export default async function AdminSellerAdCampaignsPage() {
  await requireSuperAdminPage();
  const overview = await getAdminAdCampaignOverview();

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-semibold text-ink-950">
            <Megaphone className="h-6 w-6 text-primary-700" aria-hidden />
            Paid Seller Ad Campaigns
          </h1>
          <p className="mt-1 text-sm text-ink-500">
            Super Admin approval workflow, creative preview, placement rules, and offline budget/payment tracking for seller ads. Paid ad activation and online payment collection remain disabled pending owner approval.
          </p>
        </div>
        <Link href="/admin/banners" className="text-sm font-medium text-primary-700 hover:underline">
          ← Back to Homepage Banners
        </Link>
      </header>

      {overview.failed ? (
        <ReadFailureNotice
          what="Seller advertisement campaigns"
          detail={overview.failureMessage ?? undefined}
        />
      ) : (
        <AdCampaignsManager overview={overview} />
      )}
    </div>
  );
}
