import Link from 'next/link';
import {
  ArrowRight,
  BadgePercent,
  ChevronLeft,
  Info,
  PackageCheck,
  ReceiptText,
  ShoppingCart,
  Truck,
} from 'lucide-react';
import { createClient } from '@/lib/supabase/server';
import { requireUser } from '@/lib/auth/session';
import { getProductPriceOverrides, resolvePackPrice } from '@/lib/retailer/effective-price';
import { caseLineBreakdown } from '@/lib/retailer/case-pricing';
import { loadPackTiers } from '@/lib/retailer/pricing-data';
import { CartItemRow } from '@/components/retailer/cart-item-row';
import { CartOrderSummary } from '@/components/retailer/cart-order-summary';
import { CartCheckoutBar } from '@/components/retailer/cart-checkout-bar';
import { CreditSummary } from '@/components/retailer/credit-summary';
import { ProductRail } from '@/components/retailer/product-rail';
import { RecentlyViewedRail } from '@/components/retailer/recently-viewed';
import { loadFavoriteIds } from '@/lib/retailer/catalog';
import { calcSavings, formatInr } from '@/lib/retailer/format';
import { getFrequentlyOrderedCards } from '@/lib/retailer/personalization';

interface CartItemDetail {
  id: string;
  quantity: number;
  pack_id: string;
  product_id: string;
  product_packs: {
    id: string;
    pack_name: string;
    pack_sku_code: string;
    base_price: number;
    ptr: number | null;
    case_price: number;
    units_per_case: number;
    mrp: number | null;
    moq: number;
    is_active: boolean;
  } | null;
  products: {
    name: string;
    sku_code: string;
    gst_percent: number;
    is_active: boolean;
    brands: { name: string } | null;
    product_images: { image_url: string; sort_order: number }[];
  } | null;
}

function Breadcrumb() {
  return (
    <nav aria-label="Breadcrumb" className="flex items-center gap-1.5 text-[10px] font-semibold text-slate-500 sm:text-xs">
      <Link href="/retailer/home" className="hover:text-primary-600">
        Home
      </Link>
      <span aria-hidden="true">/</span>
      <span className="text-slate-800">Cart</span>
    </nav>
  );
}

export default async function CartPage() {
  const user = await requireUser();
  const supabase = createClient();

  const [{ data: cartData }, { data: retailer }, favoriteIds] = await Promise.all([
    supabase
      .from('cart_items')
      .select(
        'id, quantity, pack_id, product_id, product_packs ( id, pack_name, pack_sku_code, base_price, ptr, case_price, units_per_case, mrp, moq, is_active ), products ( name, sku_code, gst_percent, is_active, brands ( name ), product_images ( image_url, sort_order ) )'
      )
      .eq('retailer_id', user.id)
      .order('updated_at', { ascending: false }),
    supabase
      .from('retailers')
      .select('area_id, credit_limit, outstanding_balance')
      .eq('id', user.id)
      .maybeSingle<{ area_id: string; credit_limit: number; outstanding_balance: number }>(),
    loadFavoriteIds(supabase, user.id),
  ]);

  const items = (cartData ?? []) as unknown as CartItemDetail[];
  const frequent = await getFrequentlyOrderedCards(supabase, user.id, retailer?.area_id ?? null, favoriteIds, 8);
  const recommended = frequent.filter((card) => !items.some((item) => item.product_id === card.id));

  if (items.length === 0) {
    return (
      <div className="space-y-5 sm:space-y-6">
        <Breadcrumb />
        <section className="flex min-h-[360px] flex-col items-center justify-center rounded-2xl border border-slate-200 bg-white px-5 py-12 text-center shadow-[0_8px_30px_rgba(15,23,42,0.06)]">
          <span className="flex h-20 w-20 items-center justify-center rounded-full bg-primary-50 text-primary-600">
            <ShoppingCart className="h-9 w-9" aria-hidden="true" />
          </span>
          <h1 className="mt-5 text-xl font-bold tracking-tight text-slate-950 sm:text-2xl">Your cart is empty</h1>
          <p className="mt-2 max-w-sm text-xs leading-5 text-slate-500">Browse Maharani Traders products and start shopping.</p>
          <div className="mt-6 flex flex-wrap justify-center gap-2">
            <Link
              href="/retailer/catalog"
              className="flex h-11 items-center gap-2 rounded-xl bg-primary-600 px-5 text-xs font-bold text-white shadow-sm transition hover:bg-primary-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-300 focus-visible:ring-offset-2"
            >
              Continue shopping <ArrowRight className="h-4 w-4" aria-hidden="true" />
            </Link>
            <Link
              href="/retailer/quick-order"
              className="flex h-11 items-center rounded-xl border border-slate-200 bg-white px-5 text-xs font-bold text-slate-700 transition hover:border-primary-200 hover:text-primary-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-300"
            >
              Quick order
            </Link>
          </div>
        </section>
        <ProductRail eyebrow="Suggested for you" title="Frequently bought products" products={recommended} href="/retailer/catalog" />
        <RecentlyViewedRail />
      </div>
    );
  }

  const distinctProductIds = [...new Set(items.map((item) => item.product_id))];
  const overrideByProduct = await getProductPriceOverrides(supabase, distinctProductIds, user.id, retailer?.area_id ?? null);
  const tierMap = await loadPackTiers(
    supabase,
    items.map((item) => item.pack_id)
  );

  let subtotal = 0;
  let gstTotal = 0;
  let savings = 0;
  const gstByRate = new Map<number, number>();
  const lines = items.map((item) => {
    const pack = item.product_packs;
    const product = item.products;
    const gstPercent = product?.gst_percent ?? 0;
    const casePrice = pack ? resolvePackPrice(pack, overrideByProduct.get(item.product_id) ?? null) : 0;
    const breakdown = caseLineBreakdown({
      casePrice,
      unitsPerCase: pack?.units_per_case ?? 1,
      tiers: pack ? tierMap.get(pack.id) ?? [] : [],
      packQuantity: item.quantity,
      gstPercent,
    });
    const unitPrice = breakdown.piecePrice * (pack?.units_per_case ?? 1); // per case, GST-inclusive
    subtotal += breakdown.subtotal;
    gstTotal += breakdown.gst;
    gstByRate.set(gstPercent, (gstByRate.get(gstPercent) ?? 0) + breakdown.gst);
    savings += calcSavings(pack?.mrp, breakdown.piecePrice, breakdown.pieces);
    const images = [...(product?.product_images ?? [])].sort((a, b) => a.sort_order - b.sort_order);

    return {
      id: item.id,
      productId: item.product_id,
      quantity: item.quantity,
      packName: pack?.pack_name ?? 'Unknown pack',
      productName: product?.name ?? 'Unknown product',
      brandName: product?.brands?.name ?? null,
      skuCode: pack?.pack_sku_code || product?.sku_code || null,
      imageUrl: images[0]?.image_url,
      unitPrice,
      gstPercent,
      moq: pack?.moq ?? 1,
      mrp: pack?.mrp,
      unitsPerCase: pack?.units_per_case ?? 1,
      casePrice,
      tiers: pack ? tierMap.get(pack.id) ?? [] : [],
      isUnavailable: !pack?.is_active || !product?.is_active,
      isFavorite: favoriteIds.has(item.product_id),
    };
  });

  const grandTotal = subtotal + gstTotal;
  const hasUnavailable = lines.some((line) => line.isUnavailable);
  const availableCount = lines.filter((line) => !line.isUnavailable).length;
  const totalQuantity = lines.reduce((sum, line) => sum + line.quantity, 0);

  return (
    <div className="space-y-5 pb-24 sm:space-y-6 lg:pb-0">
      <Breadcrumb />

      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-primary-600">Review your order</p>
          <h1 className="mt-1 text-xl font-bold tracking-tight text-slate-950 sm:text-3xl">Shopping cart</h1>
          <p className="mt-1 text-xs text-slate-500">
            {items.length} line item{items.length === 1 ? '' : 's'} · {totalQuantity} pack{totalQuantity === 1 ? '' : 's'}
          </p>
        </div>
        <Link
          href="/retailer/catalog"
          className="flex h-9 items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 text-[10px] font-bold text-slate-700 shadow-sm transition hover:border-primary-200 hover:text-primary-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-300"
        >
          <ChevronLeft className="h-3.5 w-3.5" aria-hidden="true" /> Continue shopping
        </Link>
      </div>

      {hasUnavailable ? (
        <div className="flex items-start gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs text-amber-800">
          <Info className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          <p>
            <span className="font-bold">Cart update required.</span> Unavailable products are clearly marked and will be excluded when the order is validated.
          </p>
        </div>
      ) : null}

      {savings > 0 ? (
        <div className="flex items-center gap-3 rounded-2xl border border-emerald-200 bg-gradient-to-r from-emerald-50 to-teal-50 px-4 py-3">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-emerald-600 text-white shadow-sm">
            <BadgePercent className="h-5 w-5" aria-hidden="true" />
          </span>
          <p className="min-w-0 text-xs leading-5 text-emerald-900 sm:text-sm">
            <span className="font-bold">You save {formatInr(savings)}</span> on this order compared to MRP.
          </p>
        </div>
      ) : null}

      <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_360px] lg:gap-7">
        <section className="space-y-3" aria-label="Cart items">
          {lines.map((line) => (
            <CartItemRow key={line.id} {...line} />
          ))}
        </section>

        <aside className="space-y-3 lg:sticky lg:top-36">
          <CartOrderSummary
            subtotal={subtotal}
            gstByRate={[...gstByRate.entries()].map(([rate, amount]) => ({ rate, amount }))}
            savings={savings}
            grandTotal={grandTotal}
            orderableCount={availableCount}
          />

          {retailer ? (
            <CreditSummary creditLimit={retailer.credit_limit} outstandingBalance={retailer.outstanding_balance} orderImpact={grandTotal} />
          ) : null}

          <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
            <div className="space-y-3">
              {[
                { icon: PackageCheck, title: 'MOQ verified', body: 'Every pack checked before order' },
                { icon: ReceiptText, title: 'GST transparent', body: 'Tax shown on every invoice' },
                { icon: Truck, title: 'Track fulfillment', body: 'Status updates after ordering' },
              ].map((item) => (
                <div key={item.title} className="flex items-start gap-2.5">
                  <item.icon className="mt-0.5 h-4 w-4 shrink-0 text-primary-600" aria-hidden="true" />
                  <div>
                    <p className="text-[10px] font-bold text-slate-800">{item.title}</p>
                    <p className="mt-0.5 text-[9px] text-slate-400">{item.body}</p>
                  </div>
                </div>
              ))}
            </div>
          </section>
        </aside>
      </div>

      <CartCheckoutBar grandTotal={grandTotal} orderableCount={availableCount} />

      <ProductRail eyebrow="Add more" title="Frequently bought products" products={recommended} href="/retailer/catalog" />
    </div>
  );
}
