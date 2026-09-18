'use client';

import Link from 'next/link';
import { useMemo, useState } from 'react';
import { ArrowLeft, ChevronRight, Package, Search, Tag } from 'lucide-react';
import { BrandCard } from '@/components/retailer/brand-card';
import { CategoryCard, type CategoryCardData } from '@/components/retailer/category-card';

export interface DirectoryCategory extends CategoryCardData {
  children: CategoryCardData[];
}

export interface DirectoryBrand {
  id: string;
  name: string;
  logo_url: string | null;
  productCount: number;
}

/**
 * Category → brand browsing for the mobile storefront.
 *
 *   Level 1 — the active root categories (image, name, product count).
 *   Level 2 — the brands that ACTUALLY have active products in the selected
 *             category; each one opens the catalog with BOTH filters applied
 *             (`?category=<id>&brand=<id>`), and an "all products in X" shortcut
 *             is always offered for the retailer who does not care about brand.
 *
 * Level 2 is a real URL (`/retailer/categories?category=<id>`), so the phone's
 * back gesture and the in-page "All categories" link both return to level 1,
 * and a deep link (e.g. from a home category tile) opens the right category.
 *
 * Empty states are explicit: a category with no brands and a search with no
 * matches each say what happened instead of rendering an empty panel.
 */
export function CategoryDirectory({
  categories,
  brands = [],
  selectedCategory = null,
  brandsCapped = false,
}: {
  categories: DirectoryCategory[];
  /** Brands available in `selectedCategory` (ignored on level 1). */
  brands?: DirectoryBrand[];
  selectedCategory?: DirectoryCategory | null;
  /** True when the brand scan hit its bound, so counts are a lower bound. */
  brandsCapped?: boolean;
}) {
  const [query, setQuery] = useState('');
  const normalizedQuery = query.trim().toLocaleLowerCase();

  // Both memos run on every render — hook order must not depend on the level.
  const visibleBrands = useMemo(
    () => (normalizedQuery ? brands.filter((brand) => brand.name.toLocaleLowerCase().includes(normalizedQuery)) : brands),
    [brands, normalizedQuery]
  );
  const visibleCategories = useMemo(() => {
    if (!normalizedQuery) return categories;
    return categories.filter((category) => {
      const parentMatches = category.name.toLocaleLowerCase().includes(normalizedQuery);
      const childMatches = category.children.some((child) => child.name.toLocaleLowerCase().includes(normalizedQuery));
      return parentMatches || childMatches;
    });
  }, [categories, normalizedQuery]);

  if (selectedCategory) {
    const children = selectedCategory.children;
    return (
      <div className="min-w-0 space-y-3">
        <Link
          href="/retailer/categories"
          className="inline-flex min-h-11 items-center gap-1.5 rounded-lg text-xs font-semibold text-primary-700 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-300"
        >
          <ArrowLeft className="h-4 w-4" aria-hidden="true" /> All categories
        </Link>

        <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
          <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-primary-600">
            {selectedCategory.productCount != null
              ? `${selectedCategory.productCount} product${selectedCategory.productCount === 1 ? '' : 's'}`
              : 'Category'}
          </p>
          <h1 className="mt-0.5 break-words text-lg font-bold tracking-tight text-slate-950 sm:text-2xl">
            {selectedCategory.name}
          </h1>
          <Link
            href={`/retailer/catalog?category=${selectedCategory.id}`}
            className="mt-3 inline-flex min-h-11 w-full items-center justify-between gap-2 rounded-xl bg-primary-600 px-3.5 text-xs font-semibold text-white transition hover:bg-primary-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-300 sm:w-auto"
          >
            View all products in {selectedCategory.name}
            <ChevronRight className="h-4 w-4" aria-hidden="true" />
          </Link>
        </section>

        {children.length > 0 ? (
          <section className="rounded-2xl border border-slate-200 bg-white p-3 shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
            <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-primary-600">Sub-categories</p>
            <div className="scrollbar-none mt-2 flex gap-2 overflow-x-auto">
              {children.map((child) => (
                <Link
                  key={child.id}
                  href={`/retailer/categories?category=${child.id}`}
                  className="flex shrink-0 items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700 transition hover:border-primary-200 hover:text-primary-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-300"
                >
                  <Tag className="h-3.5 w-3.5 text-primary-500" aria-hidden="true" />
                  {child.name}
                  {child.productCount != null ? (
                    <span className="text-[10px] font-medium text-slate-400">{child.productCount}</span>
                  ) : null}
                </Link>
              ))}
            </div>
          </section>
        ) : null}

        <section className="space-y-3 rounded-2xl border border-slate-200 bg-white p-3 shadow-[0_1px_2px_rgba(15,23,42,0.04)] sm:p-4">
          <div>
            <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-primary-600">Shop by brand</p>
            <h2 className="mt-0.5 text-sm font-bold text-slate-900 sm:text-base">Brands in {selectedCategory.name}</h2>
          </div>

          {brands.length > 0 ? (
            <>
              <label className="relative block">
                <span className="sr-only">Search brands</span>
                <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                <input
                  type="search"
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="Search brands"
                  className="h-11 w-full rounded-xl border border-slate-200 bg-white pl-10 pr-3 text-sm text-slate-900 outline-none placeholder:text-slate-400 focus:border-primary-300 focus:ring-4 focus:ring-primary-50"
                />
              </label>

              {visibleBrands.length > 0 ? (
                <ul className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-4">
                  {visibleBrands.map((brand) => (
                    <li className="min-w-0" key={brand.id}>
                      <BrandCard
                        brand={brand}
                        compact
                        href={`/retailer/catalog?category=${selectedCategory.id}&brand=${brand.id}`}
                      />
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="rounded-xl bg-slate-50 p-3 text-xs text-slate-500">
                  No brand matches “{query.trim()}”. Try a shorter name, or browse every product in this category.
                </p>
              )}

              {brandsCapped ? (
                <p className="text-[11px] leading-4 text-slate-500">
                  Showing the brands found in this category. Counts reflect the products checked so far.
                </p>
              ) : null}
            </>
          ) : (
            <div className="flex flex-col items-start gap-2 rounded-xl border border-dashed border-slate-200 bg-slate-50/60 p-4">
              <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-white text-slate-400 shadow-sm">
                <Package className="h-4 w-4" aria-hidden="true" />
              </span>
              <p className="text-xs font-semibold text-slate-800">No brands in this category yet</p>
              <p className="text-[11px] leading-5 text-slate-500">
                Products in this category are not linked to a brand yet. You can still browse everything in it.
              </p>
              <Link
                href={`/retailer/catalog?category=${selectedCategory.id}`}
                className="inline-flex min-h-11 items-center gap-1.5 rounded text-xs font-semibold text-primary-700 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-300"
              >
                View all products in {selectedCategory.name} <ChevronRight className="h-3.5 w-3.5" aria-hidden="true" />
              </Link>
            </div>
          )}
        </section>
      </div>
    );
  }

  return (
    <div className="min-w-0 space-y-4">
      <label className="relative block">
        <span className="sr-only">Search categories</span>
        <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
        <input
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search categories"
          className="h-11 w-full rounded-xl border border-slate-200 bg-white pl-10 pr-3 text-sm text-slate-900 outline-none placeholder:text-slate-400 focus:border-primary-300 focus:ring-4 focus:ring-primary-50"
        />
      </label>

      {visibleCategories.length > 0 ? (
        // Phones: three compact tiles per row (no stacking, no page growth).
        <ul className="grid grid-cols-3 gap-2.5 sm:grid-cols-2 lg:grid-cols-3">
          {visibleCategories.map((category) => {
            const matchingChildren = normalizedQuery
              ? category.children.filter((child) => child.name.toLocaleLowerCase().includes(normalizedQuery))
              : category.children;
            return (
              <li className="min-w-0" key={category.id}>
                <article className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm sm:rounded-2xl">
                  {/* Tap goes to the brands in this category, not past them. */}
                  <CategoryCard category={category} compact href={`/retailer/categories?category=${category.id}`} />
                  {matchingChildren.length > 0 ? (
                    <div className="scrollbar-none flex gap-1.5 overflow-x-auto border-t border-slate-100 px-2 py-2 sm:flex-wrap sm:overflow-visible">
                      {matchingChildren.slice(0, 8).map((child) => (
                        <Link
                          key={child.id}
                          href={`/retailer/categories?category=${child.id}`}
                          className="shrink-0 rounded-full bg-slate-50 px-2.5 py-1 text-[10px] font-semibold text-slate-600 transition hover:bg-primary-50 hover:text-primary-700"
                        >
                          {child.name}
                          {child.productCount ? ` · ${child.productCount}` : ''}
                        </Link>
                      ))}
                    </div>
                  ) : null}
                </article>
              </li>
            );
          })}
        </ul>
      ) : (
        <div className="rounded-2xl border border-dashed border-slate-200 bg-white px-5 py-14 text-center">
          <p className="text-sm font-bold text-slate-800">No matching category</p>
          <p className="mt-1 text-xs text-slate-500">Try a shorter category name or browse all categories.</p>
        </div>
      )}
    </div>
  );
}
