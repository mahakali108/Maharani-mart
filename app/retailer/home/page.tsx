import Link from 'next/link';
import Image from 'next/image';
import {
  ArrowRight,
  BadgeIndianRupee,
  Boxes,
  ChevronRight,
  ClipboardList,
  Coffee,
  Cookie,
  LayoutGrid,
  Milk,
  PackageCheck,
  RotateCcw,
  Search,
  ShoppingCart,
  ShieldCheck,
  Sparkles,
  Store,
  Tag,
  Truck,
  WalletCards,
} from 'lucide-react';
import { createClient } from '@/lib/supabase/server';
import { requireUser } from '@/lib/auth/session';
import { CreditSummary } from '@/components/retailer/credit-summary';
import { FrequentProductCard } from '@/components/retailer/frequent-product-card';
import { ProductRail } from '@/components/retailer/product-rail';
import { PromoBanner } from '@/components/retailer/promo-banner';
import { RecentlyViewedRail } from '@/components/retailer/recently-viewed';
import { SectionHeading } from '@/components/retailer/section-heading';
import { loadFavoriteIds, priceCatalogProducts, PRODUCT_CARD_SELECT, type CatalogProductRow } from '@/lib/retailer/catalog';
import { greetingForHour } from '@/lib/retailer/format';
import {
  getBuyAgainCards,
  getFrequentlyOrderedCards,
  OPEN_ORDER_STATUSES,
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

interface CategoryRow {
  id: string;
  name: string;
  image_url: string | null;
  parent_id: string | null;
  products: { count: number }[] | null;
}

interface OrderRow {
  id: string;
  order_number: string;
  status: string;
  grand_total: number;
  placed_at: string;
}

interface RetailerRow {
  shop_name: string;
  area_id: string;
  credit_limit: number;
  outstanding_balance: number;
}

interface SchemeRow {
  id: string;
  name: string;
  description: string | null;
  is_festival: boolean;
  ends_at: string;
}

const CATEGORY_ICONS = [Boxes, Cookie, Coffee, Milk, Store, Tag];

const ORDER_STATUS_STYLES: Record<string, string> = {
  pending: 'bg-amber-50 text-amber-700 ring-amber-200',
  confirmed: 'bg-blue-50 text-blue-700 ring-blue-200',
  processing: 'bg-blue-50 text-blue-700 ring-blue-200',
  packed: 'bg-violet-50 text-violet-700 ring-violet-200',
  dispatched: 'bg-cyan-50 text-cyan-700 ring-cyan-200',
  delivered: 'bg-emerald-50 text-emerald-700 ring-emerald-200',
  cancelled: 'bg-primary-50 text-primary-700 ring-primary-200',
  returned: 'bg-primary-50 text-primary-700 ring-primary-200',
};

function OrderListRow({ order }: { order: OrderRow }) {
  return (
    <Link href={`/retailer/orders/${order.id}`} className="group flex items-center gap-3 border-b border-slate-100 py-3.5 last:border-0">
      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-slate-100 text-slate-500 transition group-hover:bg-primary-50 group-hover:text-primary-600">
        {order.status === 'dispatched' ? <Truck className="h-4 w-4" /> : <PackageCheck className="h-4 w-4" />}
      </span>
      <div className="min-w-0 flex-1">
        <p className="truncate font-mono text-xs font-bold text-slate-800">{order.order_number}</p>
        <p className="mt-0.5 text-[10px] text-slate-500">
          {new Date(order.placed_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}
        </p>
      </div>
      <div className="shrink-0 text-right">
        <p className="text-xs font-bold text-slate-900">₹{order.grand_total.toFixed(2)}</p>
        <span className={`mt-1 inline-flex rounded-full px-2 py-0.5 text-[9px] font-bold capitalize ring-1 ring-inset ${ORDER_STATUS_STYLES[order.status] ?? 'bg-slate-100 text-slate-600 ring-slate-200'}`}>
          {order.status}
        </span>
      </div>
      <ChevronRight className="h-4 w-4 shrink-0 text-slate-300 transition group-hover:translate-x-0.5 group-hover:text-primary-500" />
    </Link>
  );
}

export default async function RetailerHomePage() {
  const user = await requireUser();
  const supabase = createClient();

  const { data: retailer } = await supabase
    .from('retailers')
    .select('shop_name, area_id, credit_limit, outstanding_balance')
    .eq('id', user.id)
    .maybeSingle<RetailerRow>();

  const nowIso = new Date().toISOString();
  const favoriteIds = await loadFavoriteIds(supabase, user.id);
  const [
    { data: bannerRows },
    { data: categoryData },
    { data: openOrders },
    { data: recentOrders },
    { data: lastDelivered },
    { data: schemeData },
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
      .from('orders')
      .select('id, order_number, status, grand_total, placed_at')
      .eq('retailer_id', user.id)
      .in('status', OPEN_ORDER_STATUSES)
      .order('placed_at', { ascending: false })
      .limit(5)
      .returns<OrderRow[]>(),
    supabase
      .from('orders')
      .select('id, order_number, status, grand_total, placed_at')
      .eq('retailer_id', user.id)
      .order('placed_at', { ascending: false })
      .limit(5)
      .returns<OrderRow[]>(),
    supabase
      .from('orders')
      .select('id, order_number, status, grand_total, placed_at')
      .eq('retailer_id', user.id)
      .eq('status', 'delivered')
      .order('placed_at', { ascending: false })
      .limit(1)
      .returns<OrderRow[]>(),
    supabase
      .from('schemes')
      .select('id, name, description, is_festival, ends_at')
      .eq('is_active', true)
      .lte('starts_at', nowIso)
      .gte('ends_at', nowIso)
      .order('ends_at')
      .limit(6)
      .returns<SchemeRow[]>(),
    supabase
      .from('products')
      .select(PRODUCT_CARD_SELECT)
      .eq('is_active', true)
      .order('created_at', { ascending: false })
      .limit(80)
      .returns<CatalogProductRow[]>(),
    getFrequentlyOrderedCards(supabase, user.id, retailer?.area_id ?? null, favoriteIds, 8),
    getBuyAgainCards(supabase, user.id, retailer?.area_id ?? null, favoriteIds, 8),
  ]);

  const banners = ((bannerRows ?? []) as unknown as BannerRow[]).filter((banner) => {
    const areaMatches = !banner.area_id || banner.area_id === retailer?.area_id;
    const started = !banner.starts_at || banner.starts_at <= nowIso;
    const notEnded = !banner.ends_at || banner.ends_at >= nowIso;
    return areaMatches && started && notEnded;
  });

  const categories = [...(categoryData ?? [])]
    .map((category) => ({
      ...category,
      count: category.products?.[0]?.count ?? 0,
    }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
  const popularCategories = categories.filter((category) => !category.parent_id).slice(0, 10);
  const schemes = schemeData ?? [];
  const open = openOrders ?? [];
  const recent = recentOrders ?? [];
  const reorderTarget = lastDelivered?.[0] ?? null;

  const discoveryCards = await priceCatalogProducts(
    supabase,
    discoveryRows ?? [],
    user.id,
    retailer?.area_id ?? null,
    favoriteIds
  );
  const rails = pickDiscoveryRails(discoveryCards);
  const favoriteCards = discoveryCards.filter((card) => favoriteIds.has(card.id)).slice(0, 8);
  const greeting = greetingForHour(new Date().getHours());

  return (
    <div className="space-y-6 sm:space-y-8">
      <div className="flex items-end justify-between gap-4">
        <div>
          <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-primary-600">{greeting} · Maharani Traders</p>
          <h1 className="mt-1 text-xl font-bold tracking-tight text-slate-950 sm:text-3xl">
            Welcome, {retailer?.shop_name ?? user.fullName}
          </h1>
          <p className="mt-1 max-w-xl text-xs text-slate-500 sm:text-sm">Discover wholesale essentials, current offers and reliable restocking for your shop.</p>
        </div>
        <Link href="/retailer/catalog" className="hidden h-10 items-center gap-2 rounded-xl bg-primary-600 px-4 text-xs font-bold text-white shadow-sm transition hover:bg-primary-700 sm:flex">
          Browse catalog <ArrowRight className="h-4 w-4" />
        </Link>
      </div>

      <section className="rounded-2xl border border-slate-200 bg-white p-3 shadow-sm sm:p-5">
        <div className="mb-3 flex items-center justify-between">
          <div>
            <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-primary-600">Explore the aisles</p>
            <h2 className="mt-0.5 text-sm font-bold text-slate-900 sm:text-base">Shop by category</h2>
          </div>
          <Link href="/retailer/catalog" className="flex items-center gap-0.5 text-[11px] font-bold text-primary-600">
            View all <ChevronRight className="h-3.5 w-3.5" />
          </Link>
        </div>
        <div className="scrollbar-none -mx-1 flex gap-2 overflow-x-auto px-1 pb-1 sm:gap-3">
          <Link href="/retailer/catalog" className="group flex w-[74px] shrink-0 flex-col items-center gap-2 text-center sm:w-24">
            <span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-primary-50 to-primary-100 text-primary-600 ring-1 ring-primary-100 transition group-hover:-translate-y-0.5 group-hover:shadow-md sm:h-16 sm:w-16">
              <LayoutGrid className="h-6 w-6" />
            </span>
            <span className="line-clamp-2 text-[10px] font-semibold leading-3.5 text-slate-700 sm:text-xs">All products</span>
          </Link>
          {popularCategories.map((category, index) => {
            const Icon = CATEGORY_ICONS[index % CATEGORY_ICONS.length] ?? Boxes;
            return (
              <Link key={category.id} href={`/retailer/catalog?category=${category.id}`} className="group flex w-[74px] shrink-0 flex-col items-center gap-2 text-center sm:w-24">
                <span className="relative flex h-14 w-14 items-center justify-center overflow-hidden rounded-2xl bg-gradient-to-br from-blue-50 to-sky-100 text-blue-700 ring-1 ring-blue-100 transition group-hover:-translate-y-0.5 group-hover:shadow-md sm:h-16 sm:w-16">
                  {category.image_url ? (
                    <Image src={category.image_url} alt="" fill className="object-cover" unoptimized />
                  ) : (
                    <Icon className="h-6 w-6" />
                  )}
                </span>
                <span className="line-clamp-2 text-[10px] font-semibold leading-3.5 text-slate-700 sm:text-xs">{category.name}</span>
                {category.count > 0 ? <span className="text-[9px] text-slate-400">{category.count}</span> : null}
              </Link>
            );
          })}
        </div>
      </section>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1.65fr)_minmax(300px,0.75fr)]">
        <section className="min-w-0">
          {banners.length > 0 ? (
            <div className="scrollbar-none flex snap-x gap-3 overflow-x-auto">
              {banners.map((banner) => (
                <PromoBanner key={banner.id} title={banner.title} imageUrl={banner.image_url} linkUrl={banner.link_url} />
              ))}
            </div>
          ) : (
            <div className="marketplace-grid relative flex min-h-[220px] overflow-hidden rounded-2xl bg-gradient-to-br from-primary-800 via-primary-700 to-primary-950 p-5 text-white shadow-lg sm:min-h-[280px] sm:p-8">
              <div className="relative z-10 max-w-lg self-center">
                <p className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-[0.2em] text-amber-300">
                  <Sparkles className="h-3.5 w-3.5" /> Built for your business
                </p>
                <h2 className="mt-3 text-2xl font-bold leading-tight drop-shadow-[0_2px_8px_rgba(0,0,0,0.35)] sm:text-4xl">
                  Fill your shelves.
                  <br />
                  Grow your margins.
                </h2>
                <p className="mt-3 max-w-md text-xs leading-5 text-primary-50 sm:text-sm">
                  Browse approved wholesale prices, compare pack sizes and place GST-ready orders in minutes.
                </p>
                <Link href="/retailer/catalog" className="mt-5 inline-flex h-10 items-center gap-2 rounded-xl bg-amber-400 px-4 text-xs font-bold text-slate-950 shadow-sm transition hover:bg-amber-300">
                  Start shopping <ArrowRight className="h-4 w-4" />
                </Link>
              </div>
              <ShoppingCart className="absolute -bottom-8 -right-6 h-44 w-44 rotate-[-8deg] text-white/10 sm:h-64 sm:w-64" />
            </div>
          )}
        </section>

        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-1">
          {retailer ? <CreditSummary creditLimit={retailer.credit_limit} outstandingBalance={retailer.outstanding_balance} /> : null}
          <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
            <div className="flex items-start gap-3">
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-blue-50 text-blue-700">
                <ShieldCheck className="h-5 w-5" />
              </span>
              <div>
                <p className="text-xs font-bold text-slate-900">Built for your business</p>
                <p className="mt-1 text-[10px] leading-4 text-slate-500">Approved pricing, GST-ready invoices and secure credit checks on every order.</p>
              </div>
            </div>
            <div className="mt-4 grid grid-cols-2 gap-2 border-t border-slate-100 pt-3">
              <Link href="/retailer/schemes" className="rounded-lg bg-blue-50 px-3 py-2 text-[10px] font-bold text-blue-700 transition hover:bg-blue-100">
                View schemes <span className="ml-1">→</span>
              </Link>
              <Link href="/retailer/account" className="rounded-lg bg-slate-50 px-3 py-2 text-[10px] font-bold text-slate-600 transition hover:bg-slate-100">
                Open account <span className="ml-1">→</span>
              </Link>
            </div>
          </section>
        </div>
      </div>

      {reorderTarget ? (
        <section className="flex flex-col gap-4 overflow-hidden rounded-2xl border border-primary-100 bg-gradient-to-r from-primary-50 via-white to-amber-50 p-4 shadow-sm sm:flex-row sm:items-center sm:justify-between sm:p-5">
          <div className="flex min-w-0 items-center gap-3">
            <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-primary-600 text-white shadow-sm">
              <RotateCcw className="h-5 w-5" />
            </span>
            <div className="min-w-0">
              <p className="text-sm font-bold text-slate-900">Restock from your last delivery</p>
              <p className="mt-0.5 truncate text-[11px] text-slate-500">
                Review {reorderTarget.order_number} with current prices and MOQ before adding.
              </p>
            </div>
          </div>
          <Link href={`/retailer/orders/${reorderTarget.id}/reorder`} className="flex h-10 shrink-0 items-center justify-center gap-2 rounded-xl bg-primary-600 px-4 text-xs font-bold text-white transition hover:bg-primary-700">
            Review & reorder <ArrowRight className="h-4 w-4" />
          </Link>
        </section>
      ) : null}

      <section id="deals" className="scroll-mt-36 space-y-3">
        <SectionHeading eyebrow="Smart savings" title="Offers for your shop" href="/retailer/schemes" linkLabel="View all schemes" />
        {schemes.length > 0 ? (
          <div className="scrollbar-none -mx-3 flex snap-x gap-3 overflow-x-auto px-3 pb-1 sm:mx-0 sm:px-0">
            {schemes.map((scheme, index) => (
              <article
                key={scheme.id}
                className={`relative min-h-[148px] w-[82%] max-w-sm shrink-0 snap-start overflow-hidden rounded-2xl p-5 text-white shadow-md ${index % 2 === 0 ? 'bg-gradient-to-br from-primary-700 to-primary-950' : 'bg-gradient-to-br from-slate-800 to-slate-950'}`}
              >
                <Tag className="absolute -bottom-4 -right-2 h-28 w-28 rotate-12 text-white/5" />
                <div className="relative">
                  <div className="flex items-start justify-between gap-2">
                    <span className="rounded-full bg-white/15 px-2.5 py-1 text-[9px] font-bold uppercase tracking-wider">
                      {scheme.is_festival ? 'Festival offer' : 'Retailer scheme'}
                    </span>
                    <BadgeIndianRupee className="h-5 w-5 text-amber-300" />
                  </div>
                  <h3 className="mt-4 text-base font-bold">{scheme.name}</h3>
                  {scheme.description ? <p className="mt-1 line-clamp-2 text-[11px] leading-4 text-white/75">{scheme.description}</p> : null}
                  <div className="mt-3 flex items-center justify-between gap-3">
                    <p className="text-[10px] font-semibold text-amber-300">
                      Valid till {new Date(scheme.ends_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}
                    </p>
                    <Link href="/retailer/catalog?offers=1" className="rounded-lg bg-white/15 px-2.5 py-1.5 text-[10px] font-bold text-white transition hover:bg-white/25">
                      View products
                    </Link>
                  </div>
                </div>
              </article>
            ))}
          </div>
        ) : (
          <div className="flex items-center gap-4 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-emerald-50 text-emerald-700">
              <WalletCards className="h-5 w-5" />
            </span>
            <div>
              <p className="text-sm font-bold text-slate-900">Your retailer pricing is active</p>
              <p className="mt-0.5 text-[11px] leading-4 text-slate-500">
                Any eligible area or retailer-specific price is automatically applied in the catalog and revalidated at checkout.
              </p>
            </div>
          </div>
        )}
      </section>

      <ProductRail eyebrow="Deals of the day" title="Today’s wholesale deals" href="/retailer/catalog?offers=1" products={rails.deals} />
      <ProductRail eyebrow="Best value" title="Best wholesale prices" href="/retailer/catalog?sort=price-low" products={rails.bestPrices} />

      {frequentCards.length > 0 ? (
        <section className="space-y-3">
          <SectionHeading eyebrow="Buy again" title="Frequently ordered" href="/retailer/catalog?sort=frequent" linkLabel="Browse more" />
          <div className="scrollbar-none -mx-3 flex gap-3 overflow-x-auto px-3 pb-1 sm:mx-0 sm:grid sm:grid-cols-3 sm:px-0 lg:grid-cols-6">
            {frequentCards.map((card) => (
              <FrequentProductCard
                key={card.id}
                id={card.id}
                name={card.name}
                imageUrl={card.imageUrl}
                packId={card.defaultPackId ?? null}
                packName={card.packName}
                moq={card.moq ?? 1}
                effectivePrice={card.fromPrice}
                timesOrdered={card.timesOrdered || 1}
              />
            ))}
          </div>
        </section>
      ) : null}

      <ProductRail eyebrow="From your last order" title="Buy again" href="/retailer/orders" products={buyAgainCards} />
      <ProductRail eyebrow="Just in" title="New arrivals" href="/retailer/catalog?new=1" products={rails.newArrivals} />
      <ProductRail eyebrow="Easy restock" title="Low-MOQ products" href="/retailer/catalog?maxMoq=2" products={rails.lowMoq} />
      <RecentlyViewedRail />
      <ProductRail eyebrow="Saved for later" title="Your favourites" href="/retailer/favorites" products={favoriteCards} />

      <div className="grid gap-5 lg:grid-cols-2">
        <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
          <SectionHeading title={open.length > 0 ? `Pending orders (${open.length})` : 'Pending orders'} href="/retailer/orders?status=pending" />
          {open.length > 0 ? (
            <div className="mt-2">{open.map((order) => <OrderListRow key={order.id} order={order} />)}</div>
          ) : (
            <div className="flex min-h-40 flex-col items-center justify-center text-center">
              <Truck className="h-8 w-8 text-slate-300" />
              <p className="mt-2 text-sm font-semibold text-slate-700">No active deliveries</p>
              <p className="mt-1 text-[11px] text-slate-500">New orders will appear here as they move.</p>
            </div>
          )}
        </section>

        <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
          <SectionHeading title="Recent orders" href="/retailer/orders" />
          {recent.length > 0 ? (
            <div className="mt-2">{recent.map((order) => <OrderListRow key={order.id} order={order} />)}</div>
          ) : (
            <div className="flex min-h-40 flex-col items-center justify-center text-center">
              <ClipboardList className="h-8 w-8 text-slate-300" />
              <p className="mt-2 text-sm font-semibold text-slate-700">No orders yet</p>
              <Link href="/retailer/catalog" className="mt-2 text-xs font-bold text-primary-600">Explore products</Link>
            </div>
          )}
        </section>
      </div>

      <section className="grid gap-3 rounded-2xl bg-slate-950 p-4 text-white sm:grid-cols-3 sm:p-5">
        {[
          { icon: Search, title: 'Easy discovery', body: 'Search by product, brand or SKU.' },
          { icon: WalletCards, title: 'Your B2B price', body: 'Retailer pricing applied automatically.' },
          { icon: ClipboardList, title: 'Reliable ordering', body: 'MOQ, GST and credit checked securely.' },
        ].map((item) => (
          <div key={item.title} className="flex items-center gap-3 rounded-xl bg-white/5 p-3">
            <item.icon className="h-5 w-5 shrink-0 text-amber-300" />
            <div>
              <p className="text-xs font-bold">{item.title}</p>
              <p className="mt-0.5 text-[10px] text-slate-400">{item.body}</p>
            </div>
          </div>
        ))}
      </section>
    </div>
  );
}
