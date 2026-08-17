'use client';

import { useState, useTransition } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Loader2, RotateCcw, Undo2, XCircle } from 'lucide-react';
import { cancelOrderAction, requestReturnAction } from '@/lib/retailer/order-actions';

export function RetailerOrderActions({ orderId, status }: { orderId: string; status: string }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const [showCancelForm, setShowCancelForm] = useState(false);
  const [showReturnForm, setShowReturnForm] = useState(false);
  const [cancelReason, setCancelReason] = useState('');
  const [returnReason, setReturnReason] = useState('');
  const canCancel = status === 'pending';
  const canReturn = status === 'delivered';

  function handleCancel() {
    setError(null);
    startTransition(async () => {
      const result = await cancelOrderAction(orderId, cancelReason);
      if ('error' in result && result.error) setError(result.error);
      else {
        setShowCancelForm(false);
        router.refresh();
      }
    });
  }

  function handleReturnRequest() {
    setError(null);
    startTransition(async () => {
      const result = await requestReturnAction(orderId, null, returnReason);
      if ('error' in result && result.error) setError(result.error);
      else {
        setShowReturnForm(false);
        setNotice('Return request submitted. Your distributor will review it.');
        router.refresh();
      }
    });
  }

  return (
    <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
      <div className="border-b border-slate-100 bg-slate-50 px-4 py-3.5"><h2 className="text-sm font-bold text-slate-900">Order actions</h2><p className="mt-0.5 text-[10px] text-slate-500">Reorder or manage this purchase</p></div>
      <div className="space-y-3 p-4">
        {error ? <div role="alert" className="rounded-xl border border-primary-200 bg-primary-50 px-3 py-2.5 text-[10px] font-medium text-primary-700">{error}</div> : null}
        {notice ? <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2.5 text-[10px] font-medium text-emerald-700">{notice}</div> : null}

        <Link href={`/retailer/orders/${orderId}/reorder`} className="flex h-10 w-full items-center justify-center gap-2 rounded-xl bg-primary-600 text-xs font-bold text-white transition hover:bg-primary-700"><RotateCcw className="h-4 w-4" /> Reorder these items</Link>

        {canCancel ? <button type="button" disabled={isPending} onClick={() => setShowCancelForm((open) => !open)} className="flex h-10 w-full items-center justify-center gap-2 rounded-xl border border-slate-200 text-xs font-bold text-slate-700 transition hover:border-primary-200 hover:text-primary-600 disabled:opacity-50"><XCircle className="h-4 w-4" /> Cancel order</button> : null}
        {canReturn ? <button type="button" disabled={isPending} onClick={() => setShowReturnForm((open) => !open)} className="flex h-10 w-full items-center justify-center gap-2 rounded-xl border border-slate-200 text-xs font-bold text-slate-700 transition hover:border-primary-200 hover:text-primary-600 disabled:opacity-50"><Undo2 className="h-4 w-4" /> Request return</button> : null}

        {showCancelForm ? (
          <div className="space-y-2 rounded-xl border border-dashed border-slate-300 bg-slate-50 p-3">
            <textarea value={cancelReason} onChange={(event) => setCancelReason(event.target.value)} rows={2} placeholder="Cancellation reason (optional)" className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs outline-none placeholder:text-slate-400 focus:border-primary-300" />
            <button type="button" disabled={isPending} onClick={handleCancel} className="flex h-9 w-full items-center justify-center gap-2 rounded-lg bg-primary-600 text-[10px] font-bold text-white disabled:opacity-60">{isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null} Confirm cancellation</button>
          </div>
        ) : null}

        {showReturnForm ? (
          <div className="space-y-2 rounded-xl border border-dashed border-slate-300 bg-slate-50 p-3">
            <textarea value={returnReason} onChange={(event) => setReturnReason(event.target.value)} rows={3} placeholder="Describe the issue with this order" className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs outline-none placeholder:text-slate-400 focus:border-primary-300" />
            <button type="button" disabled={isPending || !returnReason.trim()} onClick={handleReturnRequest} className="flex h-9 w-full items-center justify-center gap-2 rounded-lg bg-primary-600 text-[10px] font-bold text-white disabled:opacity-60">{isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null} Submit return request</button>
          </div>
        ) : null}
      </div>
    </section>
  );
}
