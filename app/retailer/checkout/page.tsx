import Link from 'next/link';
import Image from 'next/image';
import { redirect } from 'next/navigation';
import { Check, ChevronLeft, ChevronRight, CreditCard, ImageOff, PackageCheck, ReceiptText, ShieldCheck } from 'lucide-react';
import { createClient } from '@/lib/supabase/server';
import { requireUser } from '@/lib/auth/session';
import { getProductPriceOverrides, resolvePackPrice } from '@/lib/retailer/effective-price';
import { piecePriceFromCase } from '@/lib/retailer/case-pricing';
import { calculateRetailerPiecePrice } from '@/lib/retailer/retailer-pricing';
import { loadPackTiers } from '@/lib/retailer/pricing-data';
import { CheckoutForm } from '@/components/retailer/checkout-form';
import { CreditSummary } from '@/components/retailer/credit-summary';
import { DeliveryAddressCard } from '@/components/retailer/delivery-address-card';
import { calcSavings, formatInr } from '@/lib/retailer/format';

interface CartItemDetail {
  id: string;
  quantity: number;
  product_id: string;
  pack_id: string;
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
    product_images: { image_url: string; sort_order: number }[];
  } | null;
}

interface RetailerCreditRow {
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

  const [{ data: cartData }, { data: retailer }, { data: profile }] = await Promise.all([
    supabase
      .from('cart_items')
      .select(
        'id, quantity, product_id, pack_id, product_packs ( pack_name, base_price, ptr, case_price, units_per_case, mrp, moq, allow_loose_pieces, image_url, is_active ), products ( name, gst_percent, is_active, product_images ( image_url, sort_order ) )'
      )
      .eq('retailer_id', user.id)
      .order('updated_at', { ascending: false }),
    supabase
      .from('retailers')
      .select('area_id, credit_limit, outstanding_balance, shop_name, address, areas ( name, district )')
      .eq('id', user.id)
      .maybeSingle<RetailerCreditRow>(),
    supabase.from('profiles').select('full_name, phone').eq('id', user.id).maybeSingle<CheckoutProfileRow>(),
  ]);

  const items = (cartData ?? []) as unknown as CartItemDetail[];
  if (items.length === 0) redirect('/retailer/cart');

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
    // `item.quantity` is the PIECE count in the cart. Pricing runs through the
    // canonical retailer engine — identical to `quoteOrderForRetailer`, which
    // will be re-executed when the order is created, so this review can only
    // ever confirm the amount that will actually be billed.
    const pricing = calculateRetailerPiecePrice({
      quantity: item.quantity,
      unitsPerCase: pack?.units_per_case ?? 1,
      casePrice: 0,
      tiers: item.pack_id ? tierMap.get(item.pack_id) ?? [] : [],
      gstPercent,
      moq: pack?.moq ?? 1,
      // Server-resolved per-piece fallback (never the internal case price).
      derivedPiecePrice: pack ? piecePriceFromCase(resolvePackPrice(pack, overrideByProduct.get(item.product_id) ?? null), pack.units_per_case) : 0,
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
    return {
      id: item.id,
      quantity: item.quantity,
      packName: pack?.pack_name ?? 'Unknown pack',
      productName: product?.name ?? 'Unknown product',
      imageUrl: lineImage,
      unitPrice,
      piecePrice: pricing.unitPrice,
      unitsPerCase: pack?.units_per_case ?? 1,
      pieces: pricing.quantity,
      orderable: pricing.orderable,
      quantityMessage: pricing.message,
      gstPercent,
      lineTotal: pricing.lineTotal,
    };
  });
  const grandTotal = subtotal + gstTotal;

  return (
    <div className="space-y-5 sm:space-y-6">
      <div className="flex items-center gap-1.5 text-[10px] font-semibold text-slate-500 sm:text-xs">
        <Link href="/retailer/cart" className="flex items-center gap-1 hover:text-primary-600">
          <ChevronLeft className="h-3.5 w-3.5" /> Cart
        </Link>
        <ChevronRight className="h-3 w-3" />
        <span className="text-slate-800">Checkout</span>
      </div>

      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-primary-600">Final review</p>
          <h1 className="mt-1 text-xl font-bold tracking-tight text-slate-950 sm:text-3xl">Secure checkout</h1>
          <p className="mt-1 text-xs text-slate-500">Review pricing, GST and credit before placing your order.</p>
        </div>
        <div className="hidden items-center gap-2 text-[9px] font-bold text-slate-500 sm:flex">
          <span className="flex h-6 w-6 items-center justify-center rounded-full bg-emerald-600 text-white">
            <Check className="h-3 w-3" />
          </span>
          Cart <span className="h-px w-8 bg-emerald-300" />
          <span className="flex h-6 w-6 items-center justify-center rounded-full bg-primary-600 text-white">2</span> Checkout
          <span className="h-px w-8 bg-slate-200" />
          <span className="flex h-6 w-6 items-center justify-center rounded-full bg-slate-100 text-slate-400">3</span> Done
        </div>
      </div>

      <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_370px] lg:gap-7">
        <div className="space-y-4">
          <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
            <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3.5 sm:px-5">
              <div>
                <h2 className="text-sm font-bold text-slate-900">Order items</h2>
                <p className="mt-0.5 text-[10px] text-slate-500">
                  {lines.length} line item{lines.length === 1 ? '' : 's'}
                </p>
              </div>
              <PackageCheck className="h-5 w-5 text-primary-600" />
            </div>
            <div className="divide-y divide-slate-100 px-4 sm:px-5">
              {lines.map((line) => (
                <div key={line.id} className="flex items-center gap-3 py-4 text-xs">
                  <div className="relative h-14 w-14 shrink-0 overflow-hidden rounded-xl bg-slate-50">
                    {line.imageUrl ? (
                      <Image src={line.imageUrl} alt={line.productName} fill className="object-contain p-1" unoptimized />
                    ) : (
                      <div className="flex h-full items-center justify-center text-slate-300">
                        <ImageOff className="h-4 w-4" />
                      </div>
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-bold text-slate-900">{line.productName}</p>
                    <p className="mt-1 text-[9px] text-slate-500">
                      {line.packName} · Qty {line.pieces} pc{line.pieces === 1 ? '' : 's'} ·{' '}
                      {formatInr(line.piecePrice)}/pc
                    </p>
                    <p className="mt-0.5 text-[9px] text-slate-400">
                      GST {line.gstPercent}% included
                    </p>
                  </div>
                  <p className="shrink-0 text-sm font-bold text-slate-950">{formatInr(line.lineTotal)}</p>
                </div>
              ))}
            </div>
            <Link href="/retailer/cart" className="flex items-center justify-center border-t border-slate-100 bg-slate-50 py-3 text-[10px] font-bold text-primary-600">
              Edit cart
            </Link>
          </section>

          {retailer ? (
            <CreditSummary creditLimit={retailer.credit_limit} outstandingBalance={retailer.outstanding_balance} orderImpact={grandTotal} />
          ) : null}

          {/*
            Settlement method, stated from real data only. The schema has no
            `payment_method` column and no Net-15/Net-30 terms model, so this
            reports whether a credit facility actually exists on the account and
            says plainly that terms are set by the distributor — it never offers
            a choice that could be manipulated client-side, and it never affects
            price (which stays server-authoritative).
          */}
          <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
            <div className="flex items-center gap-2 border-b border-slate-100 bg-slate-50 px-4 py-3.5">
              <CreditCard className="h-4 w-4 text-primary-600" aria-hidden="true" />
              <h2 className="text-sm font-bold text-slate-900">Settlement</h2>
            </div>
            <div className="space-y-2 p-4 text-xs">
              <div className="flex items-center justify-between gap-3">
                <span className="text-slate-600">Method</span>
                <span className="font-bold text-slate-900">
                  {retailer && retailer.credit_limit > 0 ? 'Business credit account' : 'No credit facility configured'}
                </span>
              </div>
              <div className="flex items-center justify-between gap-3">
                <span className="text-slate-600">Final payable</span>
                <span className="font-bold text-slate-900">{formatInr(grandTotal)}</span>
              </div>
              <p className="pt-1 text-[10px] leading-4 text-slate-400">
                Payment terms (for example Net-15 or Net-30) are set by your distributor and are not selectable here.
                GST is already included in every price above — it is never added again at checkout.
              </p>
            </div>
          </section>

          {retailer ? (
            <DeliveryAddressCard
              address={{
                shopName: retailer.shop_name ?? null,
                contactName: profile?.full_name ?? user.fullName,
                address: retailer.address ?? null,
                area: retailer.areas
                  ? `${retailer.areas.name}${retailer.areas.district ? `, ${retailer.areas.district}` : ''}`
                  : null,
                phone: profile?.phone ?? null,
              }}
            />
          ) : null}
        </div>

        <aside className="space-y-4 lg:sticky lg:top-36">
          <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-[0_8px_30px_rgba(15,23,42,0.08)]">
            <div className="flex items-center gap-2 border-b border-slate-100 bg-slate-50 px-5 py-4">
              <ReceiptText className="h-4 w-4 text-primary-600" />
              <h2 className="text-sm font-bold text-slate-900">Order total</h2>
            </div>
            <div className="space-y-3 p-5">
              <div className="flex justify-between text-xs text-slate-600">
                <span>Subtotal</span>
                <span className="font-semibold text-slate-800">{formatInr(subtotal)}</span>
              </div>
              {[...gstByRate.entries()].map(([rate, amount]) => (
                <div key={rate} className="flex justify-between text-xs text-slate-600">
                  <span>GST {rate}%</span>
                  <span className="font-semibold text-slate-800">{formatInr(amount)}</span>
                </div>
              ))}
              {savings > 0 ? (
                <div className="flex justify-between text-xs font-semibold text-emerald-700">
                  <span>Total savings</span>
                  <span>{formatInr(savings)}</span>
                </div>
              ) : null}
              <div className="flex items-end justify-between border-t border-dashed border-slate-200 pt-4">
                <span className="text-sm font-bold text-slate-900">Grand total</span>
                <span className="text-2xl font-bold tracking-tight text-slate-950">{formatInr(grandTotal)}</span>
              </div>
              <div className="flex items-center justify-center gap-1.5 text-[9px] text-slate-400">
                <ShieldCheck className="h-3.5 w-3.5 text-emerald-600" /> Final totals are validated server-side
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
          <CheckoutForm
            grandTotal={grandTotal}
            subtotal={subtotal}
            gstTotal={gstTotal}
            itemCount={lines.length}
            disabled={lines.some((line) => !line.orderable)}
          />
        </aside>
      </div>
    </div>
  );
}
