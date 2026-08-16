'use client';

import { useState, useTransition } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { ImageOff, Loader2, Check, ShoppingCart } from 'lucide-react';
import { addToCartAction } from '@/lib/retailer/cart-actions';

/**
 * Compact "frequently ordered" product card for the dashboard. The
 * link body goes to the catalog page (full pack choice); the Add
 * button one-taps the product's default pack at its current MOQ
 * through the existing addToCartAction, which re-validates active
 * status and MOQ server-side.
 */
export function FrequentProductCard({
  id,
  name,
  imageUrl,
  packId,
  packName,
  moq,
  effectivePrice,
  timesOrdered,
}: {
  id: string;
  name: string;
  imageUrl?: string;
  packId: string | null;
  packName?: string;
  moq: number;
  effectivePrice: number | null;
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
    <div className="flex flex-col gap-2 rounded-2xl border border-ink-100 bg-white p-3">
      <Link href={`/retailer/catalog/${id}`} className="flex flex-col gap-2">
        <div className="relative aspect-square overflow-hidden rounded-xl bg-ink-50">
          {imageUrl ? (
            <Image src={imageUrl} alt={name} fill className="object-cover" unoptimized />
          ) : (
            <div className="flex h-full w-full items-center justify-center text-ink-300">
              <ImageOff className="h-6 w-6" />
            </div>
          )}
        </div>
        <div>
          <p className="line-clamp-2 text-xs font-medium leading-snug text-ink-900">{name}</p>
          <p className="mt-0.5 text-[11px] text-ink-400">
            {effectivePrice !== null ? `₹${effectivePrice.toFixed(2)} · ${packName}` : packName ?? ''}
          </p>
          <p className="text-[11px] text-ink-400">Ordered {timesOrdered}×</p>
        </div>
      </Link>
      {packId ? (
        <button
          type="button"
          onClick={handleAdd}
          disabled={isPending}
          className="mt-auto flex items-center justify-center gap-1.5 rounded-xl bg-primary-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-primary-700 disabled:opacity-50"
        >
          {isPending ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : added ? (
            <Check className="h-3.5 w-3.5" />
          ) : (
            <ShoppingCart className="h-3.5 w-3.5" />
          )}
          {added ? 'Added' : `Add ${moq > 1 ? `×${moq}` : ''}`}
        </button>
      ) : null}
    </div>
  );
}
