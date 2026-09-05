'use client';

import { useState, useTransition, type MouseEvent } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { Check, CheckCircle2, CircleAlert, Heart, ImageOff, Loader2, PackagePlus, ShoppingCart, Sparkles, Tag } from 'lucide-react';
import { addToCartAction } from '@/lib/retailer/cart-actions';
import { toggleFavoriteAction } from '@/lib/retailer/favorite-actions';
import { calcDiscountPercent, calcSavings, formatInr } from '@/lib/retailer/format';
import { QtyStepper } from '@/components/retailer/qty-stepper';
import { cn } from '@/lib/utils/cn';

export interface ProductCardProps {
  id: string;
  name: string;
  brandName?: string;
  imageUrl?: string;
  isNewLaunch: boolean;
  fromPrice: number | null;
  mrp?: number | null;
  packName?: string;
  moq?: number;
  unitsPerCase?: number;
  casePrice?: number | null;
  defaultPackId?: string | null;
  gstPercent?: number;
  isFavorite?: boolean;
  hasOffer?: boolean;
  compact?: boolean;
}

export function ProductCard({
  id,
  name,
  brandName,
  imageUrl,
  isNewLaunch,
  fromPrice,
  mrp,
  packName,
  moq = 1,
  defaultPackId,
  gstPercent,
  isFavorite = false,
  hasOffer = false,
  compact = false,
}: ProductCardProps) {
  const [isPending, startTransition] = useTransition();
  const [favPending, startFav] = useTransition();
  const [added, setAdded] = useState(false);
  const [error, setError] = useState(false);
  const [favorite, setFavorite] = useState(isFavorite);
  const [quantity, setQuantity] = useState(Math.max(1, moq));
  // `fromPrice` is the retailer's per-piece "from" rate (resolved server-side
  // from the cheapest variant). It is never a case total.
  const piecePrice = fromPrice;
  const discount = calcDiscountPercent(mrp, piecePrice);
  const savings = calcSavings(mrp, piecePrice);
  const unavailable = !defaultPackId || fromPrice === null;

  function handleQuickAdd() {
    if (!defaultPackId) return;
    setError(false);
    startTransition(async () => {
      const result = await addToCartAction(defaultPackId, Math.max(moq, quantity));
      if ('error' in result) setError(true);
      else setAdded(true);
    });
  }

  function handleFavorite(event: MouseEvent) {
    event.preventDefault();
    event.stopPropagation();
    startFav(async () => {
      const result = await toggleFavoriteAction(id);
      if ('success' in result) setFavorite(result.isFavorite);
    });
  }

  return (
    <article
      className={cn(
        'group relative flex h-full flex-col overflow-hidden rounded-xl border border-slate-200 bg-white shadow-[0_1px_2px_rgba(15,23,42,0.04)] transition duration-200 hover:-translate-y-0.5 hover:border-slate-300 hover:shadow-[0_10px_28px_rgba(15,23,42,0.10)] sm:rounded-2xl',
        compact && 'min-w-[10.5rem]'
      )}
    >
      <Link href={`/retailer/catalog/${id}`} className="block p-2 pb-0 sm:p-3 sm:pb-0">
        <div className="relative aspect-[1.08/1] overflow-hidden rounded-lg bg-gradient-to-br from-slate-50 to-slate-100 sm:rounded-xl">
          {imageUrl ? (
            <Image
              src={imageUrl}
              alt={name}
              fill
              sizes="(max-width: 640px) 45vw, (max-width: 1024px) 28vw, 210px"
              className="object-contain p-2 transition duration-300 group-hover:scale-105"
              unoptimized
            />
          ) : (
            <div className="flex h-full w-full flex-col items-center justify-center gap-2 text-slate-300">
              <ImageOff className="h-7 w-7" />
              <span className="text-[9px] font-semibold uppercase tracking-wider">Image coming soon</span>
            </div>
          )}
          <div className="absolute left-1.5 top-1.5 flex flex-col items-start gap-1 sm:left-2 sm:top-2">
            {discount > 0 ? (
              <span className="rounded-md bg-emerald-600 px-1.5 py-1 text-[9px] font-bold text-white shadow-sm sm:text-[10px]">
                {discount}% OFF
              </span>
            ) : null}
            {hasOffer ? (
              <span className="flex items-center gap-1 rounded-md bg-amber-400 px-1.5 py-1 text-[9px] font-bold text-slate-950 shadow-sm">
                <Tag className="h-2.5 w-2.5" /> Offer
              </span>
            ) : null}
            {isNewLaunch ? (
              <span className="flex items-center gap-1 rounded-md bg-primary-600 px-1.5 py-1 text-[9px] font-bold text-white shadow-sm sm:text-[10px]">
                <Sparkles className="h-2.5 w-2.5" /> NEW
              </span>
            ) : null}
            {unavailable ? (
              <span className="rounded-md bg-slate-800 px-1.5 py-1 text-[9px] font-bold text-white">Unavailable</span>
            ) : null}
          </div>
          <button
            type="button"
            onClick={handleFavorite}
            disabled={favPending}
            aria-label={favorite ? 'Remove from favourites' : 'Add to favourites'}
            aria-pressed={favorite}
            className={cn(
              'absolute right-1.5 top-1.5 flex h-8 w-8 items-center justify-center rounded-full border bg-white/95 shadow-sm backdrop-blur transition sm:right-2 sm:top-2',
              favorite ? 'border-primary-200 text-primary-600' : 'border-slate-200 text-slate-400 hover:text-primary-600'
            )}
          >
            <Heart className={cn('h-3.5 w-3.5', favorite && 'fill-primary-600 text-primary-600')} />
          </button>
        </div>
      </Link>

      <div className={cn('flex flex-1 flex-col px-2.5 pb-2.5 pt-2', compact ? 'sm:px-2.5 sm:pb-2.5' : 'sm:px-3.5 sm:pb-3.5')}>
        <Link href={`/retailer/catalog/${id}`} className="block">
          <p className="truncate text-[10px] font-semibold uppercase tracking-wide text-slate-400 sm:text-[11px]">
            {brandName ?? 'Maharani Traders'}
          </p>
          <h3 className="mt-0.5 line-clamp-2 min-h-[2.5rem] text-xs font-semibold leading-5 text-slate-800 transition group-hover:text-primary-700 sm:text-sm">
            {name}
          </h3>
          {packName ? (
            <p className="mt-1 flex items-center gap-1 truncate text-[10px] text-slate-500 sm:text-[11px]">
              <PackagePlus className="h-3 w-3 shrink-0" />
              {packName} · MOQ {moq} pc{moq === 1 ? '' : 's'}
            </p>
          ) : null}

          <div className="mt-2">
            <p className="text-[9px] font-semibold uppercase tracking-wide text-slate-400">Piece price · GST inclusive</p>
            <div className="mt-0.5 flex flex-wrap items-baseline gap-x-1.5">
              <p className="text-base font-bold tracking-tight text-slate-950 sm:text-lg">
                {fromPrice !== null ? formatInr(fromPrice) : 'Price on request'}
                <span className="text-[9px] font-medium text-slate-400">/pc</span>
              </p>
              {mrp && piecePrice !== null && mrp > piecePrice ? (
                <p className="text-[10px] text-slate-400 line-through sm:text-xs">MRP {formatInr(mrp)}</p>
              ) : null}
            </div>
          </div>
          {savings > 0 ? (
            <p className="text-[10px] font-semibold text-emerald-700">You save {formatInr(savings)}</p>
          ) : null}
          <div className="mt-0.5 flex flex-wrap items-center justify-between gap-x-2 gap-y-1 text-[9px] sm:text-[10px]">
            <p className="text-slate-400">GST{gstPercent != null ? ` ${gstPercent}%` : ''} included in price</p>
            <span className={cn('inline-flex items-center gap-1 font-semibold', unavailable ? 'text-slate-500' : 'text-emerald-700')}>
              {unavailable ? <CircleAlert className="h-3 w-3" /> : <CheckCircle2 className="h-3 w-3" />}
              {unavailable ? 'Currently unavailable' : 'Available to order'}
            </span>
          </div>
        </Link>

        <div className="mt-auto space-y-2 pt-2.5">
          {defaultPackId && !unavailable ? (
            <>
              <QtyStepper
                value={quantity}
                min={moq}
                onChange={setQuantity}
                compact
                label={`${name} quantity in pieces`}
              />
              <button
                type="button"
                onClick={handleQuickAdd}
                disabled={isPending}
                className={cn(
                  'flex h-9 w-full items-center justify-center gap-1.5 rounded-lg border text-[11px] font-bold transition sm:text-xs',
                  added
                    ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
                    : error
                      ? 'border-primary-200 bg-primary-50 text-primary-700'
                      : 'border-primary-600 bg-white text-primary-600 hover:bg-primary-600 hover:text-white',
                  'disabled:opacity-60'
                )}
              >
                {isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : added ? <Check className="h-3.5 w-3.5" /> : <ShoppingCart className="h-3.5 w-3.5" />}
                {isPending
                  ? 'Adding…'
                  : added
                    ? 'Added to cart'
                    : error
                      ? 'Try again'
                      : `Add${quantity > 0 ? ` · ${quantity} pc${quantity === 1 ? '' : 's'}` : ''}`}
              </button>
            </>
          ) : (
            <Link
              href={`/retailer/catalog/${id}`}
              className="flex h-9 w-full items-center justify-center rounded-lg border border-slate-200 text-[11px] font-bold text-slate-600 transition hover:border-primary-300 hover:text-primary-600 sm:text-xs"
            >
              {unavailable ? 'View details' : 'View packs'}
            </Link>
          )}
        </div>
      </div>
    </article>
  );
}
