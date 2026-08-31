'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import {
  AlertCircle,
  Award,
  Check,
  ChevronRight,
  Loader2,
  Minus,
  PackageCheck,
  Plus,
  ShieldCheck,
  ShoppingCart,
  Trash2,
  Zap,
} from 'lucide-react';
import {
  addToCartAction,
  buyNowAction,
  removeCartItemAction,
  updateCartQuantityAction,
} from '@/lib/retailer/cart-actions';
import {
  calcRetailerMargin,
  calcSavings,
  determineBestValueTier,
  formatInr,
  formatMargin,
} from '@/lib/retailer/format';
import { caseLineBreakdown, piecePriceFromCase, type PricingTier } from '@/lib/retailer/case-pricing';

export interface MultiPricePack {
  id: string;
  pack_name: string;
  pack_sku_code: string;
  units_per_case: number;
  base_price: number;
  ptr: number | null;
  mrp: number | null;
  moq: number;
  /** GST-inclusive CASE selling price (source of truth). */
  effectivePrice: number;
  casePrice: number;
  tiers: PricingTier[];
  initialQuantity?: number;
  cartItemId?: string | null;
}

export interface CartSummaryData {
  itemCount: number;
  grandTotal: number;
  savings: number;
}

export interface PackSelectorProps {
  packs: MultiPricePack[];
  gstPercent: number;
  productName?: string;
  cartSummary?: CartSummaryData | null;
}

export function PackSelector({
  packs,
  gstPercent,
  productName = 'Product',
  cartSummary,
}: PackSelectorProps) {
  const router = useRouter();

  // Local quantity for every pack (key: pack.id)
  const [quantities, setQuantities] = useState<Record<string, number>>(() => {
    const initial: Record<string, number> = {};
    for (const pack of packs) {
      initial[pack.id] = pack.initialQuantity ?? 0;
    }
    return initial;
  });

  // Track what is currently confirmed in the cart (key: pack.id)
  const [inCartMap, setInCartMap] = useState<Record<string, { quantity: number; cartItemId: string | null }>>(() => {
    const initial: Record<string, { quantity: number; cartItemId: string | null }> = {};
    for (const pack of packs) {
      initial[pack.id] = {
        quantity: pack.initialQuantity ?? 0,
        cartItemId: pack.cartItemId ?? null,
      };
    }
    return initial;
  });

  // Active pending pack ID ('all' for batch action)
  const [pendingPackId, setPendingPackId] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  // Inline feedback state
  const [packErrors, setPackErrors] = useState<Record<string, string | null>>({});
  const [packSuccess, setPackSuccess] = useState<Record<string, string | null>>({});
  const [generalError, setGeneralError] = useState<string | null>(null);

  // Compute enriched pack tier display data using authoritative business fields.
  // effectivePrice is the GST-INCLUSIVE case price; per-piece price is derived.
  const enrichedPacks = packs.map((pack) => {
    const unitPrice = piecePriceFromCase(pack.effectivePrice, pack.units_per_case);
    const landedPrice = pack.effectivePrice; // GST already included
    const marginPercent = calcRetailerMargin(pack.mrp, unitPrice);
    const savingsPerPack = calcSavings(pack.mrp, unitPrice);

    return {
      ...pack,
      unitPrice,
      gstAmount: 0,
      landedPrice,
      marginPercent,
      savingsPerPack,
    };
  });

  // GST-inclusive line total for a pack at a given quantity (applies the
  // Super Admin-configured quantity tier automatically).
  function lineTotalFor(pack: MultiPricePack, qty: number): number {
    if (qty <= 0) return 0;
    return caseLineBreakdown({
      casePrice: pack.effectivePrice,
      unitsPerCase: pack.units_per_case,
      tiers: pack.tiers,
      packQuantity: qty,
      gstPercent,
    }).total;
  }

  // Determine the best-value tier based on lowest price/unit (only when >= 2 packs and distinct prices)
  const { bestPackId, savingsVsRef, refPackName } = determineBestValueTier(enrichedPacks);

  // Stepper handlers per pack tier
  function handleIncrement(pack: MultiPricePack) {
    setGeneralError(null);
    setPackErrors((prev) => ({ ...prev, [pack.id]: null }));
    setPackSuccess((prev) => ({ ...prev, [pack.id]: null }));

    setQuantities((prev) => {
      const current = prev[pack.id] ?? 0;
      if (current === 0) {
        // Enforce MOQ on first selection
        return { ...prev, [pack.id]: Math.max(1, pack.moq) };
      }
      return { ...prev, [pack.id]: current + 1 };
    });
  }

  function handleDecrement(pack: MultiPricePack) {
    setGeneralError(null);
    setPackErrors((prev) => ({ ...prev, [pack.id]: null }));
    setPackSuccess((prev) => ({ ...prev, [pack.id]: null }));

    setQuantities((prev) => {
      const current = prev[pack.id] ?? 0;
      if (current <= 0) return prev;
      if (current <= pack.moq) {
        // Decrementing from MOQ goes to 0
        return { ...prev, [pack.id]: 0 };
      }
      return { ...prev, [pack.id]: current - 1 };
    });
  }

  function handleQuantityInput(pack: MultiPricePack, val: string) {
    const num = parseInt(val, 10);
    setGeneralError(null);
    setPackErrors((prev) => ({ ...prev, [pack.id]: null }));
    setPackSuccess((prev) => ({ ...prev, [pack.id]: null }));

    if (isNaN(num) || num <= 0) {
      setQuantities((prev) => ({ ...prev, [pack.id]: 0 }));
    } else {
      setQuantities((prev) => ({ ...prev, [pack.id]: num }));
    }
  }

  function handleQuantityBlur(pack: MultiPricePack) {
    const current = quantities[pack.id] ?? 0;
    if (current > 0 && current < pack.moq) {
      setPackErrors((prev) => ({
        ...prev,
        [pack.id]: `Minimum order quantity is ${pack.moq} pack(s). Adjusted to MOQ.`,
      }));
      setQuantities((prev) => ({ ...prev, [pack.id]: pack.moq }));
    }
  }

  // Add single pack to cart
  function handleAddSinglePack(pack: MultiPricePack) {
    const qty = quantities[pack.id] ?? 0;
    if (qty < pack.moq) {
      setPackErrors((prev) => ({
        ...prev,
        [pack.id]: `Minimum order quantity for this pack is ${pack.moq}.`,
      }));
      return;
    }

    setPendingPackId(pack.id);
    setPackErrors((prev) => ({ ...prev, [pack.id]: null }));
    setPackSuccess((prev) => ({ ...prev, [pack.id]: null }));

    startTransition(async () => {
      try {
        const result = await addToCartAction(pack.id, qty);
        if ('error' in result) {
          setPackErrors((prev) => ({ ...prev, [pack.id]: result.error ?? 'Could not add to cart.' }));
        } else {
          setPackSuccess((prev) => ({ ...prev, [pack.id]: `Added ${qty} × ${pack.pack_name} to cart` }));
          setInCartMap((prev) => ({
            ...prev,
            [pack.id]: { quantity: qty, cartItemId: prev[pack.id]?.cartItemId ?? null },
          }));
          router.refresh();
        }
      } catch {
        setPackErrors((prev) => ({ ...prev, [pack.id]: 'Failed to add to cart. Please try again.' }));
      } finally {
        setPendingPackId(null);
      }
    });
  }

  // Update existing cart item quantity
  function handleUpdateSinglePack(pack: MultiPricePack) {
    const inCart = inCartMap[pack.id];
    const qty = quantities[pack.id] ?? 0;

    if (qty === 0 && inCart?.cartItemId) {
      // Remove line from cart
      setPendingPackId(pack.id);
      startTransition(async () => {
        try {
          const result = await removeCartItemAction(inCart.cartItemId!);
          if ('error' in result) {
            setPackErrors((prev) => ({ ...prev, [pack.id]: result.error ?? 'Could not remove item.' }));
          } else {
            setInCartMap((prev) => ({ ...prev, [pack.id]: { quantity: 0, cartItemId: null } }));
            setPackSuccess((prev) => ({ ...prev, [pack.id]: `Removed ${pack.pack_name} from cart` }));
            router.refresh();
          }
        } catch {
          setPackErrors((prev) => ({ ...prev, [pack.id]: 'Failed to update cart.' }));
        } finally {
          setPendingPackId(null);
        }
      });
      return;
    }

    if (qty < pack.moq) {
      setPackErrors((prev) => ({
        ...prev,
        [pack.id]: `Minimum order quantity is ${pack.moq}.`,
      }));
      return;
    }

    setPendingPackId(pack.id);
    setPackErrors((prev) => ({ ...prev, [pack.id]: null }));

    startTransition(async () => {
      try {
        if (inCart?.cartItemId) {
          const result = await updateCartQuantityAction(inCart.cartItemId, qty);
          if ('error' in result) {
            setPackErrors((prev) => ({ ...prev, [pack.id]: result.error ?? 'Could not update quantity.' }));
          } else {
            setInCartMap((prev) => ({ ...prev, [pack.id]: { quantity: qty, cartItemId: inCart.cartItemId } }));
            setPackSuccess((prev) => ({ ...prev, [pack.id]: `Updated to ${qty} pack(s)` }));
            router.refresh();
          }
        } else {
          const result = await addToCartAction(pack.id, qty);
          if ('error' in result) {
            setPackErrors((prev) => ({ ...prev, [pack.id]: result.error ?? 'Could not add to cart.' }));
          } else {
            setInCartMap((prev) => ({ ...prev, [pack.id]: { quantity: qty, cartItemId: null } }));
            setPackSuccess((prev) => ({ ...prev, [pack.id]: `Added to cart` }));
            router.refresh();
          }
        }
      } catch {
        setPackErrors((prev) => ({ ...prev, [pack.id]: 'Could not update cart.' }));
      } finally {
        setPendingPackId(null);
      }
    });
  }

  // Batch add: Add/update all selected packs with positive quantities
  const modifiedPacks = enrichedPacks.filter((pack) => {
    const selectedQty = quantities[pack.id] ?? 0;
    const inCartQty = inCartMap[pack.id]?.quantity ?? 0;
    return selectedQty > 0 && selectedQty !== inCartQty;
  });

  const totalSelectedLanded = modifiedPacks.reduce((sum, pack) => {
    const qty = quantities[pack.id] ?? 0;
    return sum + lineTotalFor(pack, qty);
  }, 0);

  const totalSelectedPacks = modifiedPacks.reduce((sum, pack) => {
    return sum + (quantities[pack.id] ?? 0);
  }, 0);

  function handleAddAllSelected() {
    if (modifiedPacks.length === 0) return;

    // Validate MOQs
    for (const pack of modifiedPacks) {
      const qty = quantities[pack.id] ?? 0;
      if (qty < pack.moq) {
        setPackErrors((prev) => ({
          ...prev,
          [pack.id]: `Minimum order quantity for ${pack.pack_name} is ${pack.moq}.`,
        }));
        return;
      }
    }

    setPendingPackId('all');
    setGeneralError(null);

    startTransition(async () => {
      try {
        const results = await Promise.all(
          modifiedPacks.map(async (pack) => {
            const qty = quantities[pack.id] ?? 0;
            const inCart = inCartMap[pack.id];
            if (inCart?.cartItemId) {
              return updateCartQuantityAction(inCart.cartItemId, qty);
            }
            return addToCartAction(pack.id, qty);
          })
        );

        const firstError = results.find((res) => 'error' in res && res.error);
        if (firstError && 'error' in firstError) {
          setGeneralError(firstError.error ?? 'Some items could not be updated.');
        } else {
          setInCartMap((prev) => {
            const next = { ...prev };
            for (const pack of modifiedPacks) {
              next[pack.id] = {
                quantity: quantities[pack.id] ?? 0,
                cartItemId: prev[pack.id]?.cartItemId ?? null,
              };
            }
            return next;
          });
          router.refresh();
        }
      } catch {
        setGeneralError('Failed to add selected packs to cart. Please try again.');
      } finally {
        setPendingPackId(null);
      }
    });
  }

  // Buy now for the first active selection
  function handleBuyNow() {
    const packToBuy = modifiedPacks[0] ?? enrichedPacks[0];
    if (!packToBuy) return;
    const qty = Math.max(packToBuy.moq, quantities[packToBuy.id] ?? packToBuy.moq);

    setPendingPackId('buynow');
    startTransition(async () => {
      try {
        const result = await buyNowAction(packToBuy.id, qty);
        if (result && 'error' in result) {
          setGeneralError(result.error ?? 'Could not initiate checkout.');
        }
      } catch {
        setGeneralError('Could not start checkout.');
      } finally {
        setPendingPackId(null);
      }
    });
  }

  if (packs.length === 0) {
    return (
      <section className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-xs font-medium text-amber-800">
        No pack sizes are currently available for this product.
      </section>
    );
  }

  return (
    <section
      aria-label="Multi-Price / Multi-Pack Tiers"
      className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-[0_4px_24px_rgba(15,23,42,0.06)]"
    >
      {/* Section Header */}
      <div className="flex items-center justify-between border-b border-slate-100 bg-slate-50/90 px-4 py-3.5 sm:px-5">
        <div>
          <h2 className="text-sm font-bold tracking-tight text-slate-900 sm:text-base">
            Wholesale Multi-Pack Pricing
          </h2>
          <p className="mt-0.5 text-[10px] text-slate-500 sm:text-xs">
            Volume pricing tiers — select one or multiple packs
          </p>
        </div>
        <PackageCheck className="h-5 w-5 text-primary-600" aria-hidden="true" />
      </div>

      {/* Multi-Price Tiers List */}
      <div className="space-y-3.5 p-3.5 sm:p-5">
        {enrichedPacks.map((pack) => {
          const qty = quantities[pack.id] ?? 0;
          const inCart = inCartMap[pack.id];
          const isItemInCart = (inCart?.quantity ?? 0) > 0;
          const isModified = qty !== (inCart?.quantity ?? 0);
          const isCurrentPending = pendingPackId === pack.id || pendingPackId === 'all';
          const packError = packErrors[pack.id];
          const packSuccessMsg = packSuccess[pack.id];
          const isBestValue = pack.id === bestPackId;
          const lineTotal = lineTotalFor(pack, qty);

          return (
            <article
              key={pack.id}
              className={`relative overflow-hidden rounded-2xl border transition-all duration-200 ${
                isBestValue
                  ? 'border-primary-500/80 bg-gradient-to-br from-white to-primary-50/30 ring-1 ring-primary-500/30 shadow-sm'
                  : 'border-slate-200 bg-white hover:border-slate-300'
              }`}
            >
              {/* Best Value Banner */}
              {isBestValue ? (
                <div className="flex items-center justify-between bg-primary-600 px-3 py-1 text-white">
                  <span className="flex items-center gap-1 text-[10px] font-black uppercase tracking-wider">
                    <Award className="h-3 w-3 fill-amber-300 text-amber-300" />
                    BEST VALUE
                  </span>
                  {savingsVsRef && refPackName ? (
                    <span className="text-[10px] font-semibold text-primary-100">
                      Save {formatInr(savingsVsRef)}/unit vs {refPackName}
                    </span>
                  ) : null}
                </div>
              ) : null}

              <div className="p-3 sm:p-4">
                {/* Top Row: Pack Name & In-Cart Badge */}
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <h3 className="text-sm font-bold text-slate-900 sm:text-base">{pack.pack_name}</h3>
                    <p className="mt-0.5 text-[10px] font-medium text-slate-500">
                      {pack.units_per_case > 1 ? `${pack.units_per_case} unit(s) per pack · ` : ''}
                      MOQ: {pack.moq} pack{pack.moq === 1 ? '' : 's'}
                    </p>
                  </div>

                  {isItemInCart ? (
                    <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-bold text-emerald-800">
                      <Check className="h-3 w-3" />
                      In cart: {inCart?.quantity}
                    </span>
                  ) : null}
                </div>

                {/* Pricing & Margin Row */}
                <div className="mt-2.5 grid grid-cols-2 items-center gap-2 rounded-xl bg-slate-50 p-2.5 sm:flex sm:flex-wrap sm:items-baseline sm:justify-between sm:p-3">
                  {/* Price per unit */}
                  <div>
                    <span className="block text-[9px] font-bold uppercase tracking-wider text-slate-400">
                      Price / unit
                    </span>
                    <p className="mt-0.5 text-base font-extrabold tracking-tight text-slate-950 sm:text-lg">
                      {formatInr(pack.unitPrice)}
                    </p>
                    {pack.units_per_case > 1 ? (
                      <p className="text-[9px] text-slate-500">
                        {formatInr(pack.effectivePrice)} / case · {pack.units_per_case} pcs
                      </p>
                    ) : null}
                  </div>

                  {/* Margin % (honestly computed from MRP vs price) */}
                  <div className="text-right sm:text-left">
                    <span className="block text-[9px] font-bold uppercase tracking-wider text-slate-400">
                      Margin
                    </span>
                    {pack.marginPercent !== null ? (
                      <div className="mt-0.5 inline-flex items-center gap-1 rounded-md bg-emerald-50 px-1.5 py-0.5 text-xs font-bold text-emerald-700">
                        <span>{formatMargin(pack.marginPercent)}</span>
                      </div>
                    ) : (
                      <span className="mt-0.5 block text-xs font-medium text-slate-400">—</span>
                    )}
                    {pack.mrp && pack.mrp > pack.effectivePrice ? (
                      <p className="text-[9px] text-slate-400 line-through">
                        MRP {formatInr(pack.mrp)}
                      </p>
                    ) : null}
                  </div>

                  {/* Landed price info */}
                  <div className="col-span-2 border-t border-slate-200 pt-1.5 text-[10px] text-slate-600 sm:col-span-1 sm:border-0 sm:pt-0 sm:text-right">
                    <span className="font-semibold text-slate-700">
                      Landed: {formatInr(pack.landedPrice)}
                    </span>
                    <span className="text-[9px] text-slate-400"> (incl. {gstPercent}% GST)</span>
                  </div>
                </div>

                {/* Quantity Control & Action Row */}
                <div className="mt-3 flex flex-wrap items-center justify-between gap-2.5">
                  {/* Quantity Stepper: [ − 0 + ] */}
                  <div className="flex items-center">
                    <span className="mr-2 text-[10px] font-bold uppercase tracking-wider text-slate-400 sm:hidden">
                      Qty:
                    </span>
                    <div
                      className="flex h-10 items-center overflow-hidden rounded-xl border border-slate-300 bg-white shadow-sm"
                      role="group"
                      aria-label={`${productName} - ${pack.pack_name} quantity control`}
                    >
                      <button
                        type="button"
                        onClick={() => handleDecrement(pack)}
                        disabled={qty <= 0 || isCurrentPending}
                        className="flex h-full w-10 items-center justify-center text-slate-700 transition hover:bg-slate-100 active:bg-slate-200 disabled:cursor-not-allowed disabled:text-slate-300 disabled:hover:bg-transparent"
                        aria-label={`Decrease quantity of ${productName} - ${pack.pack_name}`}
                      >
                        <Minus className="h-4 w-4" />
                      </button>

                      <input
                        type="number"
                        inputMode="numeric"
                        min={0}
                        step={1}
                        value={qty}
                        disabled={isCurrentPending}
                        onChange={(e) => handleQuantityInput(pack, e.target.value)}
                        onBlur={() => handleQuantityBlur(pack)}
                        className="no-spinner h-full w-12 border-x border-slate-300 bg-white text-center text-sm font-bold text-slate-900 outline-none focus:bg-primary-50/50"
                        aria-label={`Quantity of ${productName} - ${pack.pack_name}`}
                      />

                      <button
                        type="button"
                        onClick={() => handleIncrement(pack)}
                        disabled={isCurrentPending}
                        className="flex h-full w-10 items-center justify-center text-slate-700 transition hover:bg-slate-100 active:bg-slate-200 disabled:cursor-not-allowed disabled:text-slate-300 disabled:hover:bg-transparent"
                        aria-label={`Increase quantity of ${productName} - ${pack.pack_name}`}
                      >
                        <Plus className="h-4 w-4" />
                      </button>
                    </div>
                  </div>

                  {/* Tier Action Button */}
                  <div className="flex flex-1 items-center justify-end gap-2">
                    {qty === 0 && isItemInCart ? (
                      <button
                        type="button"
                        onClick={() => handleUpdateSinglePack(pack)}
                        disabled={isCurrentPending}
                        className="flex h-10 items-center gap-1.5 rounded-xl border border-primary-200 bg-primary-50 px-3 text-xs font-bold text-primary-700 transition hover:bg-primary-100 disabled:opacity-50"
                      >
                        {isCurrentPending ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <Trash2 className="h-3.5 w-3.5" />
                        )}
                        Remove from cart
                      </button>
                    ) : qty === 0 ? (
                      <button
                        type="button"
                        onClick={() => handleIncrement(pack)}
                        disabled={isCurrentPending}
                        className="flex h-10 items-center gap-1 rounded-xl border border-slate-200 bg-slate-50 px-3.5 text-xs font-bold text-slate-700 transition hover:border-primary-300 hover:bg-primary-50 hover:text-primary-700 disabled:opacity-50"
                      >
                        <Plus className="h-3.5 w-3.5" />
                        Add pack
                      </button>
                    ) : isItemInCart && !isModified ? (
                      <div className="flex h-10 items-center gap-1.5 rounded-xl bg-emerald-50 px-3.5 text-xs font-bold text-emerald-700">
                        <Check className="h-4 w-4 text-emerald-600" />
                        <span>In cart · {formatInr(lineTotal)}</span>
                      </div>
                    ) : isItemInCart && isModified ? (
                      <button
                        type="button"
                        onClick={() => handleUpdateSinglePack(pack)}
                        disabled={isCurrentPending}
                        className="flex h-10 items-center gap-1.5 rounded-xl bg-primary-600 px-4 text-xs font-bold text-white shadow-sm transition hover:bg-primary-700 disabled:opacity-60"
                      >
                        {isCurrentPending ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <Check className="h-3.5 w-3.5" />
                        )}
                        Update · {formatInr(lineTotal)}
                      </button>
                    ) : (
                      <button
                        type="button"
                        onClick={() => handleAddSinglePack(pack)}
                        disabled={isCurrentPending}
                        className="flex h-10 items-center gap-1.5 rounded-xl bg-primary-600 px-4 text-xs font-bold text-white shadow-sm transition hover:bg-primary-700 disabled:opacity-60"
                      >
                        {isCurrentPending ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <ShoppingCart className="h-3.5 w-3.5" />
                        )}
                        Add to cart · {formatInr(lineTotal)}
                      </button>
                    )}
                  </div>
                </div>

                {/* Inline Error / Success Messages */}
                {packError ? (
                  <p
                    role="alert"
                    className="mt-2.5 flex items-center gap-1 text-[11px] font-semibold text-primary-700"
                  >
                    <AlertCircle className="h-3.5 w-3.5 shrink-0" />
                    {packError}
                  </p>
                ) : null}
                {packSuccessMsg ? (
                  <p
                    role="status"
                    className="mt-2.5 flex items-center gap-1 text-[11px] font-semibold text-emerald-700"
                  >
                    <Check className="h-3.5 w-3.5 shrink-0" />
                    {packSuccessMsg}
                  </p>
                ) : null}
              </div>
            </article>
          );
        })}

        {/* Multi-Pack Batch Order Bar (when multiple tiers are modified/selected) */}
        {modifiedPacks.length > 1 ? (
          <div className="rounded-2xl border border-primary-200 bg-primary-50/70 p-3.5 shadow-sm sm:p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <p className="text-[10px] font-bold uppercase tracking-wider text-primary-700">
                  Multiple packs selected
                </p>
                <p className="mt-0.5 text-xs font-bold text-slate-900 sm:text-sm">
                  {modifiedPacks.map((p) => `${p.pack_name} × ${quantities[p.id]}`).join(', ')}
                </p>
                <p className="mt-0.5 text-[11px] text-slate-500">
                  Total: {totalSelectedPacks} pack(s) · {formatInr(totalSelectedLanded)} (incl. GST)
                </p>
              </div>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={handleAddAllSelected}
                  disabled={isPending}
                  className="flex h-11 items-center gap-2 rounded-xl bg-primary-600 px-4 text-xs font-bold text-white shadow-sm transition hover:bg-primary-700 disabled:opacity-60"
                >
                  {isPending && pendingPackId === 'all' ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <ShoppingCart className="h-4 w-4" />
                  )}
                  Add all selected ({totalSelectedPacks})
                </button>
              </div>
            </div>
          </div>
        ) : null}

        {/* Global Error Banner */}
        {generalError ? (
          <div
            role="alert"
            className="rounded-xl border border-primary-200 bg-primary-50 p-3 text-xs font-medium text-primary-700"
          >
            {generalError}
          </div>
        ) : null}

        {/* Fast Checkout CTA */}
        <button
          type="button"
          onClick={handleBuyNow}
          disabled={isPending}
          className="flex h-11 w-full items-center justify-center gap-2 rounded-xl border border-slate-900 bg-slate-950 text-xs font-bold text-white transition hover:bg-slate-800 disabled:opacity-60"
        >
          {isPending && pendingPackId === 'buynow' ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Zap className="h-4 w-4 text-amber-300" />
          )}
          Buy now with 1-click
        </button>

        {/* Trust & Server-Authoritative Note */}
        <div className="flex items-center justify-center gap-1.5 pt-1 text-[10px] text-slate-400">
          <ShieldCheck className="h-3.5 w-3.5 text-emerald-600" aria-hidden="true" />
          <span>Prices, MOQs, and inventory are verified securely on Maharani Traders servers.</span>
        </div>
      </div>

      {/* Mobile Sticky Cart Summary Bar (appears when retailer has items in cart) */}
      {cartSummary && cartSummary.itemCount > 0 ? (
        <aside
          role="region"
          aria-label="Current cart summary"
          className="fixed inset-x-0 bottom-[calc(4.25rem+env(safe-area-inset-bottom))] z-30 border-t border-slate-200 bg-white/95 px-3 py-2.5 shadow-[0_-8px_30px_rgba(15,23,42,0.12)] backdrop-blur-xl lg:hidden"
        >
          <div className="mx-auto flex max-w-2xl items-center justify-between gap-2">
            <div className="min-w-0">
              <p className="text-[9px] font-bold uppercase tracking-wider text-slate-400">
                Cart: {cartSummary.itemCount} pack{cartSummary.itemCount === 1 ? '' : 's'}
              </p>
              <p className="truncate text-base font-extrabold tracking-tight text-slate-950">
                {formatInr(cartSummary.grandTotal)}
              </p>
              {cartSummary.savings > 0 ? (
                <p className="text-[10px] font-bold text-emerald-700">
                  Saving {formatInr(cartSummary.savings)} vs MRP
                </p>
              ) : null}
            </div>
            <Link
              href="/retailer/cart"
              className="inline-flex h-11 shrink-0 items-center gap-1.5 rounded-xl bg-primary-600 px-4 text-xs font-bold text-white shadow-sm transition hover:bg-primary-700"
            >
              View Cart <ChevronRight className="h-4 w-4" />
            </Link>
          </div>
        </aside>
      ) : null}
    </section>
  );
}
