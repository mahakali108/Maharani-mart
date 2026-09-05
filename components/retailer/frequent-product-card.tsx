'use client';

import { useState, useTransition } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { Check, ImageOff, Loader2, RotateCcw, ShoppingCart } from 'lucide-react';
import { addToCartAction } from '@/lib/retailer/cart-actions';

/** Adds the default active pack at its current MOQ through the existing cart action. */
export function FrequentProductCard({
  id,
  name,
  imageUrl,
  packId,
  packName,
  moq,
  piecePrice,
  timesOrdered,
}: {
  id: string;
  name: string;
  imageUrl?: string;
  packId: string | null;
  packName?: string;
  moq: number;
  /** GST-inclusive per-piece selling price (never the internal case price). */
  piecePrice: number | null;
  timesOrdered: number;
}) {
  const [isPending, startTransition] = useTransition();
  const [added, setAdded] = useState(false);

  function handleAdd() {
    if (!packId) return;
    startTransition(async () => {
      const result = await addToCartAction(packId, Math.max(1, moq));
      if (!('error' in result)) setAdded(true);
    });
  }

  return (
    <article className="flex w-36 shrink-0 flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white p-2.5 shadow-sm transition hover:-translate-y-0.5 hover:shadow-md sm:w-auto">
      <Link href={`/retailer/catalog/${id}`} className="flex flex-1 flex-col">
        <div className="relative aspect-square overflow-hidden rounded-xl bg-slate-50">
          {imageUrl ? (
            <Image src={imageUrl} alt={name} fill className="object-contain p-2 transition hover:scale-105" unoptimized />
          ) : (
            <div className="flex h-full w-full items-center justify-center text-slate-300"><ImageOff className="h-6 w-6" /></div>
          )}
          <span className="absolute left-1.5 top-1.5 flex items-center gap-1 rounded-md bg-slate-950/80 px-1.5 py-1 text-[8px] font-bold text-white backdrop-blur">
            <RotateCcw className="h-2.5 w-2.5" /> {timesOrdered}× ordered
          </span>
        </div>
        <h3 className="mt-2 line-clamp-2 min-h-[2rem] text-[11px] font-bold leading-4 text-slate-800">{name}</h3>
        <p className="mt-1 truncate text-[9px] text-slate-500">{packName ?? 'Select pack'} · MOQ {moq}</p>
        <p className="mt-1 text-sm font-bold text-slate-950">{piecePrice !== null ? `₹${piecePrice.toFixed(2)}/pc` : 'Price on request'}</p>
      </Link>
      {packId ? (
        <button
          type="button"
          onClick={handleAdd}
          disabled={isPending}
          className={`mt-2 flex h-8 items-center justify-center gap-1 rounded-lg text-[10px] font-bold transition ${added ? 'bg-emerald-50 text-emerald-700' : 'bg-primary-600 text-white hover:bg-primary-700'} disabled:opacity-60`}
        >
          {isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : added ? <Check className="h-3 w-3" /> : <ShoppingCart className="h-3 w-3" />}
          {isPending ? 'Adding…' : added ? 'Added' : `Add${moq > 1 ? ` ${moq}` : ''}`}
        </button>
      ) : null}
    </article>
  );
}
