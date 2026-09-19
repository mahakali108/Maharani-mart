'use client';

import { useState, useTransition } from 'react';
import { BadgePercent, Check, Loader2, Ticket, X } from 'lucide-react';
import { applyCouponAction, removeCouponAction } from '@/lib/coupons/actions';
import { formatInr } from '@/lib/retailer/format';

export interface AppliedCouponView {
  code: string;
  discount: number;
}

/**
 * Cart coupon control (apply / remove).
 *
 * The component submits only the raw CODE. The retailer identity, cart lines,
 * eligibility and the discount itself all come from the server actions
 * (lib/coupons/actions.ts → validateCouponForOrder), and the server re-render
 * is the source of truth for what is applied.
 */
export function CouponApplyForm({
  applied,
  warning,
}: {
  applied?: AppliedCouponView | null;
  /** Set when a stored coupon no longer validates against the current cart. */
  warning?: string | null;
}) {
  const [code, setCode] = useState('');
  const [message, setMessage] = useState<{ kind: 'success' | 'error'; text: string } | null>(null);
  const [isPending, startTransition] = useTransition();

  function handleApply() {
    const value = code.trim();
    if (!value || isPending) return;
    setMessage(null);
    startTransition(async () => {
      const result = await applyCouponAction(value);
      if ('error' in result) {
        setMessage({ kind: 'error', text: result.error });
      } else if (result.success && 'code' in result) {
        setMessage({ kind: 'success', text: `${result.code} applied — you save ${formatInr(result.discount)}.` });
        setCode('');
      }
    });
  }

  function handleRemove() {
    if (isPending) return;
    setMessage(null);
    startTransition(async () => {
      const result = await removeCouponAction();
      if ('error' in result) {
        setMessage({ kind: 'error', text: result.error });
      } else {
        setMessage({ kind: 'success', text: 'Coupon removed.' });
      }
    });
  }

  return (
    <section
      aria-label="Coupon"
      className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm"
    >
      <div className="flex items-center gap-2 border-b border-slate-100 bg-slate-50 px-4 py-3">
        <Ticket className="h-4 w-4 text-primary-600" aria-hidden="true" />
        <h2 className="text-xs font-bold text-slate-900">Coupon</h2>
      </div>

      <div className="space-y-3 p-4">
        {applied ? (
          <div className="flex items-center justify-between gap-3 rounded-xl border border-emerald-200 bg-emerald-50/70 px-3 py-2.5">
            <div className="flex min-w-0 items-center gap-2.5">
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-emerald-600 text-white">
                <BadgePercent className="h-4 w-4" aria-hidden="true" />
              </span>
              <div className="min-w-0">
                <p className="truncate text-[11px] font-bold text-emerald-900">{applied.code}</p>
                <p className="text-[10px] font-semibold text-emerald-700">
                  You save {formatInr(applied.discount)} on this order
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={handleRemove}
              disabled={isPending}
              className="flex h-8 shrink-0 items-center gap-1 rounded-lg border border-emerald-300 bg-white px-2.5 text-[10px] font-bold text-emerald-800 transition hover:bg-emerald-50 disabled:opacity-60"
            >
              {isPending ? <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" /> : <X className="h-3 w-3" aria-hidden="true" />}
              Remove
            </button>
          </div>
        ) : (
          <form
            onSubmit={(event) => {
              event.preventDefault();
              handleApply();
            }}
            className="flex gap-2"
          >
            <label htmlFor="coupon-code" className="sr-only">
              Coupon code
            </label>
            <input
              id="coupon-code"
              type="text"
              value={code}
              onChange={(event) => setCode(event.target.value.toUpperCase())}
              maxLength={40}
              placeholder="Enter code"
              autoComplete="off"
              spellCheck={false}
              className="h-10 min-w-0 flex-1 rounded-xl border border-slate-200 bg-white px-3 text-[11px] font-bold uppercase tracking-wide text-slate-900 outline-none placeholder:font-medium placeholder:normal-case placeholder:tracking-normal placeholder:text-slate-400 focus:border-primary-300 focus:ring-2 focus:ring-primary-100"
            />
            <button
              type="submit"
              disabled={isPending || !code.trim()}
              className="flex h-10 shrink-0 items-center gap-1.5 rounded-xl bg-primary-600 px-4 text-[11px] font-bold text-white shadow-sm transition hover:bg-primary-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-300 disabled:opacity-50"
            >
              {isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" /> : <Check className="h-3.5 w-3.5" aria-hidden="true" />}
              Apply
            </button>
          </form>
        )}

        {warning ? (
          <p role="status" className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-[10px] font-medium leading-4 text-amber-800">
            {warning}
          </p>
        ) : null}

        {message ? (
          <p
            role={message.kind === 'error' ? 'alert' : 'status'}
            className={
              message.kind === 'error'
                ? 'rounded-xl border border-primary-200 bg-primary-50 px-3 py-2 text-[10px] font-medium text-primary-700'
                : 'rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-[10px] font-medium text-emerald-700'
            }
          >
            {message.text}
          </p>
        ) : null}

        <p className="text-[9px] leading-4 text-slate-400">
          The code is validated against your shop, cart and limits on our servers before any discount is shown or billed.
        </p>
      </div>
    </section>
  );
}
