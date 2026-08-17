'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import Image from 'next/image';
import { Heart, ImageOff, Loader2, Trash2 } from 'lucide-react';
import { updateCartQuantityAction, removeCartItemAction } from '@/lib/retailer/cart-actions';
import { toggleFavoriteAction } from '@/lib/retailer/favorite-actions';
import { calcSavings, formatInr } from '@/lib/retailer/format';
import { QtyStepper } from '@/components/retailer/qty-stepper';

export function CartItemRow({
  id,
  productId,
  productName,
  packName,
  imageUrl,
  quantity,
  unitPrice,
  gstPercent,
  moq,
  mrp,
  isUnavailable,
  isFavorite = false,
}: {
  id: string;
  productId?: string;
  productName: string;
  packName: string;
  imageUrl?: string;
  quantity: number;
  unitPrice: number;
  gstPercent: number;
  moq: number;
  mrp?: number | null;
  isUnavailable: boolean;
  isFavorite?: boolean;
}) {
  const router = useRouter();
  const [localQty, setLocalQty] = useState(quantity);
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [favorite, setFavorite] = useState(isFavorite);

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

  function handleSaveForLater() {
    if (!productId) return;
    startTransition(async () => {
      const result = await toggleFavoriteAction(productId);
      if ('success' in result) setFavorite(result.isFavorite);
    });
  }

  const landedUnitPrice = unitPrice * (1 + gstPercent / 100);
  const displayTotal = landedUnitPrice * localQty;
  const lineSavings = calcSavings(mrp, unitPrice, localQty);

  return (
    <article className={`relative overflow-hidden rounded-2xl border bg-white p-3 shadow-sm sm:p-4 ${isUnavailable ? 'border-primary-200 bg-primary-50/20' : 'border-slate-200'}`}>
      {isPending ? (
        <div className="absolute inset-x-0 top-0 h-0.5 overflow-hidden bg-primary-100">
          <span className="block h-full w-1/2 animate-pulse bg-primary-600" />
        </div>
      ) : null}
      <div className="flex gap-3 sm:gap-4">
        <div className="relative h-20 w-20 shrink-0 overflow-hidden rounded-xl bg-slate-50 sm:h-24 sm:w-24">
          {imageUrl ? (
            <Image src={imageUrl} alt={productName} fill className="object-contain p-1.5" unoptimized />
          ) : (
            <div className="flex h-full items-center justify-center text-slate-300">
              <ImageOff className="h-6 w-6" />
            </div>
          )}
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
            <p className="text-sm font-bold text-slate-950">
              {formatInr(unitPrice)} <span className="text-[9px] font-medium text-slate-400">/ pack</span>
            </p>
            {mrp && mrp > unitPrice ? <p className="text-[10px] text-slate-400 line-through">{formatInr(mrp)}</p> : null}
            <p className="text-[9px] text-slate-400">+ {gstPercent}% GST</p>
          </div>
          {lineSavings > 0 ? <p className="mt-0.5 text-[10px] font-semibold text-emerald-700">You save {formatInr(lineSavings)}</p> : null}
          <p className="mt-0.5 text-[9px] text-slate-400">MOQ {moq} pack(s)</p>

          {isUnavailable ? <p className="mt-2 text-[10px] font-bold text-primary-700">This item is no longer available and will be skipped.</p> : null}
          {error ? (
            <p role="alert" className="mt-2 text-[10px] font-medium text-primary-700">
              {error}
            </p>
          ) : null}
        </div>
      </div>

      <div className="mt-3 flex items-end justify-between gap-3 border-t border-slate-100 pt-3">
        <div>
          <p className="mb-1 text-[9px] font-bold uppercase tracking-wider text-slate-400">Quantity</p>
          <QtyStepper value={localQty} min={moq} disabled={isPending || isUnavailable} onChange={handleQuantityChange} label={`${productName} quantity`} compact />
        </div>
        <div className="text-right">
          <p className="text-[9px] text-slate-400">Line total incl. GST</p>
          <p className="mt-0.5 text-base font-bold text-slate-950 sm:text-lg">{formatInr(displayTotal)}</p>
          {productId ? (
            <button
              type="button"
              onClick={handleSaveForLater}
              className="mt-1 inline-flex items-center gap-1 text-[10px] font-bold text-slate-500 hover:text-primary-600"
            >
              <Heart className={`h-3 w-3 ${favorite ? 'fill-primary-600 text-primary-600' : ''}`} />
              {favorite ? 'Saved' : 'Save for later'}
            </button>
          ) : null}
        </div>
      </div>
    </article>
  );
}
