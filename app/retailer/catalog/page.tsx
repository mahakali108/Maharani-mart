import Link from 'next/link';
import Image from 'next/image';
import {
  Boxes,
  ChevronRight,
  Coffee,
  Cookie,
  LayoutGrid,
  Milk,
  Package,
  Soup,
  Sparkles,
} from 'lucide-react';
import { createClient } from '@/lib/supabase/server';
import { requireUser } from '@/lib/auth/session';
import { AdminEmptyState } from '@/components/admin/empty-state';
import { ProductCard } from '@/components/retailer/product-card';
import { CatalogFilters } from '@/components/retailer/catalog-filters';
import { SearchField } from '@/components/retailer/search-field';
import { cn } from '@/lib/utils/cn';
import {
  loadFavoriteIds,
  priceCatalogProducts,
  PRODUCT_CARD_SELECT,
  type CatalogProductRow,
  type PricedCatalogCard,
} from '@/lib/retailer/catalog';
import {
  catalogHref,
  parseCatalogSort,
  parseOptionalNumber,
  sanitizeSearchTerm,
  type CatalogQuery,
} from '@/lib/retailer/catalog-params';
import { calcDiscountPercent } from '@/lib/retailer/format';
import { getOrderFrequencyMap } from '@/lib/retailer/personalization';

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
  const q = sanitizeSearchTerm(searchParams.q ?? '');
  const categoryId = searchParams.category?.trim() ?? '';
  const brandId = searchParams.brand?.trim() ?? '';
  const sort = parseCatalogSort(searchParams.sort);
  const minPrice = parseOptionalNumber(searchParams.minPrice);
  const maxPrice = parseOptionalNumber(searchParams.maxPrice);
  const minDiscount = parseOptionalNumber(searchParams.discount);
  const maxMoq = parseOptionalNumber(searchParams.maxMoq);
  const onlyFavorites = searchParams.fav === '1';
  const onlyNew = searchParams.new === '1';
  const onlyOffers = searchParams.offers === '1';

  const [{ data: retailer }, { data: categoryData }, { data: brandData }, favoriteIds, frequency] = await Promise.all([
    supabase.from('retailers').select('area_id').eq('id', user.id).maybeSingle<{ area_id: string }>(),
    supabase.from('categories').select('id, name, image_url, parent_id').eq('is_active', true).order('sort_order').returns<CategoryRow[]>(),
    supabase.from('brands').select('id, name').eq('is_active', true).order('name').returns<BrandRow[]>(),
    loadFavoriteIds(supabase, user.id),
    getOrderFrequencyMap(supabase, user.id),
  ]);

  const categories = categoryData ?? [];
  const brands = brandData ?? [];
  const selectedCategory = categories.find((category) => category.id === categoryId) ?? null;
  const selectedBrand = brands.find((brand) => brand.id === brandId) ?? null;
  const childCategories = selectedCategory
    ? categories.filter((category) => category.parent_id === selectedCategory.id)
    : categories.filter((category) => category.parent_id);
  const parentCategories = categories.filter((category) => !category.parent_id);
  const categoryTiles = (parentCategories.length > 0 ? parentCategories : categories).slice(0, 8);

  let matchingBrandIds: string[] = [];
  let matchingCategoryIds: string[] = [];
  if (q) {
    const like = `%${q}%`;
    const [{ data: brandMatches }, { data: categoryMatches }] = await Promise.all([
      supabase.from('brands').select('id').eq('is_active', true).ilike('name', like).returns<{ id: string }[]>(),
      supabase.from('categories').select('id').eq('is_active', true).ilike('name', like).returns<{ id: string }[]>(),
    ]);
    matchingBrandIds = (brandMatches ?? []).map((row) => row.id);
    matchingCategoryIds = (categoryMatches ?? []).map((row) => row.id);
  }

  let query = supabase
    .from('products')
    .select(PRODUCT_CARD_SELECT)
    .eq('is_active', true)
    .order('name');

  if (q) {
    const like = `"%${q}%"`;
    const clauses = [`name.ilike.${like}`];
    if (matchingBrandIds.length > 0) clauses.push(`brand_id.in.(${matchingBrandIds.join(',')})`);
    if (matchingCategoryIds.length > 0) clauses.push(`category_id.in.(${matchingCategoryIds.join(',')})`);
    query = query.or(clauses.join(','));
  }
  if (selectedCategory) {
    const scopedIds = [selectedCategory.id, ...categories.filter((category) => category.parent_id === selectedCategory.id).map((category) => category.id)];
    query = query.in('category_id', scopedIds);
  }
  if (selectedBrand) query = query.eq('brand_id', selectedBrand.id);
  if (onlyNew) query = query.eq('is_new_launch', true);
  if (onlyFavorites && favoriteIds.size > 0) query = query.in('id', [...favoriteIds]);

  const { data: productRows } = onlyFavorites && favoriteIds.size === 0
    ? { data: [] as CatalogProductRow[] }
    : await query.returns<CatalogProductRow[]>();

  let cards: PricedCatalogCard[] = await priceCatalogProducts(
    supabase,
    productRows ?? [],
    user.id,
    retailer?.area_id ?? null,
    favoriteIds,
    frequency
  );

  cards = cards.filter((card) => {
    if (minPrice !== null && (card.fromPrice === null || card.fromPrice < minPrice)) return false;
    if (maxPrice !== null && (card.fromPrice === null || card.fromPrice > maxPrice)) return false;
    if (minDiscount !== null && calcDiscountPercent(card.mrp, card.fromPrice) < minDiscount) return false;
    if (maxMoq !== null && (card.moq ?? 1) > maxMoq) return false;
    if (onlyOffers && !card.hasOffer && calcDiscountPercent(card.mrp, card.fromPrice) <= 0) return false;
    return true;
  });

  cards = [...cards].sort((a, b) => {
    if (sort === 'name') return a.name.localeCompare(b.name);
    if (sort === 'price-low') return (a.fromPrice ?? Number.MAX_SAFE_INTEGER) - (b.fromPrice ?? Number.MAX_SAFE_INTEGER);
    if (sort === 'price-high') return (b.fromPrice ?? -1) - (a.fromPrice ?? -1);
    if (sort === 'discount') return calcDiscountPercent(b.mrp, b.fromPrice) - calcDiscountPercent(a.mrp, a.fromPrice);
    if (sort === 'newest') return +new Date(b.createdAt) - +new Date(a.createdAt);
    if (sort === 'frequent') return b.timesOrdered - a.timesOrdered || Number(b.isNewLaunch) - Number(a.isNewLaunch);
    return Number(b.isNewLaunch) - Number(a.isNewLaunch) || a.name.localeCompare(b.name);
  });

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

  return (
    <div className="space-y-4 sm:space-y-6">
      <div className="flex flex-wrap items-center gap-1.5 text-[11px] font-medium text-slate-500">
        <Link href="/retailer/home" className="hover:text-primary-600">Home</Link>
        <ChevronRight className="h-3 w-3" />
        <Link href="/retailer/catalog" className="hover:text-primary-600">Products</Link>
        {selectedCategory ? (
          <>
            <ChevronRight className="h-3 w-3" />
            <span className="text-slate-800">{selectedCategory.name}</span>
          </>
        ) : null}
      </div>

      <section className="overflow-hidden rounded-2xl bg-gradient-to-r from-slate-950 via-slate-900 to-primary-950 px-4 py-5 text-white shadow-lg sm:px-7 sm:py-7">
        <div className="flex items-center justify-between gap-5">
          <div>
            <p className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-[0.2em] text-amber-300">
              <Sparkles className="h-3.5 w-3.5" /> Wholesale catalog
            </p>
            <h1 className="mt-2 text-xl font-bold sm:text-3xl">
              {selectedCategory?.name ?? selectedBrand?.name ?? (q ? `Results for “${q}”` : 'Everything your shop needs')}
            </h1>
            <p className="mt-1 max-w-xl text-xs leading-5 text-slate-200 sm:text-sm">
              Search by product, brand or category. Your approved retailer prices stay server-side.
            </p>
          </div>
          <LayoutGrid className="hidden h-20 w-20 text-white/10 sm:block" />
        </div>
        <div className="mt-4 max-w-2xl">
          <SearchField initialQuery={q} variant="hero" />
        </div>
      </section>

      <section className="space-y-3 rounded-2xl border border-slate-200 bg-white p-3 shadow-sm sm:p-5">
        <div className="flex items-end justify-between gap-3">
          <div>
            <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-primary-600">Browse the marketplace</p>
            <h2 className="mt-0.5 text-sm font-bold text-slate-900 sm:text-base">Shop by category</h2>
          </div>
          <Link href={catalogHref({ ...filterValues, category: undefined })} className="flex items-center gap-1 text-[10px] font-bold text-primary-600 sm:text-[11px]">
            View all products <ChevronRight className="h-3.5 w-3.5" />
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
                    active ? 'border-primary-600 bg-primary-50 ring-2 ring-primary-100' : 'border-slate-200'
                  )}
                >
                  <div className="relative aspect-[1.25/1] overflow-hidden bg-gradient-to-br from-blue-50 via-white to-slate-100">
                    {category.image_url ? (
                      <Image src={category.image_url} alt="" fill sizes="(max-width: 640px) 45vw, (max-width: 1024px) 22vw, 140px" className="object-cover transition duration-300 group-hover:scale-105" unoptimized />
                    ) : (
                      <span className="flex h-full items-center justify-center text-primary-600">
                        <Icon className="h-8 w-8 transition group-hover:scale-110" />
                      </span>
                    )}
                    {active ? <span className="absolute right-2 top-2 rounded-full bg-primary-600 px-2 py-1 text-[8px] font-bold text-white">Selected</span> : null}
                  </div>
                  <div className="p-2.5 sm:p-3">
                    <p className="truncate text-[11px] font-bold text-slate-800 sm:text-xs">{category.name}</p>
                    <p className="mt-0.5 text-[9px] text-slate-500">Browse products <ChevronRight className="inline h-3 w-3" /></p>
                  </div>
                </Link>
              );
            })}
          </div>
        ) : (
          <p className="rounded-xl bg-slate-50 p-4 text-xs text-slate-500">Categories will appear here as the catalog is updated.</p>
        )}

        <div className="scrollbar-none flex gap-2 overflow-x-auto border-t border-slate-100 pt-3">
          <Link
            href={catalogHref({ ...filterValues, category: undefined })}
            className={cn(
              'flex shrink-0 items-center gap-2 rounded-xl border px-3 py-2 text-xs font-semibold transition',
              !selectedCategory ? 'border-primary-600 bg-primary-50 text-primary-700' : 'border-slate-200 text-slate-600 hover:border-primary-200 hover:text-primary-600'
            )}
          >
            <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-slate-100"><Boxes className="h-4 w-4" /></span>
            All products
          </Link>
          {(selectedCategory && childCategories.length > 0 ? childCategories : categories.filter((category) => !category.parent_id)).map((category, index) => {
            const Icon = CATEGORY_ICONS[index % CATEGORY_ICONS.length] ?? Boxes;
            const active = selectedCategory?.id === category.id;
            return (
              <Link
                key={category.id}
                href={catalogHref({ ...filterValues, category: category.id })}
                className={cn(
                  'flex shrink-0 items-center gap-2 rounded-xl border px-3 py-2 text-xs font-semibold transition',
                  active ? 'border-primary-600 bg-primary-50 text-primary-700' : 'border-slate-200 text-slate-600 hover:border-primary-200 hover:text-primary-600'
                )}
              >
                <span className={cn('flex h-7 w-7 items-center justify-center rounded-lg', active ? 'bg-white' : 'bg-slate-100')}><Icon className="h-4 w-4" /></span>
                {category.name}
              </Link>
            );
          })}
        </div>
      </section>

      <CatalogFilters values={filterValues} categories={categories} brands={brands} resultCount={cards.length} />

      <div className="flex items-end justify-between gap-3">
        <div>
          <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-primary-600">Catalog results</p>
          <h2 className="mt-0.5 text-base font-bold text-slate-900 sm:text-xl">
            {selectedCategory?.name ?? selectedBrand?.name ?? (q ? `Results for “${q}”` : 'All wholesale products')}
          </h2>
        </div>
        <span className="hidden rounded-full bg-blue-50 px-3 py-1.5 text-[10px] font-semibold text-blue-700 sm:inline-flex">Prices for your shop</span>
      </div>

      {cards.length === 0 ? (
        <div className="rounded-2xl border border-slate-200 bg-white">
          <AdminEmptyState
            icon={Package}
            title={q ? 'No products match your search' : 'No products available here yet'}
            body={q ? 'Try a broader product name or brand, or clear a filter.' : 'Your distributor is updating this catalog.'}
          />
          <div className="pb-8 text-center">
            <Link href="/retailer/catalog" className="text-sm font-semibold text-primary-600">Clear filters</Link>
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 sm:gap-4 lg:grid-cols-4 xl:grid-cols-5">
          {cards.map((card) => (
            <ProductCard key={card.id} {...card} />
          ))}
        </div>
      )}
    </div>
  );
}
