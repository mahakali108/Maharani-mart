'use client';

import { useState, useTransition } from 'react';
import { CheckCircle2, Loader2, LockKeyhole, MapPin } from 'lucide-react';
import { placeOrderAction } from '@/lib/retailer/checkout-actions';

export interface CheckoutFormProps {
  grandTotal: number;
  subtotal?: number;
  gstTotal?: number;
  itemCount?: number;
}

export function CheckoutForm({ grandTotal, subtotal, gstTotal, itemCount }: CheckoutFormProps) {
  const [notes, setNotes] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function handlePlaceOrder() {
    setError(null);
    startTransition(async () => {
      const result = await placeOrderAction(notes);
      if (result && 'error' in result) setError(result.error ?? 'Failed to place order.');
    });
  }

  return (
    <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
      <div className="flex items-center gap-2 border-b border-slate-100 bg-slate-50 px-4 py-3.5"><MapPin className="h-4 w-4 text-primary-600" /><h2 className="text-sm font-bold text-slate-900">Delivery instructions</h2></div>
      <div className="space-y-4 p-4">
        <div>
          <label htmlFor="notes" className="mb-1.5 block text-[9px] font-bold uppercase tracking-wider text-slate-500">Notes for this order (optional)</label>
          <textarea id="notes" value={notes} onChange={(event) => setNotes(event.target.value)} rows={3} placeholder="Preferred delivery time, landmark or special instructions" className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-xs text-slate-900 outline-none placeholder:text-slate-400 focus:border-primary-300 focus:ring-2 focus:ring-primary-50" />
        </div>

        {itemCount || subtotal !== undefined ? (
          <div className="rounded-xl bg-slate-50 p-3 text-[10px] text-slate-500 space-y-1">
            {itemCount ? <div className="flex justify-between"><span>Items to place</span><span className="font-bold text-slate-800">{itemCount} line item{itemCount === 1 ? '' : 's'}</span></div> : null}
            {subtotal !== undefined ? <div className="flex justify-between"><span>Subtotal (excl. GST)</span><span className="font-semibold text-slate-700">₹{subtotal.toFixed(2)}</span></div> : null}
            {gstTotal !== undefined ? <div className="flex justify-between"><span>Total GST component</span><span className="font-semibold text-slate-700">₹{gstTotal.toFixed(2)}</span></div> : null}
          </div>
        ) : null}

        {error ? <div role="alert" className="rounded-xl border border-primary-200 bg-primary-50 px-3 py-2.5 text-[10px] font-medium text-primary-700">{error}</div> : null}

        <button type="button" onClick={handlePlaceOrder} disabled={isPending} className="flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-primary-600 px-4 text-xs font-bold text-white shadow-sm transition hover:bg-primary-700 disabled:opacity-60">
          {isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
          {isPending ? 'Placing order…' : `Place order · ₹${grandTotal.toFixed(2)}`}
        </button>
        <p className="flex items-start justify-center gap-1.5 text-center text-[9px] leading-4 text-slate-400"><LockKeyhole className="mt-0.5 h-3 w-3 shrink-0 text-emerald-600" /> By placing this order, prices, MOQ, GST, credit and availability will be securely rechecked.</p>
      </div>
    </section>
  );
}
