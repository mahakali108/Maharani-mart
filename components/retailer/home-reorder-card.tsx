'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Check, Loader2, RotateCcw } from 'lucide-react';
import { StoredImage } from '@/components/media/stored-image';
import { addReorderLinesToCartAction } from '@/lib/retailer/order-actions';
import { formatInr } from '@/lib/retailer/format';
import type { HomeReorderItem } from '@/lib/retailer/home-data';

export function HomeReorderCard({ item }: { item: HomeReorderItem }) {
  const [pending, setPending] = useState(false);
  const [added, setAdded] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function reorder() {
    if (!item.packId || !item.canReorder || pending) return;
    const packId = item.packId;
    setError(null);
    setAdded(false);
    setPending(true);
    try {
      const result = await addReorderLinesToCartAction(item.orderId, [{ packId, quantity: item.quantity }]);
      if ('error' in result) setError(result.error || 'Could not reorder this item. Review your order.');
      else if ('success' in result && result.skippedCount) setError('This item is no longer orderable. Review current terms.');
      else setAdded(true);
    } catch {
      setError('Could not reorder this item. Please try again.');
    } finally {
      setPending(false);
    }
  }

  return (
    <article className="flex min-w-0 flex-col rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex min-w-0 gap-3">
        <div className="relative h-16 w-16 shrink-0 overflow-hidden rounded-xl bg-slate-50">
          <StoredImage src={item.imageUrl} alt={item.name || 'Previously ordered product'} fill size="thumb" sizes="64px" className="object-contain p-1.5" />
        </div>
        <div className="min-w-0">
          {item.name && item.detailsHref ? <Link href={item.detailsHref} className="rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-action-500"><h3 className="line-clamp-2 break-words text-xs font-semibold leading-5 text-slate-900">{item.name}</h3></Link>
            : <h3 className="text-xs font-semibold text-slate-700">{item.name || 'Product no longer available'}</h3>}
          {item.packName ? <p className="mt-0.5 text-[11px] text-slate-500">{item.packName}</p> : null}
          <p className="mt-1 text-[11px] font-medium text-slate-600">Last ordered: {item.previousQuantity} pcs</p>
        </div>
      </div>
      <div className="mt-3 flex flex-wrap items-baseline justify-between gap-1">
        <p className="text-sm font-bold text-slate-950">{item.unitPrice !== null ? <>{formatInr(item.unitPrice)}<span className="text-[10px] font-normal text-slate-500"> /pc · incl. GST</span></> : <span className="text-xs font-medium text-slate-500">Current price unavailable</span>}</p>
        {item.moq !== null ? <span className="text-[10px] text-slate-500">MOQ {item.moq} pcs</span> : null}
      </div>
      {item.quantity > item.previousQuantity ? <p className="mt-2 text-[10px] text-amber-800">Reorder quantity adjusted to the current MOQ.</p> : null}
      {item.availability === 'out_of_stock' ? <p className="mt-2 text-[11px] text-slate-500">Out of stock right now.</p> : null}
      <div className="mt-auto flex flex-wrap items-center gap-2 pt-3">
        <button type="button" onClick={reorder} disabled={pending || !item.canReorder}
          aria-label={`Reorder ${item.quantity} ${item.name || 'product'} pieces`}
          className="flex min-h-11 flex-1 items-center justify-center gap-1.5 rounded-lg bg-action-600 px-3 text-[11px] font-semibold text-white hover:bg-action-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-action-500 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-500">
          {pending ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" /> : added ? <Check className="h-3.5 w-3.5" aria-hidden="true" /> : <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />}
          {pending ? 'Adding…' : added ? 'Add again' : `Reorder ${item.quantity} pcs`}
        </button>
        <Link href={`/retailer/orders/${item.orderId}/reorder`} className="inline-flex min-h-11 items-center rounded-lg px-2 text-[11px] font-semibold text-action-700 hover:bg-action-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-action-500">Review order</Link>
      </div>
      {added ? <p role="status" className="mt-2 text-[11px] text-emerald-700">Added to your cart at current terms.</p> : null}
      {error ? <p role="alert" className="mt-2 text-[11px] text-rose-700">{error}</p> : null}
    </article>
  );
}
