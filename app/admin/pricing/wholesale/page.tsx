import Link from 'next/link';
import { SlidersHorizontal } from 'lucide-react';
import { requireSuperAdminPage } from '@/lib/admin/control-center/guard';
import { getWholesalePricingOverview } from '@/lib/admin/wholesale-pricing-query';
import { WholesalePricingControl } from '@/components/admin/wholesale-pricing-control';
import { ReadFailureNotice } from '@/components/ui/read-failure-notice';

export const dynamic = 'force-dynamic';

export default async function AdminWholesalePricingPage() {
  await requireSuperAdminPage();
  const overview = await getWholesalePricingOverview();

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-semibold text-ink-950">
            <SlidersHorizontal className="h-6 w-6 text-primary-700" aria-hidden />
            Wholesale Pricing Control
          </h1>
          <p className="mt-1 text-sm text-ink-500">
            Super Admin governance for global MOQ defaults, maximum discount limits, seller pricing permissions, and pack-level wholesale slabs.
          </p>
        </div>
        <div className="flex flex-wrap gap-3 text-xs font-medium">
          <Link href="/admin/pricing" className="text-primary-700 hover:underline">
            Price lists →
          </Link>
          <Link href="/admin/pricing/tiers" className="text-primary-700 hover:underline">
            Category tiers →
          </Link>
          <Link href="/admin/pricing/schemes" className="text-primary-700 hover:underline">
            Trade schemes →
          </Link>
          {/* The "Offer price floors" link went with /admin/offers: floors only
              bounded third-party seller pricing, which no longer exists. The
              floor tables and history are preserved for audit. */}
        </div>
      </header>

      {overview.failed ? (
        <ReadFailureNotice
          what="Wholesale pricing rules"
          detail={overview.failureMessage ?? undefined}
        />
      ) : (
        <WholesalePricingControl overview={overview} />
      )}
    </div>
  );
}
