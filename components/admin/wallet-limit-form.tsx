'use client';

import { useState, useTransition } from 'react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { setCreditLimitAction } from '@/lib/admin/wallet-actions';

export function WalletLimitForm({
  retailerId,
  currentLimit,
  currentOutstanding,
  allowOverdue,
  overdueLimit,
}: {
  retailerId: string;
  currentLimit: number;
  currentOutstanding: number;
  allowOverdue: boolean;
  overdueLimit: number;
}) {
  const [isPending, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [limit, setLimit] = useState(String(currentLimit));
  const [reason, setReason] = useState('');
  const [allowOverdueState, setAllowOverdueState] = useState(allowOverdue);
  const [overdueLimitState, setOverdueLimitState] = useState(String(overdueLimit));

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const limitNum = Number(limit);
    if (isNaN(limitNum) || limitNum < 0) {
      setError('Enter valid limit');
      return;
    }
    if (!reason || reason.trim().length < 5) {
      setError('Reason must be at least 5 characters');
      return;
    }
    let confirmBelowOutstanding = false;
    if (limitNum < currentOutstanding && !allowOverdueState) {
      if (!confirm(`New limit ₹${limitNum.toFixed(2)} is below current outstanding ₹${currentOutstanding.toFixed(2)}. This will make the account over-limit and block new credit orders. Continue?`)) {
        return;
      }
      confirmBelowOutstanding = true;
    }
    setError(null);
    setMessage(null);
    startTransition(async () => {
      const result = await setCreditLimitAction(retailerId, limitNum, reason.trim(), {
        allowOverdue: allowOverdueState,
        overdueLimitRupees: Number(overdueLimitState) || 0,
        confirmBelowOutstanding,
      });
      if ('error' in result) setError(result.error);
      else {
        setMessage(result.message ?? 'Coin funding updated');
        setReason('');
      }
    });
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-3">
      {error ? <p className="rounded-lg border border-primary-200 bg-primary-50 px-3 py-2 text-xs text-primary-700">{error}</p> : null}
      {message ? <p className="rounded-lg border border-mint-200 bg-mint-50 px-3 py-2 text-xs text-mint-700">{message}</p> : null}

      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <Label>Coin funding (₹)</Label>
          <Input type="number" min={0} step={0.01} value={limit} onChange={(e) => setLimit(e.target.value)} required />
          <p className="mt-1 text-[10px] text-ink-400">
            Funding: ₹{currentLimit.toFixed(2)} · Coins already spent: ₹{currentOutstanding.toFixed(2)} · 1 coin = ₹1
          </p>
        </div>
        <div>
          <Label>Legacy overdue threshold (₹) — historical fields only</Label>
          <Input type="number" min={0} step={0.01} value={overdueLimitState} onChange={(e) => setOverdueLimitState(e.target.value)} />
        </div>
        <div className="sm:col-span-2 flex items-center gap-2">
          <input type="checkbox" checked={allowOverdueState} onChange={(e) => setAllowOverdueState(e.target.checked)} id="allowOverdue" />
          <Label htmlFor="allowOverdue">Legacy overdue policy (historical — coins never go negative)</Label>
        </div>
        <div className="sm:col-span-2">
          <Label>Reason (required)</Label>
          <Input value={reason} onChange={(e) => setReason(e.target.value)} required placeholder="e.g. Festival coin funding approved by Finance" />
        </div>
      </div>

      <button type="submit" disabled={isPending} className="w-full rounded-xl bg-ink-900 px-4 py-2.5 text-sm font-bold text-white disabled:opacity-50">
        {isPending ? 'Updating…' : 'Set coin funding'}
      </button>
      <p className="text-[11px] text-ink-400">Only authorized Admin/staff may change limits. Retailers cannot change their own. All changes audited.</p>
    </form>
  );
}
