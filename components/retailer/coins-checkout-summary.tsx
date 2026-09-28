import { Coins, ShieldCheck } from 'lucide-react';
import { computeCoinPayment, COIN_SYMBOL } from '@/lib/coins/math';
import { formatInr, paiseToRupees } from '@/lib/retailer/format';

/**
 * 🪙 Checkout coin panel — exactly four numbers, no credit:
 *
 *   Order Total
 *   Coins Available
 *   Coins Used
 *   Remaining Payable
 *
 * Everything here is computed server-side from the live wallet position and the
 * server-quoted total; the browser never supplies an amount. The order service
 * recomputes the same payment with the same pure function immediately before
 * the ledger write, so this panel can only ever confirm what will be charged.
 */
export function CoinsCheckoutSummary({
  orderTotalPaise,
  balancePaise,
}: {
  orderTotalPaise: number;
  balancePaise: number;
}) {
  const payment = computeCoinPayment({ orderTotalPaise, balancePaise });

  return (
    <section
      aria-label="Coin payment"
      className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm"
    >
      <div className="flex items-center gap-2 border-b border-slate-100 bg-amber-50/70 px-4 py-3.5 sm:px-5">
        <span aria-hidden="true" className="text-base leading-none">{COIN_SYMBOL}</span>
        <Coins className="h-4 w-4 text-amber-700" aria-hidden="true" />
        <h2 className="text-sm font-bold text-slate-900">Coin payment</h2>
      </div>
      <dl className="space-y-3 p-4 text-xs sm:p-5">
        <div className="flex items-center justify-between gap-3">
          <dt className="text-slate-600">Order total</dt>
          <dd className="font-bold text-slate-900">{formatInr(paiseToRupees(payment.orderTotalPaise))}</dd>
        </div>
        <div className="flex items-center justify-between gap-3">
          <dt className="text-slate-600">{COIN_SYMBOL} Coins available</dt>
          <dd className="font-semibold text-slate-900">{formatInr(paiseToRupees(payment.balancePaise))}</dd>
        </div>
        <div className="flex items-center justify-between gap-3">
          <dt className="text-slate-600">{COIN_SYMBOL} Coins used</dt>
          <dd className="font-semibold text-emerald-700">−{formatInr(paiseToRupees(payment.usedPaise))}</dd>
        </div>
        <div className="flex items-end justify-between gap-3 border-t border-dashed border-slate-200 pt-3">
          <dt className="text-sm font-bold text-slate-900">Remaining payable</dt>
          <dd className="text-lg font-bold tracking-tight text-slate-950">
            {formatInr(paiseToRupees(payment.remainingPaise))}
          </dd>
        </div>
        <p className="flex items-start gap-1.5 text-[10px] leading-4 text-slate-500">
          <ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-600" aria-hidden="true" />
          <span>
            {payment.usedPaise > 0
              ? 'Coins are deducted once, on the server, when the order is placed.'
              : 'No coins are deducted for this order.'}{' '}
            {payment.partial
              ? 'The remaining amount is collected on delivery.'
              : 'This order is fully covered by your coins.'}
          </span>
        </p>
      </dl>
    </section>
  );
}
