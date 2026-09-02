'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import Image from 'next/image';
import { Boxes, CircleAlert, Heart, ImageOff, Loader2, Trash2 } from 'lucide-react';
import { updateCartQuantityAction, removeCartItemAction } from '@/lib/retailer/cart-actions';
import { toggleFavoriteAction } from '@/lib/retailer/favorite-actions';
import { calcDiscountPercent, calcSavings, formatInr } from '@/lib/retailer/format';
import { caseLineBreakdown, type PricingTier } from '@/lib/retailer/case-pricing';
import { QtyStepper } from '@/components/retailer/qty-stepper';
import { cn } from '@/lib/utils/cn';

export function CartItemRow({
  id,
  productId,
  productName,
  brandName,
  packName,
  imageUrl,
  quantity,
  unitPrice,
  gstPercent,
  moq,
  mrp,
  unitsPerCase = 1,
  casePrice,
  tiers,
  isUnavailable,
  isFavorite = false,
}: {
  id: string;
  productId?: string;
  productName: string;
  brandName?: string | null;
  packName: string;
  imageUrl?: string;
  quantity: number;
  unitPrice: number;
  gstPercent: number;
  moq: number;
  mrp?: number | null;
  unitsPerCase?: number;
  casePrice?: number | null;
  tiers?: PricingTier[];
  isUnavailable: boolean;
  isFavorite?: boolean;
}) {
  const router = useRouter();
  const [localQty, setLocalQty] = useState(quantity);
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [favorite, setFavorite] = useState(isFavorite);

  function handleQuantityChange(next: number) {
    // Mirrors the server rule (MOQ + whole number); the server action remains
    // authoritative and any rejection is shown below and reverted.
    const validQuantity = Math.max(moq, Math.round(next) || moq);
    setLocalQty(validQuantity);
    setError(null);
    startTransition(async () => {
      const result = await updateCartQuantityAction(id, validQuantity);
      if ('error' in result) {
        setError(result.error ?? 'Could not update quantity.');
        setLocalQty(quantity);
      } else {
        router.refresh();
      }
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

  // unitPrice is the GST-INCLUSIVE per-case price. The line total re-applies the
  // Super Admin-configured quantity tier so quantity changes recalculate
  // automatically, and GST is already inside the price (never added again).
  const breakdown = caseLineBreakdown({
    casePrice: casePrice ?? unitPrice,
    unitsPerCase,
    tiers: tiers ?? [],
    packQuantity: localQty,
    gstPercent,
  });
  const displayTotal = breakdown.total;
  const lineSavings = calcSavings(mrp, breakdown.piecePrice, breakdown.pieces);
  const discountPercent = calcDiscountPercent(mrp, breakdown.piecePrice);

  return (
    <article
      className={cn(
        'relative grid grid-cols-1 gap-3 rounded-2xl border bg-white p-3 shadow-[0_1px_2px_rgba(15,23,42,0.04)] sm:gap-4 sm:p-4',
        'md:grid-cols-[minmax(0,1fr)_auto_auto] md:items-center md:gap-5 md:px-5',
        isUnavailable ? 'border-amber-200 bg-amber-50/40' : 'border-slate-200'
      )}
    >
      {isPending ? (
        <div className="absolute inset-x-0 top-0 h-0.5 overflow-hidden rounded-t-2xl bg-primary-100">
          <span className="block h-full w-1/2 animate-pulse bg-primary-600" />
        </div>
      ) : null}

      {/* Cell A — image + product information */}
      <div className="flex min-w-0 gap-3 sm:gap-4">
        <div
          className={cn(
            'relative h-20 w-20 shrink-0 overflow-hidden rounded-xl bg-white ring-1 ring-slate-100 sm:h-24 sm:w-24',
            isUnavailable && 'opacity-70'
          )}
        >
          {imageUrl ? (
            <Image
              src={imageUrl}
              alt={productName}
              fill
              sizes="(max-width: 640px) 80px, 96px"
              className="object-contain p-1.5"
              unoptimized
            />
          ) : (
            <div className="flex h-full items-center justify-center text-slate-300">
              <ImageOff className="h-6 w-6" aria-hidden="true" />
              <span className="sr-only">No product image available</span>
            </div>
          )}
        </div>

        <div className="min-w-0 flex-1">
          <h3 className="line-clamp-2 text-xs font-bold leading-4 text-slate-900 sm:text-sm sm:leading-5">{productName}</h3>

          <p className="mt-1 flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-[10px] font-medium text-slate-500 sm:text-[11px]">
            {brandName ? <span className="font-semibold uppercase tracking-wide text-slate-400">{brandName}</span> : null}
            {brandName && packName ? <span aria-hidden="true">·</span> : null}
            {packName ? <span className="truncate">{packName}</span> : null}
          </p>

          <p className="mt-1.5 flex items-center gap-1 text-[10px] font-medium text-slate-500">
            <Boxes className="h-3 w-3 shrink-0 text-slate-400" aria-hidden="true" />
            MOQ {moq} pack{moq === 1 ? '' : 's'}
          </p>

          <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className="inline-flex items-center gap-1 rounded-md bg-slate-100 px-1.5 py-0.5 text-[9px] font-bold text-slate-600">
              GST {gstPercent}%
            </span>
            {isUnavailable ? (
              <span className="inline-flex items-center gap-1 rounded-md bg-amber-100 px-1.5 py-0.5 text-[9px] font-bold text-amber-800">
                <CircleAlert className="h-3 w-3" aria-hidden="true" /> Unavailable — will be skipped
              </span>
            ) : (
              <span className="inline-flex items-center gap-1 rounded-md bg-emerald-50 px-1.5 py-0.5 text-[9px] font-bold text-emerald-700">
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" aria-hidden="true" /> Available to order
              </span>
            )}
          </div>

          {/* Desktop price block */}
          <div className="mt-2.5 hidden flex-wrap items-baseline gap-x-2 gap-y-1 md:flex">
            <p className="text-base font-bold tracking-tight text-slate-950">
              {formatInr(unitPrice)} <span className="text-[10px] font-medium text-slate-400">/ case</span>
            </p>
            {mrp != null && mrp > unitPrice ? (
              <p className="text-[11px] text-slate-400 line-through">MRP {formatInr(mrp)}</p>
            ) : null}
            {lineSavings > 0 ? (
              <p className="text-[11px] font-semibold text-emerald-700">Save {formatInr(lineSavings)}</p>
            ) : null}
          </div>
        </div>
      </div>

      {/* Cell B — mobile price row */}
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1 md:hidden">
        <p className="text-sm font-bold tracking-tight text-slate-950">
          {formatInr(unitPrice)} <span className="text-[10px] font-medium text-slate-400">/ case</span>
        </p>
        {discountPercent > 0 ? (
          <span className="rounded-md bg-emerald-600 px-1.5 py-0.5 text-[9px] font-bold text-white">
            {discountPercent}% off
          </span>
        ) : null}
        {mrp != null && mrp > unitPrice ? (
          <p className="text-[10px] text-slate-400 line-through">MRP {formatInr(mrp)}</p>
        ) : null}
        {lineSavings > 0 ? (
          <p className="text-[10px] font-semibold text-emerald-700">You save {formatInr(lineSavings)}</p>
        ) : null}
      </div>

      {/* Cell C — quantity + line total */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 pt-3 md:flex-col md:items-end md:gap-3 md:border-0 md:pt-0">
        <div>
          <p className="mb-1.5 text-[9px] font-bold uppercase tracking-wider text-slate-400">Quantity</p>
          <QtyStepper
            value={localQty}
            min={moq}
            disabled={isPending || isUnavailable}
            onChange={handleQuantityChange}
            label={`${productName} quantity`}
          />
        </div>
        <div className="text-right">
          <p className="text-[9px] font-medium uppercase tracking-wider text-slate-400">Line total incl. GST</p>
          <p className="mt-0.5 text-base font-bold tracking-tight text-slate-950 sm:text-lg">{formatInr(displayTotal)}</p>
          <p className="text-[9px] text-slate-400">
            {formatInr(unitPrice)} × {localQty} · {gstPercent}% GST included
          </p>
        </div>
      </div>

      {/* Cell D — actions */}
      <div className="flex items-center justify-between gap-2 md:flex-col md:items-end md:gap-2">
        {productId ? (
          <button
            type="button"
            onClick={handleSaveForLater}
            disabled={isPending}
            className={cn(
              'inline-flex h-10 items-center gap-1.5 rounded-xl px-2.5 text-[11px] font-bold transition',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-300',
              favorite ? 'text-primary-600' : 'text-slate-500 hover:bg-primary-50 hover:text-primary-600',
              'disabled:opacity-50'
            )}
            aria-label={favorite ? `Remove ${productName} from favourites` : `Save ${productName} for later`}
            aria-pressed={favorite}
          >
            <Heart className={cn('h-4 w-4', favorite && 'fill-primary-600 text-primary-600')} aria-hidden="true" />
            {favorite ? 'Saved' : 'Save for later'}
          </button>
        ) : (
          <span />
        )}
        <button
          type="button"
          onClick={handleRemove}
          disabled={isPending}
          className="inline-flex h-10 items-center gap-1.5 rounded-xl px-2.5 text-[11px] font-bold text-slate-500 transition hover:bg-primary-50 hover:text-primary-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-300 disabled:opacity-50"
          aria-label={`Remove ${productName} from cart`}
        >
          {isPending ? (
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
          ) : (
            <Trash2 className="h-4 w-4" aria-hidden="true" />
          )}
          Remove
        </button>
      </div>

      {error ? (
        <p role="alert" className="rounded-xl border border-primary-200 bg-primary-50 px-3 py-2 text-[10px] font-medium text-primary-700 md:col-span-3">
          {error}
        </p>
      ) : null}
    </article>
  );
}
