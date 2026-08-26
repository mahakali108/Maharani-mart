'use client';

import Link from 'next/link';
import { useMemo, useState } from 'react';
import { Search } from 'lucide-react';
import { CategoryCard, type CategoryCardData } from '@/components/retailer/category-card';

export interface DirectoryCategory extends CategoryCardData {
  children: CategoryCardData[];
}

export function CategoryDirectory({ categories }: { categories: DirectoryCategory[] }) {
  const [query, setQuery] = useState('');
  const normalizedQuery = query.trim().toLocaleLowerCase();
  const visibleCategories = useMemo(() => {
    if (!normalizedQuery) return categories;
    return categories.filter((category) => {
      const parentMatches = category.name.toLocaleLowerCase().includes(normalizedQuery);
      const childMatches = category.children.some((child) => child.name.toLocaleLowerCase().includes(normalizedQuery));
      return parentMatches || childMatches;
    });
  }, [categories, normalizedQuery]);

  return (
    <>
      <label className="relative block">
        <span className="sr-only">Search categories</span>
        <Search className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
        <input
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search categories"
          className="h-11 w-full rounded-xl border border-slate-200 bg-white pl-11 pr-4 text-sm text-slate-900 outline-none placeholder:text-slate-400 focus:border-primary-300 focus:ring-4 focus:ring-primary-50"
        />
      </label>

      {visibleCategories.length > 0 ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {visibleCategories.map((category) => {
            const matchingChildren = normalizedQuery
              ? category.children.filter((child) => child.name.toLocaleLowerCase().includes(normalizedQuery))
              : category.children;
            return (
              <article key={category.id} className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
                <CategoryCard category={category} />
                {matchingChildren.length > 0 ? (
                  <div className="flex flex-wrap gap-1.5 border-t border-slate-100 px-3 py-3">
                    {matchingChildren.slice(0, 8).map((child) => (
                      <Link
                        key={child.id}
                        href={`/retailer/catalog?category=${child.id}`}
                        className="rounded-full bg-slate-50 px-2.5 py-1 text-[10px] font-semibold text-slate-600 transition hover:bg-primary-50 hover:text-primary-700"
                      >
                        {child.name}
                        {child.productCount ? ` · ${child.productCount}` : ''}
                      </Link>
                    ))}
                  </div>
                ) : null}
              </article>
            );
          })}
        </div>
      ) : (
        <div className="rounded-2xl border border-dashed border-slate-200 bg-white px-5 py-14 text-center">
          <p className="text-sm font-bold text-slate-800">No matching category</p>
          <p className="mt-1 text-xs text-slate-500">Try a shorter category name or browse all categories.</p>
        </div>
      )}
    </>
  );
}
