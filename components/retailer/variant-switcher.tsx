import Link from 'next/link';
import { CircleAlert } from 'lucide-react';
import { cn } from '@/lib/utils/cn';
import type { VariantSwitcherModel } from '@/lib/retailer/variants';

/**
 * Size / variant switcher on the retailer product detail page.
 *
 * Rendered as real <Link> navigation to each variant's own route
 * (/retailer/catalog/<packId>) — NOT local state — so the URL always
 * identifies the selected variant and browser back works naturally.
 *
 * Only variants that exist and are active are navigable. An inactive
 * variant (only ever visible to staff; retailer RLS hides it entirely)
 * renders as a clearly disabled "Unavailable" pill — availability is
 * never faked, and the server still re-validates every purchase.
 */
export function VariantSwitcher({
  model,
  productName,
}: {
  model: VariantSwitcherModel;
  productName: string;
}) {
  if (model.variants.length === 0) return null;

  return (
    <div className="mt-4 border-t border-slate-100 pt-4">
      <p className="flex items-center gap-1.5 text-[9px] font-bold uppercase tracking-wider text-slate-400">
        Size / Variant
        <span className="font-medium normal-case tracking-normal text-slate-400">— pick a size to view it</span>
      </p>
      <div className="mt-2 flex flex-wrap items-center gap-2" role="group" aria-label={`${productName} sizes`}>
        {model.variants.map((variant) =>
          variant.isAvailable ? (
            <Link
              key={variant.packId}
              href={variant.href}
              aria-current={variant.isSelected ? 'true' : undefined}
              className={cn(
                'flex h-9 min-w-[3.25rem] items-center justify-center rounded-xl border px-3.5 text-xs font-bold transition',
                variant.isSelected
                  ? 'border-primary-600 bg-primary-600 text-white shadow-sm'
                  : 'border-slate-200 bg-white text-slate-700 hover:border-primary-300 hover:bg-primary-50 hover:text-primary-700'
              )}
            >
              {variant.label}
              {variant.isSelected ? <span className="sr-only"> (currently viewing)</span> : null}
            </Link>
          ) : (
            <span
              key={variant.packId}
              aria-disabled="true"
              title="This size is currently unavailable"
              className="flex h-9 min-w-[3.25rem] cursor-not-allowed items-center justify-center gap-1 rounded-xl border border-dashed border-slate-200 bg-slate-50 px-3.5 text-xs font-semibold text-slate-400"
            >
              {variant.label}
              <CircleAlert className="h-3 w-3" aria-hidden="true" />
              <span className="sr-only"> — unavailable</span>
            </span>
          )
        )}
      </div>
      {!model.hasSelectableVariants ? (
        <p role="status" className="mt-2 text-[11px] font-semibold text-amber-700">
          No sizes are currently available for this product.
        </p>
      ) : null}
    </div>
  );
}
