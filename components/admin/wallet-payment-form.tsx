'use client';

import { useState, useTransition } from 'react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { recordPaymentAction } from '@/lib/admin/wallet-actions';

export function WalletPaymentForm({ retailerId }: { retailerId: string }) {
  const [isPending, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [amount, setAmount] = useState('');
  const [method, setMethod] = useState<'cash' | 'bank_transfer' | 'upi' | 'cheque' | 'other'>('cash');
  const [paymentDate, setPaymentDate] = useState(new Date().toISOString().slice(0, 10));
  const [reference, setReference] = useState('');
  const [notes, setNotes] = useState('');

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const amountNum = Number(amount);
    if (!amountNum || amountNum <= 0) {
      setError('Enter a valid amount');
      return;
    }
    if (!paymentDate) {
      setError('Payment date required');
      return;
    }
    setError(null);
    setMessage(null);
    startTransition(async () => {
      const idempotencyKey = `pay:${retailerId}:${Date.now()}:${amountNum}`;
      const result = await recordPaymentAction(
        retailerId,
        amountNum,
        method,
        paymentDate,
        reference || undefined,
        notes || undefined,
        idempotencyKey
      );
      if ('error' in result) setError(result.error);
      else {
        setMessage(result.message ?? 'Payment recorded');
        setAmount('');
        setReference('');
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
          <Input type="number" min={0.01} step={0.01} value={amount} onChange={(e) => setAmount(e.target.value)} required placeholder="e.g. 5000" />
        </div>
        <div>
          <Label>Payment Method</Label>
          <select value={method} onChange={(e) => setMethod(e.target.value as never)} className="w-full rounded-lg border border-ink-200 bg-white px-3 py-2 text-sm">
            <option value="cash">Cash</option>
            <option value="bank_transfer">Bank transfer</option>
            <option value="upi">UPI</option>
            <option value="cheque">Cheque</option>
            <option value="other">Other</option>
          </select>
        </div>
        <div>
          <Label>Payment Date</Label>
          <Input type="date" value={paymentDate} onChange={(e) => setPaymentDate(e.target.value)} required />
        </div>
        <div>
          <Label>Reference Number</Label>
          <Input value={reference} onChange={(e) => setReference(e.target.value)} placeholder="Optional" />
        </div>
        <div className="sm:col-span-2">
          <Label>Notes</Label>
          <Input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Optional notes" />
        </div>
      </div>

      <button
        type="submit"
        disabled={isPending}
        className="w-full rounded-xl bg-ink-900 px-4 py-2.5 text-sm font-bold text-white hover:bg-ink-800 disabled:opacity-50"
      >
        {isPending ? 'Recording...' : 'Record Payment'}
      </button>
    </form>
  );
}
