'use client';

import { useMemo, useState } from 'react';
import { Search } from 'lucide-react';
import { BrandCard, type BrandCardData } from '@/components/retailer/brand-card';

export function BrandDirectory({ brands }: { brands: BrandCardData[] }) {
  const [query, setQuery] = useState('');
  const normalizedQuery = query.trim().toLocaleLowerCase();
  const visibleBrands = useMemo(
    () => brands.filter((brand) => brand.name.toLocaleLowerCase().includes(normalizedQuery)),
    [brands, normalizedQuery]
  );

  return (
    <>
      <label className="relative block">
        <span className="sr-only">Search brands</span>
        <Search className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
        <input
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search brands"
          className="h-11 w-full rounded-xl border border-slate-200 bg-white pl-11 pr-4 text-sm text-slate-900 outline-none placeholder:text-slate-400 focus:border-primary-300 focus:ring-4 focus:ring-primary-50"
        />
      </label>

      {visibleBrands.length > 0 ? (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {visibleBrands.map((brand) => <BrandCard key={brand.id} brand={brand} />)}
        </div>
      ) : (
        <div className="rounded-2xl border border-dashed border-slate-200 bg-white px-5 py-14 text-center">
          <p className="text-sm font-bold text-slate-800">No matching brand</p>
          <p className="mt-1 text-xs text-slate-500">Try a shorter brand name or browse all brands.</p>
        </div>
      )}
    </>
  );
}
