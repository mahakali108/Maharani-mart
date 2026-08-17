'use client';

import { useState, useTransition } from 'react';
import Link from 'next/link';
import {
  Check,
  ChevronRight,
  Loader2,
  Minus,
  PackageCheck,
  Plus,
  ShieldCheck,
  ShoppingCart,
} from 'lucide-react';
import { addToCartAction } from '@/lib/retailer/cart-actions';

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

  const selectedPack = packs.find((pack) => pack.id === selectedId) ?? packs[0];

  function selectPack(pack: Pack) {
    setSelectedId(pack.id);
    setQuantity(pack.moq);
    setAdded(false);
    setError(null);
  }

  function handleAddToCart() {
    if (!selectedPack) return;
    setError(null);
    setAdded(false);
    startTransition(async () => {
      const result = await addToCartAction(selectedPack.id, quantity);
      if ('error' in result) setError(result.error ?? 'Could not add to cart.');
      else setAdded(true);
    });
  }

  if (!selectedPack) return null;

  const gstAmount = (selectedPack.effectivePrice * gstPercent) / 100;
  const priceWithGst = selectedPack.effectivePrice + gstAmount;
  const orderTotal = priceWithGst * quantity;
  const discount =
    selectedPack.mrp && selectedPack.mrp > selectedPack.effectivePrice
      ? Math.round(((selectedPack.mrp - selectedPack.effectivePrice) / selectedPack.mrp) * 100)
      : 0;

  return (
    <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-[0_8px_30px_rgba(15,23,42,0.08)]">
      <div className="flex items-center justify-between border-b border-slate-100 bg-slate-50/80 px-4 py-3.5 sm:px-5">
        <div>
          <h2 className="text-sm font-bold text-slate-900">Choose pack & quantity</h2>
          <p className="mt-0.5 text-[10px] text-slate-500">Pricing is validated again at checkout</p>
        </div>
        <PackageCheck className="h-5 w-5 text-primary-600" />
      </div>

      <div className="space-y-5 p-4 sm:p-5">
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          {packs.map((pack) => {
            const active = pack.id === selectedId;
            return (
              <button
                key={pack.id}
                type="button"
                onClick={() => selectPack(pack)}
                className={`relative rounded-xl border p-3 text-left transition ${active ? 'border-primary-600 bg-primary-50 ring-1 ring-primary-600' : 'border-slate-200 bg-white hover:border-primary-200'}`}
              >
                {active ? <span className="absolute right-2 top-2 flex h-4 w-4 items-center justify-center rounded-full bg-primary-600 text-white"><Check className="h-2.5 w-2.5" /></span> : null}
                <p className={`pr-5 text-xs font-bold ${active ? 'text-primary-800' : 'text-slate-800'}`}>{pack.pack_name}</p>
                <p className="mt-1 text-[10px] text-slate-500">{pack.units_per_case} unit(s) per pack · MOQ {pack.moq}</p>
                <p className="mt-2 text-sm font-bold text-slate-950">₹{pack.effectivePrice.toFixed(2)}</p>
              </button>
            );
          })}
        </div>

        <div className="rounded-xl bg-slate-50 p-3.5">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-[9px] font-bold uppercase tracking-wider text-slate-400">Your wholesale price</p>
              <div className="mt-1 flex flex-wrap items-baseline gap-2">
                <p className="text-2xl font-bold tracking-tight text-slate-950">₹{selectedPack.effectivePrice.toFixed(2)}</p>
                {selectedPack.mrp && selectedPack.mrp > selectedPack.effectivePrice ? <p className="text-xs text-slate-400 line-through">MRP ₹{selectedPack.mrp.toFixed(2)}</p> : null}
                {discount > 0 ? <span className="rounded-md bg-emerald-100 px-1.5 py-0.5 text-[9px] font-bold text-emerald-700">SAVE {discount}%</span> : null}
              </div>
            </div>
            <ShieldCheck className="mt-1 h-5 w-5 shrink-0 text-emerald-600" />
          </div>
          <div className="mt-3 flex items-center justify-between border-t border-slate-200 pt-2 text-[10px] text-slate-500">
            <span>GST {gstPercent}%: ₹{gstAmount.toFixed(2)} / pack</span>
            <span className="font-semibold text-slate-700">Landed ₹{priceWithGst.toFixed(2)}</span>
          </div>
        </div>

        <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
          <div>
            <label htmlFor="pack-quantity" className="mb-1.5 block text-[10px] font-bold uppercase tracking-wider text-slate-500">Quantity</label>
            <div className="flex h-11 w-full items-center overflow-hidden rounded-xl border border-slate-200 bg-white sm:w-36">
              <button
                type="button"
                onClick={() => setQuantity((current) => Math.max(selectedPack.moq, current - 1))}
                disabled={quantity <= selectedPack.moq}
                className="flex h-full w-11 items-center justify-center text-slate-600 hover:bg-slate-50 disabled:text-slate-300"
                aria-label="Decrease quantity"
              >
                <Minus className="h-4 w-4" />
              </button>
              <input
                id="pack-quantity"
                type="number"
                min={selectedPack.moq}
                step={1}
                value={quantity}
                onChange={(event) => setQuantity(Math.max(selectedPack.moq, Number(event.target.value) || selectedPack.moq))}
                className="h-full min-w-0 flex-1 border-x border-slate-200 text-center text-sm font-bold text-slate-900 outline-none"
              />
              <button
                type="button"
                onClick={() => setQuantity((current) => current + 1)}
                className="flex h-full w-11 items-center justify-center text-slate-600 hover:bg-slate-50"
                aria-label="Increase quantity"
              >
                <Plus className="h-4 w-4" />
              </button>
            </div>
            <p className="mt-1 text-[9px] text-slate-400">Minimum {selectedPack.moq} pack(s)</p>
          </div>

          <button
            type="button"
            onClick={handleAddToCart}
            disabled={isPending}
            className={`flex h-11 flex-1 items-center justify-center gap-2 rounded-xl px-5 text-xs font-bold text-white shadow-sm transition ${added ? 'bg-emerald-600 hover:bg-emerald-700' : 'bg-primary-600 hover:bg-primary-700'} disabled:opacity-60`}
          >
            {isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : added ? <Check className="h-4 w-4" /> : <ShoppingCart className="h-4 w-4" />}
            {isPending ? 'Adding…' : added ? 'Added to cart' : `Add to cart · ₹${orderTotal.toFixed(2)}`}
          </button>
        </div>

        {error ? <div role="alert" className="rounded-xl border border-primary-200 bg-primary-50 px-3 py-2.5 text-xs font-medium text-primary-700">{error}</div> : null}

        {added ? (
          <Link href="/retailer/cart" className="flex items-center justify-center gap-1 text-xs font-bold text-emerald-700">
            Review your cart <ChevronRight className="h-3.5 w-3.5" />
          </Link>
        ) : null}
      </div>
    </section>
  );
}
