import Link from 'next/link';
import { ArrowRight, ShieldCheck } from 'lucide-react';
import { formatInr } from '@/lib/retailer/format';

export interface GstBreakdownRow {
  rate: number;
  amount: number;
}

/**
 * Presentational order summary. Every value is computed by the cart page from
 * the same effective-price / GST / savings helpers the checkout uses — this
 * card renders totals only and never recalculates anything itself.
 */
export function CartOrderSummary({
  subtotal,
  gstByRate,
  savings,
  grandTotal,
  orderableCount,
}: {
  subtotal: number;
  gstByRate: GstBreakdownRow[];
  savings: number;
  grandTotal: number;
  orderableCount: number;
}) {
  return (
    <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-[0_8px_30px_rgba(15,23,42,0.08)]">
      <div className="border-b border-slate-100 bg-slate-50 px-5 py-4">
        <h2 className="text-sm font-bold text-slate-900">Order summary</h2>
        <p className="mt-0.5 text-[10px] text-slate-500">
          {orderableCount} orderable item{orderableCount === 1 ? '' : 's'}
        </p>
      </div>

      <div className="space-y-3 p-5">
        <div className="flex items-baseline justify-between gap-3 text-xs text-slate-600">
          <span>Item subtotal</span>
          <span className="text-right font-semibold text-slate-800">{formatInr(subtotal)}</span>
        </div>

        {gstByRate.map(({ rate, amount }) => (
          <div key={rate} className="flex items-baseline justify-between gap-3 text-xs text-slate-600">
            <span>GST {rate}%</span>
            <span className="text-right font-semibold text-slate-800">{formatInr(amount)}</span>
          </div>
        ))}

        {savings > 0 ? (
          <div className="flex items-baseline justify-between gap-3 text-xs font-semibold text-emerald-700">
            <span>Savings vs MRP</span>
            <span className="text-right">−{formatInr(savings)}</span>
          </div>
        ) : null}

        <div className="flex items-baseline justify-between gap-3 border-t border-dashed border-slate-200 pt-4">
          <span className="text-sm font-bold text-slate-900">Grand total</span>
          <span className="text-right text-xl font-bold tracking-tight text-slate-950">{formatInr(grandTotal)}</span>
        </div>
        <p className="text-right text-[9px] text-slate-400">Inclusive of calculated GST</p>

        {orderableCount > 0 ? (
          <Link
            href="/retailer/checkout"
            className="flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-primary-600 px-4 text-xs font-bold text-white shadow-sm transition hover:bg-primary-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-300 focus-visible:ring-offset-2"
          >
            Proceed to checkout <ArrowRight className="h-4 w-4" aria-hidden="true" />
          </Link>
        ) : (
          <span className="flex h-12 w-full cursor-not-allowed items-center justify-center rounded-xl bg-slate-200 px-4 text-xs font-bold text-slate-500">
            No orderable items
          </span>
        )}

        <div className="flex items-center justify-center gap-1.5 text-[9px] text-slate-400">
          <ShieldCheck className="h-3.5 w-3.5 text-emerald-600" aria-hidden="true" />
          Secure server-side validation
        </div>
      </div>
    </section>
  );
}
