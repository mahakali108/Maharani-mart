import { Clock, Crown, History, Lock, ShieldCheck } from 'lucide-react';
import type { RetailerMembershipOverviewPayload } from '@/lib/membership/rules';
import { evaluateMembershipBenefits } from '@/lib/membership/rules';
import { formatIndiaDateTime } from '@/lib/datetime/india';
import { Card, CardHeader, CardTitle } from '@/components/ui/card';
import { StatusBadge } from '@/components/admin/status-badge';

/**
 * Retailer-facing membership status, validity, configured tier overview, and
 * history panel. Uses authoritative DB data from
 * `get_retailer_membership_overview(retailer_id)`.
 *
 * - Benefits stop immediately upon expiry (0 grace days).
 * - Never renders a checkout/buy button or collects live payments while
 *   `program_enabled` / `live_payment_collection_enabled` are disabled.
 */
export function RetailerMembershipOverview({
  overview,
}: {
  overview: RetailerMembershipOverviewPayload | null;
}) {
  if (!overview) return null;

  const evalState = evaluateMembershipBenefits({
    status: overview.current.status,
    expiresAt: overview.current.expires_at,
    productDiscountPercent: overview.current.effective_product_discount_percent,
    orderValueDiscountPercent: overview.current.effective_order_discount_percent,
  });

  return (
    <div className="space-y-6">
      {/* Current Plan & Validity */}
      <Card>
        <CardHeader className="pb-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <CardTitle className="flex items-center gap-2 text-base">
              <Crown className="h-4 w-4 text-primary-700" aria-hidden />
              Current Plan &amp; Validity
            </CardTitle>
            <StatusBadge status={evalState.isExpired ? 'expired' : overview.current.status} />
          </div>
        </CardHeader>

        <div className="grid gap-4 sm:grid-cols-3">
          <div className="rounded-xl border border-ink-100 bg-ink-50/40 p-3">
            <p className="text-xs text-ink-500">Current Plan</p>
            <p className="mt-1 text-base font-semibold text-ink-900">{overview.current.plan_name}</p>
            <p className="mt-0.5 text-xs text-ink-500 uppercase">{overview.current.tier} tier</p>
          </div>

          <div className="rounded-xl border border-ink-100 bg-ink-50/40 p-3">
            <p className="flex items-center gap-1 text-xs text-ink-500">
              <Clock className="h-3.5 w-3.5" aria-hidden /> Validity &amp; Expiry
            </p>
            <p className="mt-1 text-sm font-semibold text-ink-900">
              {overview.current.expires_at ? formatIndiaDateTime(overview.current.expires_at) : 'No expiry'}
            </p>
            <p className="mt-0.5 text-xs text-ink-600">{evalState.remainingLabel}</p>
          </div>

          <div className="rounded-xl border border-ink-100 bg-ink-50/40 p-3">
            <p className="flex items-center gap-1 text-xs text-ink-500">
              <ShieldCheck className="h-3.5 w-3.5" aria-hidden /> Active Benefits
            </p>
            <p className="mt-1 text-sm font-semibold text-ink-900">
              {evalState.benefitsActive
                ? `Product ${evalState.effectiveProductDiscountPercent}% · Order ${evalState.effectiveOrderDiscountPercent}%`
                : '0% (benefits stopped)'}
            </p>
            <p className="mt-0.5 text-[11px] text-ink-500">
              Expiry rule: benefits stop immediately upon expiry.
            </p>
          </div>
        </div>

        {overview.current.features.length > 0 ? (
          <div className="mt-4 border-t border-ink-100 pt-3">
            <p className="text-xs font-medium text-ink-700">Current plan benefits</p>
            <ul className="mt-1.5 list-disc space-y-1 pl-5 text-xs text-ink-600">
              {overview.current.features.map((feat, idx) => (
                <li key={idx}>{feat}</li>
              ))}
            </ul>
          </div>
        ) : null}
      </Card>

      {/* Available Plans & Program Status */}
      <Card>
        <CardHeader className="pb-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <CardTitle className="text-base">Available Tiers (Free, Silver, Gold)</CardTitle>
            <span className="inline-flex items-center gap-1 rounded-full bg-warning-50 px-2.5 py-0.5 text-[11px] font-medium text-warning-800">
              <Lock className="h-3 w-3" aria-hidden />
              {overview.program_enabled ? 'Owner-approved' : 'Inactive — pending owner approval'}
            </span>
          </div>
        </CardHeader>

        <p className="mb-4 text-xs text-ink-600">
          {overview.program_enabled
            ? 'Tier changes are processed through Super Admin review. Online payment collection is currently disabled.'
            : 'Tiered plans are currently in preview while awaiting owner launch approval. No fees are collected online.'}
        </p>

        {overview.plans.length === 0 ? (
          <p className="text-xs text-ink-500">No tier configurations found.</p>
        ) : (
          <div className="grid gap-3 sm:grid-cols-3">
            {overview.plans.map((plan) => (
              <div
                key={plan.id}
                className="flex flex-col justify-between rounded-xl border border-ink-100 bg-white p-4"
              >
                <div>
                  <div className="flex items-center justify-between gap-2">
                    <h3 className="text-sm font-semibold text-ink-900">{plan.name}</h3>
                    <StatusBadge status={plan.is_active ? 'active' : 'inactive'} />
                  </div>
                  <p className="mt-1 text-xs text-ink-500">
                    Duration: {plan.duration_days} days · Expiry: immediate stop
                  </p>
                  <p className="mt-1 text-xs text-ink-700">
                    Planned benefits: Product {plan.product_discount_percent}% · Order {plan.order_value_discount_percent}%
                  </p>
                  {plan.features.length > 0 ? (
                    <ul className="mt-2 list-disc space-y-1 pl-4 text-xs text-ink-600">
                      {plan.features.map((f, i) => (
                        <li key={i}>{f}</li>
                      ))}
                    </ul>
                  ) : null}
                </div>
                <p className="mt-3 border-t border-ink-100 pt-2 text-[11px] text-ink-500">
                  {plan.is_active
                    ? 'Contact Maharani Traders support for manual plan review.'
                    : 'Not open for enrolment yet.'}
                </p>
              </div>
            ))}
          </div>
        )}
      </Card>

      {/* Membership History */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-base">
            <History className="h-4 w-4 text-ink-500" aria-hidden />
            Plan History ({overview.history.length})
          </CardTitle>
        </CardHeader>
        {overview.history.length === 0 ? (
          <p className="text-xs text-ink-500">
            No previous tier subscriptions recorded on your account.
          </p>
        ) : (
          <ul className="divide-y divide-ink-100 text-xs">
            {overview.history.map((item) => (
              <li key={item.id} className="flex flex-wrap items-center justify-between gap-2 py-2.5">
                <div>
                  <p className="font-medium text-ink-900">
                    <span className="uppercase">{item.tier}</span> ({item.plan_id})
                  </p>
                  <p className="text-ink-500">
                    {formatIndiaDateTime(item.starts_at)}
                    {item.expires_at ? ` → ${formatIndiaDateTime(item.expires_at)}` : ' → No expiry'}
                  </p>
                </div>
                <StatusBadge status={item.status} />
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
