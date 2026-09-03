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
import {
  calculateCaseLoosePrice,
  piecePriceFromCase,
  suggestedQuantities,
  type CaseLoosePricing,
  type PricingTier,
} from '@/lib/retailer/case-pricing';
import { CaseLooseLineBreakdown, CaseLoosePriceSchedule } from '@/components/retailer/pricing-schedule';

export interface MultiPricePack {
  id: string;
  pack_name: string;
  units_per_case: number;
  base_price: number;
  ptr: number | null;
  mrp: number | null;
  /** Minimum order quantity in PIECES. */
  moq: number;
  /** GST-inclusive CASE selling price (source of truth). */
  effectivePrice: number;
  casePrice: number;
  /** This exact pack's loose-piece tiers (plus any legacy slab). */
  tiers: PricingTier[];
  /** false = the pack is only sold in whole cases. */
  allowLoosePieces?: boolean;
  /** Pieces already sitting in the cart for this pack. */
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
  /** Pack currently selected via the size/variant switcher (visual highlight only). */
  selectedPackId?: string | null;
}

/**
 * The retailer's quantity + add-to-cart surface for every pack of a product.
 *
 * Quantities are entered in PIECES — 6, 10, 25, 40, 46, 85 — and the price
 * shown for each of them comes from `calculateCaseLoosePrice`, the same pure
 * function the server quote runs before an order is written. Nothing here is a
 * second implementation of the pricing rule, and nothing here is trusted: the
 * action only ever submits (packId, pieces).
 */
export function PackSelector({
  packs,
  gstPercent,
  productName = 'Product',
  cartSummary,
  selectedPackId = null,
}: PackSelectorProps) {
  const router = useRouter();

  // Local quantity in PIECES for every pack (key: pack.id)
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

  // Active pending pack ID ('all' for batch action, 'buynow' for 1-click)
  const [pendingPackId, setPendingPackId] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  // Inline feedback state
  const [packErrors, setPackErrors] = useState<Record<string, string | null>>({});
  const [packSuccess, setPackSuccess] = useState<Record<string, string | null>>({});
  const [generalError, setGeneralError] = useState<string | null>(null);

  /**
   * The ONE pricing call for a pack + quantity. Full cases at the case price,
   * the remainder at its loose tier — including the orderability verdict (MOQ,
   * whole-case-only packs, unpriced loose ranges).
   */
  function pricingFor(pack: MultiPricePack, qty: number): CaseLoosePricing {
    return calculateCaseLoosePrice({
      quantity: qty,
      unitsPerCase: pack.units_per_case,
      casePrice: pack.effectivePrice,
      tiers: pack.tiers,
      gstPercent,
      moq: pack.moq,
      allowLoosePieces: pack.allowLoosePieces !== false,
    });
  }

  // Presentation extras computed from authoritative pack fields only.
  const enrichedPacks = packs.map((pack) => {
    const unitPrice = piecePriceFromCase(pack.effectivePrice, pack.units_per_case);
    const landedPrice = pack.effectivePrice; // GST already included
    const marginPercent = calcRetailerMargin(pack.mrp, unitPrice);
    const savingsPerPack = calcSavings(pack.mrp, unitPrice);
    return { ...pack, unitPrice, landedPrice, marginPercent, savingsPerPack };
  });

  const { bestPackId, savingsVsRef, refPackName } = determineBestValueTier(enrichedPacks);

  function setQuantity(pack: MultiPricePack, next: number) {
    setGeneralError(null);
    setPackErrors((prev) => ({ ...prev, [pack.id]: null }));
    setPackSuccess((prev) => ({ ...prev, [pack.id]: null }));
    setQuantities((prev) => ({ ...prev, [pack.id]: Math.max(0, Math.trunc(next) || 0) }));
  }

  function handleIncrement(pack: MultiPricePack) {
    const current = quantities[pack.id] ?? 0;
    // Stepping up from empty starts at the MOQ (in pieces) — never at a case.
    setQuantity(pack, current === 0 ? Math.max(1, pack.moq) : current + 1);
  }

  function handleDecrement(pack: MultiPricePack) {
    const current = quantities[pack.id] ?? 0;
    if (current <= 0) return;
    // Decrementing from the MOQ clears the line instead of going below it.
    setQuantity(pack, current <= pack.moq ? 0 : current - 1);
  }

  function handleQuantityInput(pack: MultiPricePack, value: string) {
    const parsed = Number.parseInt(value, 10);
    setQuantity(pack, Number.isNaN(parsed) || parsed <= 0 ? 0 : parsed);
  }

  /** Local mirror of the server rule, so the message appears while typing. */
  function localGuard(pack: MultiPricePack, pricing: CaseLoosePricing): string | null {
    if (!pricing.orderable) return pricing.message ?? 'That quantity is not available for this pack.';
    return null;
  }

  function handleAddSinglePack(pack: MultiPricePack) {
    const qty = quantities[pack.id] ?? 0;
    const pricing = pricingFor(pack, qty);
    const guard = localGuard(pack, pricing);
    if (guard) {
      setPackErrors((prev) => ({ ...prev, [pack.id]: guard }));
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
          setPackSuccess((prev) => ({
            ...prev,
            [pack.id]: `Added ${qty} pcs of ${pack.pack_name} to cart`,
          }));
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

  function handleUpdateSinglePack(pack: MultiPricePack) {
    const inCart = inCartMap[pack.id];
    const qty = quantities[pack.id] ?? 0;

    if (qty === 0 && inCart?.cartItemId) {
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

    const guard = localGuard(pack, pricingFor(pack, qty));
    if (guard) {
      setPackErrors((prev) => ({ ...prev, [pack.id]: guard }));
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
            setPackSuccess((prev) => ({ ...prev, [pack.id]: `Updated to ${qty} pcs` }));
            router.refresh();
          }
        } else {
          const result = await addToCartAction(pack.id, qty);
          if ('error' in result) {
            setPackErrors((prev) => ({ ...prev, [pack.id]: result.error ?? 'Could not add to cart.' }));
          } else {
            setInCartMap((prev) => ({ ...prev, [pack.id]: { quantity: qty, cartItemId: null } }));
            setPackSuccess((prev) => ({ ...prev, [pack.id]: `Added ${qty} pcs to cart` }));
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

  const modifiedPacks = enrichedPacks.filter((pack) => {
    const selectedQty = quantities[pack.id] ?? 0;
    const inCartQty = inCartMap[pack.id]?.quantity ?? 0;
    return selectedQty > 0 && selectedQty !== inCartQty;
  });

  const totalSelectedPcs = modifiedPacks.reduce((sum, pack) => sum + (quantities[pack.id] ?? 0), 0);
  const totalSelectedLanded = modifiedPacks.reduce(
    (sum, pack) => sum + pricingFor(pack, quantities[pack.id] ?? 0).total,
    0
  );

  function handleAddAllSelected() {
    if (modifiedPacks.length === 0) return;

    for (const pack of modifiedPacks) {
      const qty = quantities[pack.id] ?? 0;
      const guard = localGuard(pack, pricingFor(pack, qty));
      if (guard) {
        setPackErrors((prev) => ({ ...prev, [pack.id]: guard }));
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
      aria-label="Case and loose piece pricing"
      className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-[0_4px_24px_rgba(15,23,42,0.06)]"
    >
      {/* Section Header */}
      <div className="flex items-center justify-between border-b border-slate-100 bg-slate-50/90 px-4 py-3.5 sm:px-5">
        <div>
          <h2 className="text-sm font-bold tracking-tight text-slate-900 sm:text-base">
            Case price &amp; loose piece price
          </h2>
          <p className="mt-0.5 text-[10px] text-slate-500 sm:text-xs">
            Buy any number of pieces — full cases are billed at the case price, the rest at the loose rate
          </p>
        </div>
        <PackageCheck className="h-5 w-5 text-primary-600" aria-hidden="true" />
      </div>

      {/* Per-pack pricing + quantity rows */}
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
          const isSelectedVariant = pack.id === selectedPackId;
          const pricing = pricingFor(pack, qty);
          const suggestions = suggestedQuantities({
            unitsPerCase: pack.units_per_case,
            moq: pack.moq,
            tiers: pack.tiers,
            allowLoosePieces: pack.allowLoosePieces !== false,
          });

          return (
            <article
              key={pack.id}
              className={`relative overflow-hidden rounded-2xl border transition-all duration-200 ${
                isSelectedVariant
                  ? 'border-slate-900 ring-2 ring-slate-900/70 shadow-sm'
                  : isBestValue
                    ? 'border-primary-500/80 bg-gradient-to-br from-white to-primary-50/30 ring-1 ring-primary-500/30 shadow-sm'
                    : 'border-slate-200 bg-white hover:border-slate-300'
              }`}
            >
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
                {/* Pack name + in-cart badge */}
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <h3 className="text-sm font-bold text-slate-900 sm:text-base">{pack.pack_name}</h3>
                    <p className="mt-0.5 text-[10px] font-medium text-slate-500">
                      {pack.units_per_case} pcs per case · min order {pack.moq} pc{pack.moq === 1 ? '' : 's'}
                      {pack.allowLoosePieces === false ? ' · full cases only' : ''}
                    </p>
                  </div>

                  <div className="flex shrink-0 items-center gap-1.5">
                    {isSelectedVariant ? (
                      <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-slate-900 px-2 py-0.5 text-[10px] font-bold text-white">
                        Viewing this size
                      </span>
                    ) : null}
                    {isItemInCart ? (
                      <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-bold text-emerald-800">
                        <Check className="h-3 w-3" />
                        In cart: {inCart?.quantity} pcs
                      </span>
                    ) : null}
                  </div>
                </div>

                {/* Case price + loose price schedule for THIS variant */}
                <CaseLoosePriceSchedule
                  className="mt-2.5"
                  unitsPerCase={pack.units_per_case}
                  casePrice={pack.effectivePrice}
                  tiers={pack.tiers}
                  allowLoosePieces={pack.allowLoosePieces !== false}
                  gstPercent={gstPercent}
                />

                {/* Retailer economics, per piece, from MRP vs the billed rate */}
                <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px]">
                  <span className="inline-flex items-center gap-1 rounded-md bg-emerald-50 px-1.5 py-0.5 font-bold text-emerald-700">
                    Margin {pack.marginPercent !== null ? formatMargin(pack.marginPercent) : '—'}
                  </span>
                  {pack.mrp ? (
                    <span className="text-slate-400">
                      MRP {formatInr(pack.mrp)}/pc
                      {pack.savingsPerPack > 0 ? (
                        <span className="ml-1 font-semibold text-slate-500">
                          you save {formatInr(pack.savingsPerPack)}/pc
                        </span>
                      ) : null}
                    </span>
                  ) : null}
                </div>

                {/* Quantity in pieces, with shortcuts that stay optional */}
                <div className="mt-3">
                  <div className="flex flex-wrap items-center justify-between gap-2.5">
                    <div className="flex items-center gap-2">
                      <span className="text-[9px] font-bold uppercase tracking-wider text-slate-400">
                        Quantity (pcs)
                      </span>
                      <div
                        className="flex h-10 items-center overflow-hidden rounded-xl border border-slate-300 bg-white shadow-sm"
                        role="group"
                        aria-label={`${productName} - ${pack.pack_name} quantity in pieces`}
                      >
                        <button
                          type="button"
                          onClick={() => handleDecrement(pack)}
                          disabled={qty <= 0 || isCurrentPending}
                          className="flex h-full w-10 items-center justify-center text-slate-700 transition hover:bg-slate-100 active:bg-slate-200 disabled:cursor-not-allowed disabled:text-slate-300 disabled:hover:bg-transparent"
                          aria-label={`Decrease quantity of ${productName} - ${pack.pack_name} by 1 piece`}
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
                          onChange={(event) => handleQuantityInput(pack, event.target.value)}
                          className="no-spinner h-full w-14 border-x border-slate-300 bg-white text-center text-sm font-bold text-slate-900 outline-none focus:bg-primary-50/50"
                          aria-label={`Quantity in pieces of ${productName} - ${pack.pack_name}`}
                        />
                        <button
                          type="button"
                          onClick={() => handleIncrement(pack)}
                          disabled={isCurrentPending}
                          className="flex h-full w-10 items-center justify-center text-slate-700 transition hover:bg-slate-100 active:bg-slate-200 disabled:cursor-not-allowed disabled:text-slate-300 disabled:hover:bg-transparent"
                          aria-label={`Increase quantity of ${productName} - ${pack.pack_name} by 1 piece`}
                        >
                          <Plus className="h-4 w-4" />
                        </button>
                      </div>
                    </div>

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
                          Add pieces
                        </button>
                      ) : isItemInCart && !isModified ? (
                        <div className="flex h-10 items-center gap-1.5 rounded-xl bg-emerald-50 px-3.5 text-xs font-bold text-emerald-700">
                          <Check className="h-4 w-4 text-emerald-600" />
                          <span>In cart · {formatInr(pricing.total)}</span>
                        </div>
                      ) : isItemInCart ? (
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
                          Update · {formatInr(pricing.total)}
                        </button>
                      ) : (
                        <button
                          type="button"
                          onClick={() => handleAddSinglePack(pack)}
                          disabled={isCurrentPending || !pricing.orderable}
                          className="flex h-10 items-center gap-1.5 rounded-xl bg-primary-600 px-4 text-xs font-bold text-white shadow-sm transition hover:bg-primary-700 disabled:opacity-60"
                        >
                          {isCurrentPending ? (
                            <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          ) : (
                            <ShoppingCart className="h-3.5 w-3.5" />
                          )}
                          Add to cart · {formatInr(pricing.total)}
                        </button>
                      )}
                    </div>
                  </div>

                  {/* Quick quantities — a shortcut, never a restriction */}
                  {suggestions.length > 1 ? (
                    <div className="mt-2 flex flex-wrap items-center gap-1.5">
                      <span className="text-[9px] font-semibold uppercase tracking-wide text-slate-400">
                        Quick pick
                      </span>
                      {suggestions.map((value) => {
                        const isCase = value % pack.units_per_case === 0 && value >= pack.units_per_case;
                        const caseCount = value / pack.units_per_case;
                        return (
                          <button
                            key={value}
                            type="button"
                            disabled={isCurrentPending}
                            onClick={() => setQuantity(pack, value)}
                            aria-pressed={qty === value}
                            className={`h-7 rounded-lg border px-2 text-[10px] font-bold transition disabled:opacity-50 ${
                              qty === value
                                ? 'border-slate-900 bg-slate-900 text-white'
                                : 'border-slate-200 bg-white text-slate-600 hover:border-primary-300 hover:text-primary-700'
                            }`}
                          >
                            {isCase ? `${caseCount} Case${caseCount === 1 ? '' : 's'} (${value})` : `${value} pcs`}
                          </button>
                        );
                      })}
                    </div>
                  ) : null}

                  {/* Live case + loose breakdown from the canonical engine */}
                  {qty > 0 ? (
                    <CaseLooseLineBreakdown className="mt-2.5" pricing={pricing} />
                  ) : (
                    <p className="mt-2 text-[10px] text-slate-400">
                      Enter any quantity — the case part is billed at {formatInr(pack.effectivePrice)} per case and
                      any remaining pieces at the loose rate above.
                    </p>
                  )}
                </div>

                {packError ? (
                  <p role="alert" className="mt-2.5 flex items-center gap-1 text-[11px] font-semibold text-primary-700">
                    <AlertCircle className="h-3.5 w-3.5 shrink-0" />
                    {packError}
                  </p>
                ) : null}
                {packSuccessMsg ? (
                  <p role="status" className="mt-2.5 flex items-center gap-1 text-[11px] font-semibold text-emerald-700">
                    <Check className="h-3.5 w-3.5 shrink-0" />
                    {packSuccessMsg}
                  </p>
                ) : null}
              </div>
            </article>
          );
        })}

        {/* Batch order bar for several sizes at once */}
        {modifiedPacks.length > 1 ? (
          <div className="rounded-2xl border border-primary-200 bg-primary-50/70 p-3.5 shadow-sm sm:p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <p className="text-[10px] font-bold uppercase tracking-wider text-primary-700">
                  Multiple sizes selected
                </p>
                <p className="mt-0.5 text-xs font-bold text-slate-900 sm:text-sm">
                  {modifiedPacks.map((p) => `${p.pack_name} × ${quantities[p.id]} pcs`).join(', ')}
                </p>
                <p className="mt-0.5 text-[11px] text-slate-500">
                  Total: {totalSelectedPcs} pcs · {formatInr(totalSelectedLanded)} (incl. GST)
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
                  Add all selected ({totalSelectedPcs} pcs)
                </button>
              </div>
            </div>
          </div>
        ) : null}

        {generalError ? (
          <div
            role="alert"
            className="rounded-xl border border-primary-200 bg-primary-50 p-3 text-xs font-medium text-primary-700"
          >
            {generalError}
          </div>
        ) : null}

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

        <div className="flex items-center justify-center gap-1.5 pt-1 text-[10px] text-slate-400">
          <ShieldCheck className="h-3.5 w-3.5 text-emerald-600" aria-hidden="true" />
          <span>
            Prices, case splits and MOQs are recalculated on Maharani Traders servers before the order is placed.
          </span>
        </div>
      </div>

      {/* Mobile sticky cart summary */}
      {cartSummary && cartSummary.itemCount > 0 ? (
        <aside
          role="region"
          aria-label="Current cart summary"
          className="fixed inset-x-0 bottom-[calc(4.25rem+env(safe-area-inset-bottom))] z-30 border-t border-slate-200 bg-white/95 px-3 py-2.5 shadow-[0_-8px_30px_rgba(15,23,42,0.12)] backdrop-blur-xl lg:hidden"
        >
          <div className="mx-auto flex max-w-2xl items-center justify-between gap-2">
            <div className="min-w-0">
              <p className="text-[9px] font-bold uppercase tracking-wider text-slate-400">
                Cart: {cartSummary.itemCount} item{cartSummary.itemCount === 1 ? '' : 's'}
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
