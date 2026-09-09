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
    if (limitNum < currentOutstanding && !allowOverdueState) {
      if (!confirm(`New limit ₹${limitNum.toFixed(2)} is below current outstanding ₹${currentOutstanding.toFixed(2)}. This will make account over-limit. Continue?`)) {
        return;
      }
    }
    setError(null);
    setMessage(null);
    startTransition(async () => {
      const result = await setCreditLimitAction(retailerId, limitNum, reason.trim(), {
        allowOverdue: allowOverdueState,
        overdueLimitRupees: Number(overdueLimitState) || 0,
      });
      if ('error' in result) setError(result.error);
      else {
        setMessage(result.message ?? 'Limit updated');
        setReason('');
      }
    });
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-3">
      {error ? <p className="rounded-lg border border-primary-200 bg-primary-50 px-3 py-2 text-xs text-primary-700">{error}</p> : null}
      {message ? <p className="rounded-lg border border-green-200 bg-green-50 px-3 py-2 text-xs text-green-700">{message}</p> : null}

      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <Label>Credit Limit (₹)</Label>
          <Input type="number" min={0} step={0.01} value={limit} onChange={(e) => setLimit(e.target.value)} required />
          <p className="mt-1 text-[10px] text-ink-400">Current: ₹{currentLimit.toFixed(2)} · Outstanding: ₹{currentOutstanding.toFixed(2)}</p>
        </div>
        <div>
          <Label>Overdue Limit (₹) — if overdue allowed</Label>
          <Input type="number" min={0} step={0.01} value={overdueLimitState} onChange={(e) => setOverdueLimitState(e.target.value)} />
        </div>
        <div className="sm:col-span-2 flex items-center gap-2">
          <input type="checkbox" checked={allowOverdueState} onChange={(e) => setAllowOverdueState(e.target.checked)} id="allowOverdue" />
          <Label htmlFor="allowOverdue">Allow overdue (explicit Admin approval for negative available credit)</Label>
        </div>
        <div className="sm:col-span-2">
          <Label>Reason (required)</Label>
          <Input value={reason} onChange={(e) => setReason(e.target.value)} required placeholder="e.g. Initial limit approved by Finance" />
        </div>
      </div>

      <button type="submit" disabled={isPending} className="w-full rounded-xl bg-ink-900 px-4 py-2.5 text-sm font-bold text-white disabled:opacity-50">
        {isPending ? 'Updating...' : 'Set Credit Limit'}
      </button>
      <p className="text-[11px] text-ink-400">Only authorized Admin/staff may change limits. Retailers cannot change their own. All changes audited.</p>
    </form>
  );
}
