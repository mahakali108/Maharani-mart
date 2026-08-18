import Link from 'next/link';
import { redirect } from 'next/navigation';
import { Check, ChevronLeft, ChevronRight, ImageOff, PackageCheck, ReceiptText, ShieldCheck } from 'lucide-react';
import { StoredImage } from '@/components/media/stored-image';
import { createClient } from '@/lib/supabase/server';
import { requireUser } from '@/lib/auth/session';
import { getProductPriceOverrides, resolvePackPrice } from '@/lib/retailer/effective-price';
import { CheckoutForm } from '@/components/retailer/checkout-form';
import { CreditSummary } from '@/components/retailer/credit-summary';
import { calcSavings, formatInr } from '@/lib/retailer/format';

interface CartItemDetail {
  id: string;
  quantity: number;
  product_id: string;
  product_packs: { pack_name: string; base_price: number; ptr: number | null; mrp: number | null; is_active: boolean } | null;
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
}

export default async function CheckoutPage() {
  const user = await requireUser();
  const supabase = createClient();

  const [{ data: cartData }, { data: retailer }] = await Promise.all([
    supabase
      .from('cart_items')
      .select('id, quantity, product_id, product_packs ( pack_name, base_price, ptr, mrp, is_active ), products ( name, gst_percent, is_active, product_images ( image_url, sort_order ) )')
      .eq('retailer_id', user.id)
      .order('updated_at', { ascending: false }),
    supabase
      .from('retailers')
      .select('area_id, credit_limit, outstanding_balance')
      .eq('id', user.id)
      .maybeSingle<RetailerCreditRow>(),
  ]);

  const items = (cartData ?? []) as unknown as CartItemDetail[];
  if (items.length === 0) redirect('/retailer/cart');

  const distinctProductIds = [...new Set(items.map((item) => item.product_id))];
  const overrideByProduct = await getProductPriceOverrides(supabase, distinctProductIds, user.id, retailer?.area_id ?? null);

  let subtotal = 0;
  let gstTotal = 0;
  let savings = 0;
  const gstByRate = new Map<number, number>();
  const lines = items.map((item) => {
    const pack = item.product_packs;
    const product = item.products;
    const unitPrice = pack ? resolvePackPrice(pack, overrideByProduct.get(item.product_id) ?? null) : 0;
    const lineSubtotal = unitPrice * item.quantity;
    const gstPercent = product?.gst_percent ?? 0;
    const lineGst = (lineSubtotal * gstPercent) / 100;
    subtotal += lineSubtotal;
    gstTotal += lineGst;
    gstByRate.set(gstPercent, (gstByRate.get(gstPercent) ?? 0) + lineGst);
    savings += calcSavings(pack?.mrp, unitPrice, item.quantity);
    const images = [...(product?.product_images ?? [])].sort((a, b) => a.sort_order - b.sort_order);
    return {
      id: item.id,
      quantity: item.quantity,
      packName: pack?.pack_name ?? 'Unknown pack',
      productName: product?.name ?? 'Unknown product',
      imageUrl: images[0]?.image_url,
      unitPrice,
      gstPercent,
      lineTotal: lineSubtotal + lineGst,
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
                      <StoredImage src={line.imageUrl} alt={line.productName} fill className="object-contain p-1" />
                    ) : (
                      <div className="flex h-full items-center justify-center text-slate-300">
                        <ImageOff className="h-4 w-4" />
                      </div>
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-bold text-slate-900">{line.productName}</p>
                    <p className="mt-1 text-[9px] text-slate-500">
                      {line.packName} · Qty {line.quantity} · {formatInr(line.unitPrice)} each
                    </p>
                    <p className="mt-0.5 text-[9px] text-slate-400">GST {line.gstPercent}%</p>
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
          <CheckoutForm grandTotal={grandTotal} />
        </aside>
      </div>
    </div>
  );
}
