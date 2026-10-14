import Link from 'next/link';
import {
  ArrowRight, BadgePercent, BarChart3, CalendarDays, Clock3, Headset, LayoutGrid, MapPin,
  Package, ReceiptText, RotateCcw, ShieldCheck, ShoppingBag, Store, Tag, Truck,
} from 'lucide-react';
import { formatIndiaDate } from '@/lib/datetime/india';
import { BrandCard } from '@/components/retailer/brand-card';
import { CategoryCard } from '@/components/retailer/category-card';
import { ProductCard } from '@/components/retailer/product-card';
import { ProductRail } from '@/components/retailer/product-rail';
import { PromoCarousel } from '@/components/retailer/promo-carousel';
import { SectionHeading } from '@/components/retailer/section-heading';
import { HomeQuickActions } from '@/components/retailer/home-quick-actions';
import { HomeCartSummary } from '@/components/retailer/home-cart-summary';
import { HomeReorderCard } from '@/components/retailer/home-reorder-card';
import { HomeRefreshButton } from '@/components/retailer/home-refresh-button';
import { WholesaleDealCard } from '@/components/retailer/wholesale-deal-card';
import type { RetailerHomeData } from '@/lib/retailer/home-data';
import type { HomeService } from '@/lib/retailer/home-services';
import type { WalletSummary } from '@/lib/retailer/wallet';
import { CoinsBalanceCard } from '@/components/retailer/coins-balance-card';
import { SERVICE_AREA_LABEL } from '@/lib/config/service-area';

export interface HomeContentProps {
  data: RetailerHomeData;
  retailerName?: string | null;
  shopName?: string | null;
  areaName?: string | null;
  address?: string | null;
  profileUnavailable?: boolean;
  wallet: WalletSummary | null;
  services: HomeService[];
}

/** Presentational server component. All business records/terms come from the
 * request's live data loader; no fixtures, database SDK or duplicate fetches. */
export function HomeContent({ data, retailerName, shopName, areaName, address, profileUnavailable, wallet, services }: HomeContentProps) {
  const name = retailerName?.trim();
  const shop = shopName?.trim();
  const location = areaName?.trim() || address?.trim();
  const featured = data.products.slice(0, 8);
  const deals = data.products.filter((product) => product.bestSlab && product.availability !== 'out_of_stock')
    .sort((a, b) => (b.fromPrice! - b.bestSlab!.pricePerPiece) - (a.fromPrice! - a.bestSlab!.pricePerPiece)).slice(0, 4);
  const hasNewLaunches = data.products.some((product) => product.isNewLaunch);
  const newArrivals = (hasNewLaunches ? data.products.filter((product) => product.isNewLaunch) : data.products).slice(0, 8);
  const hasError = Object.values(data.errors).some(Boolean) || profileUnavailable;

  return (
    <div className="min-w-0 space-y-6 sm:space-y-8">
      <section aria-labelledby="home-welcome" className="relative overflow-hidden rounded-[1.75rem] border border-blush-200 bg-blush-50 shadow-card">
        <div aria-hidden="true" className="pointer-events-none absolute -right-12 -top-20 h-64 w-64 rounded-full border-[40px] border-peach-100/70 sm:h-96 sm:w-96" />
        <div className="relative grid gap-6 p-5 sm:p-8 lg:grid-cols-[1.4fr_1fr] lg:gap-10 lg:p-10">
          <div className="min-w-0">
            <p className="shop-eyebrow flex items-center gap-2"><Store className="h-4 w-4" aria-hidden="true" /> The retailer&apos;s everyday store</p>
            <h1 id="home-welcome" className="mt-4 max-w-xl text-3xl font-semibold leading-tight tracking-tight text-slate-950 sm:text-4xl lg:text-5xl">Your next restock,<br /><span className="text-primary-600">beautifully simple.</span></h1>
            <p className="mt-4 text-sm font-medium text-slate-800">{name ? `Welcome, ${name}` : 'Welcome to Maharani Traders'}</p>
            <p className="mt-1 max-w-md text-xs leading-6 text-slate-600 sm:text-sm">Discover products for your shelves, compare pack sizes and order at your wholesale piece price.</p>
            <div className="mt-5 flex flex-wrap gap-2">
              <Link href="/retailer/catalog" className="inline-flex min-h-12 items-center gap-3 rounded-xl bg-primary-600 px-5 text-sm font-semibold text-white hover:bg-primary-700">Explore catalogue <ArrowRight className="h-4 w-4" aria-hidden="true" /></Link>
              <Link href="/retailer/orders" className="inline-flex min-h-12 items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 text-sm font-semibold text-slate-700 hover:bg-mint-50"><RotateCcw className="h-4 w-4" aria-hidden="true" /> Buy again</Link>
            </div>
          </div>
          <div className="flex min-w-0 flex-col justify-center gap-3">
            <div className="rounded-2xl border border-white bg-white/90 p-4 shadow-card sm:p-5">
              <p className="shop-eyebrow">Your business, connected</p>
              {shop ? <p className="mt-2 break-words text-lg font-semibold text-slate-900">{shop}</p> : null}
              {location ? <p className="mt-2 flex gap-2 text-xs leading-5 text-slate-600"><MapPin className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" /><span className="break-words"><span className="block text-[10px] font-semibold uppercase tracking-wide">{areaName ? 'Delivery area' : 'Shop location'}</span>{location}</span></p> : null}
              <Link href="/retailer/account/addresses" className="mt-3 inline-flex min-h-10 items-center gap-2 text-xs font-semibold text-slate-800 underline decoration-slate-300 underline-offset-4">Manage delivery addresses <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" /></Link>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Link href="/retailer/schemes" className="rounded-2xl border border-mint-200 bg-mint-100 p-4 text-mint-700"><Tag className="mb-3 h-5 w-5" aria-hidden="true" /><span className="block text-sm font-semibold">Shop offers</span><span className="mt-1 block text-[11px]">Eligible schemes</span></Link>
              <Link href="/retailer/quick-order" className="rounded-2xl border border-lavender-200 bg-lavender-100 p-4 text-lavender-700"><ShoppingBag className="mb-3 h-5 w-5" aria-hidden="true" /><span className="block text-sm font-semibold">Quick order</span><span className="mt-1 block text-[11px]">Know what you need?</span></Link>
            </div>
          </div>
        </div>
        <div className="relative flex flex-wrap items-center justify-between gap-2 border-t border-blush-200 bg-white/60 px-5 py-3 text-[11px] text-slate-600 sm:px-8" data-testid="service-area-selector">
          <span className="flex items-center gap-1.5"><MapPin className="h-3.5 w-3.5" aria-hidden="true" />{areaName ? `Your service area: ${areaName}` : `Based in ${SERVICE_AREA_LABEL}`}</span>
          <Link href="/retailer/reports" className="inline-flex min-h-9 items-center gap-1.5 font-medium underline underline-offset-4"><BarChart3 className="h-3.5 w-3.5" aria-hidden="true" /> Purchase reports</Link>
        </div>
      </section>
      <HomeQuickActions />

      {hasError ? <div role="alert" className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3">
        <p className="min-w-0 flex-1 basis-48 text-xs leading-5 text-amber-900">Some shop details could not be loaded. Available sections are still ready to browse; missing information is not estimated.</p><HomeRefreshButton />
      </div> : null}

      <PromoCarousel banners={data.banners} />

      <section aria-label="Shop by category" className="space-y-4 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
        <SectionHeading eyebrow="Find your aisle" title="Shop by category" href="/retailer/categories" linkLabel="View all categories" />
        {data.categories.length ? <ul className="grid grid-cols-3 gap-2.5 sm:grid-cols-5 lg:grid-cols-10">
          {data.categories.map((category) => <li className="discovery-tile min-w-0" key={category.id}><CategoryCard category={category} compact /></li>)}
        </ul> : <HomeEmptyState icon={LayoutGrid} title={data.errors.categories ? 'Categories are temporarily unavailable' : 'No categories available yet'} body="You can still open the catalog to look for products." href="/retailer/catalog" linkLabel="Browse catalog" />}
      </section>

      {data.brands.length ? <section aria-label="Shop by brand" className="space-y-4 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
        <SectionHeading eyebrow="Find your favourites" title="Shop by brand" href="/retailer/brands" linkLabel="View all brands" />
        <ul className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">{data.brands.slice(0, 10).map((brand) => <li className="min-w-0" key={brand.id}><BrandCard brand={brand} compact /></li>)}</ul>
      </section> : null}

      <section aria-label="Featured products" className="space-y-4">
        <SectionHeading eyebrow="For your next restock" title="Featured products" href="/retailer/catalog" linkLabel="Browse catalog" />
        {data.errors.pricing ? <p role="status" className="text-xs text-amber-800">Current pricing could not be loaded. Add to Cart will be available when prices can be verified.</p> : null}
        {featured.length ? <div className="grid grid-cols-2 items-stretch gap-2.5 sm:grid-cols-3 sm:gap-4 lg:grid-cols-4">
          {featured.map((product) => <ProductCard key={product.id} {...product} />)}
        </div> : <HomeEmptyState icon={Package} title={data.errors.catalog ? 'Products are temporarily unavailable' : 'Your catalog is getting ready'} body="Active products and your current wholesale prices will appear here when available." href="/retailer/catalog" linkLabel="Browse Products" />}
      </section>

      <section aria-label="Offers and coupons" className="space-y-4 rounded-2xl border border-emerald-100 bg-emerald-50/40 p-4 sm:p-5">
        <SectionHeading eyebrow="Save more on restocks" title="Offers &amp; coupons" href="/retailer/schemes" linkLabel="View all offers" />
        {data.schemes.length ? <div className="grid gap-3 sm:grid-cols-2">
          {data.schemes.slice(0, 3).map((scheme) => (
            <article key={scheme.id} className="rounded-xl border border-slate-200 bg-white p-3.5 shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
              <div className="flex items-center justify-between gap-2">
                <span className="inline-flex items-center gap-1.5 rounded-full bg-primary-50 px-2.5 py-1 text-[9px] font-bold uppercase tracking-wider text-primary-700">
                  <Tag className="h-3 w-3" aria-hidden="true" /> {scheme.is_festival ? 'Festival offer' : 'Retailer scheme'}
                </span>
                <span className="flex items-center gap-1 text-[10px] font-semibold text-slate-500">
                  <CalendarDays className="h-3 w-3" aria-hidden="true" /> Till {formatIndiaDate(scheme.ends_at)}
                </span>
              </div>
              <h3 className="mt-2 truncate text-sm font-bold text-slate-900">{scheme.name}</h3>
              {scheme.description ? <p className="mt-1 line-clamp-2 text-[11px] leading-4 text-slate-600">{scheme.description}</p> : null}
              <Link href="/retailer/catalog?offers=1" className="mt-2.5 inline-flex min-h-9 items-center gap-1.5 rounded-lg bg-primary-600 px-3 text-[10px] font-bold text-white transition hover:bg-primary-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-300">
                View products <ArrowRight className="h-3 w-3" aria-hidden="true" />
              </Link>
            </article>
          ))}
        </div> : null}
        {deals.length ? <>
          <p className="text-xs leading-5 text-slate-600">Buy more, save more with configured quantity rates. Each deal shows the quantity needed to unlock it.</p>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">{deals.map((product) => <WholesaleDealCard key={product.id} product={product} />)}</div>
        </> : null}
        {!data.schemes.length && !deals.length ? <HomeEmptyState icon={BadgePercent} title={data.errors.schemes || data.errors.pricing ? 'Offers are temporarily unavailable' : 'No offers live right now'} body="Active schemes and festival offers appear here when they go live. Your current wholesale prices still apply." href="/retailer/schemes" linkLabel="Check offers" /> : null}
      </section>

      <section id="home-reorder" aria-label="Buy again" className="scroll-mt-36 space-y-4">
        <SectionHeading eyebrow="Your shop’s essentials" title="Buy again" href="/retailer/orders" linkLabel="View your orders" />
        <p className="text-xs leading-5 text-slate-600">Your recently purchased packs, with last-ordered quantities. Today’s prices and minimums apply.</p>
        {data.reorders.length ? <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">{data.reorders.map((item) => <HomeReorderCard key={item.packId ?? item.productId} item={item} />)}</div>
          : <HomeEmptyState icon={RotateCcw} title={data.errors.history ? 'Order history is temporarily unavailable' : 'Make your next restock a one-tap reorder'} body="Products from your confirmed orders will appear here. Start with the catalog, or review your existing orders." href="/retailer/orders" linkLabel="View orders" />}
        {data.frequent.length ? <ProductRail title="Frequently ordered by you" href="/retailer/catalog?sort=frequent" linkLabel="View products" products={data.frequent} /> : null}
      </section>

      <div className="grid items-start gap-4 lg:grid-cols-2">
        <HomeCartSummary cart={data.cart} />
        <HomeCoinsSummary wallet={wallet} />
      </div>

      <section aria-label="Delivery and service benefits" className="space-y-4 border-t border-slate-200 pt-6">
        <SectionHeading title="Here for your business" />
        <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
          {services.map((service) => {
            const Icon = { dispatch: Truck, delivery: Clock3, invoice: ReceiptText, moq: ShieldCheck, pricing: BadgePercent, support: Headset }[service.id];
            const content = <><Icon className="h-5 w-5 text-action-600" aria-hidden="true" /><h3 className="mt-3 text-xs font-semibold leading-5 text-slate-800">{service.title}</h3><p className="mt-1 break-words text-[11px] leading-5 text-slate-500">{service.detail}</p></>;
            const className = 'block h-full rounded-xl border border-slate-200 bg-white p-3.5';
            return <li key={service.id} className="min-w-0">{service.href ? <Link href={service.href} className={`${className} transition hover:border-action-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-action-500`}>{content}</Link> : <div className={className}>{content}</div>}</li>;
          })}
        </ul>
      </section>

      {newArrivals.length ? <ProductRail eyebrow="Fresh in the catalog" title="New arrivals" href={hasNewLaunches ? '/retailer/catalog?new=1' : '/retailer/catalog?sort=newest'} linkLabel="View new products" products={newArrivals} /> : null}
      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-200 pt-4 text-[10px] text-slate-500"><span>Maharani Traders · Wholesale for your business</span><Link href="/retailer/help" className="inline-flex min-h-11 items-center gap-1 font-medium text-action-700 hover:underline">Help & support <ArrowRight className="h-3 w-3" aria-hidden="true" /></Link></div>
    </div>
  );
}

function HomeCoinsSummary({ wallet }: { wallet: WalletSummary | null }) {
  // 🪙 Coins only: no credit limit, no outstanding, no payment terms.
  if (!wallet) return null;
  return (
    <CoinsBalanceCard
      limitPaise={wallet.creditLimitPaise}
      outstandingPaise={wallet.outstandingPaise}
      title="Your coins"
    />
  );
}

function HomeEmptyState({ icon: Icon, title, body, href, linkLabel }: { icon: typeof Package; title: string; body: string; href: string; linkLabel: string }) {
  return <div className="flex flex-col items-start gap-3 rounded-2xl border border-dashed border-slate-200 bg-white p-4 sm:flex-row sm:items-center sm:p-5">
    <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-slate-50 text-slate-500"><Icon className="h-5 w-5" aria-hidden="true" /></span>
    <div className="min-w-0 flex-1"><h3 className="text-sm font-semibold text-slate-800">{title}</h3><p className="mt-1 text-xs leading-5 text-slate-500">{body}</p><Link href={href} className="mt-2 inline-flex min-h-11 items-center gap-1.5 rounded text-xs font-semibold text-action-700 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-action-500">{linkLabel} <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" /></Link></div>
  </div>;
}
