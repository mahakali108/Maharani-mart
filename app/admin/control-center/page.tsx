import Link from 'next/link';
import { ClipboardCheck, IndianRupee, Scale, Settings, ShieldCheck } from 'lucide-react';
import { requireSuperAdminPage } from '@/lib/admin/control-center/guard';
import { getControlCenterOverview, getFeatures, getAllUsers, getSuperAdminAuditLogs, getPlatformSettings } from '@/lib/admin/control-center/actions';
import {
  getAuthoritativeBusinessProfile,
  getAuthoritativeContactGrievance,
  getAuthoritativeMarketplaceCompliance,
} from '@/lib/admin/business-settings/server';
import { createClient } from '@/lib/supabase/server';
import { COMPLIANCE_CHECKLIST } from '@/lib/compliance/checklist';
import { ControlCenterClient } from './client';
import { serverRequestTimeMs } from '@/lib/datetime/request-time';

export const dynamic = 'force-dynamic';

export default async function ControlCenterPage() {
  const user = await requireSuperAdminPage();

  const supabase = (await createClient());
  const [overview, features, users, auditLogs, settings, business, contact, marketplace] = await Promise.all([
    getControlCenterOverview(),
    getFeatures(),
    getAllUsers(),
    getSuperAdminAuditLogs(30),
    getPlatformSettings(),
    getAuthoritativeBusinessProfile(),
    getAuthoritativeContactGrievance(),
    getAuthoritativeMarketplaceCompliance(),
  ]);

  // Retailer approval queue (0081) and category pricing (0082) summaries.
  const [{ data: applicationRows }, { data: approvalSettings }, { count: categoryPriceCount }] = await Promise.all([
    supabase
      .from('retailer_applications' as never)
      .select('status, submitted_at, review_target_hours')
      .limit(1000)
      .returns<{ status: string; submitted_at: string; review_target_hours: number | null }[]>(),
    supabase
      .from('retailer_approval_settings' as never)
      .select('review_target_hours')
      .maybeSingle<{ review_target_hours: number }>(),
    supabase
      .from('product_tier_prices' as never)
      .select('id', { count: 'exact', head: true })
      .eq('is_active', true),
  ]);
  const reviewTarget = approvalSettings?.review_target_hours ?? 48;
  const pendingApplications = (applicationRows ?? []).filter((row) => row.status === 'pending');
  const requestTimeMs = serverRequestTimeMs();
  const overdueApplications = pendingApplications.filter(
    (row) => (requestTimeMs - new Date(row.submitted_at).getTime()) / 3_600_000 > (row.review_target_hours ?? reviewTarget)
  );
  const ownerInputsOutstanding = COMPLIANCE_CHECKLIST.filter((item) => item.status === 'owner_input_required').length;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2.5">
            <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-ink-950">
              <Settings className="h-5 w-5 text-white" />
            </span>
            <h1 className="text-xl font-semibold text-ink-950 sm:text-2xl">Master Control Center</h1>
          </div>
          <p className="mt-1 flex items-center gap-1.5 text-xs text-ink-500">
            <ShieldCheck className="h-3.5 w-3.5 text-mint-600" />
            Super Admin only · Full platform control · All actions audit logged
          </p>
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <Link href="/admin/retailer-applications" className="block focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-600">
          <div className="h-full rounded-2xl border border-ink-200 bg-white p-4 transition hover:border-primary-300">
            <p className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-ink-500">
              <ClipboardCheck className="h-3.5 w-3.5" /> Retailer approvals
            </p>
            <p className="mt-1 text-2xl font-semibold text-ink-950">
              {pendingApplications.length} <span className="text-sm font-normal text-ink-500">pending</span>
            </p>
            <p className={`mt-1 text-xs font-medium ${overdueApplications.length > 0 ? 'text-warning-800' : 'text-ink-500'}`}>
              {overdueApplications.length} overdue · {reviewTarget}h review target
            </p>
          </div>
        </Link>
        <Link href="/admin/pricing/tiers" className="block focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-600">
          <div className="h-full rounded-2xl border border-ink-200 bg-white p-4 transition hover:border-primary-300">
            <p className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-ink-500">
              <IndianRupee className="h-3.5 w-3.5" /> Category pricing
            </p>
            <p className="mt-1 text-2xl font-semibold text-ink-950">
              {categoryPriceCount ?? 0} <span className="text-sm font-normal text-ink-500">prices set</span>
            </p>
            <p className="mt-1 text-xs text-ink-500">General / Silver / Gold · gold ≤ silver ≤ general</p>
          </div>
        </Link>
        <Link href="/admin/compliance" className="block focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-600">
          <div className="h-full rounded-2xl border border-ink-200 bg-white p-4 transition hover:border-primary-300">
            <p className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-ink-500">
              <Scale className="h-3.5 w-3.5" /> Compliance readiness
            </p>
            <p className="mt-1 text-2xl font-semibold text-ink-950">
              {ownerInputsOutstanding} <span className="text-sm font-normal text-ink-500">owner inputs</span>
            </p>
            <p className="mt-1 text-xs text-ink-500">Readiness view — not a legal opinion</p>
          </div>
        </Link>
      </div>

      <ControlCenterClient
        overview={overview}
        features={features}
        users={users}
        auditLogs={auditLogs}
        settings={settings}
        businessConfig={business}
        contactConfig={contact}
        marketplaceConfig={marketplace}
        currentUserId={user.id}
      />
    </div>
  );
}
