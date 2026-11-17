import { requireSellerPage } from '@/lib/seller/guard';
import { getSellerOwnCampaigns } from '@/lib/admin/ad-campaign-query';
import { SellerCampaignsPanel } from '@/components/seller/seller-campaigns-panel';
import { ReadFailureNotice } from '@/components/ui/read-failure-notice';

export const dynamic = 'force-dynamic';

export default async function SellerCampaignsPage() {
  const { seller } = await requireSellerPage();
  const { settings, campaigns, failed, failureMessage } = await getSellerOwnCampaigns(seller.id);

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-semibold text-ink-950">Advertisement Campaigns</h1>
        <p className="mt-1 text-sm text-ink-500">
          Prepare promotional campaign proposals for Super Admin review. Campaigns require approval before launch.
        </p>
      </header>

      {failed ? (
        <ReadFailureNotice what="Your campaign proposals" detail={failureMessage ?? undefined} />
      ) : (
        <SellerCampaignsPanel settings={settings} campaigns={campaigns} />
      )}
    </div>
  );
}
