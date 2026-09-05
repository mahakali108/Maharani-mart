'use client';

import { useState, useTransition } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { Check, ChevronRight, ImageOff, Loader2, Minus, Plus, ShoppingCart } from 'lucide-react';
import { addToCartAction } from '@/lib/retailer/cart-actions';
import { type PricingTier } from '@/lib/retailer/case-pricing';
import { calculateRetailerPiecePrice } from '@/lib/retailer/retailer-pricing';

export interface QuickOrderPack {
  id: string;
  packName: string;
  unitsPerCase: number;
  /** Minimum order quantity in PIECES. */
  moq: number;
  mrp: number | null;
  /** Server-resolved per-piece fallback when the pack has no selling tiers. */
  derivedPiecePrice: number;
  /** false = this pack is billed in whole cases only. */
  allowLoosePieces?: boolean;
  /** This pack's own loose-piece slabs (from `product_pricing_tiers`). */
  tiers?: PricingTier[];
}

export function QuickOrderRow({
  id,
  name,
  brandName,
  imageUrl,
  gstPercent,
  packs,
}: {
  id: string;
  name: string;
  brandName?: string;
  imageUrl?: string;
  gstPercent: number;
  packs: QuickOrderPack[];
}) {
  const [packId, setPackId] = useState(packs[0]?.id ?? '');
  const [quantity, setQuantity] = useState(packs[0]?.moq ?? 1);
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [added, setAdded] = useState(false);

  const pack = packs.find((item) => item.id === packId) ?? packs[0];
  if (!pack) return null;
  const currentPack = pack;

  function selectPack(nextId: string) {
    const next = packs.find((item) => item.id === nextId);
    setPackId(nextId);
    setQuantity(next?.moq ?? 1);
    setAdded(false);
    setError(null);
  }

  function changeQuantity(nextQuantity: number) {
    setQuantity(Math.max(currentPack.moq, nextQuantity));
    setAdded(false);
  }

  function handleAdd() {
    setError(null);
    startTransition(async () => {
      const result = await addToCartAction(currentPack.id, Math.max(currentPack.moq, quantity));
      if ('error' in result) setError(result.error ?? 'Could not add to cart.');
      else setAdded(true);
    });
  }

  /*
   * The quantity in this grid is PIECES, and the price shown is what the server
   * will actually charge: `calculateRetailerPiecePrice` bills Q at Q × (the
   * applicable per-piece tier rate). Prices are GST-inclusive, so GST is never
   * added on top here either.
   */
  const pricing = calculateRetailerPiecePrice({
    quantity,
    unitsPerCase: pack.unitsPerCase,
    casePrice: 0,
    tiers: pack.tiers ?? [],
    gstPercent,
    moq: pack.moq,
    derivedPiecePrice: pack.derivedPiecePrice,
  });
  const landedPrice = pricing.lineTotal;
  const piecePrice =
    pack.tiers && pack.tiers.length > 0
      ? Math.min(...pack.tiers.filter((t) => t.is_active !== false).map((t) => t.price_per_piece))
      : pack.derivedPiecePrice;
  const discount = pack.mrp && pack.mrp > piecePrice
    ? Math.round(((pack.mrp - piecePrice) / pack.mrp) * 100)
    : 0;

  return (
    <article className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm transition hover:border-slate-300 hover:shadow-md">
      <div className="grid items-center gap-3 p-3 sm:grid-cols-[72px_minmax(150px,1fr)_minmax(160px,0.8fr)_128px_minmax(140px,0.65fr)] sm:gap-4 sm:p-4">
        <Link href={`/retailer/catalog/${id}`} className="relative hidden h-[72px] w-[72px] overflow-hidden rounded-xl bg-slate-50 sm:block">
          {imageUrl ? <Image src={imageUrl} alt={name} fill className="object-contain p-1.5" unoptimized /> : <span className="flex h-full items-center justify-center text-slate-300"><ImageOff className="h-5 w-5" /></span>}
        </Link>

        <div className="flex min-w-0 items-center gap-3 sm:block">
          <Link href={`/retailer/catalog/${id}`} className="relative h-16 w-16 shrink-0 overflow-hidden rounded-xl bg-slate-50 sm:hidden">
            {imageUrl ? <Image src={imageUrl} alt={name} fill className="object-contain p-1.5" unoptimized /> : <span className="flex h-full items-center justify-center text-slate-300"><ImageOff className="h-5 w-5" /></span>}
          </Link>
          <div className="min-w-0">
            <p className="truncate text-[9px] font-bold uppercase tracking-wider text-slate-400">{brandName ?? 'Product'}</p>
            <Link href={`/retailer/catalog/${id}`} className="mt-0.5 block line-clamp-2 text-xs font-bold leading-4 text-slate-900 hover:text-primary-600 sm:text-sm">{name}</Link>
          </div>
        </div>

        <div>
          <label htmlFor={`pack-${id}`} className="mb-1 block text-[9px] font-bold uppercase tracking-wider text-slate-400 sm:hidden">Pack size</label>
          <select
            id={`pack-${id}`}
            value={pack.id}
            onChange={(event) => selectPack(event.target.value)}
            className="h-10 w-full rounded-xl border border-slate-200 bg-white px-3 text-[11px] font-semibold text-slate-800 outline-none focus:border-primary-300 focus:ring-2 focus:ring-primary-50"
          >
            {packs.map((item) => <option key={item.id} value={item.id}>{item.packName}</option>)}
          </select>
          <p className="mt-1 text-[9px] text-slate-400">
            Sold by piece · MOQ {pack.moq} pc{pack.moq === 1 ? '' : 's'} · from ₹{piecePrice.toFixed(2)}/pc
          </p>
        </div>

        <div>
          <p className="mb-1 text-[9px] font-bold uppercase tracking-wider text-slate-400 sm:hidden">Quantity</p>
          <div className="flex h-10 items-center overflow-hidden rounded-xl border border-slate-200">
            <button type="button" onClick={() => changeQuantity(quantity - 1)} disabled={quantity <= pack.moq} className="flex h-full w-9 items-center justify-center text-slate-500 hover:bg-slate-50 disabled:text-slate-300" aria-label={`Decrease ${name} quantity`}><Minus className="h-3.5 w-3.5" /></button>
            <input
              type="number"
              min={pack.moq}
              step={1}
              value={quantity}
              onChange={(event) => changeQuantity(Number(event.target.value) || pack.moq)}
              className="h-full min-w-0 flex-1 border-x border-slate-200 text-center text-xs font-bold outline-none"
              aria-label={`${name} quantity in pieces, minimum ${pack.moq}`}
            />
            <button type="button" onClick={() => changeQuantity(quantity + 1)} className="flex h-full w-9 items-center justify-center text-slate-500 hover:bg-slate-50" aria-label={`Increase ${name} quantity`}><Plus className="h-3.5 w-3.5" /></button>
          </div>
        </div>

        <div className="flex items-end justify-between gap-3 border-t border-slate-100 pt-3 sm:block sm:border-0 sm:pt-0 sm:text-right">
          <div>
            <div className="flex items-baseline gap-1.5 sm:justify-end">
              <p className="text-base font-bold text-slate-950">₹{pricing.unitPrice.toFixed(2)}<span className="text-[9px] font-medium text-slate-400">/pc</span></p>
              {pack.mrp && pack.mrp > piecePrice ? <p className="text-[9px] text-slate-400 line-through">₹{pack.mrp.toFixed(2)}</p> : null}
            </div>
            <p className="text-[9px] text-slate-400">
              {quantity} pc{quantity === 1 ? '' : 's'} × ₹{pricing.unitPrice.toFixed(2)} = ₹{pricing.lineTotal.toFixed(2)} · {gstPercent}% GST incl
            </p>
            {discount > 0 ? <p className="mt-0.5 text-[9px] font-bold text-emerald-700">Save {discount}%</p> : null}
          </div>
          <button
            type="button"
            onClick={handleAdd}
            disabled={isPending || !pricing.orderable}
            className={`mt-2 flex h-9 min-w-[112px] items-center justify-center gap-1.5 rounded-lg px-3 text-[10px] font-bold text-white transition sm:ml-auto ${added ? 'bg-emerald-600' : 'bg-primary-600 hover:bg-primary-700'} disabled:opacity-60`}
          >
            {isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : added ? <Check className="h-3.5 w-3.5" /> : <ShoppingCart className="h-3.5 w-3.5" />}
            {isPending ? 'Adding…' : added ? 'Added' : `Add · ₹${landedPrice.toFixed(0)}`}
          </button>
        </div>
      </div>

      {!pricing.orderable ? (
        <p className="border-t border-amber-100 bg-amber-50 px-4 py-2 text-[10px] font-medium text-amber-800">
          {pricing.message}
        </p>
      ) : null}
      {error ? <p role="alert" className="border-t border-primary-100 bg-primary-50 px-4 py-2 text-[10px] font-medium text-primary-700">{error}</p> : null}
      {added ? <Link href="/retailer/cart" className="flex items-center justify-center gap-1 border-t border-emerald-100 bg-emerald-50 px-4 py-2 text-[10px] font-bold text-emerald-700">Review cart <ChevronRight className="h-3 w-3" /></Link> : null}
    </article>
  );
}
