'use client';

import { useState, useTransition } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { Check, ImageOff, Loader2, PackagePlus, ShoppingCart, Sparkles } from 'lucide-react';
import { addToCartAction } from '@/lib/retailer/cart-actions';

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
  defaultPackId?: string | null;
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
}: ProductCardProps) {
  const [isPending, startTransition] = useTransition();
  const [added, setAdded] = useState(false);
  const [error, setError] = useState(false);
  const discount =
    mrp && fromPrice !== null && mrp > fromPrice
      ? Math.round(((mrp - fromPrice) / mrp) * 100)
      : 0;

  function handleQuickAdd() {
    if (!defaultPackId) return;
    setError(false);
    startTransition(async () => {
      const result = await addToCartAction(defaultPackId, Math.max(1, moq));
      if ('error' in result) {
        setError(true);
      } else {
        setAdded(true);
      }
    });
  }

  return (
    <article className="group relative flex h-full flex-col overflow-hidden rounded-xl border border-slate-200 bg-white shadow-[0_1px_2px_rgba(15,23,42,0.04)] transition duration-200 hover:-translate-y-0.5 hover:border-slate-300 hover:shadow-[0_10px_28px_rgba(15,23,42,0.10)] sm:rounded-2xl">
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
            {isNewLaunch ? (
              <span className="flex items-center gap-1 rounded-md bg-primary-600 px-1.5 py-1 text-[9px] font-bold text-white shadow-sm sm:text-[10px]">
                <Sparkles className="h-2.5 w-2.5" /> NEW
              </span>
            ) : null}
          </div>
        </div>
      </Link>

      <div className="flex flex-1 flex-col px-2.5 pb-2.5 pt-2 sm:px-3.5 sm:pb-3.5">
        <Link href={`/retailer/catalog/${id}`} className="block">
          <p className="truncate text-[10px] font-semibold uppercase tracking-wide text-slate-400 sm:text-[11px]">
            {brandName ?? 'Maharani Mart'}
          </p>
          <h3 className="mt-0.5 line-clamp-2 min-h-[2.5rem] text-xs font-semibold leading-5 text-slate-800 transition group-hover:text-primary-700 sm:text-sm">
            {name}
          </h3>
          {packName ? (
            <p className="mt-1 flex items-center gap-1 truncate text-[10px] text-slate-500 sm:text-[11px]">
              <PackagePlus className="h-3 w-3 shrink-0" />
              {packName} · MOQ {moq}
            </p>
          ) : null}

          <div className="mt-2 flex flex-wrap items-baseline gap-x-1.5">
            <p className="text-base font-bold tracking-tight text-slate-950 sm:text-lg">
              {fromPrice !== null ? `₹${fromPrice.toFixed(2)}` : 'Price on request'}
            </p>
            {mrp && fromPrice !== null && mrp > fromPrice ? (
              <p className="text-[10px] text-slate-400 line-through sm:text-xs">₹{mrp.toFixed(2)}</p>
            ) : null}
          </div>
          <p className="text-[9px] text-slate-400 sm:text-[10px]">Wholesale price · GST extra</p>
        </Link>

        <div className="mt-auto pt-2.5">
          {defaultPackId ? (
            <button
              type="button"
              onClick={handleQuickAdd}
              disabled={isPending}
              className={`flex h-9 w-full items-center justify-center gap-1.5 rounded-lg border text-[11px] font-bold transition sm:text-xs ${
                added
                  ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
                  : error
                    ? 'border-primary-200 bg-primary-50 text-primary-700'
                    : 'border-primary-600 bg-white text-primary-600 hover:bg-primary-600 hover:text-white'
              } disabled:opacity-60`}
            >
              {isPending ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : added ? (
                <Check className="h-3.5 w-3.5" />
              ) : (
                <ShoppingCart className="h-3.5 w-3.5" />
              )}
              {isPending ? 'Adding…' : added ? 'Added to cart' : error ? 'Try again' : `Add${moq > 1 ? ` · ${moq}` : ''}`}
            </button>
          ) : (
            <Link
              href={`/retailer/catalog/${id}`}
              className="flex h-9 w-full items-center justify-center rounded-lg border border-slate-200 text-[11px] font-bold text-slate-600 transition hover:border-primary-300 hover:text-primary-600 sm:text-xs"
            >
              View packs
            </Link>
          )}
        </div>
      </div>
    </article>
  );
}
