import Link from 'next/link';
import { BadgeCheck, ClipboardCheck, Clock, History, ShieldCheck, Users } from 'lucide-react';
import { requirePagePermission } from '@/lib/admin/guard';
import { can } from '@/lib/permissions/permissions';
import { createClient } from '@/lib/supabase/server';
import { Card, CardHeader, CardTitle } from '@/components/ui/card';
import { ReadFailureNotice } from '@/components/ui/read-failure-notice';
import { formatIndiaDateTime } from '@/lib/datetime/india';
import { normalizeRetailerCategory, RETAILER_CATEGORY_LABELS, type RetailerCategory } from '@/lib/pricing/category-pricing';
import { RetailerApprovalPanel } from '@/components/admin/retailer-approval-panel';
import { RetailerApprovalSlaForm } from '@/components/admin/retailer-approval-sla-form';

export const dynamic = 'force-dynamic';

interface ApplicationRow {
  id: string;
  retailer_id: string;
  status: 'pending' | 'approved' | 'rejected' | 'suspended';
  shop_name: string;
  gstin: string | null;
  address: string | null;
  submitted_at: string;
  review_target_hours: number;
  decided_at: string | null;
  decision_reason: string | null;
  retailer_category: RetailerCategory;
  area_name: string | null;
  phone: string | null;
}

interface EventRow {
  id: string;
  retailer_id: string;
  action: string;
  previous_status: string | null;
  new_status: string | null;
  previous_category: string | null;
  new_category: string | null;
  reason: string | null;
  created_at: string;
  actor_name: string | null;
}

const STATUS_STYLES: Record<ApplicationRow['status'], string> = {
  pending: 'bg-amber-50 text-amber-800 border-amber-200',
  approved: 'bg-mint-50 text-mint-800 border-mint-200',
  rejected: 'bg-warning-50 text-warning-800 border-warning-200',
  suspended: 'bg-ink-100 text-ink-800 border-ink-200',
};

const STATUS_LABEL: Record<ApplicationRow['status'], string> = {
  pending: 'Pending',
  approved: 'Approved',
  rejected: 'Rejected',
  suspended: 'Suspended',
};

function hoursSince(iso: string): number {
  return (Date.now() - new Date(iso).getTime()) / 3_600_000;
}

export default async function RetailerApplicationsPage() {
  const user = await requirePagePermission('retailers.view');
  const supabase = createClient();

  const [applicationsResult, settingsResult, eventsResult] = await Promise.all([
    supabase
      .from('retailer_applications' as never)
      .select(
        'id, retailer_id, status, shop_name, gstin, address, submitted_at, review_target_hours, decided_at, decision_reason, retailers ( retailer_category, area_id, areas ( name ) )'
      )
      .order('submitted_at', { ascending: true })
      .limit(300),
    supabase
      .from('retailer_approval_settings' as never)
      .select('review_target_hours, reminder_hours')
      .maybeSingle<{ review_target_hours: number; reminder_hours: number }>(),
    supabase
      .from('retailer_approval_events' as never)
      .select('id, retailer_id, action, previous_status, new_status, previous_category, new_category, reason, created_at')
      .order('created_at', { ascending: false })
      .limit(30),
  ]);

  const readFailed = Boolean(applicationsResult.error || settingsResult.error || eventsResult.error);
  const readFailure = applicationsResult.error?.message ?? settingsResult.error?.message ?? eventsResult.error?.message ?? null;

  const rawApplications = (applicationsResult.data ?? []) as unknown as Array<
    Omit<ApplicationRow, 'retailer_category' | 'area_name' | 'phone'> & {
      retailers: { retailer_category: string | null; area_id: string | null; areas: { name: string } | null } | null;
    }
  >;

  // Profile phone numbers are read separately so the queue never depends on a
  // nested join shape that PostgREST may or may not infer.
  const retailerIds = rawApplications.map((row) => row.retailer_id);
  const profilesResult = retailerIds.length
    ? await supabase.from('profiles').select('id, phone').in('id', retailerIds).returns<{ id: string; phone: string }[]>()
    : { data: [] as { id: string; phone: string }[], error: null };
  const phoneById = new Map((profilesResult.data ?? []).map((row) => [row.id, row.phone]));

  const applications: ApplicationRow[] = rawApplications.map((row) => ({
    ...row,
    retailer_category: normalizeRetailerCategory(row.retailers?.retailer_category),
    area_name: row.retailers?.areas?.name ?? null,
    phone: phoneById.get(row.retailer_id) ?? null,
  }));

  // Shop names for the audit list. The actor is recorded in the database; this
  // screen shows the change itself, not personal administrator details.
  const events = (eventsResult.data ?? []) as unknown as EventRow[];
  const shopById = new Map(applications.map((row) => [row.retailer_id, row.shop_name]));

  const settings = settingsResult.data ?? { review_target_hours: 48, reminder_hours: 12 };
  const isOverdue = (row: ApplicationRow) =>
    row.status === 'pending' && hoursSince(row.submitted_at) > (row.review_target_hours || settings.review_target_hours);

  const pending = applications.filter((row) => row.status === 'pending');
  const overdue = pending.filter(isOverdue);
  const decided = applications.filter((row) => row.status !== 'pending');

  const canApprove = can(user.role, 'retailers.approve');
  const canSuspend = can(user.role, 'retailers.suspend');
  const canPrice = can(user.role, 'pricing.manage');

  return (
    <div className="space-y-6">
      <header>
        <div className="flex items-center gap-2.5">
          <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-ink-950">
            <ClipboardCheck className="h-5 w-5 text-white" />
          </span>
          <h1 className="text-xl font-semibold text-ink-950 sm:text-2xl">Retailer Approvals</h1>
        </div>
        <p className="mt-1 flex items-center gap-1.5 text-xs text-ink-500">
          <ShieldCheck className="h-3.5 w-3.5 text-mint-600" />
          Admin only · Approval, pricing category and suspension are server-enforced and audit-logged
        </p>
      </header>

      {readFailed && <ReadFailureNotice what="retailer applications" detail={readFailure} />}

      <div className="grid gap-4 sm:grid-cols-3">
        <Card>
          <p className="text-xs font-medium uppercase tracking-wide text-ink-500">Pending review</p>
          <p className="mt-1 flex items-center gap-1.5 text-2xl font-semibold text-ink-950">
            <Users className="h-4 w-4 text-ink-400" /> {pending.length}
          </p>
        </Card>
        <Card>
          <p className="text-xs font-medium uppercase tracking-wide text-ink-500">Overdue</p>
          <p className={`mt-1 flex items-center gap-1.5 text-2xl font-semibold ${overdue.length > 0 ? 'text-warning-800' : 'text-ink-950'}`}>
            <Clock className="h-4 w-4" /> {overdue.length}
          </p>
          <p className="mt-0.5 text-[11px] text-ink-500">
            Past the {settings.review_target_hours}h business review target (not a statutory deadline)
          </p>
        </Card>
        <Card>
          <p className="text-xs font-medium uppercase tracking-wide text-ink-500">Decided</p>
          <p className="mt-1 flex items-center gap-1.5 text-2xl font-semibold text-ink-950">
            <BadgeCheck className="h-4 w-4 text-ink-400" /> {decided.length}
          </p>
        </Card>
      </div>

      {can(user.role, 'command_center.view') ? (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Review target (Super Admin)</CardTitle>
            <p className="text-xs text-ink-500">
              A business SLA for how quickly applications are reviewed. It is configurable and is not a legally
              mandated approval time.
            </p>
          </CardHeader>
          <RetailerApprovalSlaForm
            reviewTargetHours={settings.review_target_hours}
            reminderHours={settings.reminder_hours}
          />
        </Card>
      ) : null}

      <section className="space-y-4">
        <h2 className="text-lg font-medium text-ink-900">Pending applications</h2>
        {pending.length === 0 ? (
          <Card className="p-6 text-sm text-ink-500">No retailer application is waiting for review.</Card>
        ) : (
          <div className="space-y-4">
            {pending.map((row) => (
              <Card key={row.id} className={isOverdue(row) ? 'border-warning-200' : undefined}>
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className="text-sm font-semibold text-ink-950">{row.shop_name}</p>
                    <p className="mt-0.5 text-xs text-ink-500">
                      {row.area_name ?? 'Area not set'} · submitted {formatIndiaDateTime(row.submitted_at)}
                      {isOverdue(row) ? ' · OVERDUE' : ''}
                    </p>
                    <p className="mt-1 text-xs text-ink-600">
                      GSTIN: {row.gstin ? row.gstin : 'not provided'} · Phone: {row.phone ?? 'not available'} · Address:{' '}
                      {row.address ?? 'not provided'}
                    </p>
                    <p className="mt-1 text-[11px] text-ink-400">
                      Applicant-supplied details. Providing a GSTIN here does not mean it has been verified.
                    </p>
                  </div>
                  <span className={`rounded-full border px-2 py-0.5 text-[11px] font-semibold ${STATUS_STYLES[row.status]}`}>
                    {STATUS_LABEL[row.status]}
                  </span>
                </div>
                <div className="mt-4 border-t border-ink-100 pt-4">
                  <RetailerApprovalPanel
                    retailerId={row.retailer_id}
                    shopName={row.shop_name}
                    applicationStatus={row.status}
                    category={row.retailer_category}
                    canApprove={canApprove}
                    canSuspend={canSuspend}
                    canPrice={canPrice}
                  />
                </div>
              </Card>
            ))}
          </div>
        )}
      </section>

      <section className="space-y-4">
        <h2 className="text-lg font-medium text-ink-900">Decided &amp; suspended</h2>
        {decided.length === 0 ? (
          <Card className="p-6 text-sm text-ink-500">No decisions recorded yet.</Card>
        ) : (
          <Card className="table-scroll p-0">
            <table className="w-full text-sm">
              <thead className="border-b border-ink-100 bg-ink-50 text-left text-[11px] uppercase tracking-wide text-ink-500">
                <tr>
                  <th className="px-3 py-2 font-medium">Shop</th>
                  <th className="px-3 py-2 font-medium">Status</th>
                  <th className="px-3 py-2 font-medium">Category</th>
                  <th className="px-3 py-2 font-medium">Decided</th>
                  <th className="px-3 py-2 font-medium">Reason</th>
                  <th className="px-3 py-2 font-medium">Manage</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-ink-100">
                {decided.map((row) => (
                  <tr key={row.id} className="align-top">
                    <td className="px-3 py-3">
                      <Link href={`/admin/retailers/${row.retailer_id}`} className="font-medium text-primary-700 hover:underline">
                        {row.shop_name}
                      </Link>
                    </td>
                    <td className="px-3 py-3">
                      <span className={`rounded-full border px-2 py-0.5 text-[11px] font-semibold ${STATUS_STYLES[row.status]}`}>
                        {STATUS_LABEL[row.status]}
                      </span>
                    </td>
                    <td className="px-3 py-3 text-xs text-ink-700">{RETAILER_CATEGORY_LABELS[row.retailer_category].en}</td>
                    <td className="px-3 py-3 text-xs text-ink-500">
                      {row.decided_at ? formatIndiaDateTime(row.decided_at) : '—'}
                    </td>
                    <td className="px-3 py-3 text-xs text-ink-600">{row.decision_reason ?? '—'}</td>
                    <td className="px-3 py-3">
                      <RetailerApprovalPanel
                        retailerId={row.retailer_id}
                        shopName={row.shop_name}
                        applicationStatus={row.status}
                        category={row.retailer_category}
                        canApprove={canApprove}
                        canSuspend={canSuspend}
                        canPrice={canPrice}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
        )}
      </section>

      <section className="space-y-3">
        <h2 className="flex items-center gap-1.5 text-lg font-medium text-ink-900">
          <History className="h-4 w-4 text-ink-400" /> Recent approval audit trail
        </h2>
        {events.length === 0 ? (
          <Card className="p-6 text-sm text-ink-500">No approval events recorded yet.</Card>
        ) : (
          <Card className="table-scroll p-0">
            <table className="w-full text-sm">
              <thead className="border-b border-ink-100 bg-ink-50 text-left text-[11px] uppercase tracking-wide text-ink-500">
                <tr>
                  <th className="px-3 py-2 font-medium">When</th>
                  <th className="px-3 py-2 font-medium">Shop</th>
                  <th className="px-3 py-2 font-medium">Action</th>
                  <th className="px-3 py-2 font-medium">Previous → new</th>
                  <th className="px-3 py-2 font-medium">Reason</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-ink-100">
                {events.map((event) => (
                  <tr key={event.id}>
                    <td className="px-3 py-2 text-xs text-ink-500">{formatIndiaDateTime(event.created_at)}</td>
                    <td className="px-3 py-2 text-xs text-ink-800">{shopById.get(event.retailer_id) ?? '—'}</td>
                    <td className="px-3 py-2 text-xs font-medium text-ink-800">{event.action}</td>
                    <td className="px-3 py-2 text-xs text-ink-600">
                      {event.previous_status ?? '—'} → {event.new_status ?? '—'}
                      {event.previous_category || event.new_category
                        ? ` · ${event.previous_category ?? '—'} → ${event.new_category ?? '—'}`
                        : ''}
                    </td>
                    <td className="px-3 py-2 text-xs text-ink-600">{event.reason ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
        )}
        <p className="text-[11px] text-ink-400">
          The trail is append-only in the database; entries cannot be edited or deleted through the app.
        </p>
      </section>
    </div>
  );
}
