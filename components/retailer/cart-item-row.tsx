'use client';

import { useState, useTransition } from 'react';
import Image from 'next/image';
import { ImageOff, Trash2, Loader2 } from 'lucide-react';
import { updateCartQuantityAction, removeCartItemAction } from '@/lib/retailer/cart-actions';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';

export function CartItemRow({
  id,
  productName,
  packName,
  imageUrl,
  quantity,
  unitPrice,
  lineTotal,
  moq,
  isUnavailable,
}: {
  id: string;
  productName: string;
  packName: string;
  imageUrl?: string;
  quantity: number;
  unitPrice: number;
  lineTotal: number;
  moq: number;
  isUnavailable: boolean;
}) {
  const [localQty, setLocalQty] = useState(quantity);
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function handleQuantityChange(next: number) {
    setLocalQty(next);
    setError(null);
    startTransition(async () => {
      const result = await updateCartQuantityAction(id, next);
      if ('error' in result) setError(result.error ?? 'Could not update quantity.');
    });
  }

  return (
    <Card className={`flex items-center gap-3 p-3 ${isUnavailable ? 'opacity-50' : ''}`}>
      <div className="relative h-14 w-14 shrink-0 overflow-hidden rounded-lg bg-ink-50">
        {imageUrl ? (
          <Image src={imageUrl} alt="" fill className="object-cover" unoptimized />
        ) : (
          <div className="flex h-full w-full items-center justify-center text-ink-300">
            <ImageOff className="h-5 w-5" />
          </div>
        )}
      </div>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium text-ink-900">{productName}</p>
        <p className="text-xs text-ink-400">
          {packName} · ₹{unitPrice.toFixed(2)} each
        </p>
        {error ? <p className="text-xs text-primary-600">{error}</p> : null}
        {isUnavailable ? <p className="text-xs text-primary-600">No longer available</p> : null}
      </div>
      <div className="flex flex-col items-end gap-1.5">
        <Input
          type="number"
          min={moq}
          step={1}
          value={localQty}
          disabled={isPending || isUnavailable}
          onChange={(e) => handleQuantityChange(Math.max(moq, Number(e.target.value) || moq))}
          className="h-8 w-16 px-2 text-center"
        />
        <p className="text-sm font-semibold text-ink-900">₹{lineTotal.toFixed(2)}</p>
      </div>
      <button
        type="button"
        disabled={isPending}
        onClick={() =>
          startTransition(async () => {
            await removeCartItemAction(id);
          })
        }
        className="rounded-lg p-1.5 text-ink-400 hover:bg-primary-50 hover:text-primary-600 disabled:opacity-50"
        aria-label="Remove item"
      >
        {isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
      </button>
    </Card>
  );
        }
