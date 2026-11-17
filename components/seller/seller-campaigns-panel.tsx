'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Lock, Megaphone, PauseCircle } from 'lucide-react';
import {
  pauseOwnSellerAdCampaignAction,
  submitSellerAdCampaignAction,
} from '@/lib/admin/ad-campaign-actions';
import {
  AD_PLACEMENT_LABELS,
  type AdProgramSettings,
  type SellerAdCampaignRow,
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

export function SellerCampaignsPanel({
  settings,
  campaigns,
}: {
  settings: AdProgramSettings;
  campaigns: SellerAdCampaignRow[];
}) {
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
      <div className="rounded-xl border border-warning-200 bg-warning-50 p-4 text-sm text-warning-900">
        <div className="flex items-start gap-2">
          <Lock className="mt-0.5 h-4 w-4 shrink-0 text-warning-700" aria-hidden />
          <p className="text-xs">
            {settings.seller_ads_enabled
              ? 'All campaign proposals require Super Admin approval before going live. No online payment collection is active.'
              : 'Paid seller advertisements are currently awaiting owner launch approval. You may submit campaign proposals for Super Admin review, but ads will not run live and no payment is collected online.'}
          </p>
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

      <Card className="p-5">
        <h2 className="flex items-center gap-2 text-base font-semibold text-ink-900">
          <Megaphone className="h-4 w-4 text-primary-700" aria-hidden /> Submit a campaign proposal
        </h2>
        <form
          className="mt-4 grid gap-4 sm:grid-cols-2"
          action={(formData) => runAction(() => submitSellerAdCampaignAction(formData))}
        >
          <div>
            <Label htmlFor="campaign-title">Campaign Title</Label>
            <Input id="campaign-title" name="title" maxLength={140} placeholder="e.g. Festive Skincare Spotlight" required />
          </div>
          <div>
            <Label htmlFor="campaign-placement">Placement</Label>
            <Select id="campaign-placement" name="placement" defaultValue={settings.allowed_placements[0] ?? 'homepage_strip'}>
              {settings.allowed_placements.map((p) => (
                <option key={p} value={p}>
                  {AD_PLACEMENT_LABELS[p]}
                </option>
              ))}
            </Select>
          </div>
          <div className="sm:col-span-2">
            <Label htmlFor="campaign-headline">Promo Headline (optional)</Label>
            <Input id="campaign-headline" name="headline" maxLength={240} placeholder="Short promotional copy" />
          </div>
          <div>
            <Label htmlFor="campaign-artwork">Artwork URL (https:// or /path)</Label>
            <Input id="campaign-artwork" name="artworkUrl" maxLength={1000} placeholder="https://..." required />
          </div>
          <div>
            <Label htmlFor="campaign-dest">Destination Link (optional)</Label>
            <Input id="campaign-dest" name="destinationUrl" maxLength={500} placeholder="/retailer/catalog" />
          </div>
          <div>
            <Label htmlFor="campaign-starts">Start Date &amp; Time</Label>
            <Input id="campaign-starts" name="startsAt" type="datetime-local" required />
          </div>
          <div>
            <Label htmlFor="campaign-ends">End Date &amp; Time</Label>
            <Input id="campaign-ends" name="endsAt" type="datetime-local" required />
          </div>
          <div>
            <Label htmlFor="campaign-budget">Planned Budget (₹)</Label>
            <Input id="campaign-budget" name="budgetRupees" type="number" min={0} step="1" defaultValue={0} required />
          </div>
          <div className="sm:col-span-2">
            <Button type="submit" size="sm" disabled={isPending}>
              Submit for Super Admin approval
            </Button>
          </div>
        </form>
      </Card>

      <Card className="p-5">
        <h2 className="text-base font-semibold text-ink-900">Your campaign proposals ({campaigns.length})</h2>
        {campaigns.length === 0 ? (
          <p className="mt-2 text-sm text-ink-500">No campaign proposals submitted yet.</p>
        ) : (
          <ul className="mt-3 divide-y divide-ink-100 text-xs">
            {campaigns.map((c) => (
              <li key={c.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                <div>
                  <p className="font-semibold text-ink-900">{c.title}</p>
                  <p className="text-ink-500">
                    {AD_PLACEMENT_LABELS[c.placement]} · Budget {inr(c.budget_paise)} · Payment:{' '}
                    {c.payment_status.replace(/_/g, ' ')}
                  </p>
                  <p className="text-ink-500">
                    {formatIndiaDateTime(c.starts_at)} → {formatIndiaDateTime(c.ends_at)}
                  </p>
                  {c.rejection_reason ? (
                    <p className="mt-1 text-error-700">Review note: {c.rejection_reason}</p>
                  ) : null}
                </div>
                <div className="flex items-center gap-2">
                  <StatusBadge status={c.approval_status} />
                  {c.approval_status === 'approved' || c.approval_status === 'pending_approval' ? (
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={isPending}
                      onClick={() => runAction(() => pauseOwnSellerAdCampaignAction(c.id))}
                    >
                      <PauseCircle className="h-3.5 w-3.5" aria-hidden /> Pause
                    </Button>
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
