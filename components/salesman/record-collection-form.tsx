'use client';

/**
 * Sales executive "record a collection" form. The amount goes into the
 * admin verification queue (payment_collections, status pending) — the
 * retailer's wallet is credited only after finance verifies it.
 * Optional photo proof is uploaded through the media pipeline into the
 * PRIVATE `payment-proofs` bucket.
 */

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { BadgeIndianRupee, Loader2, Upload } from 'lucide-react';

import { recordCollectionAction } from '@/lib/salesman/collection-actions';
import { MediaUploadField } from '@/components/media/media-upload-field';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';

export function RecordCollectionForm({
  retailers,
  defaultRetailerId,
}: {
  retailers: { id: string; shopName: string }[];
  defaultRetailerId?: string;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const [retailerId, setRetailerId] = useState(defaultRetailerId ?? retailers[0]?.id ?? '');
  const [amount, setAmount] = useState('');
  const [method, setMethod] = useState('cash');
  const [reference, setReference] = useState('');
  const [notes, setNotes] = useState('');
  const [proofUrl, setProofUrl] = useState<string | null>(null);

  if (retailers.length === 0) {
    return (
      <Card className="p-5 text-sm text-ink-500">
        No retailers are assigned to you yet — collections can only be recorded for your own retailers.
      </Card>
    );
  }

  function submit() {
    setError(null);
    setNotice(null);
    const amountRupees = Number(amount);
    if (!Number.isFinite(amountRupees) || amountRupees <= 0) {
      setError('Enter the collected amount in rupees.');
      return;
    }
    startTransition(async () => {
      const result = await recordCollectionAction({
        retailerId,
        amountRupees,
        method: method as 'cash' | 'bank_transfer' | 'upi' | 'cheque' | 'other',
        referenceNumber: reference,
        notes,
        proofUrl,
      });
      if ('error' in result) {
        setError(result.error);
        return;
      }
      setNotice(result.message ?? 'Collection recorded.');
      setAmount('');
      setReference('');
      setNotes('');
      setProofUrl(null);
      router.refresh();
    });
  }

  return (
    <Card className="space-y-4 p-5">
      <h2 className="flex items-center gap-2 text-base font-semibold text-ink-950">
        <BadgeIndianRupee className="h-4 w-4" />
        Record a collection
      </h2>

      {error ? (
        <div className="rounded-xl border border-primary-200 bg-primary-50 px-4 py-3 text-sm text-primary-700">{error}</div>
      ) : null}
      {notice ? (
        <div className="rounded-xl border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-700">{notice}</div>
      ) : null}

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <label htmlFor="collection-retailer" className="text-xs font-medium text-ink-600">Retailer *</label>
          <Select
            id="collection-retailer"
            value={retailerId}
            onChange={(e) => setRetailerId(e.target.value)}
            disabled={retailers.length === 1}
          >
            {retailers.map((r) => (
              <option key={r.id} value={r.id}>{r.shopName}</option>
            ))}
          </Select>
        </div>
        <div className="space-y-1.5">
          <label htmlFor="collection-amount" className="text-xs font-medium text-ink-600">Amount (₹) *</label>
          <Input
            id="collection-amount"
            value={amount}
            onChange={(e) => setAmount(e.target.value.replace(/[^\d.]/g, ''))}
            inputMode="decimal"
            placeholder="e.g. 2500"
          />
        </div>
        <div className="space-y-1.5">
          <label htmlFor="collection-method" className="text-xs font-medium text-ink-600">Method *</label>
          <Select id="collection-method" value={method} onChange={(e) => setMethod(e.target.value)}>
            <option value="cash">Cash</option>
            <option value="bank_transfer">Bank transfer</option>
            <option value="upi">UPI</option>
            <option value="cheque">Cheque</option>
            <option value="other">Other</option>
          </Select>
        </div>
        <div className="space-y-1.5">
          <label htmlFor="collection-reference" className="text-xs font-medium text-ink-600">Reference (optional)</label>
          <Input
            id="collection-reference"
            value={reference}
            onChange={(e) => setReference(e.target.value)}
            maxLength={100}
            placeholder="Cheque / UTR / UPI ref no."
          />
        </div>
      </div>

      <div className="space-y-1.5">
        <label htmlFor="collection-notes" className="text-xs font-medium text-ink-600">Notes (optional)</label>
        <textarea
          id="collection-notes"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          rows={2}
          maxLength={500}
          className="w-full rounded-xl border border-ink-200 bg-white px-3 py-2 text-sm text-ink-900 focus:outline-none focus:ring-2 focus:ring-primary-500"
          placeholder="Context for finance, e.g. part payment for last invoice"
        />
      </div>

      <div className="space-y-1.5 rounded-xl border border-ink-100 p-3">
        <p className="flex items-center gap-1.5 text-xs font-medium text-ink-600">
          <Upload className="h-3.5 w-3.5" /> Photo proof (optional — cheque, receipt, UPI screenshot)
        </p>
        {proofUrl ? (
          <div className="flex items-center justify-between gap-2 text-xs text-green-700">
            <span>Proof attached</span>
            <button type="button" onClick={() => setProofUrl(null)} className="text-primary-600 hover:underline">
              Remove
            </button>
          </div>
        ) : (
          <MediaUploadField
            kind="payment-proof"
            ownerId={retailerId}
            onUploaded={(media) => setProofUrl(media.ref)}
            label="Attach proof"
            replaceLabel="Replace proof"
            disabled={!retailerId}
          />
        )}
      </div>

      <Button disabled={isPending || !retailerId || !amount} onClick={submit}>
        {isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <BadgeIndianRupee className="h-4 w-4" />}
        Submit for verification
      </Button>
      <p className="text-[11px] text-ink-400">
        The retailer&apos;s wallet is credited only after the office verifies this collection — this form records field
        cash, it does not credit the account.
      </p>
    </Card>
  );
}
