'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { CheckCircle2, Eye, Lock, PauseCircle, XCircle } from 'lucide-react';
import {
  moderateSellerAdCampaignAction,
  updateAdProgramRulesAction,
  updateSellerAdPaymentStatusAction,
} from '@/lib/admin/ad-campaign-actions';
import type { AdminAdCampaignOverview } from '@/lib/admin/ad-campaign-query';
import {
  AD_PAYMENT_STATUSES,
  AD_PLACEMENTS,
  AD_PLACEMENT_LABELS,
  type AdPaymentStatus,
} from '@/lib/admin/ad-campaign-rules';
import { formatIndiaDateTime } from '@/lib/datetime/india';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { StatusBadge } from '@/components/admin/status-badge';

const inr = (paise: number) =>
  `₹${(paise / 100).toLocaleString('en-IN', { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;

export function AdCampaignsManager({ overview }: { overview: AdminAdCampaignOverview }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [feedback, setFeedback] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);
  const [rejectReasons, setRejectReasons] = useState<Record<string, string>>({});
  const [paymentDrafts, setPaymentDrafts] = useState<
    Record<string, { status: AdPaymentStatus; reference: string }>
  >({});

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
      <div className="rounded-xl border border-warning-200 bg-warning-50 p-4 text-sm text-warning-900">
        <div className="flex items-start gap-2.5">
          <Lock className="mt-0.5 h-5 w-5 shrink-0 text-warning-700" aria-hidden />
          <div className="space-y-1">
            <p className="font-semibold">
              Paid Seller Ads: {overview.settings.seller_ads_enabled ? 'Enabled (owner-approved)' : 'DISABLED — Awaiting Owner Approval'} · Live payment collection: OFF
            </p>
            <p className="text-xs text-warning-800">
              While disabled, sellers may prepare proposals and Super Admin can configure placement rules, reject non-compliant artwork, or record offline payment tracking, but no paid seller ad can be approved or served live.
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

      {/* Placement & Slot Rules */}
      <Card className="p-5">
        <h2 className="text-base font-semibold text-ink-900">Placement rules &amp; slot limits</h2>
        <form
          className="mt-4 space-y-4"
          action={(formData) => runAction(() => updateAdProgramRulesAction(formData))}
        >
          <div className="grid gap-4 sm:grid-cols-3">
            <div>
              <Label htmlFor="maxActivePerPlacement">Max Active Ads per Placement</Label>
              <Input
                id="maxActivePerPlacement"
                name="maxActivePerPlacement"
                type="number"
                min={1}
                max={20}
                defaultValue={overview.settings.max_active_campaigns_per_placement}
                required
              />
            </div>
            <div className="sm:col-span-2">
              <Label htmlFor="adProgramNotes">Program governance notes</Label>
              <Input
                id="adProgramNotes"
                name="notes"
                maxLength={1000}
                defaultValue={overview.settings.notes ?? ''}
                placeholder="Placement review checklist, creative standards, or launch conditions…"
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <p className="text-xs font-medium text-ink-700">Allowed placements</p>
            <div className="flex flex-wrap gap-4 text-sm text-ink-700">
              {AD_PLACEMENTS.map((placement) => (
                <label key={placement} className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    name="allowedPlacements"
                    value={placement}
                    defaultChecked={overview.settings.allowed_placements.includes(placement)}
                    className="h-4 w-4 rounded border-ink-300"
                  />
                  {AD_PLACEMENT_LABELS[placement]}
                </label>
              ))}
            </div>
          </div>

          <Button type="submit" size="sm" disabled={isPending}>
            Save placement rules
          </Button>
        </form>
      </Card>

      {/* Campaign Review Queue */}
      <section className="space-y-4">
        <h2 className="text-base font-semibold text-ink-900">
          Seller campaign submissions ({overview.campaigns.length})
        </h2>

        {overview.campaigns.length === 0 ? (
          <Card className="p-6 text-sm text-ink-500">
            No seller advertisement campaigns have been submitted yet.
          </Card>
        ) : (
          overview.campaigns.map((campaign) => {
            const payDraft = paymentDrafts[campaign.id] ?? {
              status: campaign.payment_status,
              reference: campaign.payment_reference ?? '',
            };
            return (
              <Card key={campaign.id} className="p-5 space-y-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="text-base font-semibold text-ink-900">{campaign.title}</h3>
                      <StatusBadge status={campaign.approval_status} />
                      <StatusBadge status={campaign.is_active ? 'active' : 'inactive'} />
                    </div>
                    <p className="mt-1 text-xs text-ink-600">
                      Seller: <strong>{campaign.seller_name}</strong> · Placement:{' '}
                      <strong>{AD_PLACEMENT_LABELS[campaign.placement]}</strong> · Planned budget:{' '}
                      <strong>{inr(campaign.budget_paise)}</strong>
                    </p>
                    <p className="mt-0.5 text-xs text-ink-500">
                      Window: {formatIndiaDateTime(campaign.starts_at)} → {formatIndiaDateTime(campaign.ends_at)}
                      {campaign.destination_url ? ` · Link: ${campaign.destination_url}` : ''}
                    </p>
                    {campaign.rejection_reason ? (
                      <p className="mt-1 text-xs text-error-700">Rejection reason: {campaign.rejection_reason}</p>
                    ) : null}
                  </div>
                </div>

                {/* Live Creative Preview before publishing */}
                <div className="rounded-xl border border-ink-100 bg-ink-50/40 p-3">
                  <p className="mb-2 flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wide text-ink-500">
                    <Eye className="h-3.5 w-3.5" aria-hidden /> Creative preview ({AD_PLACEMENT_LABELS[campaign.placement]})
                  </p>
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
                    <div className="h-20 w-44 shrink-0 overflow-hidden rounded-lg border border-ink-200 bg-white">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={campaign.artwork_url}
                        alt={campaign.title}
                        className="h-full w-full object-cover"
                      />
                    </div>
                    <div className="min-w-0 text-xs">
                      <p className="font-semibold text-ink-900">{campaign.title}</p>
                      {campaign.headline ? <p className="mt-0.5 text-ink-600">{campaign.headline}</p> : null}
                      <p className="mt-1 truncate font-mono text-[11px] text-ink-500">{campaign.artwork_url}</p>
                    </div>
                  </div>
                </div>

                {/* Moderation Controls */}
                <div className="flex flex-wrap items-center gap-2">
                  <Button
                    size="sm"
                    disabled={isPending || !overview.settings.seller_ads_enabled}
                    title={
                      overview.settings.seller_ads_enabled
                        ? 'Approve campaign'
                        : 'Paid seller ads are disabled pending owner approval'
                    }
                    onClick={() => runAction(() => moderateSellerAdCampaignAction(campaign.id, 'approved'))}
                  >
                    <CheckCircle2 className="h-4 w-4" aria-hidden /> Approve
                  </Button>
                  <Input
                    value={rejectReasons[campaign.id] ?? ''}
                    onChange={(e) => setRejectReasons((cur) => ({ ...cur, [campaign.id]: e.target.value }))}
                    placeholder="Rejection reason (min 3 chars)"
                    maxLength={500}
                    className="h-9 max-w-xs text-xs"
                  />
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={isPending}
                    onClick={() =>
                      runAction(() =>
                        moderateSellerAdCampaignAction(campaign.id, 'rejected', rejectReasons[campaign.id] ?? '')
                      )
                    }
                  >
                    <XCircle className="h-4 w-4" aria-hidden /> Reject
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={isPending}
                    onClick={() => runAction(() => moderateSellerAdCampaignAction(campaign.id, 'paused'))}
                  >
                    <PauseCircle className="h-4 w-4" aria-hidden /> Pause
                  </Button>
                </div>

                {/* Offline Budget & Payment Tracking (No Online Gateway) */}
                <div className="flex flex-wrap items-end gap-3 border-t border-ink-100 pt-3">
                  <div>
                    <Label htmlFor={`pay-status-${campaign.id}`} className="text-xs">
                      Offline Payment Status
                    </Label>
                    <Select
                      id={`pay-status-${campaign.id}`}
                      value={payDraft.status}
                      onChange={(e) =>
                        setPaymentDrafts((cur) => ({
                          ...cur,
                          [campaign.id]: { ...payDraft, status: e.target.value as AdPaymentStatus },
                        }))
                      }
                      className="h-9 text-xs"
                    >
                      {AD_PAYMENT_STATUSES.map((st) => (
                        <option key={st} value={st}>
                          {st.replace(/_/g, ' ')}
                        </option>
                      ))}
                    </Select>
                  </div>
                  <div className="flex-1 min-w-[180px]">
                    <Label htmlFor={`pay-ref-${campaign.id}`} className="text-xs">
                      Offline Invoice / UTR Reference
                    </Label>
                    <Input
                      id={`pay-ref-${campaign.id}`}
                      value={payDraft.reference}
                      onChange={(e) =>
                        setPaymentDrafts((cur) => ({
                          ...cur,
                          [campaign.id]: { ...payDraft, reference: e.target.value },
                        }))
                      }
                      placeholder="Optional offline settlement reference"
                      maxLength={160}
                      className="h-9 text-xs"
                    />
                  </div>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={isPending}
                    onClick={() =>
                      runAction(() =>
                        updateSellerAdPaymentStatusAction(campaign.id, payDraft.status, payDraft.reference)
                      )
                    }
                  >
                    Update payment record
                  </Button>
                </div>
              </Card>
            );
          })
        )}
      </section>

      {/* Immutable Audit Log */}
      <Card className="p-5">
        <h2 className="text-sm font-semibold text-ink-900">
          Campaign audit history ({overview.audit.length})
        </h2>
        {overview.audit.length === 0 ? (
          <p className="mt-2 text-xs text-ink-500">No campaign audit events recorded yet.</p>
        ) : (
          <ul className="mt-3 divide-y divide-ink-100 text-xs">
            {overview.audit.map((row) => (
              <li key={row.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                <span>
                  <strong>{row.action.replace(/_/g, ' ')}</strong>
                  {row.previous_status || row.new_status
                    ? ` · status ${row.previous_status ?? '—'} → ${row.new_status ?? '—'}`
                    : ''}
                  {row.previous_payment_status && row.previous_payment_status !== row.new_payment_status
                    ? ` · payment ${row.previous_payment_status} → ${row.new_payment_status}`
                    : ''}
                  {row.reason ? ` · "${row.reason}"` : ''}
                </span>
                <span className="text-ink-500">{formatIndiaDateTime(row.created_at)}</span>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
