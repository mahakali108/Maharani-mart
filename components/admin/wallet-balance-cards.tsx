'use client';

interface Props {
  creditLimit: number;
  outstanding: number;
  available: number;
  totalUsed: number;
  totalPaidBack: number;
  totalCreditGranted: number;
  overdue: number;
  allowOverdue: boolean;
}

export function WalletBalanceCards({
  creditLimit,
  outstanding,
  available,
  totalUsed,
  totalPaidBack,
  totalCreditGranted,
  overdue,
  allowOverdue,
}: Props) {
  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
      <div className="rounded-2xl border border-ink-100 bg-white p-4 shadow-sm">
        <p className="text-[10px] font-bold uppercase tracking-wider text-ink-400">Credit Limit</p>
        <p className="mt-1 text-xl font-bold text-ink-950">₹{creditLimit.toFixed(2)}</p>
        <p className="mt-1 text-[10px] text-ink-500">Total credit granted</p>
      </div>
      <div className="rounded-2xl border border-ink-100 bg-white p-4 shadow-sm">
        <p className="text-[10px] font-bold uppercase tracking-wider text-ink-400">Outstanding</p>
        <p className="mt-1 text-xl font-bold text-ink-950">₹{outstanding.toFixed(2)}</p>
        <p className="mt-1 text-[10px] text-ink-500">Used: ₹{totalUsed.toFixed(2)}</p>
      </div>
      <div className={`rounded-2xl border p-4 shadow-sm ${available < 0 ? 'border-primary-200 bg-primary-50' : 'border-green-200 bg-green-50'}`}>
        <p className="text-[10px] font-bold uppercase tracking-wider text-ink-400">Available Credit</p>
        <p className={`mt-1 text-xl font-bold ${available < 0 ? 'text-primary-700' : 'text-green-700'}`}>₹{available.toFixed(2)}</p>
        <p className="mt-1 text-[10px] text-ink-500">Paid back: ₹{totalPaidBack.toFixed(2)}</p>
      </div>
      <div className="rounded-2xl border border-ink-100 bg-white p-4 shadow-sm">
        <p className="text-[10px] font-bold uppercase tracking-wider text-ink-400">Overdue Amount</p>
        <p className={`mt-1 text-xl font-bold ${overdue > 0 ? 'text-primary-600' : 'text-ink-950'}`}>₹{overdue.toFixed(2)}</p>
        <p className="mt-1 text-[10px] text-ink-500">Allowed: {allowOverdue ? 'Yes' : 'No'}</p>
      </div>
    </div>
  );
}
