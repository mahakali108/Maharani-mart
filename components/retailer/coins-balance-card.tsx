import Link from 'next/link';
import { ArrowRight, Coins, ShieldCheck } from 'lucide-react';
import { coinBalancePaise, computeCoinPayment, COIN_SYMBOL } from '@/lib/coins/math';
import { formatInr, paiseToRupees } from '@/lib/retailer/format';

/**
 * 🪙 The customer's coin balance — the ONE balance a retailer has.
 *
 * Maharani Traders does not offer retailer credit, so no screen shows a credit
 * limit, an outstanding amount, Net-15/Net-30 terms or a pay-later option. A
 * shop sees its coin balance, and — when it is shopping — how many coins the
 * current order uses.
 *
 * Presentational: the balance arrives from a server read and the payment maths
 * comes from lib/coins/math, the same pure function the server bills with.
 */
export function CoinsBalanceCard({
  limitPaise,
  outstandingPaise,
  orderTotalPaise,
  title = 'Coins balance',
  showLedgerLink = true,
}: {
  limitPaise: number;
  outstandingPaise: number;
  /** When set, the order impact (coins used / payable) is shown too. */
  orderTotalPaise?: number;
  title?: string;
  showLedgerLink?: boolean;
}) {
  const balancePaise = coinBalancePaise(limitPaise, outstandingPaise);
  const payment =
    orderTotalPaise === undefined
      ? null
      : computeCoinPayment({ orderTotalPaise, balancePaise });

  return (
    <section
      aria-label={title}
      className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm"
    >
      <div className="flex items-center justify-between border-b border-slate-100 bg-gradient-to-r from-amber-50 to-white px-4 py-3.5">
        <div className="flex items-center gap-2.5">
          <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-amber-100 text-amber-700" aria-hidden="true">
            <Coins className="h-4.5 w-4.5" />
          </span>
          <div>
            <h2 className="text-xs font-bold text-slate-900">{title}</h2>
            <p className="text-[9px] text-slate-500">Spend coins on any order — 1 coin = ₹1</p>
          </div>
        </div>
        <ShieldCheck className="h-4 w-4 text-emerald-600" aria-hidden="true" />
      </div>

      <div className="p-4">
        <p className="text-[9px] font-bold uppercase tracking-wider text-slate-400">
          {COIN_SYMBOL} Coins available
        </p>
        <p className="mt-1 text-2xl font-bold tracking-tight text-slate-950">{formatInr(paiseToRupees(balancePaise))}</p>

        {payment ? (
          <dl className="mt-4 space-y-2 rounded-xl bg-slate-50 p-3 text-xs">
            <div className="flex justify-between text-slate-600">
              <dt>Order total</dt>
              <dd className="font-semibold text-slate-900">{formatInr(paiseToRupees(payment.orderTotalPaise))}</dd>
            </div>
            <div className="flex justify-between text-slate-600">
              <dt>{COIN_SYMBOL} Coins used</dt>
              <dd className="font-semibold text-emerald-700">−{formatInr(paiseToRupees(payment.usedPaise))}</dd>
            </div>
            <div className="flex justify-between border-t border-slate-200 pt-2 font-bold text-slate-900">
              <dt>Remaining payable</dt>
              <dd>{formatInr(paiseToRupees(payment.remainingPaise))}</dd>
            </div>
            {payment.partial ? (
              <p className="text-[9px] leading-4 text-slate-500">
                Your coins cover part of this order. The remaining amount is payable on delivery.
              </p>
            ) : null}
          </dl>
        ) : null}

        {showLedgerLink ? (
          <Link
            href="/retailer/account/ledger"
            className="mt-4 flex min-h-11 items-center justify-between gap-2 rounded-xl border border-slate-200 px-3 text-xs font-semibold text-primary-700 hover:bg-primary-50"
          >
            Coin history
            <ArrowRight className="h-4 w-4" aria-hidden="true" />
          </Link>
        ) : null}
      </div>
    </section>
  );
}
