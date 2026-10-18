'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import {
  sellerCreateOfferAction,
  sellerReplaceOfferTiersAction,
  sellerSetOfferActiveAction,
  sellerSetOfferStockAction,
  sellerUpdateOfferTermsAction,
  type SellerTierInput,
} from '@/lib/seller/actions';
import type { CataloguePackOption, SellerPortalOfferRow } from '@/lib/seller/queries';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { StatusBadge } from '@/components/admin/status-badge';

const inr = (paise: number) =>
  `₹${(paise / 100).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export function SellerCreateOfferCard({
  packs,
  disabled,
}: {
  packs: CataloguePackOption[];
  disabled?: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [fulfilmentType, setFulfilmentType] = useState<'seller' | 'maharani'>('seller');
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setSuccess(null);
    const form = event.currentTarget;
    const formData = new FormData(form);
    startTransition(async () => {
      const result = await sellerCreateOfferAction(formData);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setSuccess('Offer submitted for admin moderation.');
      form.reset();
      router.refresh();
    });
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      {error ? (
        <p role="alert" className="rounded-xl border border-primary-200 bg-primary-50 px-4 py-2.5 text-xs text-primary-700">
          {error}
        </p>
      ) : null}
      {success ? (
        <p className="rounded-xl border border-mint-200 bg-mint-50 px-4 py-2.5 text-xs text-mint-700">
          {success}
        </p>
      ) : null}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <div className="sm:col-span-2">
          <Label htmlFor="packId">Central catalogue pack *</Label>
          <Select id="packId" name="packId" required disabled={disabled || packs.length === 0}>
            <option value="">Select a product pack…</option>
            {packs.map((pack) => (
              <option key={pack.packId} value={pack.packId}>
                {pack.label} (pack MOQ {pack.moq})
              </option>
            ))}
          </Select>
        </div>

        <div>
          <Label htmlFor="fulfilmentType">Fulfilment mode *</Label>
          <Select
            id="fulfilmentType"
            name="fulfilmentType"
            value={fulfilmentType}
            onChange={(e) => setFulfilmentType(e.target.value === 'maharani' ? 'maharani' : 'seller')}
            disabled={disabled}
          >
            <option value="seller">Seller-fulfilled (your stock)</option>
            <option value="maharani">Maharani-fulfilled</option>
          </Select>
        </div>

        <div>
          <Label htmlFor="unitPrice">Base unit price (₹/piece) *</Label>
          <Input
            id="unitPrice"
            name="unitPrice"
            inputMode="decimal"
            placeholder="e.g. 95.50"
            required
            disabled={disabled}
          />
        </div>

        <div>
          <Label htmlFor="moq">Minimum order quantity (pieces) *</Label>
          <Input
            id="moq"
            name="moq"
            type="number"
            min={1}
            max={100000}
            defaultValue={1}
            required
            disabled={disabled}
          />
        </div>

        {fulfilmentType === 'seller' ? (
          <div>
            <Label htmlFor="stockQuantity">On-hand stock (pieces) *</Label>
            <Input
              id="stockQuantity"
              name="stockQuantity"
              type="number"
              min={0}
              defaultValue={25}
              required
              disabled={disabled}
            />
          </div>
        ) : null}

        <div>
          <Label htmlFor="sellerSku">Seller SKU (optional)</Label>
          <Input id="sellerSku" name="sellerSku" maxLength={64} placeholder="Your internal SKU" disabled={disabled} />
        </div>
      </div>

      <Button type="submit" disabled={disabled || pending || packs.length === 0}>
        {pending ? 'Submitting…' : 'Create offer (starts pending review)'}
      </Button>
    </form>
  );
}

export function SellerOfferCard({
  offer,
  disabled,
}: {
  offer: SellerPortalOfferRow;
  disabled?: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [stockInput, setStockInput] = useState(String(offer.stock_quantity ?? 0));
  const [tiers, setTiers] = useState<SellerTierInput[]>(
    offer.tiers.map((t) => ({
      minQuantity: t.min_quantity,
      maxQuantity: t.max_quantity,
      unitPriceRupees: (t.unit_price_paise / 100).toFixed(2),
    }))
  );

  function handleUpdateTerms(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setNotice(null);
    const formData = new FormData(event.currentTarget);
    startTransition(async () => {
      const result = await sellerUpdateOfferTermsAction(formData);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setNotice('Offer terms updated and queued for admin moderation.');
      router.refresh();
    });
  }

  function handleStockSave() {
    setError(null);
    setNotice(null);
    const parsed = Number(stockInput);
    startTransition(async () => {
      const result = await sellerSetOfferStockAction(offer.id, parsed);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setNotice('On-hand stock updated.');
      router.refresh();
    });
  }

  function handleToggleActive() {
    setError(null);
    setNotice(null);
    startTransition(async () => {
      const result = await sellerSetOfferActiveAction(offer.id, !offer.is_active);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setNotice(offer.is_active ? 'Offer deactivated.' : 'Offer activated.');
      router.refresh();
    });
  }

  function handleAddTier() {
    const last = tiers[tiers.length - 1];
    const nextMin = last ? (last.maxQuantity ? last.maxQuantity + 1 : last.minQuantity + 12) : Math.max(offer.moq, 12);
    setTiers([
      ...tiers,
      {
        minQuantity: nextMin,
        maxQuantity: null,
        unitPriceRupees: (offer.unit_price_paise / 100).toFixed(2),
      },
    ]);
  }

  function handleRemoveTier(idx: number) {
    setTiers(tiers.filter((_, i) => i !== idx));
  }

  function handleSaveTiers() {
    setError(null);
    setNotice(null);
    startTransition(async () => {
      const result = await sellerReplaceOfferTiersAction(offer.id, tiers);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setNotice('Quantity-tier pricing saved (offer sent for admin review).');
      router.refresh();
    });
  }

  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-sm font-bold text-slate-900">
            {offer.product_name} · <span className="text-slate-600">{offer.pack_name}</span>
          </p>
          <p className="mt-1 text-xs text-slate-500">
            Base: <strong>{inr(offer.unit_price_paise)}</strong> / pc · MOQ {offer.moq} ·{' '}
            {offer.fulfilment_type === 'seller'
              ? `Seller-fulfilled (${offer.stock_quantity ?? 0} in stock)`
              : 'Maharani-fulfilled'}
            {offer.seller_sku ? ` · SKU ${offer.seller_sku}` : ''}
          </p>
          {offer.moderation_reason ? (
            <p className="mt-1 text-xs text-primary-700">Moderation note: {offer.moderation_reason}</p>
          ) : null}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <StatusBadge status={offer.moderation_status} />
          <StatusBadge status={offer.is_active ? 'active' : 'inactive'} />
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={disabled || pending}
            onClick={handleToggleActive}
          >
            {offer.is_active ? 'Deactivate' : 'Activate'}
          </Button>
        </div>
      </div>

      {error ? (
        <p role="alert" className="rounded-lg border border-primary-200 bg-primary-50 px-3 py-2 text-xs text-primary-700">
          {error}
        </p>
      ) : null}
      {notice ? (
        <p className="rounded-lg border border-mint-200 bg-mint-50 px-3 py-2 text-xs text-mint-700">
          {notice}
        </p>
      ) : null}

      {offer.fulfilment_type === 'seller' ? (
        <div className="flex flex-wrap items-end gap-3 rounded-xl bg-slate-50 p-3">
          <div>
            <Label htmlFor={`stock-${offer.id}`}>Seller on-hand stock (pieces)</Label>
            <Input
              id={`stock-${offer.id}`}
              type="number"
              min={0}
              value={stockInput}
              onChange={(e) => setStockInput(e.target.value)}
              className="mt-1 w-36 bg-white"
              disabled={disabled || pending}
            />
          </div>
          <Button type="button" size="sm" variant="outline" disabled={disabled || pending} onClick={handleStockSave}>
            Update stock
          </Button>
          <p className="text-[11px] text-slate-500">
            Updating stock does not reset moderation status.
          </p>
        </div>
      ) : null}

      <details className="rounded-xl border border-slate-100 p-3">
        <summary className="cursor-pointer text-xs font-semibold text-slate-700">
          Edit base price, MOQ &amp; SKU (re-submits for admin moderation)
        </summary>
        <form onSubmit={handleUpdateTerms} className="mt-3 grid gap-3 sm:grid-cols-4 items-end">
          <input type="hidden" name="offerId" value={offer.id} />
          <div>
            <Label htmlFor={`price-${offer.id}`}>Unit price (₹)</Label>
            <Input
              id={`price-${offer.id}`}
              name="unitPrice"
              defaultValue={(offer.unit_price_paise / 100).toFixed(2)}
              required
              disabled={disabled || pending}
            />
          </div>
          <div>
            <Label htmlFor={`moq-${offer.id}`}>MOQ (pcs)</Label>
            <Input
              id={`moq-${offer.id}`}
              name="moq"
              type="number"
              min={1}
              defaultValue={offer.moq}
              required
              disabled={disabled || pending}
            />
          </div>
          <div>
            <Label htmlFor={`sku-${offer.id}`}>Seller SKU</Label>
            <Input
              id={`sku-${offer.id}`}
              name="sellerSku"
              defaultValue={offer.seller_sku ?? ''}
              disabled={disabled || pending}
            />
          </div>
          <Button type="submit" size="sm" disabled={disabled || pending}>
            Save terms
          </Button>
        </form>
      </details>

      <details className="rounded-xl border border-slate-100 p-3" open={offer.tiers.length > 0}>
        <summary className="cursor-pointer text-xs font-semibold text-slate-700">
          Quantity-tier pricing ({tiers.length} slab{tiers.length === 1 ? '' : 's'})
        </summary>
        <div className="mt-3 space-y-3">
          <p className="text-[11px] text-slate-500">
            Configure bulk quantity slabs for this offer. Each slab price must be at or below the base unit price (
            {inr(offer.unit_price_paise)}) and at or above the pack floor. Saving tiers sends the offer for admin review.
          </p>
          {tiers.length > 0 ? (
            <div className="space-y-2">
              {tiers.map((tier, idx) => (
                <div key={idx} className="grid grid-cols-1 gap-2 sm:grid-cols-4 items-end rounded-lg bg-slate-50 p-2.5">
                  <div>
                    <Label>Min qty (pcs)</Label>
                    <Input
                      type="number"
                      min={offer.moq}
                      value={tier.minQuantity}
                      onChange={(e) => {
                        const next = [...tiers];
                        next[idx] = { ...tier, minQuantity: Number(e.target.value) };
                        setTiers(next);
                      }}
                      className="bg-white"
                      disabled={disabled || pending}
                    />
                  </div>
                  <div>
                    <Label>Max qty (blank = open)</Label>
                    <Input
                      type="number"
                      min={tier.minQuantity}
                      value={tier.maxQuantity ?? ''}
                      placeholder="No upper limit"
                      onChange={(e) => {
                        const next = [...tiers];
                        next[idx] = {
                          ...tier,
                          maxQuantity: e.target.value === '' ? null : Number(e.target.value),
                        };
                        setTiers(next);
                      }}
                      className="bg-white"
                      disabled={disabled || pending}
                    />
                  </div>
                  <div>
                    <Label>Unit price (₹/pc)</Label>
                    <Input
                      inputMode="decimal"
                      value={tier.unitPriceRupees}
                      onChange={(e) => {
                        const next = [...tiers];
                        next[idx] = { ...tier, unitPriceRupees: e.target.value };
                        setTiers(next);
                      }}
                      className="bg-white"
                      disabled={disabled || pending}
                    />
                  </div>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => handleRemoveTier(idx)}
                    disabled={disabled || pending}
                  >
                    Remove
                  </Button>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-xs text-slate-500">No quantity slabs configured — base unit price applies to all quantities.</p>
          )}
          <div className="flex flex-wrap items-center gap-2">
            <Button type="button" variant="outline" size="sm" onClick={handleAddTier} disabled={disabled || pending}>
              + Add quantity slab
            </Button>
            <Button type="button" size="sm" onClick={handleSaveTiers} disabled={disabled || pending}>
              Save quantity tiers
            </Button>
          </div>
        </div>
      </details>
    </div>
  );
}
