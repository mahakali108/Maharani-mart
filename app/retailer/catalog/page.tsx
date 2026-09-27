import Link from 'next/link';
import Image from 'next/image';
import { Boxes, ChevronRight, Coffee, Cookie, Milk, Package, Soup, Sparkles } from 'lucide-react';
import { createClient } from '@/lib/supabase/server';
import { requireUser } from '@/lib/auth/session';
import { AdminEmptyState } from '@/components/admin/empty-state';
import { CompareGrid } from '@/components/retailer/compare-grid';
import { CatalogFilters } from '@/components/retailer/catalog-filters';
import { SearchField } from '@/components/retailer/search-field';
import { cn } from '@/lib/utils/cn';
import {
  loadCatalogBatch,
  type CatalogBrand,
  type CatalogCategory,
  type CatalogFilters as CatalogFilterValues,
} from '@/lib/retailer/catalog-batches';
import type { PricedCatalogCard } from '@/lib/retailer/catalog';
import {
  CATALOG_MAX_ROWS,
  catalogHref,
  parseCatalogSort,
  parseOptionalNumber,
  sanitizeSearchTerm,
  type CatalogQuery,
} from '@/lib/retailer/catalog-params';
import { readCursor } from '@/lib/infinite-scroll/keyset';

interface CategoryRow {
  id: string;
  name: string;
  image_url: string | null;
  parent_id: string | null;
}

interface BrandRow {
  id: string;
  name: string;
}

const CATEGORY_ICONS = [Boxes, Cookie, Coffee, Milk, Soup, Package];

export default async function RetailerCatalogPage({
  searchParams,
}: {
  searchParams: CatalogQuery;
}) {
  const user = await requireUser();
  const supabase = createClient();

  const filters: CatalogFilterValues = {
    q: sanitizeSearchTerm(searchParams.q ?? ''),
    categoryId: searchParams.category?.trim() ?? '',
    brandId: searchParams.brand?.trim() ?? '',
    sort: parseCatalogSort(searchParams.sort),
    minPrice: parseOptionalNumber(searchParams.minPrice),
    maxPrice: parseOptionalNumber(searchParams.maxPrice),
    minDiscount: parseOptionalNumber(searchParams.discount),
    maxMoq: parseOptionalNumber(searchParams.maxMoq),
    onlyFavorites: searchParams.fav === '1',
    onlyNew: searchParams.new === '1',
    onlyOffers: searchParams.offers === '1',
  };

  const [
    { data: retailer },
    { data: categoryData },
    { data: brandData },
  ] = await Promise.all([
    supabase.from('retailers').select('area_id').eq('id', user.id).maybeSingle<{ area_id: string }>(),
    supabase.from('categories').select('id, name, image_url, parent_id').eq('is_active', true).order('sort_order').returns<CategoryRow[]>(),
    supabase.from('brands').select('id, name').eq('is_active', true).order('name').returns<BrandRow[]>(),
  ]);

  const categories = categoryData ?? [];
  const brands = brandData ?? [];
  const selectedCategory = categories.find((category) => category.id === filters.categoryId) ?? null;
  const selectedBrand = brands.find((brand) => brand.id === filters.brandId) ?? null;
  const childCategories = selectedCategory
    ? categories.filter((category) => category.parent_id === selectedCategory.id)
    : categories.filter((category) => category.parent_id);
  const parentCategories = categories.filter((category) => !category.parent_id);
  const categoryTiles = (parentCategories.length > 0 ? parentCategories : categories).slice(0, 8);

  const firstBatch = await loadCatalogBatch(
    supabase,
    { userId: user.id, areaId: retailer?.area_id ?? null },
    filters,
    categories,
    brands,
    null
  );
  const cards = firstBatch.cards;
  const resultCount = firstBatch.resultCount;
  const resultCapped = firstBatch.resultCapped;

  const filterValues: CatalogQuery = {
    q: filters.q || undefined,
    category: selectedCategory?.id,
    brand: selectedBrand?.id,
    sort: filters.sort,
    minPrice: searchParams.minPrice,
    maxPrice: searchParams.maxPrice,
    discount: searchParams.discount,
    maxMoq: searchParams.maxMoq,
    fav: filters.onlyFavorites ? '1' : undefined,
    new: filters.onlyNew ? '1' : undefined,
    offers: filters.onlyOffers ? '1' : undefined,
  };

  /**
   * Server Action for the batches after the first. Filters, search and sort
   * ride along in React's encrypted bound arguments, so scrolling can never
   * quietly swap them for another query — and RLS stays the last word on which
   * products this retailer may see.
   */
  async function loadMoreCatalog(
    cursor: string | null
  ): Promise<{ items: PricedCatalogCard[]; nextCursor: string | null }> {
    'use server';
    const caller = await requireUser();
    const client = createClient();
    const [{ data: shopper }, { data: cats }, { data: brandRows }] = await Promise.all([
      client.from('retailers').select('area_id').eq('id', caller.id).maybeSingle<{ area_id: string }>(),
      client.from('categories').select('id, name, parent_id').eq('is_active', true).returns<CatalogCategory[]>(),
      client.from('brands').select('id, name').eq('is_active', true).returns<CatalogBrand[]>(),
    ]);
    const batch = await loadCatalogBatch(
      client,
      { userId: caller.id, areaId: shopper?.area_id ?? null },
      filters,
      cats ?? [],
      brandRows ?? [],
      readCursor(cursor)
    );
    return { items: batch.cards, nextCursor: batch.nextCursor };
  }

  return (
    <div className="space-y-4 sm:space-y-6">
      <div className="flex flex-wrap items-center gap-1.5 text-[11px] font-medium text-slate-500">
        <Link href="/retailer/home" className="hover:text-primary-600">
          Home
        </Link>
        <ChevronRight className="h-3 w-3" />
        <Link href="/retailer/catalog" className="hover:text-primary-600">
          Products
        </Link>
        {selectedCategory ? (
          <>
            <ChevronRight className="h-3 w-3" />
            <span className="text-slate-800">{selectedCategory.name}</span>
          </>
        ) : null}
      </div>

      <section className="overflow-hidden rounded-2xl border border-slate-200 bg-gradient-to-br from-primary-50 via-white to-rose-50/50 shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
        <div className="flex flex-col gap-4 p-4 sm:p-6">
          <div className="flex items-center gap-3">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary-600 text-white shadow-sm">
              <Sparkles className="h-5 w-5" aria-hidden="true" />
            </span>
            <div className="min-w-0">
              <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-primary-600">
                Maharani Traders
              </p>
              <h1 className="mt-0.5 text-lg font-bold tracking-tight text-slate-900 sm:text-2xl">
                {selectedCategory?.name ?? selectedBrand?.name ?? (filters.q ? `Results for “${filters.q}”` : 'All products')}
              </h1>
              <p className="mt-0.5 text-[11px] leading-5 text-slate-600 sm:text-sm">
                Search by product, brand, category or size. Your prices are calculated per piece, with GST included.
              </p>
            </div>
          </div>
          <div className="lg:max-w-2xl">
            <SearchField initialQuery={filters.q} variant="hero" />
          </div>
        </div>
      </section>

      <section className="space-y-3 rounded-2xl border border-slate-200 bg-white p-3 shadow-[0_1px_2px_rgba(15,23,42,0.04)] sm:p-5">
        <div className="flex items-end justify-between gap-3">
          <div>
            <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-primary-600">
              Browse the catalog
            </p>
            <h2 className="mt-0.5 text-sm font-bold text-slate-900 sm:text-base">Shop by category</h2>
          </div>
          <Link
            href={catalogHref({ ...filterValues, category: undefined })}
            className="flex items-center gap-1 text-[10px] font-bold text-primary-600 sm:text-[11px]"
          >
            View all products <ChevronRight className="h-3.5 w-3.5" aria-hidden="true" />
          </Link>
        </div>
        {categoryTiles.length > 0 ? (
          <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4 sm:gap-3 lg:grid-cols-8">
            {categoryTiles.map((category, index) => {
              const Icon = CATEGORY_ICONS[index % CATEGORY_ICONS.length] ?? Boxes;
              const active = selectedCategory?.id === category.id;
              return (
                <Link
                  key={category.id}
                  href={catalogHref({ ...filterValues, category: category.id })}
                  className={cn(
                    'group overflow-hidden rounded-xl border bg-slate-50 transition hover:-translate-y-0.5 hover:border-primary-300 hover:shadow-md sm:rounded-2xl',
                    active
                      ? 'border-primary-600 bg-primary-50 ring-2 ring-primary-100'
                      : 'border-slate-200'
                  )}
                >
                  <div className="relative aspect-[1.25/1] overflow-hidden bg-slate-50">
                    {category.image_url ? (
                      <Image
                        src={category.image_url}
                        alt=""
                        fill
                        sizes="(max-width: 640px) 45vw, (max-width: 1024px) 22vw, 140px"
                        className="object-cover transition duration-300 group-hover:scale-105"
                        unoptimized
                      />
                    ) : (
                      <span className="flex h-full items-center justify-center text-primary-500">
                        <Icon className="h-8 w-8 transition group-hover:scale-110" aria-hidden="true" />
                      </span>
                    )}
                    {active ? (
                      <span className="absolute right-2 top-2 rounded-full bg-primary-600 px-2 py-1 text-[8px] font-bold text-white">
                        Selected
                      </span>
                    ) : null}
                  </div>
                  <div className="p-2.5 sm:p-3">
                    <p className="truncate text-[11px] font-bold text-slate-800 sm:text-xs">{category.name}</p>
                    <p className="mt-0.5 text-[9px] text-slate-500">
                      Browse products <ChevronRight className="inline h-3 w-3" aria-hidden="true" />
                    </p>
                  </div>
                </Link>
              );
            })}
          </div>
        ) : (
          <p className="rounded-xl bg-slate-50 p-4 text-xs text-slate-500">
            Categories will appear here as the catalog is updated.
          </p>
        )}

        <div className="scrollbar-none flex gap-2 overflow-x-auto border-t border-slate-100 pt-3">
          <Link
            href={catalogHref({ ...filterValues, category: undefined })}
            className={cn(
              'flex shrink-0 items-center gap-2 rounded-xl border px-3 py-2 text-xs font-semibold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-300',
              !selectedCategory
                ? 'border-primary-600 bg-primary-50 text-primary-700'
                : 'border-slate-200 text-slate-600 hover:border-primary-200 hover:text-primary-600'
            )}
          >
            <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-slate-100">
              <Boxes className="h-4 w-4" aria-hidden="true" />
            </span>
            All products
          </Link>
          {(selectedCategory && childCategories.length > 0
            ? childCategories
            : categories.filter((category) => !category.parent_id)
          ).map((category, index) => {
            const Icon = CATEGORY_ICONS[index % CATEGORY_ICONS.length] ?? Boxes;
            const active = selectedCategory?.id === category.id;
            return (
              <Link
                key={category.id}
                href={catalogHref({ ...filterValues, category: category.id })}
                className={cn(
                  'flex shrink-0 items-center gap-2 rounded-xl border px-3 py-2 text-xs font-semibold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-300',
                  active
                    ? 'border-primary-600 bg-primary-50 text-primary-700'
                    : 'border-slate-200 text-slate-600 hover:border-primary-200 hover:text-primary-600'
                )}
              >
                <span
                  className={cn(
                    'flex h-7 w-7 items-center justify-center rounded-lg',
                    active ? 'bg-white' : 'bg-slate-100'
                  )}
                >
                  <Icon className="h-4 w-4" aria-hidden="true" />
                </span>
                {category.name}
              </Link>
            );
          })}
        </div>
      </section>

      <CatalogFilters values={filterValues} categories={categories} brands={brands} resultCount={resultCount} />

      <div className="flex items-end justify-between gap-3 px-0.5">
        <div>
          <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-primary-600">Catalog results</p>
          <h2 className="mt-0.5 text-base font-bold text-slate-900 sm:text-xl">
            {selectedCategory?.name ?? selectedBrand?.name ?? (filters.q ? `Results for “${filters.q}”` : 'All products')}
          </h2>
          <p className="mt-0.5 text-[11px] text-slate-500">
            {resultCount} product{resultCount === 1 ? '' : 's'} · prices per piece, GST included
          </p>
        </div>
      </div>

      {resultCapped ? (
        <p className="rounded-xl border border-amber-200 bg-amber-50 px-3.5 py-2.5 text-[11px] leading-4 text-amber-800">
          Showing the first <span className="font-bold">{CATALOG_MAX_ROWS}</span> products that match, ranked by your
          price filter. Narrow the search or pick a category to see the rest.
        </p>
      ) : null}

      {cards.length === 0 ? (
        <div className="rounded-2xl border border-slate-200 bg-white">
          <AdminEmptyState
            icon={Package}
            title={filters.q ? 'No products match your search' : 'No products available here yet'}
            body={
              filters.q
                ? 'Try a broader product name, brand, category or pack size, or clear a filter.'
                : 'Your distributor is updating this catalog.'
            }
          />
          <div className="pb-8 text-center">
            <Link href="/retailer/catalog" className="text-sm font-semibold text-primary-600">
              Clear filters
            </Link>
          </div>
        </div>
      ) : (
        <>
          <CompareGrid
            cards={cards}
            loader={loadMoreCatalog}
            initialCursor={firstBatch.nextCursor}
            initialHasMore={Boolean(firstBatch.nextCursor)}
            resetKey={catalogHref(filterValues)}
          />
        </>
      )}
    </div>
  );
}
