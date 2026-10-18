'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Loader2, Store, Truck } from 'lucide-react';
import { addSellerOfferToCartAction } from '@/lib/retailer/cart-actions';
import { formatInr } from '@/lib/retailer/format';

export interface RetailerMarketplaceOffer {
  offerId: string;
  sellerBusinessName: string;
  sellerGstin: string | null;
  packId: string;
  packName: string;
  fulfilmentType: 'seller' | 'maharani';
  unitPricePaise: number;
  moq: number;
  inStock: boolean;
  initialQuantity: number;
  tiers?: {
    minQuantity: number;
    maxQuantity: number | null;
    unitPricePaise: number;
  }[];
}

function resolveClientOfferPaise(offer: RetailerMarketplaceOffer, quantity: number): number {
  const tiers = offer.tiers ?? [];
  if (tiers.length === 0) return offer.unitPricePaise;
  let matchedPaise: number | null = null;
  let matchedMin = -1;
  for (const tier of tiers) {
    if (tier.minQuantity <= quantity && (tier.maxQuantity === null || quantity <= tier.maxQuantity)) {
      if (tier.minQuantity > matchedMin) {
        matchedMin = tier.minQuantity;
        matchedPaise = tier.unitPricePaise;
      }
    }
  }
  return matchedPaise ?? offer.unitPricePaise;
}

export function MarketplaceOfferList({ offers }: { offers: RetailerMarketplaceOffer[] }) {
  const router = useRouter();
  const [quantities, setQuantities] = useState<Record<string, number>>(() =>
    Object.fromEntries(offers.map((offer) => [offer.offerId, Math.max(offer.moq, 1)]))
  );
  const [activeOffer, setActiveOffer] = useState<string | null>(null);
  const [message, setMessage] = useState<{ offerId: string; error?: string; success?: string } | null>(null);
  const [isPending, startTransition] = useTransition();

  if (offers.length === 0) return null;

  function addOffer(offer: RetailerMarketplaceOffer) {
    const quantity = Math.max(offer.moq, Math.round(quantities[offer.offerId] ?? offer.moq));
    setQuantities((current) => ({ ...current, [offer.offerId]: quantity }));
    setActiveOffer(offer.offerId);
    setMessage(null);
    startTransition(async () => {
      const result = await addSellerOfferToCartAction(offer.packId, quantity, offer.offerId);
      if ('error' in result && result.error) {
        setMessage({ offerId: offer.offerId, error: result.error });
      } else {
        setMessage({ offerId: offer.offerId, success: 'Seller offer added to your cart.' });
        router.refresh();
      }
      setActiveOffer(null);
    });
  }

  return (
    <section aria-labelledby="marketplace-offers-heading" className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
      <div className="border-b border-slate-100 bg-slate-50 px-4 py-3.5 sm:px-5">
        <div className="flex items-center gap-2">
          <Store className="h-4 w-4 text-primary-600" aria-hidden="true" />
          <h2 id="marketplace-offers-heading" className="text-sm font-bold text-slate-900">Other marketplace sellers</h2>
        </div>
        <p className="mt-1 text-[10px] leading-4 text-slate-500">
          Compare the seller, pack, minimum quantity, fulfilment and approved price before adding.
        </p>
      </div>
      <ul className="divide-y divide-slate-100">
        {offers.map((offer) => {
          const quantity = Math.max(offer.moq, quantities[offer.offerId] ?? offer.moq);
          const effectivePaise = resolveClientOfferPaise(offer, quantity);
          const tiers = offer.tiers ?? [];
          const busy = isPending && activeOffer === offer.offerId;
          return (
            <li key={offer.offerId} className="space-y-3 px-4 py-4 sm:px-5">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <p className="text-xs font-bold text-slate-900">{offer.sellerBusinessName}</p>
                  <p className="mt-0.5 text-[10px] text-slate-500">
                    {offer.packName} · MOQ {offer.moq} pc{offer.moq === 1 ? '' : 's'}
                  </p>
                  <p className="mt-1 flex items-center gap-1 text-[10px] font-medium text-slate-600">
                    <Truck className="h-3 w-3" aria-hidden="true" />
                    {offer.fulfilmentType === 'seller' ? 'Dispatched by seller' : 'Fulfilled by Maharani'}
                  </p>
                  {offer.sellerGstin ? (
                    <p className="mt-0.5 text-[9px] text-slate-500">Seller GSTIN {offer.sellerGstin}</p>
                  ) : null}
                  {tiers.length > 0 ? (
                    <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                      <span className="text-[9px] font-semibold text-slate-500">Quantity tiers:</span>
                      {tiers.map((tier, idx) => (
                        <span
                          key={idx}
                          className="rounded-md border border-primary-200 bg-primary-50/70 px-1.5 py-0.5 text-[9px] font-medium text-primary-800"
                        >
                          {tier.minQuantity}
                          {tier.maxQuantity ? `–${tier.maxQuantity}` : '+'} pcs:{' '}
                          {formatInr(tier.unitPricePaise / 100)}/pc
                        </span>
                      ))}
                    </div>
                  ) : null}
                </div>
                <div className="text-right">
                  <p className="text-base font-bold text-primary-700">{formatInr(effectivePaise / 100)}<span className="text-[9px] font-medium text-slate-500"> /pc</span></p>
                  <p className={`mt-1 text-[9px] font-bold ${offer.inStock ? 'text-mint-700' : 'text-slate-500'}`}>
                    {offer.inStock ? 'In stock' : 'Out of stock'}
                  </p>
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <label className="flex items-center gap-2 text-[10px] font-bold text-slate-600">
                  Qty
                  <input
                    type="number"
                    min={offer.moq}
                    max={100000}
                    step={1}
                    value={quantity}
                    disabled={!offer.inStock || busy}
                    onChange={(event) => {
                      const next = Number(event.target.value);
                      setQuantities((current) => ({
                        ...current,
                        [offer.offerId]: Number.isFinite(next) ? Math.max(offer.moq, Math.round(next)) : offer.moq,
                      }));
                    }}
                    className="h-11 w-24 rounded-xl border border-slate-300 px-3 text-center text-xs text-slate-900 outline-none focus:border-primary-500 focus:ring-2 focus:ring-primary-100 disabled:bg-slate-100"
                  />
                </label>
                <button
                  type="button"
                  disabled={!offer.inStock || busy}
                  onClick={() => addOffer(offer)}
                  className="inline-flex h-11 flex-1 items-center justify-center gap-2 rounded-xl bg-primary-600 px-4 text-xs font-bold text-white transition hover:bg-primary-700 disabled:cursor-not-allowed disabled:bg-slate-200 disabled:text-slate-500 sm:flex-none"
                >
                  {busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Store className="h-4 w-4" aria-hidden="true" />}
                  {busy ? 'Adding…' : offer.initialQuantity > 0 ? 'Add more' : 'Add seller offer'}
                </button>
              </div>
              {message?.offerId === offer.offerId ? (
                <p
                  role={message.error ? 'alert' : 'status'}
                  className={`rounded-lg px-3 py-2 text-[10px] font-semibold ${
                    message.error ? 'bg-primary-50 text-primary-700' : 'bg-mint-50 text-mint-700'
                  }`}
                >
                  {message.error ?? message.success}
                </p>
              ) : null}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
