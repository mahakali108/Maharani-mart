import Link from 'next/link';
import { ArrowDownCircle, BarChart3, BadgePercent, Package, RotateCcw, Search as SearchIcon, Sparkles, Wallet } from 'lucide-react';
import { createClient } from '@/lib/supabase/server';
import { requireUser } from '@/lib/auth/session';
import { getRetailerWalletSummary, formatPaise } from '@/lib/retailer/wallet';
import { BrandCard, type BrandCardData } from '@/components/retailer/brand-card';
import { CategoryCard, type CategoryCardData } from '@/components/retailer/category-card';
import { ProductRail } from '@/components/retailer/product-rail';
import { PromoCarousel } from '@/components/retailer/promo-carousel';
import {
  loadFavoriteIds,
  priceCatalogProducts,
  PRODUCT_CARD_SELECT,
  type CatalogProductRow,
} from '@/lib/retailer/catalog';
import {
  getBuyAgainCards,
  getFrequentlyOrderedCards,
  pickDiscoveryRails,
} from '@/lib/retailer/personalization';

interface BannerRow {
  id: string;
  title: string;
  image_url: string;
  link_url: string | null;
  area_id: string | null;
  starts_at: string | null;
  ends_at: string | null;
}

interface CategoryRow extends CategoryCardData {
  parent_id: string | null;
  products: { count: number }[] | null;
}

interface BrandRow extends BrandCardData {
  products: { count: number }[] | null;
}

interface RetailerRow {
  area_id: string;
}

/**
 * Marketplace discovery for the small retailer. Every card on this page is a
 * real record (active banners, active categories, active brands, active
 * products) and every price is the canonical per-piece rate. There is no
 * invented popularity, no fake stock, no fake review count and no fake offer.
 */
export default async function RetailerHomePage() {
  const user = await requireUser();
  const supabase = createClient();

  const [{ data: retailer }, favoriteIds, walletSummary] = await Promise.all([
    supabase.from('retailers').select('area_id').eq('id', user.id).maybeSingle<RetailerRow>(),
    loadFavoriteIds(supabase, user.id),
    getRetailerWalletSummary(supabase, user.id),
  ]);

  const nowIso = new Date().toISOString();
  const [
    { data: bannerRows },
    { data: categoryData },
    { data: brandData },
    { data: discoveryRows },
    frequentCards,
    buyAgainCards,
  ] = await Promise.all([
    supabase
      .from('banners')
      .select('id, title, image_url, link_url, area_id, starts_at, ends_at')
      .eq('is_active', true)
      .order('sort_order'),
    supabase
      .from('categories')
      .select('id, name, image_url, parent_id, products(count)')
      .eq('is_active', true)
      .order('sort_order')
      .returns<CategoryRow[]>(),
    supabase
      .from('brands')
      .select('id, name, logo_url, products(count)')
      .eq('is_active', true)
      .order('name')
      .returns<BrandRow[]>(),
    supabase
      .from('products')
      .select(PRODUCT_CARD_SELECT)
      .eq('is_active', true)
      .order('created_at', { ascending: false })
      .limit(80)
      .returns<CatalogProductRow[]>(),
    getFrequentlyOrderedCards(supabase, user.id, retailer?.area_id ?? null, favoriteIds, 10),
    getBuyAgainCards(supabase, user.id, retailer?.area_id ?? null, favoriteIds, 10),
  ]);

  const banners = ((bannerRows ?? []) as BannerRow[]).filter((banner) => {
    const areaMatches = !banner.area_id || banner.area_id === retailer?.area_id;
    const hasStarted = !banner.starts_at || banner.starts_at <= nowIso;
    const hasNotEnded = !banner.ends_at || banner.ends_at >= nowIso;
    return areaMatches && hasStarted && hasNotEnded;
  });

  const categories = (categoryData ?? []).map((category) => ({
    ...category,
    productCount: category.products?.[0]?.count ?? 0,
  }));
  const parentCategories = categories.filter((category) => !category.parent_id);
  const homeCategories = (parentCategories.length > 0 ? parentCategories : categories).slice(0, 10);
  const brands = (brandData ?? []).map((brand) => ({
    ...brand,
    productCount: brand.products?.[0]?.count ?? 0,
  }));

  const discoveryCards = await priceCatalogProducts(
    supabase,
    discoveryRows ?? [],
    user.id,
    retailer?.area_id ?? null,
    favoriteIds
  );
  const discovery = pickDiscoveryRails(discoveryCards);
  // Retailers can only access their own order history. Use it for the
  // best-selling rail when present, then fall back to the existing catalog
  // discovery ranking without exposing cross-retailer purchasing data.
  const bestSellingProducts = frequentCards.length > 0 ? frequentCards : discovery.bestPrices;

  return (
    <div className="space-y-5 sm:space-y-7">
      <h1 className="sr-only">Maharani Traders — order everyday products by the piece</h1>

      {/* Credit summary strip — real wallet numbers, one tap to the ledger. */}
      <section
        aria-label="Credit summary"
        className="grid grid-cols-3 divide-x divide-slate-100 rounded-2xl border border-slate-200 bg-white shadow-sm"
      >
        <Link href="/retailer/account/ledger" className="min-w-0 p-3 transition hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-300 sm:p-4">
          <span className="flex items-center gap-1 text-[9px] font-bold uppercase tracking-wider text-slate-400">
            <Wallet className="h-3 w-3 shrink-0 text-slate-400" aria-hidden="true" /> <span className="truncate">Outstanding</span>
          </span>
          <span className="mt-1 block truncate text-sm font-bold tracking-tight text-slate-950 sm:text-base">
            {formatPaise(walletSummary.outstandingPaise)}
          </span>
        </Link>
        <Link href="/retailer/account/ledger" className="min-w-0 p-3 transition hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-300 sm:p-4">
          <span className="flex items-center gap-1 text-[9px] font-bold uppercase tracking-wider text-slate-400">
            <ArrowDownCircle className="h-3 w-3 shrink-0 text-slate-400" aria-hidden="true" /> <span className="truncate">Available credit</span>
          </span>
          <span className="mt-1 block truncate text-sm font-bold tracking-tight text-emerald-700 sm:text-base">
            {walletSummary.hasConfiguredLimit ? formatPaise(walletSummary.availablePaise) : '—'}
          </span>
        </Link>
        <Link href="/retailer/account/ledger" className="min-w-0 p-3 transition hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-300 sm:p-4">
          <span className="flex items-center gap-1 text-[9px] font-bold uppercase tracking-wider text-slate-400">
            <BarChart3 className="h-3 w-3 shrink-0 text-slate-400" aria-hidden="true" /> <span className="truncate">Credit limit</span>
          </span>
          <span className="mt-1 block truncate text-sm font-bold tracking-tight text-slate-950 sm:text-base">
            {walletSummary.hasConfiguredLimit ? formatPaise(walletSummary.creditLimitPaise) : 'Not set'}
          </span>
        </Link>
      </section>

      {/* Quick actions — the four things retailers do most. */}
      <nav aria-label="Quick actions" className="grid grid-cols-4 gap-2">
        <Link href="/retailer/quick-order" className="flex min-w-0 flex-col items-center gap-1.5 rounded-2xl border border-slate-200 bg-white p-2.5 text-center shadow-sm transition hover:border-primary-200 hover:bg-primary-50/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-300">
          <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-amber-50 text-amber-700"><SearchIcon className="h-4 w-4" aria-hidden="true" /></span>
          <span className="w-full truncate text-[9px] font-bold text-slate-700">Quick order</span>
        </Link>
        <Link href="/retailer/orders" className="flex min-w-0 flex-col items-center gap-1.5 rounded-2xl border border-slate-200 bg-white p-2.5 text-center shadow-sm transition hover:border-primary-200 hover:bg-primary-50/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-300">
          <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-blue-50 text-blue-700"><RotateCcw className="h-4 w-4" aria-hidden="true" /></span>
          <span className="w-full truncate text-[9px] font-bold text-slate-700">Reorder</span>
        </Link>
        <Link href="/retailer/schemes" className="flex min-w-0 flex-col items-center gap-1.5 rounded-2xl border border-slate-200 bg-white p-2.5 text-center shadow-sm transition hover:border-primary-200 hover:bg-primary-50/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-300">
          <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-rose-50 text-rose-700"><BadgePercent className="h-4 w-4" aria-hidden="true" /></span>
          <span className="w-full truncate text-[9px] font-bold text-slate-700">Offers</span>
        </Link>
        <Link href="/retailer/reports" className="flex min-w-0 flex-col items-center gap-1.5 rounded-2xl border border-slate-200 bg-white p-2.5 text-center shadow-sm transition hover:border-primary-200 hover:bg-primary-50/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-300">
          <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-emerald-50 text-emerald-700"><BarChart3 className="h-4 w-4" aria-hidden="true" /></span>
          <span className="w-full truncate text-[9px] font-bold text-slate-700">Reports</span>
        </Link>
      </nav>

      {/* Promotional banner carousel — only renders when there is a real active
         banner; the carousel component paints a soft light fallback otherwise. */}
      <PromoCarousel banners={banners} />

      {/* Shop by category — real categories only, soft red/pink accent rail. */}
      <section aria-labelledby="home-categories" className="space-y-3">
        <div className="flex items-end justify-between gap-3 px-0.5">
          <div>
            <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-primary-600">
              Shop by category
            </p>
            <h2 id="home-categories" className="mt-0.5 text-base font-bold tracking-tight text-slate-900 sm:text-lg">
              What are you stocking today?
            </h2>
          </div>
          <Link
            href="/retailer/categories"
            className="shrink-0 text-[11px] font-bold text-primary-600 hover:text-primary-700 sm:text-xs"
          >
            View all
          </Link>
        </div>
        {homeCategories.length > 0 ? (
          <div
            className="scrollbar-none -mx-3 flex snap-x snap-mandatory gap-2.5 overflow-x-auto px-3 pb-1 sm:mx-0 sm:grid sm:grid-cols-5 sm:gap-3 sm:overflow-visible sm:px-0 md:grid-cols-6 lg:grid-cols-8 xl:grid-cols-10"
            role="list"
          >
            {homeCategories.map((category) => (
              <div key={category.id} className="w-[6.5rem] shrink-0 snap-start sm:w-auto" role="listitem">
                <CategoryCard category={category} compact />
              </div>
            ))}
          </div>
        ) : (
          <EmptyState
            icon={SearchIcon}
            title="Categories will appear here"
            body="Your distributor is curating this section. Check back soon."
          />
        )}
      </section>

      {/* Shop by brand — real brands only. */}
      <section aria-labelledby="home-brands" className="space-y-3">
        <div className="flex items-end justify-between gap-3 px-0.5">
          <div>
            <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-primary-600">
              Trusted brands
            </p>
            <h2 id="home-brands" className="mt-0.5 text-base font-bold tracking-tight text-slate-900 sm:text-lg">
              Shop by brand
            </h2>
          </div>
          <Link
            href="/retailer/brands"
            className="shrink-0 text-[11px] font-bold text-primary-600 hover:text-primary-700 sm:text-xs"
          >
            View all
          </Link>
        </div>
        {brands.length > 0 ? (
          <div
            className="scrollbar-none -mx-3 flex snap-x snap-mandatory gap-2.5 overflow-x-auto px-3 pb-1 sm:mx-0 sm:grid sm:grid-cols-4 sm:gap-3 sm:overflow-visible sm:px-0 md:grid-cols-5 lg:grid-cols-6 xl:grid-cols-8"
            role="list"
          >
            {brands.slice(0, 10).map((brand) => (
              <div key={brand.id} className="w-[8.5rem] shrink-0 snap-start sm:w-auto" role="listitem">
                <BrandCard brand={brand} compact />
              </div>
            ))}
          </div>
        ) : (
          <EmptyState
            icon={Sparkles}
            title="Brands will appear here"
            body="New brands join the marketplace regularly — they'll show up here once available."
          />
        )}
      </section>

      {/* Buy again — only if the retailer has real order history. No placeholder. */}
      {buyAgainCards.length > 0 ? (
        <ProductRail
          eyebrow="Reorder in a tap"
          title="Buy again"
          href="/retailer/orders"
          linkLabel="View your orders"
          products={buyAgainCards}
        />
      ) : null}

      <ProductRail
        eyebrow="Chosen for your shelves"
        title="Best selling products"
        href="/retailer/catalog?sort=frequent"
        linkLabel="View products"
        products={bestSellingProducts}
        emptyMessage="Best-selling products will appear here as your marketplace catalog grows."
      />

      <ProductRail
        eyebrow="Fresh on the shelves"
        title="New arrivals"
        href="/retailer/catalog?new=1"
        linkLabel="View new products"
        products={discovery.newArrivals}
        emptyMessage="New launches will appear here."
      />

      <ProductRail
        eyebrow="Value for your shop"
        title="Featured products & offers"
        href="/retailer/catalog?offers=1"
        linkLabel="View offers"
        products={discovery.deals}
        emptyMessage="Featured offers will appear here when they are available."
      />
    </div>
  );
}

/**
 * Reusable empty-state card. Used wherever real data is empty — never as a
 * cover for a placeholder or fake data. Keep it small, light and friendly.
 */
function EmptyState({
  icon: Icon,
  title,
  body,
}: {
  icon: typeof Package;
  title: string;
  body: string;
}) {
  return (
    <div className="flex items-center gap-3 rounded-2xl border border-dashed border-slate-200 bg-white px-4 py-5 text-xs text-slate-500">
      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-slate-50 text-slate-400">
        <Icon className="h-5 w-5" aria-hidden="true" />
      </span>
      <div>
        <p className="text-[12px] font-semibold text-slate-800">{title}</p>
        <p className="mt-0.5 text-[11px] text-slate-500">{body}</p>
      </div>
    </div>
  );
}
