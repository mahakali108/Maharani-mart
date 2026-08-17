'use client';

import { useState, useTransition } from 'react';
import { Heart, Loader2 } from 'lucide-react';
import { toggleFavoriteAction } from '@/lib/retailer/favorite-actions';

/** Retailer identity is resolved server-side; the client sends only productId. */
export function FavoriteToggle({
  productId,
  initialFavorite,
  compact = false,
}: {
  productId: string;
  initialFavorite: boolean;
  compact?: boolean;
}) {
  const [isFavorite, setIsFavorite] = useState(initialFavorite);
  const [isPending, startTransition] = useTransition();

  function handleToggle() {
    startTransition(async () => {
      const result = await toggleFavoriteAction(productId);
      if ('success' in result) setIsFavorite(result.isFavorite);
    });
  }

  return (
    <button
      type="button"
      onClick={handleToggle}
      disabled={isPending}
      aria-label={isFavorite ? 'Remove from favourites' : 'Add to favourites'}
      aria-pressed={isFavorite}
      className={`flex items-center justify-center gap-1.5 border font-bold shadow-sm backdrop-blur transition ${
        compact ? 'h-10 w-10 rounded-xl bg-white/95 p-0 text-xs' : 'h-10 rounded-xl px-3.5 text-xs'
      } ${
        isFavorite
          ? 'border-primary-200 bg-primary-50 text-primary-600'
          : 'border-slate-200 bg-white text-slate-500 hover:border-primary-300 hover:text-primary-600'
      } disabled:opacity-60`}
    >
      {isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Heart className={`h-4 w-4 ${isFavorite ? 'fill-primary-600 text-primary-600' : ''}`} />}
      {!compact ? (isFavorite ? 'Saved' : 'Save') : null}
    </button>
  );
}
