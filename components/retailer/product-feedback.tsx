'use client';

import { useState, useTransition } from 'react';
import {
  BellPlus,
  Check,
  Flag,
  Loader2,
  X,
} from 'lucide-react';
import { reportProductIssueAction, toggleStockAlertAction } from '@/lib/retailer/product-feedback-actions';

const ISSUE_OPTIONS = [
  { value: 'wrong_information', label: 'Wrong information' },
  { value: 'image_problem', label: 'Image looks wrong' },
  { value: 'pricing_problem', label: 'Price looks wrong' },
  { value: 'stock_problem', label: 'Stock problem' },
  { value: 'other', label: 'Something else' },
] as const;

/**
 * "Report a problem" — a restrained bottom-sheet form (mobile-first, safe on
 * 320px). Everything is sent to the server action, which re-validates and
 * routes the report to staff. No client state is trusted beyond the typed
 * fields.
 */
export function ProductIssueReport({ productId, packId }: { productId: string; packId?: string | null }) {
  const [open, setOpen] = useState(false);
  const [issueType, setIssueType] = useState<string>('wrong_information');
  const [message, setMessage] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [isPending, startTransition] = useTransition();

  function submit() {
    setError(null);
    startTransition(async () => {
      const result = await reportProductIssueAction({
        productId,
        packId: packId ?? null,
        issueType,
        message,
      });
      if ('error' in result && result.error) {
        setError(result.error);
        return;
      }
      setDone(true);
    });
  }

  return (
    <>
      <button
        type="button"
        onClick={() => {
          setDone(false);
          setError(null);
          setOpen(true);
        }}
        className="flex h-9 items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 text-[11px] font-bold text-slate-600 transition hover:border-primary-200 hover:text-primary-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-300"
      >
        <Flag className="h-3.5 w-3.5" aria-hidden="true" /> Report a problem
      </button>

      {open ? (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Report a problem with this product"
          className="fixed inset-0 z-50 flex items-end justify-center bg-slate-950/40 sm:items-center"
          onClick={(event) => {
            if (event.target === event.currentTarget) setOpen(false);
          }}
        >
          <div className="max-h-[85dvh] w-full max-w-md overflow-y-auto rounded-t-3xl bg-white p-4 shadow-2xl pb-[calc(1rem+env(safe-area-inset-bottom))] sm:rounded-3xl">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="flex items-center gap-1.5 text-sm font-bold text-slate-900">
                <Flag className="h-4 w-4 text-primary-600" aria-hidden="true" /> Report a problem
              </h2>
              <button
                type="button"
                onClick={() => setOpen(false)}
                aria-label="Close"
                className="flex h-9 w-9 items-center justify-center rounded-xl text-slate-400 transition hover:bg-slate-50"
              >
                <X className="h-4 w-4" aria-hidden="true" />
              </button>
            </div>

            {done ? (
              <div className="py-6 text-center">
                <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-emerald-50 text-emerald-600">
                  <Check className="h-6 w-6" aria-hidden="true" />
                </span>
                <p className="mt-3 text-sm font-bold text-slate-900">Thank you — report received</p>
                <p className="mt-1 text-[11px] text-slate-500">The team will review it and fix the product details.</p>
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  className="mt-4 h-10 w-full rounded-xl bg-primary-600 text-xs font-bold text-white transition hover:bg-primary-700"
                >
                  Done
                </button>
              </div>
            ) : (
              <div className="space-y-3">
                <div>
                  <p className="mb-1.5 text-[10px] font-bold uppercase tracking-wider text-slate-500">What is wrong?</p>
                  <div className="flex flex-wrap gap-1.5">
                    {ISSUE_OPTIONS.map((option) => (
                      <button
                        key={option.value}
                        type="button"
                        onClick={() => setIssueType(option.value)}
                        aria-pressed={issueType === option.value}
                        className={
                          issueType === option.value
                            ? 'rounded-full border-2 border-primary-500 bg-primary-50 px-3 py-1.5 text-[11px] font-bold text-primary-800'
                            : 'rounded-full border border-slate-200 px-3 py-1.5 text-[11px] font-semibold text-slate-600 transition hover:bg-slate-50'
                        }
                      >
                        {option.label}
                      </button>
                    ))}
                  </div>
                </div>
                <div>
                  <label htmlFor="issue-message" className="mb-1.5 block text-[10px] font-bold uppercase tracking-wider text-slate-500">
                    Details
                  </label>
                  <textarea
                    id="issue-message"
                    value={message}
                    onChange={(event) => setMessage(event.target.value)}
                    rows={3}
                    maxLength={1000}
                    placeholder="Tell us what looks wrong…"
                    className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-900 outline-none placeholder:text-slate-400 focus:border-primary-300 focus:ring-2 focus:ring-primary-100"
                  />
                </div>
                {error ? (
                  <p role="alert" className="rounded-xl bg-rose-50 px-3 py-2 text-[11px] font-semibold text-rose-700">{error}</p>
                ) : null}
                <button
                  type="button"
                  onClick={submit}
                  disabled={isPending}
                  className="flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-primary-600 text-xs font-bold text-white transition hover:bg-primary-700 disabled:opacity-60"
                >
                  {isPending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Flag className="h-4 w-4" aria-hidden="true" />}
                  Send report
                </button>
              </div>
            )}
          </div>
        </div>
      ) : null}
    </>
  );
}

/**
 * Pack-level "notify me when available" toggle for out-of-stock variants.
 * Writes to retailer_stock_alerts through the server action (owner-only RLS).
 */
export function StockAlertButton({ packId, subscribed }: { packId: string; subscribed: boolean }) {
  const [active, setActive] = useState(subscribed);
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function toggle() {
    const next = !active;
    setError(null);
    setActive(next); // optimistic
    startTransition(async () => {
      const result = await toggleStockAlertAction(packId, next);
      if ('error' in result && result.error) {
        setActive(!next);
        setError(result.error);
      }
    });
  }

  return (
    <span className="inline-flex flex-col">
      <button
        type="button"
        onClick={toggle}
        disabled={isPending}
        aria-pressed={active}
        className={
          active
            ? 'flex h-9 items-center gap-1.5 rounded-xl border-2 border-emerald-500 bg-emerald-50 px-3 text-[11px] font-bold text-emerald-700 transition disabled:opacity-60'
            : 'flex h-9 items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 text-[11px] font-bold text-slate-700 transition hover:border-primary-200 hover:text-primary-600 disabled:opacity-60'
        }
      >
        {isPending ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
        ) : active ? (
          <Check className="h-3.5 w-3.5" aria-hidden="true" />
        ) : (
          <BellPlus className="h-3.5 w-3.5" aria-hidden="true" />
        )}
        {active ? 'Will notify you' : 'Notify me when available'}
      </button>
      {error ? <span className="mt-1 text-[9px] font-bold text-rose-600">{error}</span> : null}
    </span>
  );
}
