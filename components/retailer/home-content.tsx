import Link from 'next/link';
import {
  ArrowRight, BadgePercent, BarChart3, Clock3, Headset, LayoutGrid, MapPin, Package,
  ReceiptText, RotateCcw, ShieldCheck, ShoppingBag, Sparkles, Store, Truck, Wallet,
} from 'lucide-react';
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
import { formatInr } from '@/lib/retailer/format';
import { fromPaise } from '@/lib/retailer/case-pricing';
import type { RetailerHomeData } from '@/lib/retailer/home-data';
import type { HomeService } from '@/lib/retailer/home-services';
import type { WalletSummary } from '@/lib/retailer/wallet';

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
      <section aria-labelledby="home-welcome" className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-6">
        <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-4">
          <div className="min-w-0 flex-1 basis-60">
            <p className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.16em] text-action-700"><Store className="h-3.5 w-3.5" aria-hidden="true" /> Your wholesale store</p>
            <h1 id="home-welcome" className="mt-2 break-words text-xl font-bold leading-snug tracking-tight text-slate-950 sm:text-3xl">{name ? `Welcome, ${name}` : 'Welcome to Maharani Traders'}</h1>
            <p className="mt-2 max-w-xl text-xs leading-5 text-slate-600 sm:text-sm sm:leading-6">Wholesale pricing. Easy restocking for your business.</p>
          </div>
          {shop || location ? <div className="min-w-0 max-w-full rounded-xl border border-slate-100 bg-slate-50 px-3 py-2 sm:max-w-xs sm:py-2.5">
            {shop ? <p className="break-words text-xs font-semibold text-slate-800">{shop}</p> : null}
            {location ? <p className="mt-1 flex items-start gap-1.5 text-[11px] leading-5 text-slate-600"><MapPin className="mt-1 h-3.5 w-3.5 shrink-0 text-action-600" aria-hidden="true" /><span className="min-w-0 break-words"><span className="sr-only text-[9px] font-medium uppercase tracking-wide text-slate-500 sm:not-sr-only sm:block">{areaName ? 'Delivery area' : 'Shop location'}</span>{location}</span></p> : null}
          </div> : null}
        </div>
        <div className="mt-4 border-t border-slate-100 pt-4 sm:mt-5 sm:pt-5"><HomeQuickActions /></div>
        <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px]">
          <span className="hidden text-slate-500 sm:inline">Know what you need?</span>
          <Link href="/retailer/quick-order" className="inline-flex min-h-10 items-center gap-1.5 rounded font-semibold text-action-700 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-action-500"><ShoppingBag className="h-3.5 w-3.5" aria-hidden="true" /> Quick order</Link>
          <Link href="/retailer/reports" className="inline-flex min-h-10 items-center gap-1.5 rounded font-semibold text-action-700 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-action-500"><BarChart3 className="h-3.5 w-3.5" aria-hidden="true" /> Purchase reports</Link>
        </div>
      </section>

      {hasError ? <div role="alert" className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3">
        <p className="min-w-0 flex-1 basis-48 text-xs leading-5 text-amber-900">Some shop details could not be loaded. Available sections are still ready to browse; missing information is not estimated.</p><HomeRefreshButton />
      </div> : null}

      <PromoCarousel banners={data.banners} />

      <section aria-label="Shop by category" className="space-y-3 rounded-2xl border border-slate-200 bg-white p-3 shadow-sm sm:space-y-4 sm:p-5">
        <SectionHeading eyebrow="Find your aisle" title="Shop by category" href="/retailer/categories" linkLabel="View all categories" />
        {data.categories.length ? <ul className="scrollbar-none -mx-1 flex snap-x gap-2 overflow-x-auto px-1 pb-1 sm:mx-0 sm:grid sm:grid-cols-5 sm:gap-3 sm:overflow-visible sm:px-0 sm:pb-0 lg:grid-cols-10">
          {data.categories.map((category) => <li className="w-[5.5rem] min-w-0 shrink-0 snap-start sm:w-auto" key={category.id}><CategoryCard category={category} compact href={`/retailer/categories?category=${category.id}`} /></li>)}
        </ul> : <HomeEmptyState icon={LayoutGrid} title={data.errors.categories ? 'Categories are temporarily unavailable' : 'No categories available yet'} body="You can still open the catalog to look for products." href="/retailer/catalog" linkLabel="Browse catalog" />}
      </section>

      <section aria-label="Featured products" className="space-y-4">
        <SectionHeading eyebrow="For your next restock" title="Featured products" href="/retailer/catalog" linkLabel="Browse catalog" />
        {data.errors.pricing ? <p role="status" className="text-xs text-amber-800">Current pricing could not be loaded. Add to Cart will be available when prices can be verified.</p> : null}
        {featured.length ? <div className="grid grid-cols-2 items-stretch gap-2.5 sm:grid-cols-3 sm:gap-4 lg:grid-cols-4">
          {featured.map((product) => <ProductCard key={product.id} {...product} />)}
        </div> : <HomeEmptyState icon={Package} title={data.errors.catalog ? 'Products are temporarily unavailable' : 'Your catalog is getting ready'} body="Active products and your current wholesale prices will appear here when available." href="/retailer/catalog" linkLabel="Browse Products" />}
      </section>

      <section aria-label="Wholesale deals" className="space-y-4 rounded-2xl border border-emerald-100 bg-emerald-50/40 p-4 sm:p-5">
        <SectionHeading eyebrow="More quantity. Better value." title="Wholesale deals" href="/retailer/schemes" linkLabel="View offers" />
        <p className="text-xs leading-5 text-slate-600">Buy more, save more with configured quantity rates. Each deal shows the quantity needed to unlock it.</p>
        {deals.length ? <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">{deals.map((product) => <WholesaleDealCard key={product.id} product={product} />)}</div>
          : <HomeEmptyState icon={BadgePercent} title={data.errors.pricing ? 'Quantity rates are temporarily unavailable' : 'No bulk deals available right now'} body="Browse the catalog for current wholesale prices, or check the offers page for active schemes." href="/retailer/schemes" linkLabel="Check offers" />}
      </section>

      <section id="home-reorder" aria-label="Buy again" className="scroll-mt-36 space-y-4">
        <SectionHeading eyebrow="Your shop’s essentials" title="Buy again" href="/retailer/orders" linkLabel="View your orders" />
        <p className="text-xs leading-5 text-slate-600">Your recently purchased packs, with last-ordered quantities. Today’s prices and minimums apply.</p>
        {data.reorders.length ? <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">{data.reorders.map((item) => <HomeReorderCard key={item.packId ?? item.productId} item={item} />)}</div>
          : <HomeEmptyState icon={RotateCcw} title={data.errors.history ? 'Order history is temporarily unavailable' : 'Make your next restock a one-tap reorder'} body="Products from your confirmed orders will appear here. Start with the catalog, or review your existing orders." href="/retailer/orders" linkLabel="View orders" />}
        {data.frequent.length ? <ProductRail title="Frequently ordered by you" href="/retailer/catalog?sort=frequent" linkLabel="View products" products={data.frequent} /> : null}
      </section>

      {data.brands.length ? <section aria-label="Shop by brand" className="space-y-4 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
        <SectionHeading eyebrow="Find your favourites" title="Shop by brand" href="/retailer/brands" linkLabel="View all brands" />
        <ul className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">{data.brands.slice(0, 10).map((brand) => <li className="min-w-0" key={brand.id}><BrandCard brand={brand} compact /></li>)}</ul>
      </section> : null}

      <div className="grid items-start gap-4 lg:grid-cols-2">
        <HomeCartSummary cart={data.cart} />
        <HomeCreditSummary wallet={wallet} />
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

function HomeCreditSummary({ wallet }: { wallet: WalletSummary | null }) {
  return <section aria-label="Credit summary" className="min-w-0 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
    <div className="flex items-center gap-3"><span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-slate-100 text-slate-600"><Wallet className="h-5 w-5" aria-hidden="true" /></span><div><h2 className="text-base font-bold text-slate-900">Your business account</h2><p className="mt-0.5 text-[11px] text-slate-500">Keep your credit in view.</p></div></div>
    {wallet ? <dl className="mt-4 space-y-3 text-xs">
      <div className="flex flex-wrap justify-between gap-2"><dt className="text-slate-600">Outstanding</dt><dd className="font-semibold text-slate-900">{formatInr(fromPaise(wallet.outstandingPaise))}</dd></div>
      <div className="flex flex-wrap justify-between gap-2"><dt className="text-slate-600">Available credit</dt><dd className="font-semibold text-emerald-700">{wallet.hasConfiguredLimit ? formatInr(fromPaise(wallet.availablePaise)) : 'Not configured'}</dd></div>
      <div className="flex flex-wrap justify-between gap-2"><dt className="text-slate-600">Credit limit</dt><dd className="font-semibold text-slate-900">{wallet.hasConfiguredLimit ? formatInr(fromPaise(wallet.creditLimitPaise)) : 'Not configured'}</dd></div>
    </dl> : <p className="mt-4 text-xs leading-5 text-slate-500">Credit details are currently unavailable. Open your ledger to review your account.</p>}
    <Link href="/retailer/account/ledger" className="mt-4 flex min-h-11 items-center justify-between gap-2 rounded-xl border border-slate-200 px-3 text-xs font-semibold text-action-700 hover:bg-action-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-action-500">View credit & ledger <ArrowRight className="h-4 w-4" aria-hidden="true" /></Link>
    <Link href="/retailer/favorites" className="mt-2 inline-flex min-h-11 items-center gap-1.5 text-[11px] font-semibold text-action-700 hover:underline"><Sparkles className="h-3.5 w-3.5" aria-hidden="true" /> Shop your favourites</Link>
  </section>;
}

function HomeEmptyState({ icon: Icon, title, body, href, linkLabel }: { icon: typeof Package; title: string; body: string; href: string; linkLabel: string }) {
  return <div className="flex flex-col items-start gap-3 rounded-2xl border border-dashed border-slate-200 bg-white p-4 sm:flex-row sm:items-center sm:p-5">
    <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-slate-50 text-slate-500"><Icon className="h-5 w-5" aria-hidden="true" /></span>
    <div className="min-w-0 flex-1"><h3 className="text-sm font-semibold text-slate-800">{title}</h3><p className="mt-1 text-xs leading-5 text-slate-500">{body}</p><Link href={href} className="mt-2 inline-flex min-h-11 items-center gap-1.5 rounded text-xs font-semibold text-action-700 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-action-500">{linkLabel} <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" /></Link></div>
  </div>;
}
