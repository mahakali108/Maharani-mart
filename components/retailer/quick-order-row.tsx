'use client';

import { useState, useTransition } from 'react';
import { Loader2, Check, ShoppingCart } from 'lucide-react';
import { addToCartAction } from '@/lib/retailer/cart-actions';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

export interface QuickOrderPack {
  id: string;
  packName: string;
  unitsPerCase: number;
  moq: number;
  mrp: number | null;
  effectivePrice: number;
}

/**
 * One search result row in Quick Order: product heading, current
 * price/GST, a pack dropdown, a direct quantity input pre-filled at
 * the current MOQ, and Add. The existing addToCartAction server-side
 * re-checks pack/product active status and MOQ for every add, so no
 * new (potentially divergent) mutation path is introduced.
 */
export function QuickOrderRow({
  name,
  skuCode,
  gstPercent,
  packs,
}: {
  name: string;
  skuCode: string;
  gstPercent: number;
  packs: QuickOrderPack[];
}) {
  const [packId, setPackId] = useState(packs[0]?.id ?? '');
  const [quantity, setQuantity] = useState(packs[0]?.moq ?? 1);
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [added, setAdded] = useState(false);

  const pack = packs.find((p) => p.id === packId) ?? packs[0];
  if (!pack) return null;
  const currentPack = pack;

  function selectPack(nextId: string) {
    const next = packs.find((p) => p.id === nextId);
    setPackId(nextId);
    setQuantity(next?.moq ?? 1);
    setAdded(false);
    setError(null);
  }

  function handleAdd() {
    setError(null);
    startTransition(async () => {
      // Client clamps to MOQ for UX; addToCartAction enforces it
      // authoritatively server-side regardless of what is sent.
      const result = await addToCartAction(currentPack.id, Math.max(currentPack.moq, quantity));
      if ('error' in result) {
        setError(result.error ?? 'Could not add to cart.');
      } else {
        setAdded(true);
      }
    });
  }

  const gstAmount = (pack.effectivePrice * gstPercent) / 100;

  return (
    <Card className="space-y-2 p-3">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate text-sm font-medium text-ink-900">{name}</p>
          <p className="font-mono text-xs text-ink-400">{skuCode}</p>
        </div>
        <div className="shrink-0 text-right">
          <p className="text-sm font-semibold text-ink-950">₹{pack.effectivePrice.toFixed(2)}</p>
          {pack.mrp && pack.mrp > pack.effectivePrice ? (
            <p className="text-xs text-ink-400 line-through">₹{pack.mrp.toFixed(2)}</p>
          ) : null}
          <p className="text-[11px] text-ink-400">
            +{gstPercent}% GST = ₹{(pack.effectivePrice + gstAmount).toFixed(2)}
          </p>
        </div>
      </div>

      {error ? <p className="text-xs text-primary-600">{error}</p> : null}

      <div className="flex items-center gap-2">
        <select
          value={pack.id}
          onChange={(e) => selectPack(e.target.value)}
          className="h-10 min-w-0 flex-1 rounded-xl border border-ink-200 bg-white px-2.5 text-sm text-ink-900 focus:border-transparent focus:outline-none focus:ring-2 focus:ring-primary-600"
          aria-label="Pack size"
        >
          {packs.map((p) => (
            <option key={p.id} value={p.id}>
              {p.packName}
            </option>
          ))}
        </select>
        <Input
          type="number"
          min={pack.moq}
          step={1}
          value={quantity}
          onChange={(e) => setQuantity(Math.max(pack.moq, Number(e.target.value) || pack.moq))}
          className="h-10 w-20 px-2 text-center"
          aria-label={`Quantity (min ${pack.moq})`}
        />
        <Button size="sm" onClick={handleAdd} disabled={isPending} className="h-10 shrink-0 px-3">
          {isPending ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : added ? (
            <Check className="h-4 w-4" />
          ) : (
            <ShoppingCart className="h-4 w-4" />
          )}
          {added ? 'Added' : 'Add'}
        </Button>
      </div>
      <p className="text-[11px] text-ink-400">
        {pack.unitsPerCase} unit(s) per case · MOQ {pack.moq}
      </p>
    </Card>
  );
}
