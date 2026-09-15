'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Check, Heart, ImageOff, Loader2, ShoppingCart, Tag } from 'lucide-react';
import { addToCartAction } from '@/lib/retailer/cart-actions';
import { toggleFavoriteAction } from '@/lib/retailer/favorite-actions';
import { calcDiscountPercent, calcSavings, formatInr } from '@/lib/retailer/format';
import { calculateRetailerPiecePrice } from '@/lib/retailer/retailer-pricing';
import type { PricingTier } from '@/lib/retailer/case-pricing';
import type { AvailabilityState } from '@/lib/retailer/availability';
import { QtyStepper } from '@/components/retailer/qty-stepper';
import { StoredImage } from '@/components/media/stored-image';
import { cn } from '@/lib/utils/cn';

export interface SlabOffer {
  minQuantity: number;
  /** Exclusive upper bound; null when the engine extends the last slab. */
  maxQuantity: number | null;
  pricePerPiece: number;
}

export interface ProductCardProps {
  id: string;
  name: string;
  brandName?: string;
  imageUrl?: string;
  isNewLaunch: boolean;
  /** Current GST-inclusive piece rate at the displayed variant's MOQ. */
  fromPrice: number | null;
  mrp?: number | null;
  packName?: string;
  moq?: number;
  defaultPackId?: string | null;
  gstPercent?: number;
  isFavorite?: boolean;
  hasOffer?: boolean;
  availability?: AvailabilityState;
  nextTierHint?: { minQuantity: number; pricePerPiece: number; label: string } | null;
  bestSlab?: SlabOffer | null;
  /** Selling terms only. No internal case totals or cost fields. */
  piecePricing?: { unitsPerCase: number; derivedPiecePrice: number; tiers: PricingTier[] };
  compact?: boolean;
}

export function ProductCard({
  id, name, brandName, imageUrl, isNewLaunch, fromPrice, mrp, packName, moq = 1,
  defaultPackId, gstPercent, isFavorite = false, hasOffer = false,
  availability = 'unknown', nextTierHint = null, piecePricing, compact = false,
}: ProductCardProps) {
  const [isPending, setIsPending] = useState(false);
  const [favPending, setFavPending] = useState(false);
  const [added, setAdded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [favorite, setFavorite] = useState(isFavorite);
  const [quantity, setQuantity] = useState(Math.max(1, moq));
  useEffect(() => setFavorite(isFavorite), [isFavorite]);

  const pricing = piecePricing ? calculateRetailerPiecePrice({
    quantity, casePrice: 0, ...piecePricing, gstPercent, moq,
  }) : null;
  const piecePrice = fromPrice === null ? null : pricing?.unitPrice ?? fromPrice;
  const discount = calcDiscountPercent(mrp, piecePrice);
  const savings = calcSavings(mrp, piecePrice);
  const unavailable = !defaultPackId || piecePrice === null || piecePrice <= 0 || availability === 'out_of_stock';
  const detailsHref = `/retailer/catalog/${defaultPackId ?? id}`;
  const availabilityLabel = !defaultPackId ? 'Currently unavailable'
    : availability === 'in_stock' ? 'In stock'
    : availability === 'low_stock' ? 'Running low'
    : availability === 'out_of_stock' ? 'Out of stock' : 'Stock not confirmed';

  async function handleQuickAdd() {
    if (!defaultPackId || unavailable || isPending) return;
    setError(null);
    setAdded(false);
    setIsPending(true);
    try {
      const result = await addToCartAction(defaultPackId, Math.max(moq, quantity));
      if ('error' in result) setError(result.error || 'Could not add this item. Please try again.');
      else setAdded(true);
    } catch {
      setError('Could not add this item. Please try again.');
    } finally {
      setIsPending(false);
    }
  }

  async function handleFavorite() {
    if (favPending) return;
    setFavPending(true);
    try {
      const result = await toggleFavoriteAction(id);
      if ('success' in result) setFavorite(result.isFavorite);
      else setError('Could not update your favourites. Please try again.');
    } catch {
      setError('Could not update your favourites. Please try again.');
    } finally {
      setFavPending(false);
    }
  }

  return (
    <article className={cn(
      'group relative flex h-full min-w-0 flex-col overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm transition hover:border-action-200 hover:shadow-md sm:rounded-2xl',
      compact && 'min-w-[10.5rem]'
    )}>
      <div className="relative p-2 pb-0 sm:p-3 sm:pb-0">
        <Link href={detailsHref} aria-label={`View ${name}`} className="block rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-action-500">
          <div className="relative aspect-square overflow-hidden rounded-lg bg-slate-50 sm:rounded-xl">
            <StoredImage
              src={imageUrl} alt={name} fill size="card"
              sizes="(max-width: 640px) 45vw, (max-width: 1024px) 30vw, 280px"
              className="object-contain p-3 transition duration-300 motion-safe:group-hover:scale-105"
              fallback={<div className="flex h-full flex-col items-center justify-center gap-1.5 px-2 text-center text-slate-500"><ImageOff className="h-7 w-7" aria-hidden="true" /><span className="text-[10px]">Image unavailable</span></div>}
            />
            <div className="absolute left-1.5 top-1.5 flex max-w-[65%] flex-col items-start gap-1">
              {discount > 0 ? <span className="rounded-md bg-emerald-700 px-1.5 py-1 text-[10px] font-bold text-white">{discount}% off</span> : null}
              {hasOffer ? <span className="rounded-md bg-amber-100 px-1.5 py-1 text-[10px] font-semibold text-amber-900">Offer</span> : null}
              {isNewLaunch ? <span className="rounded-md bg-action-600 px-1.5 py-1 text-[10px] font-semibold text-white">New</span> : null}
            </div>
          </div>
        </Link>
        {/* A sibling of the link, never an interactive element nested in it. */}
        <button type="button" onClick={handleFavorite} disabled={favPending}
          aria-label={`${favorite ? 'Remove' : 'Add'} ${name} ${favorite ? 'from' : 'to'} favourites`} aria-pressed={favorite}
          className={cn('absolute right-2 top-2 flex h-10 w-10 items-center justify-center rounded-full border border-slate-100 bg-white/95 shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-action-500 sm:right-3 sm:top-3', favorite ? 'text-rose-600' : 'text-slate-500 hover:text-rose-600')}>
          <Heart className={cn('h-4 w-4', favorite && 'fill-current')} aria-hidden="true" />
        </button>
      </div>

      <div className="flex min-w-0 flex-1 flex-col px-2.5 pb-2.5 pt-3 sm:px-3 sm:pb-3">
        {brandName ? <p className="truncate text-[10px] font-semibold uppercase tracking-wide text-slate-500 sm:text-[11px]">{brandName}</p> : null}
        <Link href={detailsHref} className="rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-action-500">
          <h3 className="mt-0.5 line-clamp-2 min-h-[2.5rem] break-words text-xs font-semibold leading-5 text-slate-900 group-hover:text-action-700 sm:text-sm">{name}</h3>
        </Link>
        <p className="mt-1 min-h-4 break-words text-[10px] text-slate-500 sm:text-[11px]">
          {packName ? <span>{packName} · </span> : null}{defaultPackId ? <>MOQ {moq} pc{moq === 1 ? '' : 's'}</> : 'No active pack'}
        </p>
        <span className={cn('mt-2 w-fit rounded-md px-1.5 py-1 text-[10px] font-semibold',
          availability === 'in_stock' && defaultPackId ? 'bg-emerald-50 text-emerald-800' : availability === 'low_stock' ? 'bg-amber-50 text-amber-800' : 'bg-slate-100 text-slate-600')}>
          {availabilityLabel}
        </span>

        <div className="mt-3 border-t border-slate-100 pt-2.5">
          <p className="text-[9px] font-medium text-slate-500 sm:text-[10px]">Piece price · GST inclusive</p>
          <p className="mt-0.5 break-words text-lg font-bold tracking-tight text-slate-950 sm:text-xl">
            {piecePrice !== null && piecePrice > 0 ? <>{formatInr(piecePrice)}<span className="text-[10px] font-normal text-slate-500"> /pc</span></> : <span className="text-xs font-semibold text-slate-600">Price unavailable</span>}
          </p>
          {mrp != null && mrp > 0 ? <p className="mt-1 text-[10px] text-slate-500">MRP <span className={cn(piecePrice !== null && mrp > piecePrice && 'line-through')}>{formatInr(mrp)}</span></p> : null}
          {savings > 0 ? <p className="mt-1 text-[10px] font-semibold text-emerald-700">Save {formatInr(savings)} /pc</p> : null}
          {gstPercent != null && piecePrice !== null ? <p className="mt-1 text-[9px] text-slate-500">Includes {gstPercent}% GST</p> : null}
          {nextTierHint ? <p aria-hidden={quantity >= nextTierHint.minQuantity} className={cn("mt-2 flex min-h-4 items-start gap-1 text-[10px] font-medium text-action-700", quantity >= nextTierHint.minQuantity && "invisible")}><Tag className="mt-0.5 h-3 w-3 shrink-0" aria-hidden="true" /><span>{nextTierHint.minQuantity} pcs: {formatInr(nextTierHint.pricePerPiece)}/pc</span></p> : null}
        </div>

        <div className="mt-auto space-y-2 pt-3">
          {!unavailable ? <>
            <QtyStepper value={quantity} min={moq} compact disabled={isPending}
              onChange={(next) => { setQuantity(next); setAdded(false); setError(null); }} label={`${name} quantity in pieces`} />
            <button type="button" onClick={handleQuickAdd} disabled={isPending || pricing?.orderable === false}
              aria-label={`Add ${quantity} ${name} pieces to cart`}
              className="flex min-h-11 w-full items-center justify-center gap-1.5 rounded-lg bg-action-600 px-1 text-[11px] font-semibold text-white transition hover:bg-action-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-action-500 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60 sm:text-xs">
              {isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" /> : added ? <Check className="h-3.5 w-3.5" aria-hidden="true" /> : <ShoppingCart className="h-3.5 w-3.5" aria-hidden="true" />}
              {isPending ? 'Adding…' : added ? 'Add again' : 'Add to Cart'}
            </button>
          </> : <p className="py-1 text-[10px] text-slate-500">{availability === 'out_of_stock' ? 'Check details for stock updates.' : 'Check details for current terms.'}</p>}
          <Link href={detailsHref} aria-label={`View details for ${name}`} className="flex min-h-10 w-full items-center justify-center rounded-lg border border-slate-200 px-1 text-[11px] font-semibold text-action-700 transition hover:border-action-300 hover:bg-action-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-action-500 sm:text-xs">View Details</Link>
          {added ? <p role="status" className="text-[10px] font-medium text-emerald-700">Added to your cart.</p> : null}
          {error ? <p role="alert" className="text-[10px] text-rose-700">{error}</p> : null}
          {pricing && !pricing.orderable && !unavailable ? <p role="alert" className="text-[10px] text-rose-700">{pricing.message}</p> : null}
        </div>
      </div>
    </article>
  );
}
