import Link from 'next/link';
import { CircleAlert, Tag } from 'lucide-react';
import { cn } from '@/lib/utils/cn';
import { formatInr } from '@/lib/retailer/format';
import type { VariantSwitcherItem, VariantSwitcherModel } from '@/lib/retailer/variants';

/**
 * Size / variant selector on the retailer product detail page.
 *
 * Rendered as real <Link> navigation to each variant's own route
 * (/retailer/catalog/<packId>) — NOT local state — so the URL always
 * identifies the selected variant and browser/app back navigation works
 * naturally. It is a Server Component: no client JS, no hydration cost.
 *
 * Each card shows only REAL data supplied by the page:
 *   - the dynamic size label the admin typed (30g / 750g / 2kg / anything)
 *   - the GST-inclusive per-piece selling price derived from the pack's
 *     case_price (the source of truth) and its own units_per_case
 *   - the printed MRP + genuine saving %, only when an MRP exists and is
 *     actually higher
 *   - an OFFER badge only when a real active scheme row exists
 *   - a BEST VALUE badge only when one size is genuinely cheaper per piece
 *   - availability from the pack's `is_active` flag
 *
 * Per-variant STOCK is intentionally not shown: inventory is tracked at
 * product level and is staff-only under RLS (see docs/warehouse-gaps.md).
 *
 * Layout: a horizontally scrolling, snap-aligned row on mobile; a wrapped
 * grid from `sm` up. When a product has many sizes only the first
 * VISIBLE_LIMIT render inline and the rest live in a CSS-only
 * <details> "View all sizes" disclosure — accessible and JS-free.
 */

/** Sizes rendered before the "View all sizes" disclosure kicks in. */
export const VISIBLE_LIMIT = 6;

function VariantCard({ variant }: { variant: VariantSwitcherItem }) {
  const { pricing } = variant;

  const body = (
    <>
      <span className="flex items-center justify-between gap-1">
        <span className="text-sm font-extrabold leading-none">{variant.label}</span>
        {variant.isSelected ? <span className="sr-only">(currently viewing)</span> : null}
      </span>

      {pricing ? (
        <>
          <span
            className={cn(
              'mt-1.5 block text-xs font-bold leading-none',
              variant.isSelected ? 'text-white' : 'text-slate-900'
            )}
          >
            {formatInr(pricing.piecePrice)}
            <span className={cn('font-semibold', variant.isSelected ? 'text-white/80' : 'text-slate-500')}>/pc</span>
          </span>
          {pricing.mrp !== null && pricing.discountPercent > 0 ? (
            <span className="mt-1 flex items-center gap-1 text-[10px] font-semibold leading-none">
              <span className={cn('line-through', variant.isSelected ? 'text-white/70' : 'text-slate-400')}>
                {formatInr(pricing.mrp)}
              </span>
              <span className={variant.isSelected ? 'text-emerald-100' : 'text-emerald-700'}>
                {pricing.discountPercent}% off
              </span>
            </span>
          ) : null}
          <span
            className={cn(
              'mt-1 block text-[10px] font-medium leading-none',
              variant.isSelected ? 'text-white/80' : 'text-slate-500'
            )}
          >
            Quantity tier rates apply
          </span>
        </>
      ) : null}

      {variant.isBestValue || pricing?.hasOffer ? (
        <span className="mt-1.5 flex flex-wrap gap-1">
          {variant.isBestValue ? (
            <span
              className={cn(
                'rounded-md px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide',
                variant.isSelected ? 'bg-white/20 text-white' : 'bg-emerald-50 text-emerald-700'
              )}
            >
              Best value
            </span>
          ) : null}
          {pricing?.hasOffer ? (
            <span
              className={cn(
                'flex items-center gap-0.5 rounded-md px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide',
                variant.isSelected ? 'bg-white/20 text-white' : 'bg-amber-100 text-amber-800'
              )}
            >
              <Tag className="h-2.5 w-2.5" aria-hidden="true" /> Offer
            </span>
          ) : null}
        </span>
      ) : null}
    </>
  );

  if (!variant.isAvailable) {
    return (
      <span
        aria-disabled="true"
        title="This size is currently unavailable"
        className="flex w-[8.5rem] shrink-0 cursor-not-allowed snap-start flex-col rounded-2xl border border-dashed border-slate-200 bg-slate-50 p-2.5 text-slate-400 sm:w-auto"
      >
        <span className="flex items-center justify-between gap-1">
          <span className="text-sm font-extrabold leading-none">{variant.label}</span>
          <CircleAlert className="h-3 w-3" aria-hidden="true" />
        </span>
        <span className="mt-1.5 block text-[10px] font-semibold leading-none">Unavailable</span>
        <span className="sr-only"> — this size cannot be ordered right now</span>
      </span>
    );
  }

  return (
    <Link
      href={variant.href}
      aria-current={variant.isSelected ? 'true' : undefined}
      className={cn(
        'flex w-[8.5rem] shrink-0 snap-start flex-col rounded-2xl border p-2.5 transition sm:w-auto',
        variant.isSelected
          ? 'border-primary-600 bg-primary-600 text-white shadow-sm ring-2 ring-primary-200'
          : 'border-slate-200 bg-white text-slate-700 hover:border-primary-300 hover:bg-primary-50'
      )}
    >
      {body}
    </Link>
  );
}

export function VariantSwitcher({
  model,
  productName,
}: {
  model: VariantSwitcherModel;
  productName: string;
}) {
  if (model.variants.length === 0) return null;

  const inline = model.variants.slice(0, VISIBLE_LIMIT);
  const overflow = model.variants.slice(VISIBLE_LIMIT);

  return (
    <div className="mt-4 border-t border-slate-100 pt-4">
      <div className="flex flex-wrap items-baseline justify-between gap-x-2 gap-y-1">
        <p className="text-[9px] font-bold uppercase tracking-wider text-slate-400">
          Choose size
          <span className="ml-1.5 font-medium normal-case tracking-normal text-slate-400">
            — prices include GST
          </span>
        </p>
        <p className="text-[10px] font-semibold text-slate-400">
          {model.variants.length} size{model.variants.length === 1 ? '' : 's'}
        </p>
      </div>

      <div
        className="-mx-1 mt-2 flex snap-x snap-mandatory gap-2 overflow-x-auto px-1 pb-1 sm:mx-0 sm:grid sm:grid-cols-[repeat(auto-fill,minmax(8.5rem,1fr))] sm:overflow-visible sm:px-0"
        role="group"
        aria-label={`${productName} sizes`}
      >
        {inline.map((variant) => (
          <VariantCard key={variant.packId} variant={variant} />
        ))}
      </div>

      {overflow.length > 0 ? (
        <details className="group mt-2">
          <summary className="inline-flex cursor-pointer list-none items-center gap-1 rounded-xl border border-slate-200 px-3 py-1.5 text-[11px] font-bold text-slate-600 transition hover:border-primary-300 hover:text-primary-700">
            <span className="group-open:hidden">View all {model.variants.length} sizes</span>
            <span className="hidden group-open:inline">Show fewer sizes</span>
          </summary>
          <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-[repeat(auto-fill,minmax(8.5rem,1fr))]">
            {overflow.map((variant) => (
              <VariantCard key={variant.packId} variant={variant} />
            ))}
          </div>
        </details>
      ) : null}

      {!model.hasSelectableVariants ? (
        <p role="status" className="mt-2 text-[11px] font-semibold text-amber-700">
          No sizes are currently available for this product.
        </p>
      ) : null}
    </div>
  );
}
