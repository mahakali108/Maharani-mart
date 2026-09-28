'use client';

import { useState, useTransition } from 'react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { recordAdjustmentAction } from '@/lib/admin/wallet-actions';

export function WalletAdjustmentForm({ retailerId }: { retailerId: string }) {
  const [isPending, startTransition] = useTransition();
  // One idempotency key per MOUNTED form: a double-click on "Record" reuses the
  // same key, so the ledger's unique constraint turns the second submission
  // into a no-op instead of crediting the shop twice. A fresh page view gets a
  // fresh key, so a genuinely repeated adjustment is still possible.
  const [idempotencyKey] = useState(() => `adj:${retailerId}:${Math.random().toString(36).slice(2, 12)}`);
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
      const result = await recordAdjustmentAction(
        retailerId,
        amountNum,
        direction,
        type,
        reason.trim(),
        notes || undefined,
        idempotencyKey
      );
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
            <option value="credit">Add coins to the shop</option>
            <option value="debit">Remove coins from the shop</option>
          </select>
        </div>
        <div>
          <Label>Type</Label>
          <select value={type} onChange={(e) => setType(e.target.value as never)} className="w-full rounded-lg border border-ink-200 bg-white px-3 py-2 text-sm">
            <option value="MANUAL_CREDIT">Manual top-up</option>
            <option value="MANUAL_DEBIT">Manual deduction</option>
            <option value="REFUND_CREDIT">Refund</option>
            <option value="ADJUSTMENT">Correction</option>
          </select>
        </div>
        <div className="sm:col-span-2">
          <Label>Reason (required)</Label>
          <Input value={reason} onChange={(e) => setReason(e.target.value)} required placeholder="e.g. Festival scheme coins approved" />
        </div>
        <div className="sm:col-span-2">
          <Label>Notes (optional)</Label>
          <Input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Optional" />
        </div>
      </div>

      <button type="submit" disabled={isPending} className="w-full rounded-xl bg-ink-900 px-4 py-2.5 text-sm font-bold text-white disabled:opacity-50">
        {isPending ? 'Recording…' : 'Record coin adjustment'}
      </button>
      <p className="text-[11px] text-ink-400">
        A reason is required. Every adjustment is written to the ledger with the amount, direction, reason and the
        admin who made it.
      </p>
    </form>
  );
}
