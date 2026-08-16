'use client';

import { useState, useTransition } from 'react';
import { Heart, Loader2 } from 'lucide-react';
import { toggleFavoriteAction } from '@/lib/retailer/favorite-actions';

/**
 * Wishlist heart toggle. Sends only the productId — retailer identity
 * is resolved entirely server-side from the auth session.
 */
export function FavoriteToggle({ productId, initialFavorite }: { productId: string; initialFavorite: boolean }) {
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
      className={`flex items-center gap-1.5 rounded-full border px-3.5 py-2 text-sm font-medium transition-colors ${
        isFavorite
          ? 'border-primary-600 bg-primary-50 text-primary-600'
          : 'border-ink-200 bg-white text-ink-500 hover:border-primary-300 hover:text-primary-600'
      } disabled:opacity-50`}
    >
      {isPending ? (
        <Loader2 className="h-4 w-4 animate-spin" />
      ) : (
        <Heart className={`h-4 w-4 ${isFavorite ? 'fill-primary-600 text-primary-600' : ''}`} />
      )}
      {isFavorite ? 'Saved' : 'Save'}
    </button>
  );
}
