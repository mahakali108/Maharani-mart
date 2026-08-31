'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import Image from 'next/image';
import { ImageOff, Loader2, ShoppingCart } from 'lucide-react';
import { addReorderLinesToCartAction } from '@/lib/retailer/order-actions';
import { gstComponentFromInclusive, round2 } from '@/lib/retailer/case-pricing';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

export interface ReorderLineInput {
  packId: string;
  productName: string;
  packName: string;
  imageUrl?: string;
  previousQuantity: number;
  suggestedQuantity: number;
  moq: number;
  gstPercent: number;
  currentUnitPrice: number;
  unavailable: boolean;
}

interface LineState {
  included: boolean;
  quantity: number;
}

/**
 * Client side of the reorder review screen. Quantities pre-fill at
 * max(previous qty, current MOQ); unavailable lines are excluded and
 * locked. The running totals are a DISPLAY aid computed from the
 * server-rendered current prices/GST — the server action re-validates
 * everything again on submit, and checkout re-validates once more, so
 * a tampered quantity below MOQ or a disabled pack can never get
 * through.
 */
export function ReorderForm({ orderId, lines }: { orderId: string; lines: ReorderLineInput[] }) {
  const router = useRouter();
  const [state, setState] = useState<Record<string, LineState>>(() =>
    Object.fromEntries(
      lines.map((line) => [line.packId, { included: !line.unavailable, quantity: line.suggestedQuantity }])
    )
  );
  const [error, setError] = useState<string | null>(null);
  const [skippedCount, setSkippedCount] = useState(0);
  const [isPending, startTransition] = useTransition();

  const selected = lines.filter((line) => state[line.packId]?.included);
  let subtotal = 0;
  let gstTotal = 0;
  for (const line of selected) {
    const quantity = Math.max(line.moq, state[line.packId]?.quantity ?? line.moq);
    // currentUnitPrice is GST-INCLUSIVE — GST is extracted, never added.
    const lineTotal = round2(line.currentUnitPrice * quantity);
    const lineGst = gstComponentFromInclusive(lineTotal, line.gstPercent);
    subtotal += round2(lineTotal - lineGst);
    gstTotal += lineGst;
  }
  const grandTotal = round2(subtotal + gstTotal);

  function setQuantity(packId: string, quantity: number, moq: number) {
    setState((prev) => ({
      ...prev,
      [packId]: { included: true, quantity: Math.max(moq, quantity) },
    }));
  }

  function toggleIncluded(packId: string, checked: boolean, suggestedQuantity: number) {
    setState((prev) => ({
      ...prev,
      [packId]: { included: checked, quantity: prev[packId]?.quantity ?? suggestedQuantity },
    }));
  }

  function handleAddToCart() {
    setError(null);
    startTransition(async () => {
      const result = await addReorderLinesToCartAction(
        orderId,
        selected.map((line) => ({
          packId: line.packId,
          quantity: Math.max(line.moq, state[line.packId]?.quantity ?? line.moq),
        }))
      );
      if ('error' in result && result.error) {
        setError(result.error);
      } else {
        setSkippedCount('skippedCount' in result ? result.skippedCount ?? 0 : 0);
        router.push('/retailer/cart');
      }
    });
  }

  if (lines.length === 0) {
    return (
      <Card className="py-8 text-center text-sm text-ink-500">
        This order has no orderable items left.
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <div className="space-y-3">
        {lines.map((line) => {
          const lineState = state[line.packId];
          const quantity = Math.max(line.moq, lineState?.quantity ?? line.moq);
          const lineTotal = round2(line.currentUnitPrice * quantity);
          return (
            <Card
              key={line.packId}
              className={`flex items-center gap-3 p-3 ${line.unavailable ? 'opacity-60' : ''}`}
            >
              <input
                type="checkbox"
                aria-label={`Include ${line.productName}`}
                checked={lineState?.included ?? false}
                disabled={line.unavailable || isPending}
                onChange={(e) => toggleIncluded(line.packId, e.target.checked, line.suggestedQuantity)}
                className="h-5 w-5 shrink-0 accent-primary-600"
              />
              <div className="relative h-14 w-14 shrink-0 overflow-hidden rounded-lg bg-ink-50">
                {line.imageUrl ? (
                  <Image src={line.imageUrl} alt="" fill className="object-cover" unoptimized />
                ) : (
                  <div className="flex h-full w-full items-center justify-center text-ink-300">
                    <ImageOff className="h-5 w-5" />
                  </div>
                )}
              </div>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-ink-900">{line.productName}</p>
                <p className="text-xs text-ink-400">
                  {line.packName} · ₹{line.currentUnitPrice.toFixed(2)} · {line.gstPercent}% GST included
                </p>
                <p className="text-xs text-ink-400">
                  Previously {line.previousQuantity} · MOQ now {line.moq}
                </p>
                {line.unavailable ? (
                  <p className="text-xs font-medium text-primary-600">No longer available</p>
                ) : null}
              </div>
              <div className="flex w-20 flex-col items-end gap-1.5">
                <Input
                  type="number"
                  min={line.moq}
                  step={1}
                  value={lineState?.quantity ?? line.suggestedQuantity}
                  disabled={line.unavailable || isPending || !lineState?.included}
                  onChange={(e) => setQuantity(line.packId, Number(e.target.value) || line.moq, line.moq)}
                  className="h-8 px-2 text-center"
                />
                {lineState?.included && !line.unavailable ? (
                  <p className="text-sm font-semibold text-ink-900">₹{lineTotal.toFixed(2)}</p>
                ) : null}
              </div>
            </Card>
          );
        })}
      </div>

      <Card className="space-y-2">
        <div className="flex justify-between text-sm text-ink-600">
          <span>Subtotal</span>
          <span>₹{subtotal.toFixed(2)}</span>
        </div>
        <div className="flex justify-between text-sm text-ink-600">
          <span>GST</span>
          <span>₹{gstTotal.toFixed(2)}</span>
        </div>
        <div className="flex justify-between border-t border-ink-100 pt-2 text-base font-semibold text-ink-950">
          <span>Total (current prices)</span>
          <span>₹{grandTotal.toFixed(2)}</span>
        </div>

        {error ? (
          <div className="rounded-xl border border-primary-200 bg-primary-50 px-4 py-3 text-sm text-primary-700">
            {error}
          </div>
        ) : null}
        {skippedCount > 0 ? (
          <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-700">
            {skippedCount} item(s) were skipped because they became unavailable or fell below the
            current minimum quantity.
          </div>
        ) : null}

        <Button
          className="mt-2 w-full"
          disabled={isPending || selected.length === 0}
          onClick={handleAddToCart}
        >
          {isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShoppingCart className="h-4 w-4" />}
          {isPending ? 'Adding…' : `Add ${selected.length} item(s) to cart`}
        </Button>
      </Card>
    </div>
  );
}
