import Link from 'next/link';
import { ArrowRight } from 'lucide-react';
import { formatInr } from '@/lib/retailer/format';

/**
 * Mobile-only sticky checkout bar. Sits above the locked five-tab bottom
 * navigation (which owns the safe-area inset) and respects the same inset so
 * nothing overlaps. Total and CTA come from the server-computed values; the
 * checkout link uses the existing checkout flow.
 */
export function CartCheckoutBar({ grandTotal, orderableCount }: { grandTotal: number; orderableCount: number }) {
  return (
    <div
      role="region"
      aria-label="Checkout summary"
      className="fixed inset-x-0 bottom-[calc(4.25rem+env(safe-area-inset-bottom))] z-30 border-t border-slate-200 bg-white/95 px-3 pb-3 pt-2.5 shadow-[0_-8px_30px_rgba(15,23,42,0.10)] backdrop-blur-xl lg:hidden"
    >
      <div className="mx-auto flex max-w-2xl items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[9px] font-bold uppercase tracking-wider text-slate-400">Grand total</p>
          <p className="truncate text-lg font-bold tracking-tight text-slate-950">{formatInr(grandTotal)}</p>
        </div>
        {orderableCount > 0 ? (
          <Link
            href="/retailer/checkout"
            className="inline-flex h-12 shrink-0 items-center gap-2 rounded-xl bg-primary-600 px-5 text-xs font-bold text-white shadow-sm transition hover:bg-primary-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-300 focus-visible:ring-offset-2"
          >
            Proceed to checkout <ArrowRight className="h-4 w-4" aria-hidden="true" />
          </Link>
        ) : (
          <span className="inline-flex h-12 shrink-0 cursor-not-allowed items-center rounded-xl bg-slate-200 px-5 text-xs font-bold text-slate-500">
            No orderable items
          </span>
        )}
      </div>
    </div>
  );
}
