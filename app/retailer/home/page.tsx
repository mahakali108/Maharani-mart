import Link from 'next/link';
import Image from 'next/image';
import {
  ArrowRight,
  BadgeIndianRupee,
  BellRing,
  Boxes,
  ChevronRight,
  ClipboardList,
  Coffee,
  Cookie,
  Heart,
  LayoutGrid,
  Milk,
  PackageCheck,
  RotateCcw,
  Search,
  ShoppingCart,
  Sparkles,
  Store,
  Tag,
  Truck,
  WalletCards,
  Zap,
} from 'lucide-react';
import { createClient } from '@/lib/supabase/server';
import { requireUser } from '@/lib/auth/session';
import { getProductPriceOverride, resolvePackPrice } from '@/lib/retailer/effective-price';
import { CreditSummary } from '@/components/retailer/credit-summary';
import { FrequentProductCard } from '@/components/retailer/frequent-product-card';

interface BannerRow {
  id: string;
  title: string;
  image_url: string;
  link_url: string | null;
}

interface CategoryRow {
  id: string;
  name: string;
  image_url: string | null;
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

interface FavoriteRow {
  product_id: string;
  products: { id: string; name: string; is_active: boolean } | null;
}

interface FrequentItemRow {
  product_id: string;
  quantity: number;
  order_id: string;
  products: {
    id: string;
    name: string;
    is_active: boolean;
    product_images: { image_url: string; sort_order: number }[];
    product_packs: {
      id: string;
      pack_name: string;
      base_price: number;
      ptr: number | null;
      moq: number;
      is_active: boolean;
      sort_order: number;
    }[];
  } | null;
}

const OPEN_ORDER_STATUSES = ['pending', 'confirmed', 'processing', 'packed', 'dispatched'];
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

function SectionHeading({
  eyebrow,
  title,
  href,
  linkLabel = 'View all',
}: {
  eyebrow?: string;
  title: string;
  href?: string;
  linkLabel?: string;
}) {
  return (
    <div className="flex items-end justify-between gap-3">
      <div>
        {eyebrow ? <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-primary-600">{eyebrow}</p> : null}
        <h2 className="mt-0.5 text-base font-bold tracking-tight text-slate-900 sm:text-xl">{title}</h2>
      </div>
      {href ? (
        <Link href={href} className="flex shrink-0 items-center gap-1 text-[11px] font-bold text-primary-600 hover:text-primary-700 sm:text-xs">
          {linkLabel}
          <ChevronRight className="h-3.5 w-3.5" />
        </Link>
      ) : null}
    </div>
  );
}

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
  const [
    { data: bannerRows },
    { data: categoryData },
    { data: openOrders },
    { data: recentOrders },
    { data: lastDelivered },
    { data: schemeData },
    { data: favoriteData },
  ] = await Promise.all([
    supabase
      .from('banners')
      .select('id, title, image_url, link_url, area_id, starts_at, ends_at')
      .eq('is_active', true)
      .order('sort_order'),
    supabase
      .from('categories')
      .select('id, name, image_url')
      .eq('is_active', true)
      .order('sort_order')
      .limit(12)
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
      .from('retailer_favorites')
      .select('product_id, products ( id, name, is_active )')
      .eq('retailer_id', user.id)
      .order('created_at', { ascending: false })
      .limit(8)
      .returns<FavoriteRow[]>(),
  ]);

  const banners = ((bannerRows ?? []) as unknown as (BannerRow & {
    area_id: string | null;
    starts_at: string | null;
    ends_at: string | null;
  })[]).filter((banner) => {
    const areaMatches = !banner.area_id || banner.area_id === retailer?.area_id;
    const started = !banner.starts_at || banner.starts_at <= nowIso;
    const notEnded = !banner.ends_at || banner.ends_at >= nowIso;
    return areaMatches && started && notEnded;
  });

  const categories = categoryData ?? [];
  const schemes = schemeData ?? [];
  const favorites = (favoriteData ?? []).filter((favorite) => favorite.products?.is_active);
  const open = openOrders ?? [];
  const recent = recentOrders ?? [];
  const reorderTarget = lastDelivered?.[0] ?? null;

  const { data: freqOrderIds } = await supabase
    .from('orders')
    .select('id')
    .eq('retailer_id', user.id)
    .neq('status', 'cancelled')
    .order('placed_at', { ascending: false })
    .limit(25)
    .returns<{ id: string }[]>();
  const recentOrderIds = (freqOrderIds ?? []).map((order) => order.id);
  let frequentCards: {
    id: string;
    name: string;
    imageUrl?: string;
    packId: string | null;
    packName?: string;
    moq: number;
    effectivePrice: number | null;
    timesOrdered: number;
  }[] = [];

  if (recentOrderIds.length > 0) {
    const { data: freqRows } = await supabase
      .from('order_items')
      .select('product_id, quantity, order_id, products ( id, name, is_active, product_images ( image_url, sort_order ), product_packs ( id, pack_name, base_price, ptr, moq, is_active, sort_order ) )')
      .in('order_id', recentOrderIds)
      .limit(500)
      .returns<FrequentItemRow[]>();

    const byProduct = new Map<string, { times: number; qty: number; product: NonNullable<FrequentItemRow['products']> }>();
    for (const row of freqRows ?? []) {
      if (!row.products?.is_active) continue;
      const entry = byProduct.get(row.product_id) ?? { times: 0, qty: 0, product: row.products };
      entry.times += 1;
      entry.qty += row.quantity;
      byProduct.set(row.product_id, entry);
    }

    const top = [...byProduct.entries()]
      .sort((a, b) => b[1].times - a[1].times || b[1].qty - a[1].qty)
      .slice(0, 6);
    const overrides = await Promise.all(
      top.map(([productId]) => getProductPriceOverride(supabase, productId, user.id, retailer?.area_id ?? null))
    );

    frequentCards = top.map(([productId, info], index) => {
      const packs = [...info.product.product_packs]
        .filter((pack) => pack.is_active)
        .sort((a, b) => a.sort_order - b.sort_order);
      const pack = packs[0] ?? null;
      const images = [...info.product.product_images].sort((a, b) => a.sort_order - b.sort_order);
      return {
        id: productId,
        name: info.product.name,
        imageUrl: images[0]?.image_url,
        packId: pack?.id ?? null,
        packName: pack?.pack_name,
        moq: pack?.moq ?? 1,
        effectivePrice: pack ? resolvePackPrice(pack, overrides[index] ?? null) : null,
        timesOrdered: info.times,
      };
    });
  }

  return (
    <div className="space-y-6 sm:space-y-8">
      <div className="flex items-center justify-between gap-4">
        <div>
          <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-primary-600">Retailer dashboard</p>
          <h1 className="mt-1 text-xl font-bold tracking-tight text-slate-950 sm:text-3xl">
            Welcome, {retailer?.shop_name ?? user.fullName}
          </h1>
          <p className="mt-1 text-xs text-slate-500 sm:text-sm">Restock faster with wholesale prices made for your business.</p>
        </div>
        <Link href="/retailer/quick-order" className="hidden h-10 items-center gap-2 rounded-xl bg-primary-600 px-4 text-xs font-bold text-white shadow-sm transition hover:bg-primary-700 sm:flex">
          <Zap className="h-4 w-4" /> Quick order
        </Link>
      </div>

      <section className="rounded-2xl border border-slate-200 bg-white p-3 shadow-sm sm:p-5">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-bold text-slate-900 sm:text-base">Shop by category</h2>
          <Link href="/retailer/catalog" className="flex items-center gap-0.5 text-[11px] font-bold text-primary-600">All products <ChevronRight className="h-3.5 w-3.5" /></Link>
        </div>
        <div className="scrollbar-none -mx-1 flex gap-2 overflow-x-auto px-1 pb-1 sm:gap-3">
          <Link href="/retailer/catalog" className="group flex w-[74px] shrink-0 flex-col items-center gap-2 text-center sm:w-24">
            <span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-primary-50 to-primary-100 text-primary-600 ring-1 ring-primary-100 transition group-hover:-translate-y-0.5 group-hover:shadow-md sm:h-16 sm:w-16">
              <LayoutGrid className="h-6 w-6" />
            </span>
            <span className="line-clamp-2 text-[10px] font-semibold leading-3.5 text-slate-700 sm:text-xs">All products</span>
          </Link>
          {categories.map((category, index) => {
            const Icon = CATEGORY_ICONS[index % CATEGORY_ICONS.length] ?? Boxes;
            return (
              <Link key={category.id} href={`/retailer/catalog?category=${category.id}`} className="group flex w-[74px] shrink-0 flex-col items-center gap-2 text-center sm:w-24">
                <span className="relative flex h-14 w-14 items-center justify-center overflow-hidden rounded-2xl bg-gradient-to-br from-amber-50 to-orange-100 text-orange-700 ring-1 ring-orange-100 transition group-hover:-translate-y-0.5 group-hover:shadow-md sm:h-16 sm:w-16">
                  {category.image_url ? (
                    <Image src={category.image_url} alt="" fill className="object-cover" unoptimized />
                  ) : (
                    <Icon className="h-6 w-6" />
                  )}
                </span>
                <span className="line-clamp-2 text-[10px] font-semibold leading-3.5 text-slate-700 sm:text-xs">{category.name}</span>
              </Link>
            );
          })}
        </div>
      </section>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1.65fr)_minmax(300px,0.75fr)]">
        <section className="min-w-0">
          {banners.length > 0 ? (
            <div className="scrollbar-none flex snap-x gap-3 overflow-x-auto">
              {banners.map((banner) => {
                const bannerContent = (
                  <>
                    <Image src={banner.image_url} alt={banner.title} fill className="object-cover transition duration-500 group-hover:scale-105" unoptimized />
                    <div className="absolute inset-0 bg-gradient-to-r from-slate-950/70 via-slate-950/10 to-transparent" />
                    <div className="absolute inset-y-0 left-0 flex max-w-[70%] flex-col justify-end p-5 text-white sm:p-7">
                      <span className="mb-2 w-fit rounded-full bg-amber-400 px-2.5 py-1 text-[9px] font-black uppercase tracking-wider text-slate-950">Featured</span>
                      <h2 className="text-lg font-bold leading-tight drop-shadow sm:text-2xl">{banner.title}</h2>
                      <span className="mt-3 flex items-center gap-1 text-[11px] font-bold sm:text-xs">Explore offer <ArrowRight className="h-3.5 w-3.5" /></span>
                    </div>
                  </>
                );
                return banner.link_url ? (
                  <a key={banner.id} href={banner.link_url} target="_blank" rel="noreferrer" className="group relative aspect-[2/1] w-[92%] shrink-0 snap-start overflow-hidden rounded-2xl bg-slate-900 shadow-md sm:w-full">
                    {bannerContent}
                  </a>
                ) : (
                  <div key={banner.id} className="group relative aspect-[2/1] w-[92%] shrink-0 snap-start overflow-hidden rounded-2xl bg-slate-900 shadow-md sm:w-full">
                    {bannerContent}
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="marketplace-grid relative flex min-h-[220px] overflow-hidden rounded-2xl bg-gradient-to-br from-primary-800 via-primary-700 to-primary-950 p-5 text-white shadow-lg sm:min-h-[280px] sm:p-8">
              <div className="relative z-10 max-w-lg self-center">
                <p className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-[0.2em] text-amber-300"><Sparkles className="h-3.5 w-3.5" /> Built for your business</p>
                <h2 className="mt-3 text-2xl font-bold leading-tight sm:text-4xl">Fill your shelves.<br />Grow your margins.</h2>
                <p className="mt-3 max-w-md text-xs leading-5 text-primary-100 sm:text-sm">Browse approved wholesale prices, compare pack sizes and place GST-ready orders in minutes.</p>
                <Link href="/retailer/catalog" className="mt-5 inline-flex h-10 items-center gap-2 rounded-xl bg-white px-4 text-xs font-bold text-primary-700 shadow-sm transition hover:bg-amber-50">Start shopping <ArrowRight className="h-4 w-4" /></Link>
              </div>
              <ShoppingCart className="absolute -bottom-8 -right-6 h-44 w-44 rotate-[-8deg] text-white/10 sm:h-64 sm:w-64" />
            </div>
          )}
        </section>

        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-1">
          {retailer ? <CreditSummary creditLimit={retailer.credit_limit} outstandingBalance={retailer.outstanding_balance} /> : null}
          <div className="grid grid-cols-2 gap-2 rounded-2xl border border-slate-200 bg-white p-3 shadow-sm">
            <Link href="/retailer/quick-order" className="group rounded-xl bg-primary-50 p-3 transition hover:bg-primary-100">
              <Zap className="h-5 w-5 text-primary-600" />
              <p className="mt-2 text-xs font-bold text-slate-900">Quick order</p>
              <p className="mt-0.5 text-[10px] text-slate-500">Search SKU & add</p>
            </Link>
            <Link href="/retailer/cart" className="group rounded-xl bg-amber-50 p-3 transition hover:bg-amber-100">
              <ShoppingCart className="h-5 w-5 text-amber-700" />
              <p className="mt-2 text-xs font-bold text-slate-900">My cart</p>
              <p className="mt-0.5 text-[10px] text-slate-500">Review order</p>
            </Link>
            <Link href="/retailer/orders" className="group rounded-xl bg-blue-50 p-3 transition hover:bg-blue-100">
              <ClipboardList className="h-5 w-5 text-blue-700" />
              <p className="mt-2 text-xs font-bold text-slate-900">Orders</p>
              <p className="mt-0.5 text-[10px] text-slate-500">Track & reorder</p>
            </Link>
            <Link href="/retailer/notifications" className="group rounded-xl bg-emerald-50 p-3 transition hover:bg-emerald-100">
              <BellRing className="h-5 w-5 text-emerald-700" />
              <p className="mt-2 text-xs font-bold text-slate-900">Updates</p>
              <p className="mt-0.5 text-[10px] text-slate-500">Alerts & news</p>
            </Link>
          </div>
        </div>
      </div>

      {reorderTarget ? (
        <section className="flex flex-col gap-4 overflow-hidden rounded-2xl border border-primary-100 bg-gradient-to-r from-primary-50 via-white to-amber-50 p-4 shadow-sm sm:flex-row sm:items-center sm:justify-between sm:p-5">
          <div className="flex min-w-0 items-center gap-3">
            <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-primary-600 text-white shadow-sm"><RotateCcw className="h-5 w-5" /></span>
            <div className="min-w-0">
              <p className="text-sm font-bold text-slate-900">Restock from your last delivery</p>
              <p className="mt-0.5 truncate text-[11px] text-slate-500">Review {reorderTarget.order_number} with current prices and MOQ before adding.</p>
            </div>
          </div>
          <Link href={`/retailer/orders/${reorderTarget.id}/reorder`} className="flex h-10 shrink-0 items-center justify-center gap-2 rounded-xl bg-primary-600 px-4 text-xs font-bold text-white transition hover:bg-primary-700">Review & reorder <ArrowRight className="h-4 w-4" /></Link>
        </section>
      ) : null}

      <section id="deals" className="scroll-mt-36 space-y-3">
        <SectionHeading eyebrow="Smart savings" title="Deals & active schemes" href="/retailer/catalog" linkLabel="Shop catalog" />
        {schemes.length > 0 ? (
          <div className="scrollbar-none -mx-3 flex snap-x gap-3 overflow-x-auto px-3 pb-1 sm:mx-0 sm:px-0">
            {schemes.map((scheme, index) => (
              <article key={scheme.id} className={`relative min-h-[148px] w-[82%] max-w-sm shrink-0 snap-start overflow-hidden rounded-2xl p-5 text-white shadow-md ${index % 2 === 0 ? 'bg-gradient-to-br from-primary-700 to-primary-950' : 'bg-gradient-to-br from-slate-800 to-slate-950'}`}>
                <Tag className="absolute -bottom-4 -right-2 h-28 w-28 rotate-12 text-white/5" />
                <div className="relative">
                  <div className="flex items-start justify-between gap-2">
                    <span className="rounded-full bg-white/15 px-2.5 py-1 text-[9px] font-bold uppercase tracking-wider">{scheme.is_festival ? 'Festival offer' : 'Retailer scheme'}</span>
                    <BadgeIndianRupee className="h-5 w-5 text-amber-300" />
                  </div>
                  <h3 className="mt-4 text-base font-bold">{scheme.name}</h3>
                  {scheme.description ? <p className="mt-1 line-clamp-2 text-[11px] leading-4 text-white/75">{scheme.description}</p> : null}
                  <p className="mt-3 text-[10px] font-semibold text-amber-300">Valid till {new Date(scheme.ends_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}</p>
                </div>
              </article>
            ))}
          </div>
        ) : (
          <div className="flex items-center gap-4 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-emerald-50 text-emerald-700"><WalletCards className="h-5 w-5" /></span>
            <div>
              <p className="text-sm font-bold text-slate-900">Your retailer pricing is active</p>
              <p className="mt-0.5 text-[11px] leading-4 text-slate-500">Any eligible area or retailer-specific price is automatically applied in the catalog and revalidated at checkout.</p>
            </div>
          </div>
        )}
      </section>

      {frequentCards.length > 0 ? (
        <section className="space-y-3">
          <SectionHeading eyebrow="Buy again" title="Frequently ordered" href="/retailer/catalog" linkLabel="Browse more" />
          <div className="scrollbar-none -mx-3 flex gap-3 overflow-x-auto px-3 pb-1 sm:mx-0 sm:grid sm:grid-cols-3 sm:px-0 lg:grid-cols-6">
            {frequentCards.map((card) => <FrequentProductCard key={card.id} {...card} />)}
          </div>
        </section>
      ) : null}

      <div className="grid gap-5 lg:grid-cols-2">
        <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
          <SectionHeading title={open.length > 0 ? `Orders in progress (${open.length})` : 'Orders in progress'} href="/retailer/orders" />
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

      {favorites.length > 0 ? (
        <section className="space-y-3">
          <SectionHeading eyebrow="Saved for later" title="Your favourites" />
          <div className="flex flex-wrap gap-2 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
            {favorites.map((favorite) => (
              <Link key={favorite.product_id} href={`/retailer/catalog/${favorite.product_id}`} className="flex items-center gap-2 rounded-full border border-slate-200 bg-slate-50 px-3 py-2 text-[11px] font-semibold text-slate-700 transition hover:border-primary-200 hover:bg-primary-50 hover:text-primary-700">
                <Heart className="h-3.5 w-3.5 fill-primary-100 text-primary-500" /> {favorite.products?.name}
              </Link>
            ))}
          </div>
        </section>
      ) : null}

      <section className="grid gap-3 rounded-2xl bg-slate-950 p-4 text-white sm:grid-cols-3 sm:p-5">
        {[
          { icon: Search, title: 'Easy discovery', body: 'Search by product, brand or SKU.' },
          { icon: WalletCards, title: 'Your B2B price', body: 'Retailer pricing applied automatically.' },
          { icon: ClipboardList, title: 'Reliable ordering', body: 'MOQ, GST and credit checked securely.' },
        ].map((item) => (
          <div key={item.title} className="flex items-center gap-3 rounded-xl bg-white/5 p-3">
            <item.icon className="h-5 w-5 shrink-0 text-amber-300" />
            <div><p className="text-xs font-bold">{item.title}</p><p className="mt-0.5 text-[10px] text-slate-400">{item.body}</p></div>
          </div>
        ))}
      </section>
    </div>
  );
}
