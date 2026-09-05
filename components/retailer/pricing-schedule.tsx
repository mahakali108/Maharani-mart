import { Tag } from 'lucide-react';
import {
  maxLooseQuantity,
  resolveLooseTierSet,
  tierRangeLabel,
  type PricingTier,
} from '@/lib/retailer/case-pricing';
import type { RetailerPiecePricing } from '@/lib/retailer/retailer-pricing';
import { formatInr } from '@/lib/retailer/format';
import { cn } from '@/lib/utils/cn';

/**
 * Retailer-facing piece pricing presentation for the small-retailer B2B model.
 *
 * The retailer buys PIECES. These components render ONLY what the canonical
 * retailer engine already computed (`lib/retailer/retailer-pricing.ts`) — they
 * restate no arithmetic, so the number a retailer reads on the product page, in
 * the cart, at checkout and on the invoice is by construction the number the
 * server will bill. They are free of client state and of the `use client`
 * directive, so the same file serves both server components (product page, cart,
 * checkout) and client components (the quantity selector).
 *
 * No case price, no supplier cost, no units-per-case buying requirement and no
 * internal pack identifier is ever rendered here — those belong to the admin /
 * warehouse internal model only.
 */

const money = (value: number) => formatInr(value);

/**
 * The retailer's piece-price discount schedule, e.g.
 *
 *   1–6 pcs   → ₹30.00/pc
 *   7–12 pcs  → ₹28.00/pc
 *   13–20 pcs → ₹27.00/pc
 *   21–79 pcs → ₹26.00/pc
 *
 * Rendering every slab the admin configured means the retailer can read the
 * exact per-piece rate they will be charged for any quantity before they add it.
 */
export function RetailerPriceSchedule({
  tiers,
  unitsPerCase,
  gstPercent,
  className,
}: {
  tiers?: PricingTier[] | null;
  unitsPerCase: number;
  gstPercent?: number;
  className?: string;
}) {
  const loose = resolveLooseTierSet(tiers, unitsPerCase).tiers;
  const looseCeiling = maxLooseQuantity(unitsPerCase);
  const gstNote = gstPercent !== null && gstPercent !== undefined ? `GST ${gstPercent}% already included` : null;

  return (
    <div className={cn('rounded-xl border border-slate-200 bg-white p-3', className)}>
      <p className="flex items-center gap-1.5 text-[9px] font-bold uppercase tracking-wider text-slate-500">
        <Tag className="h-3 w-3 text-primary-600" aria-hidden="true" /> Piece price · GST inclusive
      </p>
      {loose.length > 0 ? (
        <ul className="mt-1.5 space-y-1" aria-label="Piece price per quantity">
          {loose.map((tier) => (
            <li
              key={tier.id ?? tier.min_quantity}
              className="flex items-baseline justify-between gap-2 text-[11px]"
            >
              <span className="font-semibold text-slate-600">{tierRangeLabel(tier.min_quantity, tier.max_quantity)}</span>
              <span className="font-bold text-slate-900">{money(tier.price_per_piece)}/pc</span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-1 text-[11px] font-semibold text-slate-700">
          {looseCeiling > 0 ? 'Enter a quantity to see your piece rate.' : 'This size is available to order by the piece.'}
        </p>
      )}
      {gstNote ? <p className="mt-1.5 text-[10px] text-slate-400">{gstNote}</p> : null}
    </div>
  );
}

/**
 * The line breakdown the cart and product page show while the retailer is
 * choosing a quantity, e.g.
 *
 *   12 pcs × ₹28.00
 *   = ₹336.00   (quantity tier 7–12 pcs)
 */
export function RetailerLineBreakdown({
  pricing,
  className,
  showSummary = true,
}: {
  pricing: RetailerPiecePricing;
  className?: string;
  showSummary?: boolean;
}) {
  const label = pricing.tier ? tierRangeLabel(pricing.tier.min_quantity, pricing.tier.max_quantity) : null;

  return (
    <div className={cn('rounded-xl bg-slate-50 px-3 py-2.5', className)}>
      <p className="text-[9px] font-bold uppercase tracking-wider text-slate-400">Piece price</p>
      <ul className="mt-1 space-y-0.5 text-[11px] font-semibold text-slate-700">
        <li className="flex items-baseline justify-between gap-2">
          <span>
            {pricing.quantity} pc{pricing.quantity === 1 ? '' : 's'} × {money(pricing.unitPrice)}
          </span>
          <span className="text-slate-900">{money(pricing.lineTotal)}</span>
        </li>
      </ul>
      {pricing.orderable && showSummary && label ? (
        <p className="mt-0.5 text-right text-[10px] font-bold text-slate-500">Tier: {label}</p>
      ) : null}
      {pricing.orderable ? (
        <p className="mt-1.5 flex items-baseline justify-between gap-2 border-t border-slate-200 pt-1.5 text-xs font-black text-slate-950">
          <span>Total (incl. GST)</span>
          <span>{money(pricing.lineTotal)}</span>
        </p>
      ) : null}
    </div>
  );
}
