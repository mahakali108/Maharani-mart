'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Loader2, Trash2 } from 'lucide-react';
import { clearCartAction } from '@/lib/retailer/cart-actions';

/**
 * Empties the retailer's cart in one tap.
 *
 * Destructive, so it asks first: a single confirm step, then the server action.
 * The action itself is owner-scoped (`cart_items.retailer_id = auth.uid()` via
 * the existing `cart_owner` RLS policy and the `clearRetailerCart` service), so
 * a tampered request can only ever clear the caller's own cart.
 */
export function ClearCartButton({ itemCount }: { itemCount: number }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [isPending, startTransition] = useTransition();

  if (itemCount < 1) return null;

  function handleClear() {
    setError(null);
    startTransition(async () => {
      const result = await clearCartAction();
      if ('error' in result && result.error) {
        setError(result.error);
        setConfirming(false);
        return;
      }
      setConfirming(false);
      router.refresh();
    });
  }

  if (confirming) {
    return (
      <span className="flex items-center gap-1.5">
        <button
          type="button"
          onClick={handleClear}
          disabled={isPending}
          className="flex h-9 items-center gap-1.5 rounded-lg border border-primary-200 bg-primary-50 px-3 text-[10px] font-bold text-primary-700 transition hover:bg-primary-100 disabled:opacity-60"
        >
          {isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" /> : null}
          {isPending ? 'Clearing…' : 'Confirm clear'}
        </button>
        <button
          type="button"
          onClick={() => setConfirming(false)}
          disabled={isPending}
          className="flex h-9 items-center rounded-lg border border-slate-200 bg-white px-3 text-[10px] font-bold text-slate-600 transition hover:text-slate-900 disabled:opacity-60"
        >
          Keep
        </button>
        {error ? (
          <span role="alert" className="text-[10px] font-semibold text-primary-600">
            {error}
          </span>
        ) : null}
      </span>
    );
  }

  return (
    <button
      type="button"
      onClick={() => setConfirming(true)}
      className="flex h-9 items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 text-[10px] font-bold text-slate-500 shadow-sm transition hover:border-primary-200 hover:text-primary-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-300"
    >
      <Trash2 className="h-3.5 w-3.5" aria-hidden="true" /> Clear cart
    </button>
  );
}
