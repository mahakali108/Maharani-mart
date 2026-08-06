'use client';

import { useState, useTransition } from 'react';
import { Loader2, ShoppingCart, Check } from 'lucide-react';
import { addToCartAction } from '@/lib/retailer/cart-actions';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

interface Pack {
  id: string;
  pack_name: string;
  units_per_case: number;
  mrp: number | null;
  moq: number;
  effectivePrice: number;
}

export function PackSelector({ packs, gstPercent }: { packs: Pack[]; gstPercent: number }) {
  const [selectedId, setSelectedId] = useState(packs[0]?.id ?? '');
  const [quantity, setQuantity] = useState(packs[0]?.moq ?? 1);
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [added, setAdded] = useState(false);

  const selectedPack = packs.find((p) => p.id === selectedId) ?? packs[0];

  function selectPack(pack: Pack) {
    setSelectedId(pack.id);
    setQuantity(pack.moq);
    setAdded(false);
  }

  function handleAddToCart() {
    if (!selectedPack) return;
    setError(null);
    setAdded(false);
    startTransition(async () => {
      const result = await addToCartAction(selectedPack.id, quantity);
      if ('error' in result) {
        setError(result.error ?? 'Could not add to cart.');
      } else {
        setAdded(true);
      }
    });
  }

  if (!selectedPack) return null;

  const gstAmount = (selectedPack.effectivePrice * gstPercent) / 100;
  const priceWithGst = selectedPack.effectivePrice + gstAmount;

  return (
    <Card className="space-y-4">
      <div>
        <p className="mb-2 text-sm font-medium text-ink-800">Select pack size</p>
        <div className="flex flex-wrap gap-2">
          {packs.map((pack) => (
            <button
              key={pack.id}
              type="button"
              onClick={() => selectPack(pack)}
              className={`rounded-xl border px-3.5 py-2 text-sm font-medium transition-colors ${
                pack.id === selectedId
                  ? 'border-primary-600 bg-primary-50 text-primary-700'
                  : 'border-ink-200 text-ink-600 hover:border-ink-300'
              }`}
            >
              {pack.pack_name}
            </button>
          ))}
        </div>
      </div>

      <div className="flex items-baseline gap-2">
        <p className="text-2xl font-semibold text-ink-950">₹{selectedPack.effectivePrice.toFixed(2)}</p>
        {selectedPack.mrp && selectedPack.mrp > selectedPack.effectivePrice ? (
          <p className="text-sm text-ink-400 line-through">₹{selectedPack.mrp.toFixed(2)}</p>
        ) : null}
        <p className="text-xs text-ink-400">+ {gstPercent}% GST (₹{gstAmount.toFixed(2)}) = ₹{priceWithGst.toFixed(2)}</p>
      </div>
      <p className="text-xs text-ink-400">
        {selectedPack.units_per_case} unit(s) per case · Minimum order quantity: {selectedPack.moq}
      </p>

      {error ? (
        <div className="rounded-xl border border-primary-200 bg-primary-50 px-3 py-2 text-sm text-primary-700">{error}</div>
      ) : null}

      <div className="flex items-center gap-3">
        <Input
          type="number"
          min={selectedPack.moq}
          step={1}
          value={quantity}
          onChange={(e) => setQuantity(Math.max(selectedPack.moq, Number(e.target.value) || selectedPack.moq))}
          className="w-24"
        />
        <Button onClick={handleAddToCart} disabled={isPending} className="flex-1">
          {isPending ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : added ? (
            <Check className="h-4 w-4" />
          ) : (
            <ShoppingCart className="h-4 w-4" />
          )}
          {added ? 'Added to cart' : 'Add to cart'}
        </Button>
      </div>
    </Card>
  );
}
