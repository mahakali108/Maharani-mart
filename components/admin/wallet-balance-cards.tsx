'use client';

interface Props {
  creditLimit: number;
  outstanding: number;
  available: number;
  totalUsed: number;
  totalPaidBack: number;
  overdue: number;
  allowOverdue: boolean;
}

export function WalletBalanceCards({
  creditLimit,
  outstanding,
  available,
  totalUsed,
  totalPaidBack,
  overdue,
  allowOverdue,
}: Props) {
  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
      <div className="rounded-2xl border border-amber-200 bg-amber-50/60 p-4 shadow-sm">
        <p className="text-[10px] font-bold uppercase tracking-wider text-amber-700">🪙 Coins available</p>
        <p className="mt-1 text-xl font-bold text-ink-950">₹{available.toFixed(2)}</p>
        <p className="mt-1 text-[10px] text-ink-500">1 coin = ₹1 — the spendable balance of the shop</p>
      </div>
      <div className="rounded-2xl border border-ink-100 bg-white p-4 shadow-sm">
        <p className="text-[10px] font-bold uppercase tracking-wider text-ink-400">Coins spent</p>
        <p className="mt-1 text-xl font-bold text-ink-950">₹{totalUsed.toFixed(2)}</p>
        <p className="mt-1 text-[10px] text-ink-500">Order deductions recorded on the ledger</p>
      </div>
      <div className="rounded-2xl border border-mint-200 bg-mint-50 p-4 shadow-sm">
        <p className="text-[10px] font-bold uppercase tracking-wider text-ink-400">Coins added</p>
        <p className="mt-1 text-xl font-bold text-mint-700">₹{totalPaidBack.toFixed(2)}</p>
        <p className="mt-1 text-[10px] text-ink-500">Top-ups, refunds and credits</p>
      </div>
      <div className="rounded-2xl border border-ink-100 bg-white p-4 shadow-sm">
        <p className="text-[10px] font-bold uppercase tracking-wider text-ink-400">Historical credit mirror</p>
        <p className={`mt-1 text-xl font-bold ${outstanding > 0 ? 'text-ink-700' : 'text-ink-950'}`}>
          ₹{outstanding.toFixed(2)}
        </p>
        <p className="mt-1 text-[10px] text-ink-500">
          Outstanding ₹{outstanding.toFixed(2)} · funding limit ₹{creditLimit.toFixed(2)} · overdue ₹{overdue.toFixed(2)}
          {allowOverdue ? ' · legacy overdue policy on' : ''}
        </p>
      </div>
    </div>
  );
}
