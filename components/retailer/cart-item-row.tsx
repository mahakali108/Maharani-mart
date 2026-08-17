'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import Image from 'next/image';
import { ImageOff, Loader2, Minus, Plus, Trash2 } from 'lucide-react';
import { updateCartQuantityAction, removeCartItemAction } from '@/lib/retailer/cart-actions';

export function CartItemRow({
  id,
  productName,
  packName,
  imageUrl,
  quantity,
  unitPrice,
  gstPercent,
  moq,
  isUnavailable,
}: {
  id: string;
  productName: string;
  packName: string;
  imageUrl?: string;
  quantity: number;
  unitPrice: number;
  gstPercent: number;
  moq: number;
  isUnavailable: boolean;
}) {
  const router = useRouter();
  const [localQty, setLocalQty] = useState(quantity);
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function handleQuantityChange(next: number) {
    const validQuantity = Math.max(moq, Math.round(next) || moq);
    setLocalQty(validQuantity);
    setError(null);
    startTransition(async () => {
      const result = await updateCartQuantityAction(id, validQuantity);
      if ('error' in result) setError(result.error ?? 'Could not update quantity.');
      else router.refresh();
    });
  }

  function handleRemove() {
    setError(null);
    startTransition(async () => {
      const result = await removeCartItemAction(id);
      if ('error' in result) setError(result.error ?? 'Could not remove this item.');
      else router.refresh();
    });
  }

  const landedUnitPrice = unitPrice * (1 + gstPercent / 100);
  const displayTotal = landedUnitPrice * localQty;

  return (
    <article className={`relative overflow-hidden rounded-2xl border bg-white p-3 shadow-sm sm:p-4 ${isUnavailable ? 'border-primary-200 bg-primary-50/20' : 'border-slate-200'}`}>
      {isPending ? <div className="absolute inset-x-0 top-0 h-0.5 overflow-hidden bg-primary-100"><span className="block h-full w-1/2 animate-pulse bg-primary-600" /></div> : null}
      <div className="flex gap-3 sm:gap-4">
        <div className="relative h-20 w-20 shrink-0 overflow-hidden rounded-xl bg-slate-50 sm:h-24 sm:w-24">
          {imageUrl ? <Image src={imageUrl} alt={productName} fill className="object-contain p-1.5" unoptimized /> : <div className="flex h-full items-center justify-center text-slate-300"><ImageOff className="h-6 w-6" /></div>}
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <h3 className="line-clamp-2 text-xs font-bold leading-4 text-slate-900 sm:text-sm">{productName}</h3>
              <p className="mt-1 text-[10px] font-medium text-slate-500">{packName}</p>
            </div>
            <button
              type="button"
              disabled={isPending}
              onClick={handleRemove}
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-slate-400 transition hover:bg-primary-50 hover:text-primary-600 disabled:opacity-50"
              aria-label={`Remove ${productName}`}
            >
              {isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
            </button>
          </div>

          <div className="mt-2 flex flex-wrap items-baseline gap-2">
            <p className="text-sm font-bold text-slate-950">₹{unitPrice.toFixed(2)} <span className="text-[9px] font-medium text-slate-400">/ pack</span></p>
            <p className="text-[9px] text-slate-400">+ {gstPercent}% GST</p>
          </div>
          <p className="mt-0.5 text-[9px] text-slate-400">MOQ {moq} pack(s)</p>

          {isUnavailable ? <p className="mt-2 text-[10px] font-bold text-primary-700">This item is no longer available and will be skipped.</p> : null}
          {error ? <p role="alert" className="mt-2 text-[10px] font-medium text-primary-700">{error}</p> : null}
        </div>
      </div>

      <div className="mt-3 flex items-end justify-between gap-3 border-t border-slate-100 pt-3">
        <div>
          <p className="mb-1 text-[9px] font-bold uppercase tracking-wider text-slate-400">Quantity</p>
          <div className="flex h-9 w-32 items-center overflow-hidden rounded-lg border border-slate-200 bg-white">
            <button type="button" onClick={() => handleQuantityChange(localQty - 1)} disabled={isPending || isUnavailable || localQty <= moq} className="flex h-full w-9 items-center justify-center text-slate-500 hover:bg-slate-50 disabled:text-slate-300" aria-label={`Decrease ${productName} quantity`}><Minus className="h-3.5 w-3.5" /></button>
            <input type="number" min={moq} step={1} value={localQty} disabled={isPending || isUnavailable} onChange={(event) => handleQuantityChange(Number(event.target.value) || moq)} className="h-full min-w-0 flex-1 border-x border-slate-200 text-center text-xs font-bold outline-none disabled:bg-slate-50" aria-label={`${productName} quantity`} />
            <button type="button" onClick={() => handleQuantityChange(localQty + 1)} disabled={isPending || isUnavailable} className="flex h-full w-9 items-center justify-center text-slate-500 hover:bg-slate-50 disabled:text-slate-300" aria-label={`Increase ${productName} quantity`}><Plus className="h-3.5 w-3.5" /></button>
          </div>
        </div>
        <div className="text-right">
          <p className="text-[9px] text-slate-400">Line total incl. GST</p>
          <p className="mt-0.5 text-base font-bold text-slate-950 sm:text-lg">₹{displayTotal.toFixed(2)}</p>
        </div>
      </div>
    </article>
  );
}
