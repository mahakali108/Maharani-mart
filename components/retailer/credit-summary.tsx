import { CreditCard, ShieldCheck, WalletCards } from 'lucide-react';

/**
 * Presentational credit summary only. Values come from the retailer
 * record and the authoritative credit validation remains in
 * createOrderForRetailer when an order is submitted.
 */
export function CreditSummary({
  creditLimit,
  outstandingBalance,
  orderImpact,
}: {
  creditLimit: number;
  outstandingBalance: number;
  orderImpact?: number;
}) {
  const hasLimit = creditLimit > 0;
  const availableCredit = hasLimit ? Math.max(0, creditLimit - outstandingBalance) : null;
  const usedPercent = hasLimit ? Math.min(100, Math.max(0, (outstandingBalance / creditLimit) * 100)) : 0;
  const availableAfter =
    orderImpact !== undefined && availableCredit !== null
      ? Math.max(0, availableCredit - orderImpact)
      : null;

  return (
    <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
      <div className="flex items-center justify-between border-b border-slate-100 bg-gradient-to-r from-slate-50 to-white px-4 py-3.5">
        <div className="flex items-center gap-2.5">
          <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-emerald-50 text-emerald-700">
            <WalletCards className="h-4.5 w-4.5" />
          </span>
          <div>
            <h2 className="text-xs font-bold text-slate-900">Business credit</h2>
            <p className="text-[9px] text-slate-500">Secure account limit</p>
          </div>
        </div>
        <ShieldCheck className="h-4 w-4 text-emerald-600" />
      </div>

      <div className="p-4">
        <div className="flex items-end justify-between gap-3">
          <div>
            <p className="text-[9px] font-bold uppercase tracking-wider text-slate-400">Available credit</p>
            <p className="mt-1 text-xl font-bold tracking-tight text-slate-950">
              {availableCredit === null ? 'Not configured' : `₹${availableCredit.toFixed(2)}`}
            </p>
          </div>
          {hasLimit ? (
            <p className="text-right text-[10px] leading-4 text-slate-500">
              of <span className="font-semibold text-slate-700">₹{creditLimit.toFixed(2)}</span>
            </p>
          ) : null}
        </div>

        {hasLimit ? (
          <>
            <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-slate-100">
              <div
                className={`h-full rounded-full ${usedPercent > 85 ? 'bg-primary-600' : usedPercent > 60 ? 'bg-amber-500' : 'bg-emerald-500'}`}
                style={{ width: `${usedPercent}%` }}
              />
            </div>
            <div className="mt-2 flex items-center justify-between text-[9px] text-slate-500">
              <span>{usedPercent.toFixed(0)}% used</span>
              <span>Outstanding ₹{outstandingBalance.toFixed(2)}</span>
            </div>
          </>
        ) : (
          <p className="mt-3 text-[10px] leading-4 text-slate-500">Contact your distributor if your shop requires a credit facility.</p>
        )}

        {orderImpact !== undefined && availableCredit !== null ? (
          <div className="mt-4 space-y-2 rounded-xl bg-slate-50 p-3 text-xs">
            <div className="flex justify-between text-slate-600">
              <span className="flex items-center gap-1.5"><CreditCard className="h-3.5 w-3.5" /> This order</span>
              <span className="font-semibold">₹{orderImpact.toFixed(2)}</span>
            </div>
            <div className={`flex justify-between border-t border-slate-200 pt-2 font-bold ${availableAfter! > 0 || orderImpact === 0 ? 'text-slate-900' : 'text-primary-600'}`}>
              <span>Available after order</span>
              <span>₹{availableAfter!.toFixed(2)}</span>
            </div>
            <p className="text-[9px] leading-4 text-slate-400">Credit is securely revalidated when the order is placed.</p>
          </div>
        ) : null}
      </div>
    </section>
  );
}
