'use client';

import { useState, useTransition } from 'react';
import { BadgePercent, CalendarClock, Check, Copy, Loader2, Ticket } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { applyCouponAction } from '@/lib/coupons/actions';
import { describeDiscountValue } from '@/lib/coupons/engine';
import { formatInr } from '@/lib/retailer/format';
import { formatIndiaDate } from '@/lib/datetime/india';

export interface CouponCardProps {
  code: string;
  title: string;
  discountLabel: string;
  details: string[];
  expiresLabel: string;
  /** null = this code can be applied right now. */
  blockedReason: string | null;
  /** Used on the "starting soon" section. */
  scheduled?: boolean;
}

/**
 * One coupon on the retailer coupon page.
 *
 * Copy puts the code on the clipboard. Apply submits ONLY the code to the
 * server action — eligibility, limits and the discount are computed and
 * rechecked server-side (validateCouponForOrder), and on success the retailer
 * lands on the cart where the validated discount is shown.
 */
export function CouponCard({ code, title, discountLabel, details, expiresLabel, blockedReason, scheduled = false }: CouponCardProps) {
  const router = useRouter();
  const [copied, setCopied] = useState(false);
  const [applyMessage, setApplyMessage] = useState<{ kind: 'success' | 'error'; text: string } | null>(null);
  const [isPending, startTransition] = useTransition();
  const locked = Boolean(blockedReason);

  async function copyCode() {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setApplyMessage({ kind: 'error', text: 'Could not copy automatically — long-press the code to copy it.' });
    }
  }

  function apply() {
    if (locked || isPending) return;
    setApplyMessage(null);
    startTransition(async () => {
      const result = await applyCouponAction(code);
      if ('error' in result) {
        setApplyMessage({ kind: 'error', text: result.error });
      } else if (result.success && 'code' in result) {
        setApplyMessage({ kind: 'success', text: `${result.code} applied — you save ${formatInr(result.discount)}.` });
        setTimeout(() => router.push('/retailer/cart'), 600);
      }
    });
  }

  return (
    <article
      className={`overflow-hidden rounded-2xl border bg-white shadow-sm ${
        locked ? 'border-slate-200 opacity-90' : 'border-primary-100'
      }`}
    >
      <div className={`flex items-start justify-between gap-3 border-b border-dashed px-4 py-3 ${locked ? 'border-slate-100 bg-slate-50' : 'border-primary-100 bg-primary-50/60'}`}>
        <div className="flex min-w-0 items-center gap-3">
          <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${locked ? 'bg-slate-200 text-slate-500' : 'bg-primary-600 text-white'}`}>
            <BadgePercent className="h-5 w-5" aria-hidden="true" />
          </span>
          <div className="min-w-0">
            <p className="truncate font-mono text-sm font-bold tracking-widest text-slate-900">{code}</p>
            <p className="truncate text-[11px] font-semibold text-slate-600">{title}</p>
          </div>
        </div>
        <button
          type="button"
          onClick={copyCode}
          className="flex h-8 shrink-0 items-center gap-1 rounded-lg border border-slate-200 bg-white px-2.5 text-[10px] font-bold text-slate-600 transition hover:border-primary-200 hover:text-primary-600"
        >
          {copied ? <Check className="h-3 w-3 text-emerald-600" aria-hidden="true" /> : <Copy className="h-3 w-3" aria-hidden="true" />}
          {copied ? 'Copied' : 'Copy'}
        </button>
      </div>

      <div className="space-y-3 p-4">
        <p className={`text-base font-bold ${locked ? 'text-slate-500' : 'text-slate-950'}`}>{discountLabel}</p>

        {details.length > 0 ? (
          <ul className="space-y-1">
            {details.map((detail) => (
              <li key={detail} className="flex items-start gap-1.5 text-[10px] leading-4 text-slate-500">
                <Ticket className="mt-0.5 h-3 w-3 shrink-0 text-primary-400" aria-hidden="true" />
                {detail}
              </li>
            ))}
          </ul>
        ) : null}

        <p className="flex items-center gap-1.5 text-[10px] font-medium text-slate-400">
          <CalendarClock className="h-3.5 w-3.5" aria-hidden="true" />
          {scheduled ? `Starts ${expiresLabel}` : `Valid till ${expiresLabel}`}
        </p>

        {blockedReason ? (
          <p className="rounded-lg bg-slate-50 px-3 py-2 text-[10px] font-semibold leading-4 text-slate-500">{blockedReason}</p>
        ) : (
          <button
            type="button"
            onClick={apply}
            disabled={isPending}
            className="flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-primary-600 text-xs font-bold text-white shadow-sm transition hover:bg-primary-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-300 focus-visible:ring-offset-2 disabled:opacity-60"
          >
            {isPending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : null}
            {isPending ? 'Applying…' : 'Apply to my cart'}
          </button>
        )}

        {applyMessage ? (
          <p
            role={applyMessage.kind === 'error' ? 'alert' : 'status'}
            className={
              applyMessage.kind === 'error'
                ? 'rounded-lg bg-primary-50 px-3 py-2 text-[10px] font-semibold text-primary-700'
                : 'rounded-lg bg-emerald-50 px-3 py-2 text-[10px] font-semibold text-emerald-700'
            }
          >
            {applyMessage.text}
          </p>
        ) : null}
      </div>
    </article>
  );
}
