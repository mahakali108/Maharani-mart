import Link from 'next/link';
import {
  ArrowUpDown,
  Boxes,
  ChevronRight,
  Coffee,
  Cookie,
  LayoutGrid,
  Milk,
  Package,
  Search,
  Soup,
  Sparkles,
} from 'lucide-react';
import { createClient } from '@/lib/supabase/server';
import { requireUser } from '@/lib/auth/session';
import { getProductPriceOverride, resolvePackPrice } from '@/lib/retailer/effective-price';
import { AdminEmptyState } from '@/components/admin/empty-state';
import { ProductCard, type ProductCardProps } from '@/components/retailer/product-card';
import { cn } from '@/lib/utils/cn';

interface CategoryRow {
  id: string;
  name: string;
  image_url: string | null;
}

interface ProductListRow {
  id: string;
  name: string;
  sku_code: string;
  category_id: string | null;
  is_new_launch: boolean;
  brands: { name: string } | null;
  product_images: { image_url: string; sort_order: number }[];
  product_packs: {
    id: string;
    pack_name: string;
    ptr: number | null;
    base_price: number;
    mrp: number | null;
    moq: number;
    is_active: boolean;
    sort_order: number;
  }[];
}

const CATEGORY_ICONS = [Boxes, Cookie, Coffee, Milk, Soup, Package];

function catalogHref({ q, category, sort }: { q?: string; category?: string; sort?: string }) {
  const params = new URLSearchParams();
  if (q) params.set('q', q);
  if (category) params.set('category', category);
  if (sort && sort !== 'recommended') params.set('sort', sort);
  const query = params.toString();
  return `/retailer/catalog${query ? `?${query}` : ''}`;
}

export default async function RetailerCatalogPage({
  searchParams,
}: {
  searchParams: { q?: string; category?: string; sort?: string };
}) {
  const user = await requireUser();
  const supabase = createClient();
  const q = searchParams.q?.trim() ?? '';
  const categoryId = searchParams.category?.trim() ?? '';
  const sort = ['price-low', 'price-high', 'name'].includes(searchParams.sort ?? '')
    ? searchParams.sort!
    : 'recommended';

  const [{ data: retailer }, { data: categoryData }] = await Promise.all([
    supabase
      .from('retailers')
      .select('area_id')
      .eq('id', user.id)
      .maybeSingle<{ area_id: string }>(),
    supabase
      .from('categories')
      .select('id, name, image_url')
      .eq('is_active', true)
      .order('sort_order')
      .returns<CategoryRow[]>(),
  ]);

  const categories = categoryData ?? [];
  const selectedCategory = categories.find((category) => category.id === categoryId) ?? null;

  let query = supabase
    .from('products')
    .select(
      'id, name, sku_code, category_id, is_new_launch, brands ( name ), product_images ( image_url, sort_order ), product_packs ( id, pack_name, ptr, base_price, mrp, moq, is_active, sort_order )'
    )
    .eq('is_active', true)
    .order('name');

  if (q) query = query.or(`name.ilike.%${q}%,sku_code.ilike.%${q}%`);
  if (selectedCategory) query = query.eq('category_id', selectedCategory.id);

  const { data: productRows } = await query.returns<ProductListRow[]>();
  const products = productRows ?? [];
  const overrides = await Promise.all(
    products.map((product) =>
      getProductPriceOverride(supabase, product.id, user.id, retailer?.area_id ?? null)
    )
  );

  const cards: ProductCardProps[] = products
    .map((product, index) => {
      const activePacks = [...product.product_packs]
        .filter((pack) => pack.is_active)
        .sort((a, b) => a.sort_order - b.sort_order);
      const pricedPacks = activePacks.map((pack) => ({
        pack,
        price: resolvePackPrice(pack, overrides[index] ?? null),
      }));
      const bestPack = pricedPacks.sort((a, b) => a.price - b.price)[0] ?? null;
      const sortedImages = [...product.product_images].sort((a, b) => a.sort_order - b.sort_order);

      return {
        id: product.id,
        name: product.name,
        brandName: product.brands?.name,
        imageUrl: sortedImages[0]?.image_url,
        isNewLaunch: product.is_new_launch,
        fromPrice: bestPack?.price ?? null,
        mrp: bestPack?.pack.mrp,
        packName: bestPack?.pack.pack_name,
        moq: bestPack?.pack.moq ?? 1,
        defaultPackId: bestPack?.pack.id ?? null,
      };
    })
    .sort((a, b) => {
      if (sort === 'name') return a.name.localeCompare(b.name);
      if (sort === 'price-low') return (a.fromPrice ?? Number.MAX_SAFE_INTEGER) - (b.fromPrice ?? Number.MAX_SAFE_INTEGER);
      if (sort === 'price-high') return (b.fromPrice ?? -1) - (a.fromPrice ?? -1);
      return Number(b.isNewLaunch) - Number(a.isNewLaunch);
    });

  return (
    <div className="space-y-4 sm:space-y-6">
      <div className="flex flex-wrap items-center gap-1.5 text-[11px] font-medium text-slate-500">
        <Link href="/retailer/home" className="hover:text-primary-600">Home</Link>
        <ChevronRight className="h-3 w-3" />
        <span className="text-slate-800">Products</span>
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
              {selectedCategory?.name ?? (q ? `Results for “${q}”` : 'Everything your shop needs')}
            </h1>
            <p className="mt-1 max-w-xl text-xs leading-5 text-slate-300 sm:text-sm">
              Your approved retailer prices, pack sizes and minimum quantities—all in one place.
            </p>
          </div>
          <LayoutGrid className="hidden h-20 w-20 text-white/10 sm:block" />
        </div>

        <form method="get" className="relative mt-4 max-w-2xl">
          {selectedCategory ? <input type="hidden" name="category" value={selectedCategory.id} /> : null}
          {sort !== 'recommended' ? <input type="hidden" name="sort" value={sort} /> : null}
          <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <input
            name="q"
            defaultValue={q}
            placeholder="Search product name or SKU code"
            className="h-11 w-full rounded-xl border-0 bg-white pl-10 pr-20 text-sm text-slate-900 shadow-sm outline-none placeholder:text-slate-400 focus:ring-2 focus:ring-amber-300"
          />
          <button type="submit" className="absolute right-1.5 top-1.5 h-8 rounded-lg bg-primary-600 px-4 text-xs font-bold text-white">
            Find
          </button>
        </form>
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white p-3 shadow-sm sm:p-4">
        <div className="scrollbar-none flex gap-2 overflow-x-auto">
          <Link
            href={catalogHref({ q, sort })}
            className={cn(
              'flex shrink-0 items-center gap-2 rounded-xl border px-3 py-2 text-xs font-semibold transition',
              !selectedCategory
                ? 'border-primary-600 bg-primary-50 text-primary-700'
                : 'border-slate-200 text-slate-600 hover:border-primary-200 hover:text-primary-600'
            )}
          >
            <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-slate-100">
              <Boxes className="h-4 w-4" />
            </span>
            All products
          </Link>
          {categories.map((category, index) => {
            const Icon = CATEGORY_ICONS[index % CATEGORY_ICONS.length] ?? Boxes;
            const active = selectedCategory?.id === category.id;
            return (
              <Link
                key={category.id}
                href={catalogHref({ q, category: category.id, sort })}
                className={cn(
                  'flex shrink-0 items-center gap-2 rounded-xl border px-3 py-2 text-xs font-semibold transition',
                  active
                    ? 'border-primary-600 bg-primary-50 text-primary-700'
                    : 'border-slate-200 text-slate-600 hover:border-primary-200 hover:text-primary-600'
                )}
              >
                <span className={cn('flex h-7 w-7 items-center justify-center rounded-lg', active ? 'bg-white' : 'bg-slate-100')}>
                  <Icon className="h-4 w-4" />
                </span>
                {category.name}
              </Link>
            );
          })}
        </div>
      </section>

      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="text-base font-bold text-slate-900 sm:text-lg">
            {selectedCategory?.name ?? 'All products'}
          </h2>
          <p className="text-[11px] text-slate-500 sm:text-xs">
            {cards.length} {cards.length === 1 ? 'product' : 'products'} available
          </p>
        </div>
        <form method="get" className="flex items-center gap-1.5">
          {q ? <input type="hidden" name="q" value={q} /> : null}
          {selectedCategory ? <input type="hidden" name="category" value={selectedCategory.id} /> : null}
          <div className="relative">
            <ArrowUpDown className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
            <select
              name="sort"
              defaultValue={sort}
              className="h-10 max-w-[150px] appearance-none rounded-xl border border-slate-200 bg-white pl-8 pr-3 text-[11px] font-semibold text-slate-700 outline-none focus:border-primary-300 sm:max-w-none sm:text-xs"
              aria-label="Sort products"
            >
              <option value="recommended">Recommended</option>
              <option value="price-low">Price: low to high</option>
              <option value="price-high">Price: high to low</option>
              <option value="name">Name: A to Z</option>
            </select>
          </div>
          <button type="submit" className="h-10 rounded-xl bg-slate-900 px-3 text-[10px] font-bold text-white">Apply</button>
        </form>
      </div>

      {cards.length === 0 ? (
        <div className="rounded-2xl border border-slate-200 bg-white">
          <AdminEmptyState
            icon={Package}
            title={q ? 'No products match your search' : 'No products available here yet'}
            body={q ? 'Try a broader product name or clear this category.' : 'Your distributor is updating this catalog.'}
          />
          {(q || selectedCategory) ? (
            <div className="pb-8 text-center">
              <Link href="/retailer/catalog" className="text-sm font-semibold text-primary-600">Clear filters</Link>
            </div>
          ) : null}
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 sm:gap-4 lg:grid-cols-4 xl:grid-cols-5">
          {cards.map((card) => <ProductCard key={card.id} {...card} />)}
        </div>
      )}
    </div>
  );
}
