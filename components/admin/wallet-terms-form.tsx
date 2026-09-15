'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { setPaymentTermsAction } from '@/lib/admin/wallet-actions';

/**
 * Admin control for a retailer's Net-N payment terms (migration 0049).
 * Presets cover the common B2B terms; custom days (0–365) are allowed.
 * Setting terms never touches money — it only stores the terms on the
 * credit account, and the app derives due dates from real ledger data.
 */
export function WalletTermsForm({
  retailerId,
  currentTermsDays,
}: {
  retailerId: string;
  currentTermsDays: number | null;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [terms, setTerms] = useState(
    currentTermsDays === null ? '' : String(currentTermsDays)
  );
  const [reason, setReason] = useState('');

  function submit(nextTerms: number | null) {
    setError(null);
    setMessage(null);
    if (reason.trim().length < 5) {
      setError('Reason must be at least 5 characters');
      return;
    }
    startTransition(async () => {
      const result = await setPaymentTermsAction(retailerId, nextTerms, reason.trim());
      if ('error' in result) {
        setError(result.error);
      } else {
        setMessage(result.message ?? 'Terms updated');
        setReason('');
        router.refresh();
      }
    });
  }

  return (
    <form
      className="space-y-3"
      onSubmit={(e) => {
        e.preventDefault();
        const value = terms.trim();
        const parsed = value === '' ? null : Number(value);
        if (parsed !== null && (!Number.isInteger(parsed) || parsed < 0 || parsed > 365)) {
          setError('Terms must be a whole number of days between 0 and 365');
          return;
        }
        submit(parsed);
      }}
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="terms-days">Payment terms (Net-N days)</Label>
          <Input
            id="terms-days"
            type="number"
            min={0}
            max={365}
            step={1}
            value={terms}
            onChange={(e) => setTerms(e.target.value)}
            placeholder="Not set"
          />
          <div className="flex flex-wrap gap-1.5">
            {[15, 30, 60].map((days) => (
              <button
                key={days}
                type="button"
                onClick={() => setTerms(String(days))}
                className="rounded-full border border-ink-200 bg-white px-2.5 py-1 text-[10px] font-semibold text-ink-600 hover:border-primary-300 hover:text-primary-700"
              >
                Net {days}
              </button>
            ))}
            <button
              type="button"
              onClick={() => setTerms('')}
              className="rounded-full border border-ink-200 bg-white px-2.5 py-1 text-[10px] font-semibold text-ink-600 hover:border-primary-300 hover:text-primary-700"
            >
              Clear
            </button>
          </div>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="terms-reason">Reason</Label>
          <Input
            id="terms-reason"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="e.g. Moving shop to Net-30 terms"
          />
        </div>
      </div>

      {error ? (
        <div role="alert" className="rounded-xl border border-primary-200 bg-primary-50 px-3 py-2.5 text-sm text-primary-700">
          {error}
        </div>
      ) : null}
      {message ? (
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2.5 text-sm text-emerald-700">
          {message}
        </div>
      ) : null}

      <div className="flex justify-end">
        <Button type="submit" size="sm" disabled={isPending}>
          {isPending ? 'Saving…' : 'Save payment terms'}
        </Button>
      </div>
    </form>
  );
}
