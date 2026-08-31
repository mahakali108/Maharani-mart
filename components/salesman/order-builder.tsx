'use client';

import Image from 'next/image';
import { useMemo, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { CheckCircle2, ImageOff, Loader2, Minus, Plus, Search, ShoppingCart } from 'lucide-react';
import { createSalesmanOrderAction } from '@/lib/salesman/order-creation-actions';
import { gstComponentFromInclusive, round2 } from '@/lib/retailer/case-pricing';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';

interface RetailerOption {
  id: string;
  shopName: string;
}

interface OrderPack {
  id: string;
  name: string;
  skuCode: string;
  moq: number;
  effectivePrice: number;
}

interface OrderProduct {
  id: string;
  name: string;
  skuCode: string;
  brandName: string | null;
  imageUrl: string | null;
  gstPercent: number;
  packs: OrderPack[];
}

export function SalesmanOrderBuilder({
  retailers,
  selectedRetailerId,
  products,
  credit,
}: {
  retailers: RetailerOption[];
  selectedRetailerId: string;
  products: OrderProduct[];
  credit: { limit: number; outstanding: number };
}) {
  const router = useRouter();
  const [query, setQuery] = useState('');
  const [quantities, setQuantities] = useState<Record<string, number>>({});
  const [notes, setNotes] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const filteredProducts = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    if (!normalized) return products;
    return products.filter(
      (product) =>
        product.name.toLowerCase().includes(normalized) ||
        product.skuCode.toLowerCase().includes(normalized) ||
        product.brandName?.toLowerCase().includes(normalized) ||
        product.packs.some((pack) => pack.name.toLowerCase().includes(normalized) || pack.skuCode.toLowerCase().includes(normalized))
    );
  }, [products, query]);

  const packById = useMemo(
    () => new Map(products.flatMap((product) => product.packs.map((pack) => [pack.id, { pack, product }] as const))),
    [products]
  );

  const selectedLines = Object.entries(quantities).filter(([, quantity]) => quantity > 0);
  let subtotal = 0;
  let gstTotal = 0;
  for (const [packId, quantity] of selectedLines) {
    const item = packById.get(packId);
    if (!item) continue;
    // effectivePrice is the GST-INCLUSIVE case price — GST is extracted, never added.
    const lineTotal = round2(item.pack.effectivePrice * quantity);
    const lineGst = gstComponentFromInclusive(lineTotal, item.product.gstPercent);
    subtotal += round2(lineTotal - lineGst);
    gstTotal += lineGst;
  }
  const estimatedTotal = round2(subtotal + gstTotal);
  const availableCredit = credit.limit > 0 ? Math.max(0, credit.limit - credit.outstanding) : null;

  function setPackQuantity(pack: OrderPack, nextQuantity: number) {
    const normalized = nextQuantity <= 0 ? 0 : Math.max(pack.moq, Math.floor(nextQuantity));
    setQuantities((current) => ({ ...current, [pack.id]: normalized }));
  }

  function handleSubmit() {
    setError(null);
    startTransition(async () => {
      const result = await createSalesmanOrderAction({
        retailerId: selectedRetailerId,
        notes,
        lines: selectedLines.map(([packId, quantity]) => ({ packId, quantity })),
      });
      if ('error' in result) {
        setError(result.error);
        return;
      }
      router.push(`/salesman/orders/${result.orderId}`);
      router.refresh();
    });
  }

  return (
    <div className="space-y-5">
      <Card className="space-y-4">
        <div>
          <Label htmlFor="retailer">Retailer</Label>
          <Select
            id="retailer"
            value={selectedRetailerId}
            disabled={isPending}
            onChange={(event) => {
              setQuantities({});
              router.push(`/salesman/orders/new?retailer=${event.target.value}`);
            }}
          >
            {retailers.map((retailer) => (
              <option key={retailer.id} value={retailer.id}>
                {retailer.shopName}
              </option>
            ))}
          </Select>
        </div>
        <div className="grid grid-cols-2 gap-3 text-sm">
          <div className="rounded-xl bg-ink-50 p-3">
            <p className="text-xs text-ink-400">Outstanding</p>
            <p className="mt-0.5 font-semibold text-ink-900">₹{credit.outstanding.toFixed(2)}</p>
          </div>
          <div className="rounded-xl bg-ink-50 p-3">
            <p className="text-xs text-ink-400">Available credit</p>
            <p className="mt-0.5 font-semibold text-ink-900">
              {availableCredit === null ? 'Not configured' : `₹${availableCredit.toFixed(2)}`}
            </p>
          </div>
        </div>
      </Card>

      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-400" />
        <Input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search product, brand, SKU, or pack"
          className="pl-9"
        />
      </div>

      {filteredProducts.length === 0 ? (
        <Card className="py-10 text-center">
          <p className="text-sm font-medium text-ink-700">No products match your search.</p>
        </Card>
      ) : (
        <div className="space-y-3">
          {filteredProducts.map((product) => (
            <Card key={product.id} className="p-4">
              <div className="flex gap-3">
                <div className="relative h-14 w-14 shrink-0 overflow-hidden rounded-xl bg-ink-50">
                  {product.imageUrl ? (
                    <Image src={product.imageUrl} alt={product.name} fill className="object-cover" unoptimized />
                  ) : (
                    <div className="flex h-full items-center justify-center text-ink-300">
                      <ImageOff className="h-5 w-5" />
                    </div>
                  )}
                </div>
                <div className="min-w-0">
                  <p className="font-medium text-ink-900">{product.name}</p>
                  <p className="text-xs text-ink-400">
                    {product.brandName ? `${product.brandName} · ` : ''}{product.skuCode} · GST {product.gstPercent}%
                  </p>
                </div>
              </div>

              <div className="mt-3 space-y-2 border-t border-ink-100 pt-3">
                {product.packs.map((pack) => {
                  const quantity = quantities[pack.id] ?? 0;
                  return (
                    <div key={pack.id} className="flex flex-col gap-2 rounded-xl bg-ink-50 p-3 sm:flex-row sm:items-center sm:justify-between">
                      <div>
                        <p className="text-sm font-medium text-ink-800">{pack.name}</p>
                        <p className="text-xs text-ink-400">
                          ₹{pack.effectivePrice.toFixed(2)} · MOQ {pack.moq} · {pack.skuCode}
                        </p>
                      </div>
                      {quantity === 0 ? (
                        <Button type="button" size="sm" variant="outline" onClick={() => setPackQuantity(pack, pack.moq)}>
                          <Plus className="h-3.5 w-3.5" /> Add
                        </Button>
                      ) : (
                        <div className="flex items-center justify-end gap-2">
                          <button
                            type="button"
                            aria-label={`Remove ${pack.name}`}
                            onClick={() => setPackQuantity(pack, 0)}
                            className="rounded-lg border border-ink-200 bg-white p-2 text-ink-600"
                          >
                            <Minus className="h-3.5 w-3.5" />
                          </button>
                          <Input
                            type="number"
                            min={pack.moq}
                            step={1}
                            value={quantity}
                            onChange={(event) => setPackQuantity(pack, Number(event.target.value))}
                            className="h-9 w-20 text-center"
                            aria-label={`Quantity for ${product.name} ${pack.name}`}
                          />
                          <button
                            type="button"
                            aria-label={`Add one ${pack.name}`}
                            onClick={() => setPackQuantity(pack, quantity + 1)}
                            className="rounded-lg border border-ink-200 bg-white p-2 text-ink-600"
                          >
                            <Plus className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </Card>
          ))}
        </div>
      )}

      <Card className="sticky bottom-20 z-20 space-y-3 shadow-premium lg:bottom-4">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-xs text-ink-400">{selectedLines.length} pack(s) selected</p>
            <p className="text-lg font-semibold text-ink-950">₹{estimatedTotal.toFixed(2)}</p>
            <p className="text-[11px] text-ink-400">Includes estimated GST of ₹{gstTotal.toFixed(2)}</p>
          </div>
          <ShoppingCart className="h-6 w-6 text-primary-600" />
        </div>
        <div>
          <Label htmlFor="order-notes">Delivery notes (optional)</Label>
          <textarea
            id="order-notes"
            value={notes}
            onChange={(event) => setNotes(event.target.value)}
            maxLength={1000}
            rows={2}
            className="w-full rounded-xl border border-ink-200 bg-white px-3.5 py-2.5 text-sm text-ink-900 focus:border-transparent focus:outline-none focus:ring-2 focus:ring-primary-600"
            placeholder="Landmark, delivery time, or instructions"
          />
        </div>
        {error ? <p className="rounded-xl bg-primary-50 px-3 py-2 text-sm text-primary-700">{error}</p> : null}
        <Button className="w-full" disabled={isPending || selectedLines.length === 0} onClick={handleSubmit}>
          {isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
          {isPending ? 'Creating order…' : 'Create order'}
        </Button>
      </Card>
    </div>
  );
}
