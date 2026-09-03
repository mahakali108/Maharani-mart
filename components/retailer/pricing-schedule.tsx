import { Package, Layers } from 'lucide-react';
import {
  inclusiveMaxQuantity,
  maxLooseQuantity,
  piecePriceFromCase,
  resolveLooseTierSet,
  type CaseLoosePricing,
  type PricingTier,
} from '@/lib/retailer/case-pricing';
import { formatInr } from '@/lib/retailer/format';
import { cn } from '@/lib/utils/cn';

/**
 * Retailer-facing price presentation for the case + loose-piece model.
 *
 * These components render ONLY what the canonical engine already computed
 * (`lib/retailer/case-pricing`) — they restate no arithmetic, so the number a
 * retailer reads on the product page, in the cart, at checkout and on the
 * invoice is by construction the number the server will bill. They are free of
 * client state and of the `use client` directive, so the same file serves both
 * server components (product page, cart, checkout) and client components
 * (the quantity selector).
 */

/** "₹1,000.00" style money formatting, overridable for compact layouts. */
const money = (value: number) => formatInr(value);

export function CaseLoosePriceSchedule({
  unitsPerCase,
  casePrice,
  tiers,
  allowLoosePieces = true,
  gstPercent,
  className,
}: {
  unitsPerCase: number;
  casePrice: number;
  tiers?: PricingTier[] | null;
  allowLoosePieces?: boolean;
  gstPercent?: number;
  className?: string;
}) {
  const loose = resolveLooseTierSet(tiers, unitsPerCase).tiers;
  const looseCeiling = maxLooseQuantity(unitsPerCase);
  const gstNote =
    gstPercent !== null && gstPercent !== undefined
      ? `GST ${gstPercent}% already included — never added at checkout`
      : null;

  return (
    <div className={cn('grid gap-2.5 sm:grid-cols-2', className)}>
      {/* CASE PRICE — the source of truth for anything that fills a case */}
      <div className="rounded-xl border border-slate-200 bg-white p-3">
        <p className="flex items-center gap-1.5 text-[9px] font-bold uppercase tracking-wider text-slate-500">
          <Package className="h-3 w-3 text-primary-600" aria-hidden="true" /> Case price
        </p>
        <p className="mt-1 text-[11px] font-semibold text-slate-600">
          {unitsPerCase} pcs / case
        </p>
        <p className="text-lg font-black leading-tight tracking-tight text-slate-950">{money(casePrice)}</p>
        <p className="text-[10px] font-medium text-slate-500">per full case</p>
        {unitsPerCase > 1 ? (
          <p className="mt-1 text-[10px] text-slate-400">
            Best per-piece rate: {money(piecePriceFromCase(casePrice, unitsPerCase))}/pc
          </p>
        ) : null}
      </div>

      {/* LOOSE PRICE — a separate, independently priced system */}
      <div className="rounded-xl border border-slate-200 bg-white p-3">
        <p className="flex items-center gap-1.5 text-[9px] font-bold uppercase tracking-wider text-slate-500">
          <Layers className="h-3 w-3 text-primary-600" aria-hidden="true" /> Loose price
        </p>
        {allowLoosePieces === false ? (
          <p className="mt-1 text-[11px] font-semibold text-slate-700">
            This pack ships in full cases of {unitsPerCase} pcs only.
          </p>
        ) : loose.length > 0 ? (
          <ul className="mt-1 space-y-1" aria-label="Loose piece price per quantity">
            {loose.map((tier) => (
              <li key={tier.id ?? tier.min_quantity} className="flex items-baseline justify-between gap-2 text-[11px]">
                <span className="font-semibold text-slate-600">
                  {tier.min_quantity}
                  {inclusiveMaxQuantity(tier.max_quantity, unitsPerCase) > tier.min_quantity
                    ? `–${inclusiveMaxQuantity(tier.max_quantity, unitsPerCase)}`
                    : ''}{' '}
                  pcs
                </span>
                <span className="font-bold text-slate-900">{money(tier.price_per_piece)}/pc</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-1 text-[11px] font-semibold text-slate-700">
            {looseCeiling > 0
              ? `1–${looseCeiling} pcs at ${money(piecePriceFromCase(casePrice, unitsPerCase))}/pc`
              : 'Single-piece pack — every order is a full case.'}
          </p>
        )}
        {allowLoosePieces !== false && looseCeiling > 0 ? (
          <p className="mt-1.5 text-[10px] font-semibold text-emerald-700">
            Order just 1 pc if you need 1 pc — a full case is not compulsory.
            <span className="mt-0.5 block text-[10px] font-medium text-emerald-800/80" lang="hi">
              6 pcs bhi le sakte hain — full case lena compulsory nahi hai.
            </span>
          </p>
        ) : null}
      </div>

      {gstNote ? <p className="text-[10px] text-slate-500 sm:col-span-2">{gstNote}</p> : null}
    </div>
  );
}

/**
 * The line breakdown the cart and product page show while the retailer is
 * choosing a quantity, e.g.
 *
 *   1 Case × ₹1,000.00
 * + 6 pcs × ₹30.00
 * = ₹1,180.00   (Cases: 1 · Loose: 6)
 */
export function CaseLooseLineBreakdown({
  pricing,
  className,
  showSummary = true,
}: {
  pricing: CaseLoosePricing;
  className?: string;
  showSummary?: boolean;
}) {
  const hasCase = pricing.fullCases > 0;
  const hasLoose = pricing.looseQuantity > 0 && pricing.looseUnitPrice !== null;
  const wholeCaseOnly = !pricing.orderable && pricing.looseQuantity > 0 && pricing.looseUnitPrice === null;

  return (
    <div className={cn('rounded-xl bg-slate-50 px-3 py-2.5', className)}>
      <p className="text-[9px] font-bold uppercase tracking-wider text-slate-400">How this is priced</p>
      <ul className="mt-1 space-y-0.5 text-[11px] font-semibold text-slate-700">
        {hasCase ? (
          <li className="flex items-baseline justify-between gap-2">
            <span>
              {pricing.fullCases} Case{pricing.fullCases === 1 ? '' : 's'} × {money(pricing.casePrice)}
            </span>
            <span className="text-slate-900">{money(pricing.caseSubtotal)}</span>
          </li>
        ) : null}
        {hasLoose ? (
          <li className="flex items-baseline justify-between gap-2">
            <span>
              {pricing.looseQuantity} loose pcs × {money(pricing.looseUnitPrice ?? 0)}
            </span>
            <span className="text-slate-900">{money(pricing.looseSubtotal)}</span>
          </li>
        ) : null}
      </ul>
      {wholeCaseOnly ? (
        <p className="mt-1 text-[10px] font-semibold text-amber-700">
          {pricing.looseQuantity} pcs cannot be billed on its own — this pack is sold in full cases of{' '}
          {pricing.unitsPerCase} pcs.
        </p>
      ) : null}
      {pricing.orderable ? (
        <p className="mt-1.5 flex items-baseline justify-between gap-2 border-t border-slate-200 pt-1.5 text-xs font-black text-slate-950">
          <span>Total</span>
          <span>{money(pricing.total)}</span>
        </p>
      ) : null}
      {showSummary && pricing.orderable ? (
        <p className="mt-0.5 text-right text-[10px] font-bold text-slate-500">
          Cases: {pricing.fullCases} · Loose: {pricing.looseQuantity}
        </p>
      ) : null}
    </div>
  );
}
