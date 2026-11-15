import { CommerceSteps } from '@/components/retailer/commerce-steps';
import Link from 'next/link';
import {
  ArrowRight,
  BadgePercent,
  ChevronLeft,
  CircleAlert,
  Info,
  PackageCheck,
  ReceiptText,
  ShoppingCart,
  Truck,
} from 'lucide-react';
import { createClient } from '@/lib/supabase/server';
import { requireUser } from '@/lib/auth/session';
import { getProductPriceOverrides, resolvePackPrice } from '@/lib/retailer/effective-price';
import { piecePriceFromCase } from '@/lib/retailer/case-pricing';
import { calculateRetailerPiecePrice } from '@/lib/retailer/retailer-pricing';
import { loadPackTiers } from '@/lib/retailer/pricing-data';
import { CartItemRow } from '@/components/retailer/cart-item-row';
import { CartSaveControls } from '@/components/retailer/cart-save-controls';
import { CartOrderSummary } from '@/components/retailer/cart-order-summary';
import { CartCheckoutBar } from '@/components/retailer/cart-checkout-bar';
import { CouponApplyForm } from '@/components/retailer/coupon-apply-form';
import { ClearCartButton } from '@/components/retailer/clear-cart-button';
import { CoinsBalanceCard } from '@/components/retailer/coins-balance-card';
import { ProductRail } from '@/components/retailer/product-rail';
import { RecentlyViewedRail } from '@/components/retailer/recently-viewed';
import { loadFavoriteIds } from '@/lib/retailer/catalog';
import { calcSavings, formatInr } from '@/lib/retailer/format';
import { getRetailerWalletSummary } from '@/lib/retailer/wallet';
import { getFrequentlyOrderedCards } from '@/lib/retailer/personalization';
import { loadCartCouponLines } from '@/lib/coupons/cart-lines';
import { loadActiveCouponForRetailer, validateCouponForOrder } from '@/lib/coupons/validate';
import {
  loadMarketplaceOfferQuotes,
  resolveOfferUnitPricePaise,
} from '@/lib/retailer/marketplace-offers';

interface CartItemDetail {
  id: string;
  quantity: number;
  pack_id: string;
  product_id: string;
  seller_offer_id: string | null;
  source_type: 'maharani' | 'seller';
  product_packs: {
    id: string;
    pack_name: string;
    base_price: number;
    ptr: number | null;
    case_price: number;
    units_per_case: number;
    mrp: number | null;
    /** Minimum order quantity in PIECES. */
    moq: number;
    /** false = this pack is sold in whole cases only. */
    allow_loose_pieces: boolean;
    image_url: string | null;
    is_active: boolean;
  } | null;
  products: {
    name: string;
    gst_percent: number;
    is_active: boolean;
    brands: { name: string } | null;
    product_images: { image_url: string; sort_order: number }[];
  } | null;
}

function Breadcrumb() {
  return (
    <nav
      aria-label="Breadcrumb"
      className="flex items-center gap-1.5 text-[10px] font-semibold text-slate-500 sm:text-xs"
    >
      <Link href="/retailer/home" className="flex min-h-11 min-w-11 items-center justify-center rounded hover:text-primary-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-600">
        Home
      </Link>
      <span aria-hidden="true">/</span>
      <span className="text-slate-800">Cart</span>
    </nav>
  );
}

export default async function CartPage() {
  const user = await requireUser();
  const supabase = (await createClient());

  const [{ data: cartData }, { data: retailer }, favoriteIds, walletSummary] = await Promise.all([
    supabase
      .from('cart_items')
      .select(
        'id, quantity, pack_id, product_id, seller_offer_id, source_type, product_packs ( id, pack_name, base_price, ptr, case_price, units_per_case, mrp, moq, allow_loose_pieces, image_url, is_active ), products ( name, gst_percent, is_active, brands ( name ), product_images ( image_url, sort_order ) )'
      )
      .eq('retailer_id', user.id)
      .order('updated_at', { ascending: false }),
    supabase
      .from('retailers')
      .select('area_id, credit_limit, outstanding_balance')
      .eq('id', user.id)
      .maybeSingle<{ area_id: string; credit_limit: number; outstanding_balance: number }>(),
    loadFavoriteIds(supabase, user.id),
    getRetailerWalletSummary(supabase, user.id),
  ]);

  const items = (cartData ?? []) as unknown as CartItemDetail[];
  const frequent = await getFrequentlyOrderedCards(supabase, user.id, retailer?.area_id ?? null, favoriteIds, 8);
  const recommended = frequent.filter((card) => !items.some((item) => item.product_id === card.id));

  if (items.length === 0) {
    return (
      <div className="space-y-5 sm:space-y-6">
        <Breadcrumb />
        <section className="flex min-h-[360px] flex-col items-center justify-center rounded-2xl border border-slate-200 bg-white px-5 py-12 text-center shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
          <span className="flex h-20 w-20 items-center justify-center rounded-full bg-primary-50 text-primary-600">
            <ShoppingCart className="h-9 w-9" aria-hidden="true" />
          </span>
          <h1 className="shop-heading mt-5 font-semibold tracking-tight text-slate-950">Your cart is empty</h1>
          <p className="mt-2 max-w-sm text-xs leading-5 text-slate-500">
            Browse the catalog and add the products your shop needs today.
          </p>
          <div className="mt-6 flex flex-wrap justify-center gap-2">
            <Link
              href="/retailer/catalog"
              className="flex h-11 items-center gap-2 rounded-xl bg-primary-600 px-5 text-xs font-bold text-white shadow-sm transition hover:bg-primary-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-300 focus-visible:ring-offset-2"
            >
              Browse Products <ArrowRight className="h-4 w-4" aria-hidden="true" />
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
  const sellerOfferIds = items
    .map((item) => item.seller_offer_id)
    .filter((id): id is string => Boolean(id));
  const [overrideByProduct, tierMap, marketplaceResult] = await Promise.all([
    getProductPriceOverrides(supabase, distinctProductIds, user.id, retailer?.area_id ?? null),
    loadPackTiers(supabase, items.map((item) => item.pack_id), user.id),
    loadMarketplaceOfferQuotes(supabase, sellerOfferIds),
  ]);
  const offerById = new Map(marketplaceResult.offers.map((offer) => [offer.offerId, offer]));

  const pricedLines = items.map((item) => {
    const pack = item.product_packs;
    const product = item.products;
    const gstPercent = product?.gst_percent ?? 0;
    const marketplaceOffer = item.seller_offer_id ? offerById.get(item.seller_offer_id) : null;
    const marketplaceLine = Boolean(item.seller_offer_id);
    const casePrice = !marketplaceLine && pack
      ? resolvePackPrice(pack, overrideByProduct.get(item.product_id) ?? null)
      : 0;
    const moq = marketplaceOffer?.moq ?? (marketplaceLine ? 1 : pack?.moq ?? 1);
    const tiers = marketplaceLine ? [] : pack ? tierMap.get(pack.id) ?? [] : [];
    // Marketplace lines use the approved offer's integer-paise piece price;
    // Maharani lines retain the canonical case/tier engine.
    const derivedPiecePrice = marketplaceOffer
      ? resolveOfferUnitPricePaise(marketplaceOffer, item.quantity) / 100
      : pack ? piecePriceFromCase(casePrice, pack.units_per_case) : 0;
    const pricing = calculateRetailerPiecePrice({
      quantity: item.quantity,
      unitsPerCase: pack?.units_per_case ?? 1,
      casePrice,
      tiers,
      gstPercent,
      moq,
      derivedPiecePrice,
    });
    const marketplaceUnavailable = marketplaceLine && (
      !marketplaceOffer
      || !marketplaceOffer.inStock
      || (marketplaceOffer.stockQuantity ?? 0) < item.quantity
    );
    const images = [...(product?.product_images ?? [])].sort((a, b) => a.sort_order - b.sort_order);
    // The cart line shows the variant's own image when it has one (same rule
    // as the product page size switcher), falling back to the product gallery.
    const lineImage = pack?.image_url ?? images[0]?.image_url;

    const line = {
      id: item.id,
      productId: item.product_id,
      quantity: item.quantity,
      isOrderable: pricing.orderable,
      quantityMessage: pricing.message,
      packName: pack?.pack_name ?? 'Unknown pack',
      productName: product?.name ?? 'Unknown product',
      brandName: product?.brands?.name ?? null,
      imageUrl: lineImage,
      gstPercent,
      moq,
      mrp: pack?.mrp,
      unitsPerCase: pack?.units_per_case ?? 1,
      derivedPiecePrice,
      tiers,
      allowLoosePieces: marketplaceLine || pack?.allow_loose_pieces !== false,
      isUnavailable: !pack?.is_active || !product?.is_active || marketplaceUnavailable,
      isFavorite: favoriteIds.has(item.product_id),
      sellerName: marketplaceOffer?.sellerBusinessName ?? null,
      sellerGstin: marketplaceOffer?.sellerGstin ?? null,
      fulfilmentType: marketplaceOffer?.fulfilmentType ?? null,
    };
    // Totals are summed after the map, in line order, rather than by
    // reassigning outer variables from inside the callback.
    return {
      line,
      subtotal: pricing.subtotal,
      gst: pricing.gst,
      gstPercent,
      savings: calcSavings(pack?.mrp, pricing.unitPrice, pricing.quantity),
    };
  });

  let subtotal = 0;
  let gstTotal = 0;
  let savings = 0;
  const gstByRate = new Map<number, number>();
  for (const entry of pricedLines) {
    subtotal += entry.subtotal;
    gstTotal += entry.gst;
    gstByRate.set(entry.gstPercent, (gstByRate.get(entry.gstPercent) ?? 0) + entry.gst);
    savings += entry.savings;
  }
  const lines = pricedLines.map((entry) => entry.line);

  // COUPON (0051): the stored code is REVALIDATED server-side against the
  // current cart before any discount is shown. A code that no longer applies
  // (window closed, minimum order dropped, no eligible items, limits reached)
  // is displayed as a warning and NOT subtracted — the same validator runs
  // again inside the quote when the order is actually created.
  const cartCoupon = await loadActiveCouponForRetailer(supabase, user.id);
  let appliedCoupon: { code: string; discount: number } | null = null;
  let couponWarning: string | null = null;
  if (cartCoupon.coupon && !cartCoupon.error) {
    const { lines: couponLines } = await loadCartCouponLines(supabase, user.id, retailer?.area_id ?? null);
    const validation = await validateCouponForOrder(supabase, {
      retailerId: user.id,
      code: cartCoupon.coupon.code,
      lines: couponLines,
    });
    if (validation.valid) {
      appliedCoupon = { code: validation.coupon.code, discount: validation.discount };
    } else {
      couponWarning = `Coupon ${cartCoupon.coupon.code} no longer applies: ${validation.message}`;
    }
  }

  const discountTotal = appliedCoupon?.discount ?? 0;
  const grandTotal = subtotal + gstTotal - discountTotal;
  const hasUnavailable = lines.some((line) => line.isUnavailable);
  // A line is only orderable when the engine could price it at a valid retail
  // piece rate (whole quantity, at or above MOQ). Unpriced requests are blocked
  // here rather than silently re-priced.
  const blockedLines = lines.filter((line) => !line.isUnavailable && !line.isOrderable);
  const availableCount = lines.filter((line) => !line.isUnavailable && line.isOrderable).length;
  const checkoutBlocked = hasUnavailable || blockedLines.length > 0 || Boolean(marketplaceResult.error);
  const totalQuantity = lines.reduce((sum, line) => sum + line.quantity, 0);

  return (
    <div className="space-y-5 pb-24 sm:space-y-6 lg:pb-0">
      <CommerceSteps current={1} />
      <Breadcrumb />

      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="shop-intro">
          <p className="shop-eyebrow">Review your order</p>
          <h1 className="shop-heading mt-1 font-semibold tracking-tight text-slate-950">Your cart</h1>
          <p className="mt-1 text-xs text-slate-500">
            {items.length} line{items.length === 1 ? '' : 's'} · {totalQuantity} pc{totalQuantity === 1 ? '' : 's'} in total
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <CartSaveControls itemCount={items.length} />
          <ClearCartButton itemCount={items.length} />
          <Link
            href="/retailer/catalog"
            className="flex h-11 items-center gap-1.5 rounded-lg border border-slate-400 bg-white px-3 text-[10px] font-bold text-slate-700 shadow-sm transition hover:border-primary-500 hover:text-primary-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-600"
          >
            <ChevronLeft className="h-3.5 w-3.5" aria-hidden="true" /> Continue shopping
          </Link>
        </div>
      </div>

      {hasUnavailable ? (
        <div
          role="status"
          className="flex items-start gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs text-amber-800"
        >
          <Info className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          <p>
            <span className="font-bold">Heads up.</span> Unavailable items are clearly marked. Remove them or choose an available seller before checkout.
          </p>
        </div>
      ) : null}

      {blockedLines.length > 0 ? (
        <div
          role="alert"
          className="flex items-start gap-3 rounded-xl border border-primary-200 bg-primary-50 px-4 py-3 text-xs text-primary-800"
        >
          <CircleAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          <div className="space-y-1">
            <p className="font-bold">Some quantities cannot be ordered yet</p>
            <ul className="list-disc space-y-0.5 pl-4">
              {blockedLines.map((line) => (
                <li key={line.id}>
                  <span className="font-semibold">{line.productName}</span> ({line.packName}) —{' '}
                  {line.quantityMessage ?? 'adjust the quantity to continue.'}
                </li>
              ))}
            </ul>
          </div>
        </div>
      ) : null}

      {savings > 0 ? (
        <div className="flex items-center gap-3 rounded-2xl border border-mint-200 bg-mint-50/70 px-4 py-3">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-mint-600 text-white shadow-sm">
            <BadgePercent className="h-5 w-5" aria-hidden="true" />
          </span>
          <p className="min-w-0 text-xs leading-5 text-mint-900 sm:text-sm">
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
          <CouponApplyForm applied={appliedCoupon} warning={couponWarning} />

          <CartOrderSummary
            subtotal={subtotal}
            gstByRate={[...gstByRate.entries()].map(([rate, amount]) => ({ rate, amount }))}
            savings={savings}
            grandTotal={grandTotal}
            orderableCount={availableCount}
            checkoutBlocked={checkoutBlocked}
            coupon={appliedCoupon}
          />

          {/* 🪙 Coins — the only balance a retailer has (no credit, no terms). */}
          <CoinsBalanceCard
            limitPaise={walletSummary.creditLimitPaise}
            outstandingPaise={walletSummary.outstandingPaise}
            orderTotalPaise={Math.round(grandTotal * 100)}
          />

          <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
            <div className="space-y-3">
              {[
                { icon: PackageCheck, title: 'Piece pricing', body: 'Each piece is priced — bigger quantities earn a lower per-piece rate' },
                { icon: ReceiptText, title: 'GST transparent', body: 'Tax shown on every invoice' },
                { icon: Truck, title: 'Track delivery', body: 'Status updates once your order is confirmed' },
              ].map((item) => (
                <div key={item.title} className="flex items-start gap-2.5">
                  <item.icon className="mt-0.5 h-4 w-4 shrink-0 text-primary-600" aria-hidden="true" />
                  <div>
                    <p className="text-[10px] font-bold text-slate-800">{item.title}</p>
                    <p className="mt-0.5 text-[9px] text-slate-500">{item.body}</p>
                  </div>
                </div>
              ))}
            </div>
          </section>
        </aside>
      </div>

      <CartCheckoutBar grandTotal={grandTotal} orderableCount={availableCount} checkoutBlocked={checkoutBlocked} />

      <ProductRail eyebrow="Add more" title="Frequently bought products" products={recommended} href="/retailer/catalog" />
    </div>
  );
}
