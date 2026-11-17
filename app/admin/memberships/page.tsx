import { Crown } from 'lucide-react';
import { requireSuperAdminPage } from '@/lib/admin/control-center/guard';
import { getAdminMembershipOverview } from '@/lib/admin/membership-query';
import { MembershipManager } from '@/components/admin/membership-manager';
import { ReadFailureNotice } from '@/components/ui/read-failure-notice';

export const dynamic = 'force-dynamic';

export default async function AdminMembershipsPage() {
  await requireSuperAdminPage();
  const overview = await getAdminMembershipOverview();

  return (
    <div className="space-y-6">
      <header>
        <h1 className="flex items-center gap-2 text-2xl font-semibold text-ink-950">
          <Crown className="h-6 w-6 text-primary-700" aria-hidden />
          Retailer Membership Management
        </h1>
        <p className="mt-1 text-sm text-ink-500">
          Configure Free, Silver, and Gold plan rules, discount ceilings, eligibility, renewal mode, and strict immediate-stop expiry behavior. Program activation and live payment collection remain disabled pending owner approval.
        </p>
      </header>

      {overview.failed ? (
        <ReadFailureNotice
          what="Membership plan configurations"
          detail={overview.failureMessage ?? undefined}
        />
      ) : (
        <MembershipManager overview={overview} />
      )}
    </div>
  );
}
