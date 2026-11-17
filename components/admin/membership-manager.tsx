'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Crown, Lock, ShieldCheck } from 'lucide-react';
import {
  reviewMembershipUpgradeRequestAction,
  updateMembershipPlanConfigAction,
  updateMembershipProgramNotesAction,
} from '@/lib/admin/membership-actions';
import type { AdminMembershipOverview } from '@/lib/admin/membership-query';
import { formatIndiaDateTime } from '@/lib/datetime/india';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { StatusBadge } from '@/components/admin/status-badge';

const inr = (paise: number) =>
  `₹${(paise / 100).toLocaleString('en-IN', { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;

export function MembershipManager({ overview }: { overview: AdminMembershipOverview }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [feedback, setFeedback] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);

  const runAction = (fn: () => Promise<{ ok: true; message: string } | { ok: false; error: string }>) => {
    setFeedback(null);
    startTransition(async () => {
      const res = await fn();
      if (res.ok) {
        setFeedback({ kind: 'ok', text: res.message });
        router.refresh();
      } else {
        setFeedback({ kind: 'error', text: res.error });
      }
    });
  };

  return (
    <div className="space-y-6">
      {/* Owner Approval & Payment Safety Banner */}
      <div className="rounded-xl border border-warning-200 bg-warning-50 p-4 text-sm text-warning-900">
        <div className="flex items-start gap-2.5">
          <Lock className="mt-0.5 h-5 w-5 shrink-0 text-warning-700" aria-hidden />
          <div className="space-y-1">
            <p className="font-semibold">
              Program status: {overview.settings.program_enabled ? 'Owner-approved' : 'Disabled — Awaiting Owner Approval'} · Live payment collection: OFF
            </p>
            <p className="text-xs text-warning-800">
              All plans remain inactive for checkout and live payment collection is hard-disabled in the database until explicit owner approval. Benefits always stop immediately upon expiry (zero grace period).
            </p>
          </div>
        </div>
      </div>

      {feedback ? (
        <div
          role={feedback.kind === 'error' ? 'alert' : 'status'}
          className={`rounded-xl border px-4 py-3 text-sm ${
            feedback.kind === 'error'
              ? 'border-error-200 bg-error-50 text-error-700'
              : 'border-mint-200 bg-mint-50 text-mint-700'
          }`}
        >
          {feedback.text}
        </div>
      ) : null}

      {/* Summary Counts */}
      <div className="grid gap-4 sm:grid-cols-4">
        <Card className="p-4">
          <p className="text-xs text-ink-500">Configured Plans</p>
          <p className="mt-1 text-2xl font-semibold text-ink-900">{overview.counts.configuredPlans}</p>
        </Card>
        <Card className="p-4">
          <p className="text-xs text-ink-500">Active Plans</p>
          <p className="mt-1 text-2xl font-semibold text-ink-900">{overview.counts.activePlans}</p>
        </Card>
        <Card className="p-4">
          <p className="text-xs text-ink-500">Active / Expired Retailer Records</p>
          <p className="mt-1 text-2xl font-semibold text-ink-900">
            {overview.counts.activeRetailerMemberships} / {overview.counts.expiredRetailerMemberships}
          </p>
        </Card>
        <Card className="p-4">
          <p className="text-xs text-ink-500">Pending Requests</p>
          <p className="mt-1 text-2xl font-semibold text-ink-900">{overview.counts.pendingUpgradeRequests}</p>
        </Card>
      </div>

      {/* Plan Configuration Cards (Free, Silver, Gold) */}
      <section className="space-y-4">
        <h2 className="flex items-center gap-2 text-base font-semibold text-ink-900">
          <Crown className="h-5 w-5 text-primary-700" aria-hidden />
          Plan configurations (Free, Silver, Gold)
        </h2>

        <div className="grid gap-6 lg:grid-cols-3">
          {overview.plans.map((plan) => (
            <Card key={plan.id} className="p-5">
              <div className="flex items-center justify-between gap-2">
                <div>
                  <h3 className="text-base font-semibold text-ink-900">{plan.name}</h3>
                  <p className="text-xs uppercase tracking-wide text-ink-500">Tier: {plan.tier}</p>
                </div>
                <StatusBadge status={plan.is_active ? 'active' : 'inactive'} />
              </div>

              <form
                className="mt-4 space-y-3"
                action={(formData) => runAction(() => updateMembershipPlanConfigAction(formData))}
              >
                <input type="hidden" name="planId" value={plan.id} />

                <div>
                  <Label htmlFor={`name-${plan.id}`}>Plan Name</Label>
                  <Input id={`name-${plan.id}`} name="name" defaultValue={plan.name} maxLength={80} required />
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <Label htmlFor={`price-${plan.id}`}>Planned Price (₹)</Label>
                    <Input
                      id={`price-${plan.id}`}
                      name="priceRupees"
                      type="number"
                      min={0}
                      step="1"
                      defaultValue={Math.round(plan.price_paise / 100)}
                      readOnly={plan.id === 'free'}
                      required
                    />
                  </div>
                  <div>
                    <Label htmlFor={`duration-${plan.id}`}>Duration (days)</Label>
                    <Input
                      id={`duration-${plan.id}`}
                      name="durationDays"
                      type="number"
                      min={1}
                      max={3650}
                      defaultValue={plan.duration_days}
                      required
                    />
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <Label htmlFor={`prodDisc-${plan.id}`}>Product Discount (%)</Label>
                    <Input
                      id={`prodDisc-${plan.id}`}
                      name="productDiscountPercent"
                      type="number"
                      min={0}
                      max={50}
                      step="0.5"
                      defaultValue={plan.product_discount_percent}
                      required
                    />
                  </div>
                  <div>
                    <Label htmlFor={`ordDisc-${plan.id}`}>Order-Value Discount (%)</Label>
                    <Input
                      id={`ordDisc-${plan.id}`}
                      name="orderValueDiscountPercent"
                      type="number"
                      min={0}
                      max={50}
                      step="0.5"
                      defaultValue={plan.order_value_discount_percent}
                      required
                    />
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <Label htmlFor={`minOrder-${plan.id}`}>Min Order Value (₹)</Label>
                    <Input
                      id={`minOrder-${plan.id}`}
                      name="minOrderValueRupees"
                      type="number"
                      min={0}
                      step="1"
                      defaultValue={Math.round(plan.min_order_value_paise / 100)}
                      required
                    />
                  </div>
                  <div>
                    <Label htmlFor={`maxDisc-${plan.id}`}>Max Discount Cap (₹)</Label>
                    <Input
                      id={`maxDisc-${plan.id}`}
                      name="maxDiscountRupees"
                      type="number"
                      min={0}
                      step="1"
                      defaultValue={Math.round(plan.max_discount_paise / 100)}
                      required
                    />
                  </div>
                </div>

                <div>
                  <Label htmlFor={`renewal-${plan.id}`}>Renewal Settings</Label>
                  <Select id={`renewal-${plan.id}`} name="renewalMode" defaultValue={plan.renewal_mode}>
                    <option value="manual_owner_approval">Manual owner approval</option>
                    <option value="disabled">Disabled</option>
                  </Select>
                </div>

                <div>
                  <Label htmlFor={`features-${plan.id}`}>Benefits (one per line)</Label>
                  <textarea
                    id={`features-${plan.id}`}
                    name="featuresText"
                    rows={3}
                    defaultValue={plan.features.join('\n')}
                    className="w-full rounded-xl border border-ink-200 bg-white px-3 py-2 text-xs text-ink-900 focus:border-primary-500 focus:outline-none"
                  />
                </div>

                <div className="space-y-1.5 rounded-lg border border-ink-100 bg-ink-50/40 p-2.5 text-xs text-ink-700">
                  <p className="font-medium text-ink-800">Eligibility &amp; Expiry Policy</p>
                  <label className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      name="requireApprovedRetailer"
                      defaultChecked={plan.eligibility_rules.requireApprovedRetailer}
                      className="h-3.5 w-3.5"
                    />
                    Require approved retailer KYC
                  </label>
                  <div className="flex flex-wrap gap-3 pt-1">
                    {(['general', 'silver', 'gold'] as const).map((cat) => (
                      <label key={cat} className="flex items-center gap-1 capitalize">
                        <input
                          type="checkbox"
                          name="allowedCategories"
                          value={cat}
                          defaultChecked={plan.eligibility_rules.allowedCategories.includes(cat)}
                          className="h-3.5 w-3.5"
                        />
                        {cat}
                      </label>
                    ))}
                  </div>
                  <p className="pt-1 text-[11px] text-ink-500">
                    Expiry behavior: <strong>Immediate stop (0 grace days)</strong> — enforced in database.
                  </p>
                </div>

                <Button type="submit" size="sm" disabled={isPending} className="w-full">
                  Save {plan.tier} plan draft
                </Button>
              </form>
            </Card>
          ))}
        </div>
      </section>

      {/* Governance Notes */}
      <Card className="p-5">
        <h2 className="flex items-center gap-2 text-sm font-semibold text-ink-900">
          <ShieldCheck className="h-4 w-4 text-primary-700" aria-hidden />
          Program launch governance notes
        </h2>
        <form
          className="mt-3 flex flex-col gap-3 sm:flex-row"
          action={(formData) => runAction(() => updateMembershipProgramNotesAction(formData))}
        >
          <Input
            name="notes"
            maxLength={1000}
            defaultValue={overview.settings.notes ?? ''}
            placeholder="Record owner approval conditions, legal terms, or rollout notes…"
          />
          <Button type="submit" size="sm" variant="outline" disabled={isPending}>
            Save notes
          </Button>
        </form>
      </Card>

      {/* Upgrade Requests Queue & Historical Memberships */}
      <div className="grid gap-6 lg:grid-cols-2">
        <Card className="p-5">
          <h2 className="text-sm font-semibold text-ink-900">
            Membership upgrade requests ({overview.upgradeRequests.length})
          </h2>
          {overview.upgradeRequests.length === 0 ? (
            <p className="mt-2 text-xs text-ink-500">No retailer upgrade requests recorded yet.</p>
          ) : (
            <ul className="mt-3 divide-y divide-ink-100 text-xs">
              {overview.upgradeRequests.map((req) => (
                <li key={req.id} className="space-y-2 py-2.5">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-medium text-ink-900">
                      {req.shop_name} → <span className="uppercase">{req.requested_plan_id}</span>
                    </span>
                    <StatusBadge status={req.status} />
                  </div>
                  {req.notes ? <p className="text-ink-600">{req.notes}</p> : null}
                  {req.status === 'pending_review' ? (
                    <div className="flex gap-2">
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={isPending}
                        onClick={() =>
                          runAction(() =>
                            reviewMembershipUpgradeRequestAction(req.id, 'approved_pending_launch', 'Queued for launch')
                          )
                        }
                      >
                        Approve (pending launch)
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={isPending}
                        onClick={() =>
                          runAction(() =>
                            reviewMembershipUpgradeRequestAction(req.id, 'rejected', 'Program not active yet')
                          )
                        }
                      >
                        Reject
                      </Button>
                    </div>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card className="p-5">
          <h2 className="text-sm font-semibold text-ink-900">
            Retailer membership records ({overview.memberships.length})
          </h2>
          {overview.memberships.length === 0 ? (
            <p className="mt-2 text-xs text-ink-500">
              No retailer membership subscriptions exist in the database.
            </p>
          ) : (
            <ul className="mt-3 divide-y divide-ink-100 text-xs">
              {overview.memberships.map((m) => (
                <li key={m.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                  <div>
                    <p className="font-medium text-ink-900">
                      {m.shop_name} · <span className="uppercase">{m.tier}</span>
                    </p>
                    <p className="text-ink-500">
                      Started {formatIndiaDateTime(m.starts_at)}
                      {m.expires_at ? ` · Expires ${formatIndiaDateTime(m.expires_at)}` : ' · No expiry'}
                    </p>
                  </div>
                  <StatusBadge status={m.status} />
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      <p className="text-xs text-ink-500">
        Configured tier prices shown above ({overview.plans.map((p) => `${p.name}: ${inr(p.price_paise)}`).join(' · ')}) are draft configurations only; live checkout charges ₹0 for membership until owner launch approval.
      </p>
    </div>
  );
}
