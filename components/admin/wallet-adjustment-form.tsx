'use client';

import { useState, useTransition } from 'react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { recordAdjustmentAction } from '@/lib/admin/wallet-actions';

export function WalletAdjustmentForm({ retailerId }: { retailerId: string }) {
  const [isPending, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [amount, setAmount] = useState('');
  const [direction, setDirection] = useState<'credit' | 'debit'>('credit');
  const [type, setType] = useState<'MANUAL_CREDIT' | 'MANUAL_DEBIT' | 'ADJUSTMENT' | 'REFUND_CREDIT'>('MANUAL_CREDIT');
  const [reason, setReason] = useState('');
  const [notes, setNotes] = useState('');

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const amountNum = Number(amount);
    if (!amountNum || amountNum <= 0) {
      setError('Enter valid amount');
      return;
    }
    if (!reason || reason.trim().length < 5) {
      setError('Reason must be at least 5 characters');
      return;
    }
    setError(null);
    setMessage(null);
    startTransition(async () => {
      const key = `adj:${retailerId}:${Date.now()}:${amountNum}:${type}`;
      const result = await recordAdjustmentAction(retailerId, amountNum, direction, type, reason.trim(), notes || undefined, key);
      if ('error' in result) setError(result.error);
      else {
        setMessage(result.message ?? 'Adjustment recorded');
        setAmount('');
        setReason('');
        setNotes('');
      }
    });
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-3">
      {error ? <p className="rounded-lg border border-primary-200 bg-primary-50 px-3 py-2 text-xs text-primary-700">{error}</p> : null}
      {message ? <p className="rounded-lg border border-green-200 bg-green-50 px-3 py-2 text-xs text-green-700">{message}</p> : null}

      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <Label>Amount (₹)</Label>
          <Input type="number" min={0.01} step={0.01} value={amount} onChange={(e) => setAmount(e.target.value)} required />
        </div>
        <div>
          <Label>Direction</Label>
          <select value={direction} onChange={(e) => setDirection(e.target.value as never)} className="w-full rounded-lg border border-ink-200 bg-white px-3 py-2 text-sm">
            <option value="credit">Credit (reduces outstanding)</option>
            <option value="debit">Debit (increases outstanding)</option>
          </select>
        </div>
        <div>
          <Label>Type</Label>
          <select value={type} onChange={(e) => setType(e.target.value as never)} className="w-full rounded-lg border border-ink-200 bg-white px-3 py-2 text-sm">
            <option value="MANUAL_CREDIT">Manual Credit</option>
            <option value="MANUAL_DEBIT">Manual Debit</option>
            <option value="REFUND_CREDIT">Refund Credit</option>
            <option value="ADJUSTMENT">Adjustment</option>
          </select>
        </div>
        <div className="sm:col-span-2">
          <Label>Reason (required)</Label>
          <Input value={reason} onChange={(e) => setReason(e.target.value)} required placeholder="e.g. Approved credit for festival scheme" />
        </div>
        <div className="sm:col-span-2">
          <Label>Notes (optional)</Label>
          <Input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Optional" />
        </div>
      </div>

      <button type="submit" disabled={isPending} className="w-full rounded-xl bg-ink-900 px-4 py-2.5 text-sm font-bold text-white disabled:opacity-50">
        {isPending ? 'Recording...' : 'Record Adjustment'}
      </button>
      <p className="text-[11px] text-ink-400">Debit adjustments require reason. All actions are auditable and need confirmation.</p>
    </form>
  );
}
