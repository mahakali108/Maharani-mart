import Link from 'next/link';
import { ArrowRight, TrendingDown } from 'lucide-react';
import { StoredImage } from '@/components/media/stored-image';
import { calcDiscountPercent, calcSavings, formatInr } from '@/lib/retailer/format';
import { tierRangeLabel } from '@/lib/retailer/case-pricing';
import type { ProductCardProps } from '@/components/retailer/product-card';

export function WholesaleDealCard({ product }: { product: ProductCardProps }) {
  const slab = product.bestSlab;
  if (!slab || !product.defaultPackId) return null;
  const href = `/retailer/catalog/${product.defaultPackId}`;
  const discount = calcDiscountPercent(product.mrp, slab.pricePerPiece);
  const extraSaving = calcSavings(product.fromPrice, slab.pricePerPiece);
  return (
    <article className="flex min-w-0 flex-col rounded-2xl border border-emerald-100 bg-white p-4 shadow-sm">
      <div className="flex min-w-0 items-start gap-3">
        <div className="relative h-16 w-16 shrink-0 overflow-hidden rounded-xl bg-slate-50">
          <StoredImage src={product.imageUrl} alt={product.name} fill size="thumb" sizes="64px" className="object-contain p-1.5" />
        </div>
        <div className="min-w-0">
          {product.brandName ? <p className="truncate text-[10px] font-semibold uppercase tracking-wide text-slate-500">{product.brandName}</p> : null}
          <Link href={href} className="rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-action-500"><h3 className="mt-0.5 line-clamp-2 break-words text-xs font-semibold leading-5 text-slate-900">{product.name}</h3></Link>
          {product.packName ? <p className="mt-1 text-[10px] text-slate-500">{product.packName}</p> : null}
        </div>
      </div>
      <p className="mt-4 text-[10px] font-medium text-slate-500">Best available slab rate</p>
      <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1">
        <p className="text-2xl font-bold tracking-tight text-slate-950">{formatInr(slab.pricePerPiece)}<span className="text-[10px] font-normal text-slate-500"> /pc</span></p>
        {discount > 0 ? <span className="rounded-md bg-emerald-50 px-1.5 py-1 text-[10px] font-semibold text-emerald-800">{discount}% off MRP</span> : null}
      </div>
      <p className="mt-1 text-xs font-semibold text-slate-700">At {tierRangeLabel(slab.minQuantity, slab.maxQuantity)}</p>
      <p className="mt-1 text-[10px] text-slate-500">MOQ {product.moq} pcs · GST inclusive</p>
      {extraSaving > 0 ? <p className="mt-2 text-[11px] text-emerald-800">Save an extra {formatInr(extraSaving)} /pc vs the MOQ rate.</p> : null}
      <div className="mt-3 flex items-center gap-1.5 text-[10px] font-semibold text-emerald-700"><TrendingDown className="h-3.5 w-3.5" aria-hidden="true" /> Buy more, save more</div>
      <Link href={href} className="mt-4 flex min-h-11 items-center justify-between gap-2 rounded-xl bg-action-50 px-3 text-xs font-semibold text-action-700 hover:bg-action-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-action-500">View bulk pricing <ArrowRight className="h-4 w-4 shrink-0" aria-hidden="true" /></Link>
    </article>
  );
}
