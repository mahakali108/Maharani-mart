'use client';

import { useFormState } from 'react-dom';
import { useTransition } from 'react';
import { Trash2, ChevronUp, ChevronDown, Copy } from 'lucide-react';
import {
  addProductPackAction,
  togglePackActiveAction,
  deleteProductPackAction,
  movePackAction,
  setPackImageAction,
  duplicatePackAction,
  type PackFormState,
} from '@/lib/admin/products-actions';
import { PackCasePricing, type PackPricingTier } from '@/components/admin/pack-case-pricing';
import { MediaUploadField } from '@/components/media/media-upload-field';
import { StoredImage } from '@/components/media/stored-image';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { SubmitButton } from '@/components/ui/submit-button';
import { ToggleActiveButton } from '@/components/admin/toggle-active-button';
import { piecePriceFromCase } from '@/lib/retailer/case-pricing';

export interface Pack {
  id: string;
  pack_name: string;
  pack_sku_code: string;
  units_per_case: number;
  mrp: number | null;
  base_price: number;
  case_price: number;
  cost_price: number | null;
  barcode: string | null;
  image_url: string | null;
  /** Minimum order quantity in PIECES. */
  moq: number;
  /** false = whole cases only. */
  allow_loose_pieces: boolean;
  is_active: boolean;
  tiers: PackPricingTier[];
}

const initialState: PackFormState = null;

function money(v: number | null) {
  return v === null ? '—' : `₹${v.toFixed(2)}`;
}

export function ProductPackManager({
  productId,
  packs,
  gstPercent = 0,
}: {
  productId: string;
  packs: Pack[];
  /** Parent product's GST per cent — every price here is GST-inclusive. */
  gstPercent?: number;
}) {
  const boundAction = addProductPackAction.bind(null, productId);
  const [state, formAction] = useFormState(boundAction, initialState);
  const [isPending, startTransition] = useTransition();

  return (
    <div className="space-y-4">
      <p className="text-sm text-ink-500">
        Add every sellable size/variant for this product — <strong>30g</strong>, <strong>100g</strong>,{' '}
        <strong>500g</strong>, <strong>750g</strong>, <strong>2 Kg</strong>, or a case pack like{' '}
        <strong>Case of 12</strong>. Sizes are free text, so any current or future size can be added without a code
        change. For each variant set the number of pieces per case and the fixed, GST-inclusive{' '}
        <strong>case selling price</strong>, then add its <strong>loose piece tiers</strong> below: a retailer may buy
        any quantity, full cases are always billed at the case price and the remaining pieces at their tier rate. The
        per-piece reference price is derived automatically, and the internal pack code is generated for you.
      </p>

      {packs.length === 0 ? (
        <p className="text-sm text-ink-500">No pack sizes yet — add the first one below.</p>
      ) : (
        <div className="space-y-4">
          {packs.map((pack, index) => {
            const piecePrice = piecePriceFromCase(pack.case_price, pack.units_per_case);
            return (
              <div key={pack.id} className="overflow-hidden rounded-xl border border-ink-100">
                <table className="w-full text-sm">
                  <thead className="border-b border-ink-100 bg-ink-50 text-left text-xs uppercase tracking-wide text-ink-500">
                    <tr>
                      <th className="whitespace-nowrap px-4 py-2.5 font-medium">Pack</th>
                      <th className="whitespace-nowrap px-4 py-2.5 font-medium">Barcode</th>
                      <th className="whitespace-nowrap px-4 py-2.5 font-medium">Units/case</th>
                      <th className="whitespace-nowrap px-4 py-2.5 font-medium">MRP</th>
                      <th className="whitespace-nowrap px-4 py-2.5 font-medium">Case price</th>
                      <th className="whitespace-nowrap px-4 py-2.5 font-medium">Per piece</th>
                      <th className="whitespace-nowrap px-4 py-2.5 font-medium">Status</th>
                      <th className="whitespace-nowrap px-4 py-2.5 font-medium" />
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-ink-100">
                    <tr>
                      <td className="whitespace-nowrap px-4 py-2.5 font-medium text-ink-900">{pack.pack_name}</td>
                      <td className="whitespace-nowrap px-4 py-2.5 font-mono text-xs text-ink-500">{pack.barcode ?? '—'}</td>
                      <td className="whitespace-nowrap px-4 py-2.5 text-ink-600">
                        {pack.units_per_case === 1 ? (
                          <span
                            className="inline-flex items-center rounded-full border border-amber-300 bg-amber-50 px-1.5 py-0.5 text-[10px] font-semibold text-amber-800"
                            title="Legacy configuration: 1 piece = 1 case. Set the real pieces per case in the pricing editor below."
                          >
                            1 pc = 1 case
                          </span>
                        ) : (
                          pack.units_per_case
                        )}
                      </td>
                      <td className="whitespace-nowrap px-4 py-2.5 text-ink-600">{money(pack.mrp ?? pack.base_price)}</td>
                      <td className="whitespace-nowrap px-4 py-2.5 font-semibold text-ink-900">{money(pack.case_price)}</td>
                      <td className="whitespace-nowrap px-4 py-2.5 text-ink-600">{money(piecePrice)}</td>
                      <td className="whitespace-nowrap px-4 py-2.5">
                        <ToggleActiveButton
                          isActive={pack.is_active}
                          onToggle={() => togglePackActiveAction(pack.id, productId, !pack.is_active)}
                        />
                      </td>
                      <td className="whitespace-nowrap px-4 py-2.5">
                        <div className="flex items-center gap-1">
                          <button
                            type="button"
                            disabled={isPending || index === 0}
                            onClick={() => startTransition(() => movePackAction(productId, pack.id, 'up'))}
                            className="rounded-lg p-1 text-ink-400 hover:bg-ink-100 hover:text-ink-700 disabled:opacity-30"
                            aria-label="Move pack up"
                          >
                            <ChevronUp className="h-3.5 w-3.5" />
                          </button>
                          <button
                            type="button"
                            disabled={isPending || index === packs.length - 1}
                            onClick={() => startTransition(() => movePackAction(productId, pack.id, 'down'))}
                            className="rounded-lg p-1 text-ink-400 hover:bg-ink-100 hover:text-ink-700 disabled:opacity-30"
                            aria-label="Move pack down"
                          >
                            <ChevronDown className="h-3.5 w-3.5" />
                          </button>
                          <button
                            type="button"
                            disabled={isPending}
                            onClick={() => startTransition(() => duplicatePackAction(pack.id, productId))}
                            className="rounded-lg p-1 text-ink-400 hover:bg-ink-100 hover:text-ink-700 disabled:opacity-30"
                            aria-label="Duplicate pack"
                            title="Duplicate this variant"
                          >
                            <Copy className="h-3.5 w-3.5" />
                          </button>
                          <button
                            type="button"
                            disabled={isPending}
                            onClick={() => {
                              if (confirm('Delete this pack? This cannot be undone.')) {
                                startTransition(() => deleteProductPackAction(pack.id, productId));
                              }
                            }}
                            className="rounded-lg p-1 text-ink-400 hover:bg-primary-50 hover:text-primary-600 disabled:opacity-30"
                            aria-label="Delete pack"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  </tbody>
                </table>
                <div className="border-t border-ink-100 bg-white px-3 py-3">
                  <PackCasePricing
                    packId={pack.id}
                    productId={productId}
                    packName={pack.pack_name}
                    unitsPerCase={pack.units_per_case}
                    casePrice={pack.case_price}
                    mrp={pack.mrp ?? pack.base_price}
                    moq={pack.moq}
                    allowLoosePieces={pack.allow_loose_pieces !== false}
                    gstPercent={gstPercent}
                    tiers={pack.tiers}
                  />
                </div>
                <div className="border-t border-ink-100 bg-white px-3 py-3">
                  <p className="mb-2 text-xs font-medium text-ink-500">
                    Variant image — shown on the retailer size switcher for <strong>{pack.pack_name}</strong> (falls
                    back to the product gallery when empty).
                  </p>
                  <div className="flex items-center gap-3">
                    {pack.image_url ? (
                      <div className="relative h-16 w-16 shrink-0 overflow-hidden rounded-xl border border-ink-100">
                        <StoredImage src={pack.image_url} alt={`${pack.pack_name} image`} size="thumb" fill className="object-contain" />
                      </div>
                    ) : null}
                    <MediaUploadField
                      kind="product-gallery"
                      ownerId={productId}
                      hasExisting={!!pack.image_url}
                      label={pack.image_url ? 'Replace variant image' : 'Upload variant image'}
                      onUploaded={(media) => setPackImageAction(pack.id, productId, media.ref)}
                    />
                    {pack.image_url ? (
                      <button
                        type="button"
                        disabled={isPending}
                        onClick={() => startTransition(() => setPackImageAction(pack.id, productId, null))}
                        className="flex h-9 items-center gap-1.5 rounded-xl border border-ink-200 px-3 text-xs font-medium text-ink-600 transition hover:border-primary-200 hover:text-primary-600 disabled:opacity-50"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                        Remove
                      </button>
                    ) : null}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      <form action={formAction} className="grid grid-cols-1 gap-3 rounded-xl border border-dashed border-ink-200 p-4 sm:grid-cols-4">
        <p className="sm:col-span-4 text-sm font-semibold text-ink-800">Add a pack size</p>
        {state?.error ? (
          <div className="sm:col-span-4 rounded-lg border border-primary-200 bg-primary-50 px-3 py-2 text-xs text-primary-700">
            {state.error}
          </div>
        ) : null}
        <div>
          <Label htmlFor="packName">Pack name</Label>
          <Input id="packName" name="packName" placeholder="Case of 12" required />
        </div>
        <div>
          <Label htmlFor="barcode">Barcode</Label>
          <Input id="barcode" name="barcode" placeholder="Optional" />
        </div>
        <div>
          <Label htmlFor="unitsPerCase">Units/case</Label>
          <Input id="unitsPerCase" name="unitsPerCase" type="number" min={1} step={1} defaultValue={1} required />
        </div>
        <div>
          <Label htmlFor="mrp">MRP (₹) / piece</Label>
          <Input id="mrp" name="mrp" type="number" min={0} step="0.01" required />
        </div>
        <div>
          <Label htmlFor="costPrice">Cost price (₹) — admin only</Label>
          <Input id="costPrice" name="costPrice" type="number" min={0} step="0.01" placeholder="Optional" />
        </div>
        <div>
          <Label htmlFor="casePrice">Case selling price (₹) — GST inclusive</Label>
          <Input id="casePrice" name="casePrice" type="number" min={0} step="0.01" required />
        </div>
        <div>
          <Label htmlFor="moq">Min order qty (pieces)</Label>
          <Input id="moq" name="moq" type="number" min={1} step={1} defaultValue={1} />
        </div>
        <div className="sm:col-span-4">
          <SubmitButton pendingLabel="Adding…">Add pack</SubmitButton>
        </div>
      </form>
    </div>
  );
}
