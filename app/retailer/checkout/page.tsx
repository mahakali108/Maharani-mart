import { CommerceSteps } from '@/components/retailer/commerce-steps';
import Link from 'next/link';
import Image from 'next/image';
import { redirect } from 'next/navigation';
import {
  Check,
  ChevronLeft,
  ChevronRight,
  CreditCard,
  ImageOff,
  ReceiptText,
  ShieldCheck,
  ShoppingCart,
  Truck,
} from 'lucide-react';
import { createClient } from '@/lib/supabase/server';
import { requireUser } from '@/lib/auth/session';
import { getProductPriceOverrides, resolvePackPrice } from '@/lib/retailer/effective-price';
import { piecePriceFromCase } from '@/lib/retailer/case-pricing';
import { calculateRetailerPiecePrice } from '@/lib/retailer/retailer-pricing';
import { loadPackTiers } from '@/lib/retailer/pricing-data';
import { CheckoutForm } from '@/components/retailer/checkout-form';
import { CoinsCheckoutSummary } from '@/components/retailer/coins-checkout-summary';
import { CheckoutAddressProvider } from '@/components/retailer/checkout-address-context';
import { CheckoutAddressSelector } from '@/components/retailer/checkout-address-selector';
import type { SavedAddress } from '@/components/retailer/address-form';
import { calcSavings, formatInr } from '@/lib/retailer/format';
import { buildCanonicalProductName } from '@/lib/retailer/product-name';
import { getRetailerWalletSummary } from '@/lib/retailer/wallet';
import { coinBalancePaise, computeCoinPayment } from '@/lib/coins/math';
import { loadCartCouponLines } from '@/lib/coupons/cart-lines';
import { loadActiveCouponForRetailer, validateCouponForOrder } from '@/lib/coupons/validate';
import {
  loadMarketplaceOfferQuotes,
  resolveOfferUnitPricePaise,
} from '@/lib/retailer/marketplace-offers';

interface CartItemDetail {
  id: string;
  quantity: number;
  product_id: string;
  pack_id: string;
  seller_offer_id: string | null;
  source_type: 'maharani' | 'seller';
  product_packs: {
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

/**
 * `credit_limit` / `outstanding_balance` are the legacy wallet columns that
 * BACK the coin balance (coins available = funded limit − spent). They are read
 * only — nothing in the customer flow shows or charges credit.
 */
interface RetailerAccountRow {
  area_id: string;
  credit_limit: number;
  outstanding_balance: number;
  shop_name: string;
  address: string | null;
  areas: { name: string; district: string | null } | null;
}

interface CheckoutProfileRow {
  full_name: string;
  phone: string | null;
}

export default async function CheckoutPage() {
  const user = await requireUser();
  const supabase = createClient();

  const [{ data: cartData }, { data: retailer }, { data: profile }, walletSummary, { data: addressRows }] = await Promise.all([
    supabase
      .from('cart_items')
      .select(
        'id, quantity, product_id, pack_id, seller_offer_id, source_type, product_packs ( pack_name, base_price, ptr, case_price, units_per_case, mrp, moq, allow_loose_pieces, image_url, is_active ), products ( name, gst_percent, is_active, brands ( name ), product_images ( image_url, sort_order ) )'
      )
      .eq('retailer_id', user.id)
      .order('updated_at', { ascending: false }),
    supabase
      .from('retailers')
      .select('area_id, credit_limit, outstanding_balance, shop_name, address, areas ( name, district )')
      .eq('id', user.id)
      .maybeSingle<RetailerAccountRow>(),
    supabase.from('profiles').select('full_name, phone').eq('id', user.id).maybeSingle<CheckoutProfileRow>(),
    getRetailerWalletSummary(supabase, user.id),
    supabase
      .from('retailer_addresses')
      .select('id, label, receiver_name, phone, line1, line2, landmark, city, district, state, pincode, is_default')
      .eq('retailer_id', user.id)
      .order('is_default', { ascending: false })
      .order('created_at', { ascending: true }),
  ]);

  const savedAddresses = ((addressRows ?? []) as unknown as SavedAddress[]).filter((row) => row.id);
  const defaultAddress = savedAddresses.find((row) => row.is_default) ?? savedAddresses[0] ?? null;

  const items = (cartData ?? []) as unknown as CartItemDetail[];
  if (items.length === 0) redirect('/retailer/cart');

  const distinctProductIds = [...new Set(items.map((item) => item.product_id))];
  const sellerOfferIds = items
    .map((item) => item.seller_offer_id)
    .filter((id): id is string => Boolean(id));
  const [overrideByProduct, tierMap, marketplaceResult] = await Promise.all([
    getProductPriceOverrides(supabase, distinctProductIds, user.id, retailer?.area_id ?? null),
    loadPackTiers(supabase, items.map((item) => item.pack_id)),
    loadMarketplaceOfferQuotes(supabase, sellerOfferIds),
  ]);
  const offerById = new Map(marketplaceResult.offers.map((offer) => [offer.offerId, offer]));

  let subtotal = 0;
  let gstTotal = 0;
  let savings = 0;
  const gstByRate = new Map<number, number>();
  const lines = items.map((item) => {
    const pack = item.product_packs;
    const product = item.products;
    const gstPercent = product?.gst_percent ?? 0;
    const marketplaceOffer = item.seller_offer_id ? offerById.get(item.seller_offer_id) : null;
    const marketplaceLine = Boolean(item.seller_offer_id);
    const moq = marketplaceOffer?.moq ?? (marketplaceLine ? 1 : pack?.moq ?? 1);
    const marketplaceAvailable = !marketplaceLine || Boolean(
      marketplaceOffer
      && marketplaceOffer.inStock
      && (marketplaceOffer.stockQuantity ?? 0) >= item.quantity
    );
    // Seller lines use only the approved offer's integer-paise piece rate.
    // Maharani lines retain the same tier/override engine as the final quote.
    const pricing = calculateRetailerPiecePrice({
      quantity: item.quantity,
      unitsPerCase: pack?.units_per_case ?? 1,
      casePrice: 0,
      tiers: marketplaceLine ? [] : item.pack_id ? tierMap.get(item.pack_id) ?? [] : [],
      gstPercent,
      moq,
      derivedPiecePrice: marketplaceOffer
        ? resolveOfferUnitPricePaise(marketplaceOffer, item.quantity) / 100
        : pack
          ? piecePriceFromCase(
              resolvePackPrice(pack, overrideByProduct.get(item.product_id) ?? null),
              pack.units_per_case
            )
          : 0,
    });
    // Effective per-piece rate actually charged.
    const unitPrice = pricing.unitPrice;
    subtotal += pricing.subtotal;
    gstTotal += pricing.gst;
    gstByRate.set(gstPercent, (gstByRate.get(gstPercent) ?? 0) + pricing.gst);
    savings += calcSavings(pack?.mrp, pricing.unitPrice, pricing.quantity);
    const images = [...(product?.product_images ?? [])].sort((a, b) => a.sort_order - b.sort_order);
    // Prefer the variant's own image (matches the product page size switcher).
    const lineImage = pack?.image_url ?? images[0]?.image_url;
    const canonical = buildCanonicalProductName({
      brandName: product?.brands?.name ?? null,
      productName: product?.name ?? null,
      packName: pack?.pack_name ?? null,
    });
    return {
      id: item.id,
      quantity: item.quantity,
      packName: pack?.pack_name ?? 'Unknown pack',
      productName: product?.name ?? 'Unknown product',
      canonicalName: canonical,
      brandName: product?.brands?.name ?? null,
      imageUrl: lineImage,
      unitPrice,
      piecePrice: pricing.unitPrice,
      unitsPerCase: pack?.units_per_case ?? 1,
      pieces: pricing.quantity,
      orderable: pricing.orderable && marketplaceAvailable && Boolean(pack?.is_active) && Boolean(product?.is_active),
      quantityMessage: marketplaceAvailable
        ? pricing.message
        : 'This seller offer no longer has enough stock or is no longer available.',
      gstPercent,
      lineTotal: pricing.lineTotal,
      sellerName: marketplaceOffer?.sellerBusinessName ?? null,
      sellerGstin: marketplaceOffer?.sellerGstin ?? null,
      fulfilmentType: marketplaceOffer?.fulfilmentType ?? null,
    };
  });
  // COUPON (0051): revalidated server-side against the current cart before any
  // discount is displayed. The final gate is the quote inside
  // placeOrderAction, which re-runs the same validator and refuses to bill a
  // discount the database no longer supports.
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
      couponWarning = `Coupon ${cartCoupon.coupon.code} no longer applies: ${validation.message}. The order will be placed without it.`;
    }
  }

  const discountTotal = appliedCoupon?.discount ?? 0;
  const grandTotal = subtotal + gstTotal - discountTotal;
  const totalPieces = lines.reduce((sum, line) => sum + line.pieces, 0);

  // 🪙 Coins, computed once from the SAME authoritative wallet position the
  // order service re-reads before it debits. The browser never contributes an
  // amount; this is display only and can only confirm what the server charges.
  const coinsAvailablePaise = coinBalancePaise(walletSummary.creditLimitPaise, walletSummary.outstandingPaise);
  const coinPayment = computeCoinPayment({
    orderTotalPaise: Math.round(grandTotal * 100),
    balancePaise: coinsAvailablePaise,
  });
  const coinsUsedRupees = coinPayment.usedPaise / 100;
  const payableOnDeliveryRupees = coinPayment.remainingPaise / 100;

  return (
    <CheckoutAddressProvider defaultAddressId={defaultAddress?.id ?? null}>
    <div className="space-y-5 sm:space-y-6">
      <CommerceSteps current={2} />
      <div className="flex items-center gap-1.5 text-[10px] font-semibold text-slate-500 sm:text-xs">
        <Link href="/retailer/cart" className="flex items-center gap-1 hover:text-primary-600">
          <ChevronLeft className="h-3.5 w-3.5" aria-hidden="true" /> Cart
        </Link>
        <ChevronRight className="h-3 w-3" />
        <span className="text-slate-800">Checkout</span>
      </div>

      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="shop-intro">
          <p className="shop-eyebrow">Final review</p>
          <h1 className="shop-heading mt-1 font-semibold tracking-tight text-slate-950">Checkout</h1>
          <p className="mt-1 text-xs text-slate-500">
            Review the items, address and your coin balance before placing the order.
          </p>
        </div>
        {/* Stepper — Cart → Checkout → Done. Visible from sm up. */}
        <ol
          className="hidden items-center gap-2 text-[10px] font-bold text-slate-500 sm:flex"
          aria-label="Checkout progress"
        >
          <li className="flex items-center gap-1.5">
            <span className="flex h-6 w-6 items-center justify-center rounded-full bg-mint-600 text-white">
              <Check className="h-3 w-3" aria-hidden="true" />
            </span>
            <span>Cart</span>
          </li>
          <span className="h-px w-6 bg-mint-300" aria-hidden="true" />
          <li className="flex items-center gap-1.5 text-primary-700">
            <span className="flex h-6 w-6 items-center justify-center rounded-full bg-primary-600 text-white">2</span>
            <span>Checkout</span>
          </li>
          <span className="h-px w-6 bg-slate-200" aria-hidden="true" />
          <li className="flex items-center gap-1.5 text-slate-400">
            <span className="flex h-6 w-6 items-center justify-center rounded-full bg-slate-100 text-slate-400">3</span>
            <span>Done</span>
          </li>
        </ol>
      </div>

      <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_370px] lg:gap-7">
        <div className="space-y-4">
          {/* 1. DELIVERY ADDRESS */}
          {retailer ? (
            <section
              aria-label="Delivery address"
              className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm"
            >
              <div className="flex items-center gap-2 border-b border-slate-100 bg-slate-50 px-4 py-3.5 sm:px-5">
                <span className="flex h-6 w-6 items-center justify-center rounded-full bg-primary-600 text-[11px] font-bold text-white">1</span>
                <Truck className="h-4 w-4 text-primary-600" aria-hidden="true" />
                <h2 className="text-sm font-bold text-slate-900">Delivery address</h2>
              </div>
              <div className="p-4 sm:p-5">
                <CheckoutAddressSelector
                  addresses={savedAddresses}
                  shop={{
                    shopName: retailer.shop_name ?? null,
                    contactName: profile?.full_name ?? user.fullName,
                    addressText: retailer.address ?? null,
                    area: retailer.areas
                      ? `${retailer.areas.name}${retailer.areas.district ? `, ${retailer.areas.district}` : ''}`
                      : null,
                    phone: profile?.phone ?? null,
                  }}
                />
              </div>
            </section>
          ) : null}

          {/* 2. ORDER ITEMS */}
          <section
            aria-label="Order items"
            className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm"
          >
            <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3.5 sm:px-5">
              <div className="flex items-center gap-2">
                <span className="flex h-6 w-6 items-center justify-center rounded-full bg-primary-600 text-[11px] font-bold text-white">2</span>
                <ShoppingCart className="h-4 w-4 text-primary-600" aria-hidden="true" />
                <h2 className="text-sm font-bold text-slate-900">Order items</h2>
              </div>
              <p className="text-[10px] font-semibold text-slate-500">
                {lines.length} line{lines.length === 1 ? '' : 's'} · {totalPieces} pc{totalPieces === 1 ? '' : 's'}
              </p>
            </div>
            <div className="divide-y divide-slate-100 px-4 sm:px-5">
              {lines.map((line) => (
                <div key={line.id} className="flex items-center gap-3 py-4 text-xs">
                  <div className="relative h-14 w-14 shrink-0 overflow-hidden rounded-xl bg-slate-50">
                    {line.imageUrl ? (
                      <Image
                        src={line.imageUrl}
                        alt={line.canonicalName}
                        fill
                        sizes="56px"
                        className="object-contain p-1"
                        unoptimized
                      />
                    ) : (
                      <div className="flex h-full items-center justify-center text-slate-300">
                        <ImageOff className="h-4 w-4" aria-hidden="true" />
                      </div>
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="break-words font-bold text-slate-900">{line.canonicalName}</p>
                    <p className="mt-1 text-[10px] text-slate-500">
                      {line.packName} · {line.pieces} pc{line.pieces === 1 ? '' : 's'} × {formatInr(line.piecePrice)}/pc
                    </p>
                    <p className="mt-0.5 text-[10px] text-slate-400">GST {line.gstPercent}% included</p>
                    {line.sellerName ? (
                      <p className="mt-1 text-[10px] leading-4 text-slate-500">
                        Sold by <span className="font-semibold text-slate-700">{line.sellerName}</span>
                        {line.sellerGstin ? ` · GSTIN ${line.sellerGstin}` : ''}
                        {' · '}{line.fulfilmentType === 'seller' ? 'Seller fulfilled' : 'Fulfilled by Maharani'}
                      </p>
                    ) : null}
                  </div>
                  <p className="shrink-0 text-sm font-bold text-slate-950">{formatInr(line.lineTotal)}</p>
                </div>
              ))}
            </div>
            <Link
              href="/retailer/cart"
              className="flex items-center justify-center border-t border-slate-100 bg-slate-50 py-3 text-[10px] font-bold text-primary-600 hover:text-primary-700"
            >
              Edit cart
            </Link>
          </section>

          {retailer ? (
            /* 🪙 Coins — the only balance a retailer has. No credit limit, no
               outstanding, no terms: order total, coins available, coins used,
               remaining payable. All four are server-computed. */
            <CoinsCheckoutSummary orderTotalPaise={Math.round(grandTotal * 100)} balancePaise={coinsAvailablePaise} />
          ) : null}

          {/* 3. PAYMENT */}
          {/*
            Settlement comes from coins only. There is no credit checkout, no
            Net-15/Net-30 selection and no pay-later option — the browser cannot
            choose a payment method that changes what is billed, because coins
            are calculated and deducted server-side and everything else is
            payable on delivery.
          */}
          <section
            aria-label="Payment"
            className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm"
          >
            <div className="flex items-center gap-2 border-b border-slate-100 bg-slate-50 px-4 py-3.5 sm:px-5">
              <span className="flex h-6 w-6 items-center justify-center rounded-full bg-primary-600 text-[11px] font-bold text-white">3</span>
              <CreditCard className="h-4 w-4 text-primary-600" aria-hidden="true" />
              <h2 className="text-sm font-bold text-slate-900">Payment</h2>
            </div>
            <div className="space-y-2 p-4 text-xs sm:p-5">
              <div className="flex items-center justify-between gap-3">
                <span className="text-slate-600">Method</span>
                <span className="font-bold text-slate-900">🪙 Coins + cash on delivery</span>
              </div>
              <div className="flex items-center justify-between gap-3">
                <span className="text-slate-600">Payable on delivery</span>
                <span className="font-bold text-slate-900">{formatInr(payableOnDeliveryRupees)}</span>
              </div>
              <p className="pt-1 text-[10px] leading-4 text-slate-500">
                Coins are applied automatically and deducted on the server. Any remaining amount is collected on
                delivery. GST is already included in every price above — it is never added again at checkout.
              </p>
            </div>
          </section>
        </div>

        <aside className="space-y-4 lg:sticky lg:top-36">
          {/* 4. PLACE ORDER SUMMARY */}
          <section
            aria-label="Order total"
            className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm"
          >
            <div className="flex items-center gap-2 border-b border-slate-100 bg-slate-50 px-5 py-4">
              <span className="flex h-6 w-6 items-center justify-center rounded-full bg-primary-600 text-[11px] font-bold text-white">4</span>
              <ReceiptText className="h-4 w-4 text-primary-600" aria-hidden="true" />
              <h2 className="text-sm font-bold text-slate-900">Order total</h2>
            </div>
            <div className="space-y-3 p-5">
              <div className="flex justify-between text-xs text-slate-600">
                <span>Subtotal</span>
                <span className="font-semibold text-slate-800">{formatInr(subtotal)}</span>
              </div>
              {appliedCoupon ? (
                <div className="flex justify-between text-xs font-semibold text-mint-700">
                  <span>Coupon · {appliedCoupon.code}</span>
                  <span>−{formatInr(appliedCoupon.discount)}</span>
                </div>
              ) : null}
              {[...gstByRate.entries()].map(([rate, amount]) => (
                <div key={rate} className="flex justify-between text-xs text-slate-600">
                  <span>GST {rate}%</span>
                  <span className="font-semibold text-slate-800">{formatInr(amount)}</span>
                </div>
              ))}
              {savings > 0 ? (
                <div className="flex justify-between text-xs font-semibold text-mint-700">
                  <span>Total savings</span>
                  <span>{formatInr(savings)}</span>
                </div>
              ) : null}
              <div className="flex items-end justify-between border-t border-dashed border-slate-200 pt-4">
                <span className="text-sm font-bold text-slate-900">Order total (incl. GST)</span>
                <span className="text-2xl font-bold tracking-tight text-slate-950">{formatInr(grandTotal)}</span>
              </div>
              <div className="flex items-center justify-between text-xs text-slate-600">
                <span>🪙 Coins used</span>
                <span className="font-semibold text-mint-700">−{formatInr(coinsUsedRupees)}</span>
              </div>
              <div className="flex items-center justify-between text-sm font-bold text-slate-900">
                <span>Remaining payable</span>
                <span>{formatInr(payableOnDeliveryRupees)}</span>
              </div>
              <div className="flex items-center justify-center gap-1.5 text-[9px] text-slate-400">
                <ShieldCheck className="h-3.5 w-3.5 text-mint-600" aria-hidden="true" />
                Final totals are validated server-side
              </div>
            </div>
          </section>
          {lines.some((line) => !line.orderable) ? (
            <p
              role="alert"
              className="rounded-2xl border border-primary-200 bg-primary-50 px-4 py-3 text-[11px] font-semibold text-primary-700"
            >
              {lines.find((line) => !line.orderable)?.quantityMessage ??
                'One of the quantities in your cart is not available. Adjust it in the cart to continue.'}
            </p>
          ) : null}
          {couponWarning ? (
            <p
              role="status"
              className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-[11px] font-semibold text-amber-800"
            >
              {couponWarning}
            </p>
          ) : null}
          <CheckoutForm
            grandTotal={grandTotal}
            subtotal={subtotal}
            gstTotal={gstTotal}
            couponDiscount={discountTotal}
            couponCode={appliedCoupon?.code ?? null}
            itemCount={lines.length}
            disabled={lines.some((line) => !line.orderable)}
          />
        </aside>
      </div>
    </div>
    </CheckoutAddressProvider>
  );
}
