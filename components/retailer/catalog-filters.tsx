'use client';

import { useState } from 'react';
import Link from 'next/link';
import { SlidersHorizontal, X } from 'lucide-react';
import { catalogHref, type CatalogQuery } from '@/lib/retailer/catalog-params';
import { cn } from '@/lib/utils/cn';

export function CatalogFilters({
  values,
  categories,
  brands,
  resultCount,
}: {
  values: CatalogQuery;
  categories: { id: string; name: string }[];
  brands: { id: string; name: string }[];
  resultCount: number;
}) {
  const [open, setOpen] = useState(false);
  const activeChips: { label: string; href: string }[] = [];
  if (values.q) activeChips.push({ label: `“${values.q}”`, href: catalogHref({ ...values, q: undefined }) });
  if (values.category) {
    const category = categories.find((item) => item.id === values.category);
    if (category) activeChips.push({ label: category.name, href: catalogHref({ ...values, category: undefined }) });
  }
  if (values.brand) {
    const brand = brands.find((item) => item.id === values.brand);
    if (brand) activeChips.push({ label: brand.name, href: catalogHref({ ...values, brand: undefined }) });
  }
  if (values.minPrice || values.maxPrice) {
    activeChips.push({
      label: `₹${values.minPrice || '0'}–₹${values.maxPrice || '∞'}`,
      href: catalogHref({ ...values, minPrice: undefined, maxPrice: undefined }),
    });
  }
  if (values.discount) activeChips.push({ label: `${values.discount}%+ off`, href: catalogHref({ ...values, discount: undefined }) });
  if (values.maxMoq) activeChips.push({ label: `MOQ ≤ ${values.maxMoq}`, href: catalogHref({ ...values, maxMoq: undefined }) });
  if (values.fav === '1') activeChips.push({ label: 'Favourites', href: catalogHref({ ...values, fav: undefined }) });
  if (values.new === '1') activeChips.push({ label: 'New', href: catalogHref({ ...values, new: undefined }) });
  if (values.offers === '1') activeChips.push({ label: 'Offers', href: catalogHref({ ...values, offers: undefined }) });

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <p className="text-xs text-slate-500">
          <span className="font-bold text-slate-800">{resultCount}</span> {resultCount === 1 ? 'product' : 'products'}
        </p>
        <button
          type="button"
          onClick={() => setOpen((current) => !current)}
          className="inline-flex h-9 items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 text-[11px] font-bold text-slate-700 shadow-sm lg:hidden"
        >
          <SlidersHorizontal className="h-3.5 w-3.5" /> Filters
        </button>
      </div>

      {activeChips.length > 0 ? (
        <div className="flex flex-wrap gap-1.5">
          {activeChips.map((chip) => (
            <Link
              key={chip.label}
              href={chip.href}
              className="inline-flex items-center gap-1 rounded-full bg-primary-50 px-2.5 py-1 text-[10px] font-bold text-primary-700"
            >
              {chip.label} <X className="h-3 w-3" />
            </Link>
          ))}
          <Link href="/retailer/catalog" className="text-[10px] font-bold text-slate-500 hover:text-primary-600">
            Clear all
          </Link>
        </div>
      ) : null}

      <form
        method="get"
        className={cn(
          'grid gap-3 rounded-2xl border border-slate-200 bg-white p-3 shadow-sm sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-6',
          open ? 'grid' : 'hidden lg:grid'
        )}
      >
        {values.q ? <input type="hidden" name="q" value={values.q} /> : null}
        <label className="space-y-1 text-[10px] font-bold uppercase tracking-wider text-slate-400">
          Category
          <select name="category" defaultValue={values.category ?? ''} className="h-10 w-full rounded-xl border border-slate-200 bg-white px-3 text-xs font-semibold text-slate-800">
            <option value="">All categories</option>
            {categories.map((category) => (
              <option key={category.id} value={category.id}>
                {category.name}
              </option>
            ))}
          </select>
        </label>
        <label className="space-y-1 text-[10px] font-bold uppercase tracking-wider text-slate-400">
          Brand
          <select name="brand" defaultValue={values.brand ?? ''} className="h-10 w-full rounded-xl border border-slate-200 bg-white px-3 text-xs font-semibold text-slate-800">
            <option value="">All brands</option>
            {brands.map((brand) => (
              <option key={brand.id} value={brand.id}>
                {brand.name}
              </option>
            ))}
          </select>
        </label>
        <label className="space-y-1 text-[10px] font-bold uppercase tracking-wider text-slate-400">
          Min price
          <input name="minPrice" type="number" min={0} step="1" defaultValue={values.minPrice ?? ''} className="h-10 w-full rounded-xl border border-slate-200 px-3 text-xs font-semibold" />
        </label>
        <label className="space-y-1 text-[10px] font-bold uppercase tracking-wider text-slate-400">
          Max price
          <input name="maxPrice" type="number" min={0} step="1" defaultValue={values.maxPrice ?? ''} className="h-10 w-full rounded-xl border border-slate-200 px-3 text-xs font-semibold" />
        </label>
        <label className="space-y-1 text-[10px] font-bold uppercase tracking-wider text-slate-400">
          Discount
          <select name="discount" defaultValue={values.discount ?? ''} className="h-10 w-full rounded-xl border border-slate-200 px-3 text-xs font-semibold">
            <option value="">Any</option>
            <option value="10">10% or more</option>
            <option value="20">20% or more</option>
            <option value="30">30% or more</option>
          </select>
        </label>
        <label className="space-y-1 text-[10px] font-bold uppercase tracking-wider text-slate-400">
          Max MOQ
          <select name="maxMoq" defaultValue={values.maxMoq ?? ''} className="h-10 w-full rounded-xl border border-slate-200 px-3 text-xs font-semibold">
            <option value="">Any</option>
            <option value="1">1</option>
            <option value="2">2 or less</option>
            <option value="5">5 or less</option>
            <option value="10">10 or less</option>
          </select>
        </label>
        <label className="space-y-1 text-[10px] font-bold uppercase tracking-wider text-slate-400">
          Sort
          <select name="sort" defaultValue={values.sort ?? 'recommended'} className="h-10 w-full rounded-xl border border-slate-200 px-3 text-xs font-semibold">
            <option value="recommended">Recommended</option>
            <option value="price-low">Price: low to high</option>
            <option value="price-high">Price: high to low</option>
            <option value="discount">Highest discount</option>
            <option value="newest">Newest</option>
            <option value="frequent">Frequently ordered</option>
            <option value="name">Name: A to Z</option>
          </select>
        </label>
        <div className="flex flex-wrap items-end gap-3 text-[11px] font-semibold text-slate-700 sm:col-span-2">
          <label className="flex items-center gap-1.5">
            <input type="checkbox" name="fav" value="1" defaultChecked={values.fav === '1'} /> Favourites
          </label>
          <label className="flex items-center gap-1.5">
            <input type="checkbox" name="new" value="1" defaultChecked={values.new === '1'} /> New products
          </label>
          <label className="flex items-center gap-1.5">
            <input type="checkbox" name="offers" value="1" defaultChecked={values.offers === '1'} /> Offers
          </label>
          <button type="submit" className="ml-auto h-10 rounded-xl bg-slate-950 px-4 text-[11px] font-bold text-white">
            Apply
          </button>
        </div>
      </form>
    </div>
  );
}
