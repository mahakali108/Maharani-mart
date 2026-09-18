import Link from 'next/link';
import {
  Boxes,
  ChevronRight,
  Coffee,
  Cookie,
  Milk,
  Package,
  Soup,
  Sparkles,
  Tag,
} from 'lucide-react';
import { createClient } from '@/lib/supabase/server';
import { requireUser } from '@/lib/auth/session';
import { AdminEmptyState } from '@/components/admin/empty-state';
import { CatalogFeed } from '@/components/retailer/catalog-feed';
import { CatalogFilters } from '@/components/retailer/catalog-filters';
import { SearchField } from '@/components/retailer/search-field';
import { StoredImage } from '@/components/media/stored-image';
import { cn } from '@/lib/utils/cn';
import { loadCatalogFeed } from '@/lib/retailer/catalog-feed';
import {
  CATALOG_MAX_ROWS,
  catalogFeedKey,
  catalogHref,
  catalogOffsetFromPage,
  parseCatalogPage,
  parseCatalogSort,
  sanitizeSearchTerm,
  type CatalogQuery,
} from '@/lib/retailer/catalog-params';
import { categoryScopeIds, loadCategoryBrandCounts, orderBrandsByCount } from '@/lib/retailer/catalog-taxonomy';

const CATEGORY_ICONS = [Boxes, Cookie, Coffee, Milk, Soup, Package];

export default async function RetailerCatalogPage({
  searchParams,
}: {
  searchParams: CatalogQuery;
}) {
  const user = await requireUser();
  const supabase = createClient();
  const q = sanitizeSearchTerm(searchParams.q ?? '');
  const sort = parseCatalogSort(searchParams.sort);
  const onlyFavorites = searchParams.fav === '1';
  const onlyNew = searchParams.new === '1';
  const onlyOffers = searchParams.offers === '1';

  // Legacy `?page=` deep links (nothing emits them any more — the list is
  // continuous now) are honoured as the batch they always meant.
  const legacyOffset = searchParams.page ? catalogOffsetFromPage(parseCatalogPage(searchParams.page)) : 0;

  /**
   * One authoritative read powers the first batch. Every later batch is
   * produced by the SAME loader through /api/retailer/catalog, so filters,
   * sort, retailer pricing, availability, MOQ and RLS cannot drift between
   * what the server rendered and what gets appended.
   */
  const feed = await loadCatalogFeed({
    supabase,
    retailerId: user.id,
    query: searchParams,
    offset: legacyOffset,
  });

  const categories = feed.categories;
  const selectedCategory = categories.find((category) => category.id === searchParams.category?.trim()) ?? null;
  const selectedBrand = feed.brands.find((brand) => brand.id === searchParams.brand?.trim()) ?? null;
  const childCategories = selectedCategory
    ? categories.filter((category) => category.parent_id === selectedCategory.id)
    : categories.filter((category) => category.parent_id);
  const parentCategories = categories.filter((category) => !category.parent_id);
  const categoryTiles = (parentCategories.length > 0 ? parentCategories : categories).slice(0, 8);

  /**
   * Brand options follow the selected category, so the retailer is never shown
   * brands that have nothing in the aisle they are browsing. The selected brand
   * is always kept: hiding the active filter would be worse than showing it.
   */
  let brandOptions = feed.brands;
  let brandCounts = new Map<string, number>();
  if (selectedCategory) {
    const scoped = categoryScopeIds(categories, selectedCategory.id);
    brandCounts = (await loadCategoryBrandCounts(supabase, scoped)).counts;
    const scopedBrands = feed.brands.filter((brand) => brandCounts.has(brand.id));
    brandOptions = selectedBrand && !brandCounts.has(selectedBrand.id)
      ? [...scopedBrands, selectedBrand]
      : scopedBrands;
  }

  const resultCount = feed.total;
  const filterValues: CatalogQuery = {
    q: q || undefined,
    category: selectedCategory?.id,
    brand: selectedBrand?.id,
    sort,
    minPrice: searchParams.minPrice,
    maxPrice: searchParams.maxPrice,
    discount: searchParams.discount,
    maxMoq: searchParams.maxMoq,
    fav: onlyFavorites ? '1' : undefined,
    new: onlyNew ? '1' : undefined,
    offers: onlyOffers ? '1' : undefined,
  };

  // Identity of this result set: the client remounts onto a new first batch
  // whenever the filters/sort change, and resumes the same feed otherwise.
  const feedKey = catalogFeedKey(filterValues);

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
        {selectedBrand ? (
          <>
            <ChevronRight className="h-3 w-3" />
            <span className="text-slate-800">{selectedBrand.name}</span>
          </>
        ) : null}
      </div>

      <section className="overflow-hidden rounded-2xl border border-slate-200 bg-gradient-to-br from-primary-50 via-white to-rose-50/50 shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
        <div className="flex flex-col gap-3 p-4 sm:gap-4 sm:p-6">
          <div className="flex items-center gap-3">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary-600 text-white shadow-sm">
              <Sparkles className="h-5 w-5" aria-hidden="true" />
            </span>
            <div className="min-w-0">
              <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-primary-600">
                Maharani Traders
              </p>
              <h1 className="mt-0.5 text-lg font-bold tracking-tight text-slate-900 sm:text-2xl">
                {selectedCategory?.name ?? selectedBrand?.name ?? (q ? `Results for “${q}”` : 'All products')}
              </h1>
              <p className="mt-0.5 text-[11px] leading-5 text-slate-600 sm:text-sm">
                Search by product, brand, category or size. Your prices are calculated per piece, with GST included.
              </p>
            </div>
          </div>
          <div className="lg:max-w-2xl">
            <SearchField initialQuery={q} variant="hero" />
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
          // Phones: one compact horizontal rail (no stacking, no page growth).
          // Tablet/desktop: the existing grid.
          <div className="scrollbar-none -mx-1 flex snap-x gap-2 overflow-x-auto px-1 pb-1 sm:mx-0 sm:grid sm:grid-cols-4 sm:gap-3 sm:overflow-visible sm:px-0 sm:pb-0 lg:grid-cols-8">
            {categoryTiles.map((category, index) => {
              const Icon = CATEGORY_ICONS[index % CATEGORY_ICONS.length] ?? Boxes;
              const active = selectedCategory?.id === category.id;
              return (
                <Link
                  key={category.id}
                  href={catalogHref({ ...filterValues, category: category.id })}
                  className={cn(
                    'group w-[5.75rem] shrink-0 snap-start overflow-hidden rounded-xl border bg-slate-50 transition hover:-translate-y-0.5 hover:border-primary-300 hover:shadow-md sm:w-auto sm:rounded-2xl',
                    active
                      ? 'border-primary-600 bg-primary-50 ring-2 ring-primary-100'
                      : 'border-slate-200'
                  )}
                >
                  <div className="relative aspect-[1.25/1] overflow-hidden bg-slate-50">
                    <StoredImage
                      src={category.image_url}
                      alt=""
                      fill
                      sizes="(max-width: 640px) 92px, (max-width: 1024px) 22vw, 140px"
                      fallback={
                        <span className="flex h-full items-center justify-center text-primary-500">
                          <Icon className="h-8 w-8 transition group-hover:scale-110" aria-hidden="true" />
                        </span>
                      }
                      className="object-cover transition duration-300 group-hover:scale-105"
                    />
                    {active ? (
                      <span className="absolute right-2 top-2 rounded-full bg-primary-600 px-2 py-1 text-[8px] font-bold text-white">
                        Selected
                      </span>
                    ) : null}
                  </div>
                  <div className="p-2 sm:p-3">
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

        {/* Sub-categories and root categories as chips. On phones the rail above
            already lists the root categories, so this row only appears once a
            category is selected (where it earns its height). */}
        <div
          className={cn(
            'scrollbar-none gap-2 overflow-x-auto border-t border-slate-100 pt-3',
            selectedCategory ? 'flex' : 'hidden sm:flex'
          )}
        >
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

        {/* Brands that actually exist in the selected category — the same
            category → brand drill-down the categories page offers. */}
        {selectedCategory && brandOptions.length > 0 ? (
          <div className="scrollbar-none flex gap-2 overflow-x-auto border-t border-slate-100 pt-3">
            <Link
              href={catalogHref({ ...filterValues, brand: undefined })}
              className={cn(
                'flex shrink-0 items-center gap-1.5 rounded-xl border px-3 py-2 text-xs font-semibold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-300',
                !selectedBrand
                  ? 'border-primary-600 bg-primary-50 text-primary-700'
                  : 'border-slate-200 text-slate-600 hover:border-primary-200 hover:text-primary-600'
              )}
            >
              <Tag className="h-3.5 w-3.5" aria-hidden="true" /> All brands
            </Link>
            {orderBrandsByCount(brandOptions, brandCounts).map(({ brand, count }) => {
              const active = selectedBrand?.id === brand.id;
              return (
                <Link
                  key={brand.id}
                  href={catalogHref({ ...filterValues, brand: brand.id })}
                  className={cn(
                    'flex shrink-0 items-center gap-1.5 rounded-xl border px-3 py-2 text-xs font-semibold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-300',
                    active
                      ? 'border-primary-600 bg-primary-50 text-primary-700'
                      : 'border-slate-200 text-slate-600 hover:border-primary-200 hover:text-primary-600'
                  )}
                >
                  {brand.name}
                  <span className="text-[10px] font-medium text-slate-400">{count}</span>
                </Link>
              );
            })}
          </div>
        ) : null}
      </section>

      <CatalogFilters values={filterValues} categories={categories} brands={brandOptions} resultCount={resultCount} />

      <div className="flex items-end justify-between gap-3 px-0.5">
        <div>
          <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-primary-600">Catalog results</p>
          <h2 className="mt-0.5 text-base font-bold text-slate-900 sm:text-xl">
            {selectedCategory?.name ?? selectedBrand?.name ?? (q ? `Results for “${q}”` : 'All products')}
          </h2>
          <p className="mt-0.5 text-[11px] text-slate-500">
            {resultCount} product{resultCount === 1 ? '' : 's'} · prices per piece, GST included
          </p>
        </div>
      </div>

      {feed.workingSetCapped ? (
        <p className="rounded-xl border border-amber-200 bg-amber-50 px-3.5 py-2.5 text-[11px] leading-4 text-amber-800">
          Showing the first <span className="font-bold">{CATALOG_MAX_ROWS}</span> products that match, ranked by your
          price filter. Narrow the search or pick a category to see the rest.
        </p>
      ) : null}

      {feed.cards.length === 0 ? (
        <div className="rounded-2xl border border-slate-200 bg-white">
          <AdminEmptyState
            icon={Package}
            title={q ? 'No products match your search' : 'No products available here yet'}
            body={
              q
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
        // Continuous browsing: the first batch below is what the server already
        // rendered; scrolling appends more. No page numbers, no Next button.
        <CatalogFeed
          key={feedKey}
          query={filterValues}
          initial={{
            cards: feed.cards,
            total: feed.total,
            offset: feed.offset,
            limit: feed.limit,
            nextOffset: feed.nextOffset,
            hasMore: feed.hasMore,
            workingSetCapped: feed.workingSetCapped,
            feedCapped: feed.feedCapped,
          }}
        />
      )}
    </div>
  );
}
