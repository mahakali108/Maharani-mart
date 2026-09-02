import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';
import { requireUser } from '@/lib/auth/session';
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
 * Marketplace discovery only. Ordering, credit, account and support tools
 * remain intentionally out of this surface and are available from Account.
 */
export default async function RetailerHomePage() {
  const user = await requireUser();
  const supabase = createClient();

  const [{ data: retailer }, favoriteIds] = await Promise.all([
    supabase.from('retailers').select('area_id').eq('id', user.id).maybeSingle<RetailerRow>(),
    loadFavoriteIds(supabase, user.id),
  ]);

  const nowIso = new Date().toISOString();
  const [{ data: bannerRows }, { data: categoryData }, { data: brandData }, { data: discoveryRows }, frequentCards, buyAgainCards] = await Promise.all([
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
    // "Recently ordered" — the retailer's OWN last non-cancelled order, read
    // through their RLS-scoped session. getBuyAgainCards re-resolves today's
    // price for every product, so nothing here carries a stale amount, and it
    // returns [] when the shop has no order history yet (the rail then simply
    // does not render — no placeholder products are ever invented).
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
    <div className="space-y-7 sm:space-y-10">
      <h1 className="sr-only">Maharani Traders wholesale marketplace</h1>

      <PromoCarousel banners={banners} />

      <section aria-labelledby="home-categories" className="space-y-3">
        <div className="flex items-end justify-between gap-3">
          <div>
            <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-primary-600">Browse the marketplace</p>
            <h2 id="home-categories" className="mt-0.5 text-base font-bold tracking-tight text-slate-900 sm:text-xl">Shop by category</h2>
          </div>
          <Link href="/retailer/categories" className="shrink-0 text-[11px] font-bold text-primary-600 hover:text-primary-700 sm:text-xs">
            View all
          </Link>
        </div>
        {homeCategories.length > 0 ? (
          <div className="scrollbar-none -mx-3 flex gap-3 overflow-x-auto px-3 pb-1 sm:mx-0 sm:grid sm:grid-cols-5 sm:gap-4 sm:overflow-visible sm:px-0 lg:grid-cols-8 xl:grid-cols-10">
            {homeCategories.map((category) => (
              <div key={category.id} className="w-[6.75rem] shrink-0 sm:w-auto">
                <CategoryCard category={category} compact />
              </div>
            ))}
          </div>
        ) : (
          <div className="rounded-2xl border border-dashed border-slate-200 bg-white px-4 py-8 text-center text-xs text-slate-500">
            Categories will appear here when the catalog is ready.
          </div>
        )}
      </section>

      <section aria-labelledby="home-brands" className="space-y-3">
        <div className="flex items-end justify-between gap-3">
          <div>
            <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-primary-600">Trusted FMCG partners</p>
            <h2 id="home-brands" className="mt-0.5 text-base font-bold tracking-tight text-slate-900 sm:text-xl">Shop by brand</h2>
          </div>
          <Link href="/retailer/brands" className="shrink-0 text-[11px] font-bold text-primary-600 hover:text-primary-700 sm:text-xs">
            View all
          </Link>
        </div>
        {brands.length > 0 ? (
          <div className="scrollbar-none -mx-3 flex gap-3 overflow-x-auto px-3 pb-1 sm:mx-0 sm:grid sm:grid-cols-4 sm:gap-4 sm:overflow-visible sm:px-0 lg:grid-cols-6 xl:grid-cols-8">
            {brands.slice(0, 10).map((brand) => (
              <div key={brand.id} className="w-[8.75rem] shrink-0 sm:w-auto">
                <BrandCard brand={brand} compact />
              </div>
            ))}
          </div>
        ) : (
          <div className="rounded-2xl border border-dashed border-slate-200 bg-white px-4 py-8 text-center text-xs text-slate-500">
            Brands will appear here when products are added.
          </div>
        )}
      </section>

      {buyAgainCards.length > 0 ? (
        <ProductRail
          eyebrow="From your last order"
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
