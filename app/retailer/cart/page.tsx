import Link from 'next/link';
import {
  ArrowRight,
  ChevronLeft,
  Info,
  PackageCheck,
  ReceiptText,
  ShieldCheck,
  ShoppingCart,
  Truck,
} from 'lucide-react';
import { createClient } from '@/lib/supabase/server';
import { requireUser } from '@/lib/auth/session';
import { getProductPriceOverride, resolvePackPrice } from '@/lib/retailer/effective-price';
import { CartItemRow } from '@/components/retailer/cart-item-row';

interface CartItemDetail {
  id: string;
  quantity: number;
  pack_id: string;
  product_id: string;
  product_packs: {
    id: string;
    pack_name: string;
    base_price: number;
    ptr: number | null;
    moq: number;
    is_active: boolean;
  } | null;
  products: {
    name: string;
    gst_percent: number;
    is_active: boolean;
    product_images: { image_url: string; sort_order: number }[];
  } | null;
}

export default async function CartPage() {
  const user = await requireUser();
  const supabase = createClient();

  const [{ data: cartData }, { data: retailer }] = await Promise.all([
    supabase
      .from('cart_items')
      .select('id, quantity, pack_id, product_id, product_packs ( id, pack_name, base_price, ptr, moq, is_active ), products ( name, gst_percent, is_active, product_images ( image_url, sort_order ) )')
      .eq('retailer_id', user.id)
      .order('updated_at', { ascending: false }),
    supabase
      .from('retailers')
      .select('area_id')
      .eq('id', user.id)
      .maybeSingle<{ area_id: string }>(),
  ]);

  const items = (cartData ?? []) as unknown as CartItemDetail[];

  if (items.length === 0) {
    return (
      <div className="space-y-5">
        <div className="flex items-center gap-1.5 text-[10px] font-semibold text-slate-500 sm:text-xs"><Link href="/retailer/home" className="hover:text-primary-600">Home</Link><span>/</span><span className="text-slate-800">Cart</span></div>
        <section className="flex min-h-[460px] flex-col items-center justify-center rounded-2xl border border-slate-200 bg-white px-5 text-center shadow-sm">
          <span className="flex h-20 w-20 items-center justify-center rounded-full bg-primary-50 text-primary-600"><ShoppingCart className="h-9 w-9" /></span>
          <h1 className="mt-5 text-xl font-bold text-slate-950 sm:text-2xl">Your cart is ready for a restock</h1>
          <p className="mt-2 max-w-sm text-xs leading-5 text-slate-500">Browse wholesale products or use Quick Order to add products by name and SKU.</p>
          <div className="mt-6 flex flex-wrap justify-center gap-2">
            <Link href="/retailer/catalog" className="flex h-10 items-center gap-2 rounded-xl bg-primary-600 px-5 text-xs font-bold text-white shadow-sm transition hover:bg-primary-700">Browse products <ArrowRight className="h-4 w-4" /></Link>
            <Link href="/retailer/quick-order" className="flex h-10 items-center rounded-xl border border-slate-200 bg-white px-5 text-xs font-bold text-slate-700 transition hover:border-primary-200 hover:text-primary-600">Quick order</Link>
          </div>
        </section>
      </div>
    );
  }

  const distinctProductIds = [...new Set(items.map((item) => item.product_id))];
  const overridePairs = await Promise.all(
    distinctProductIds.map(async (productId) => [
      productId,
      await getProductPriceOverride(supabase, productId, user.id, retailer?.area_id ?? null),
    ] as const)
  );
  const overrideByProduct = new Map(overridePairs);

  let subtotal = 0;
  let gstTotal = 0;
  const lines = items.map((item) => {
    const pack = item.product_packs;
    const product = item.products;
    const unitPrice = pack ? resolvePackPrice(pack, overrideByProduct.get(item.product_id) ?? null) : 0;
    const lineSubtotal = unitPrice * item.quantity;
    const gstPercent = product?.gst_percent ?? 0;
    const lineGst = (lineSubtotal * gstPercent) / 100;
    subtotal += lineSubtotal;
    gstTotal += lineGst;
    const images = [...(product?.product_images ?? [])].sort((a, b) => a.sort_order - b.sort_order);

    return {
      id: item.id,
      quantity: item.quantity,
      packName: pack?.pack_name ?? 'Unknown pack',
      productName: product?.name ?? 'Unknown product',
      imageUrl: images[0]?.image_url,
      unitPrice,
      gstPercent,
      moq: pack?.moq ?? 1,
      isUnavailable: !pack?.is_active || !product?.is_active,
    };
  });

  const grandTotal = subtotal + gstTotal;
  const hasUnavailable = lines.some((line) => line.isUnavailable);
  const availableCount = lines.filter((line) => !line.isUnavailable).length;
  const totalQuantity = lines.reduce((sum, line) => sum + line.quantity, 0);

  return (
    <div className="space-y-5 sm:space-y-6">
      <div className="flex items-center gap-1.5 text-[10px] font-semibold text-slate-500 sm:text-xs"><Link href="/retailer/home" className="hover:text-primary-600">Home</Link><span>/</span><span className="text-slate-800">Cart</span></div>

      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-primary-600">Review your order</p>
          <h1 className="mt-1 text-xl font-bold tracking-tight text-slate-950 sm:text-3xl">Shopping cart</h1>
          <p className="mt-1 text-xs text-slate-500">{items.length} line item{items.length === 1 ? '' : 's'} · {totalQuantity} pack{totalQuantity === 1 ? '' : 's'}</p>
        </div>
        <Link href="/retailer/catalog" className="flex h-9 items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 text-[10px] font-bold text-slate-700 shadow-sm transition hover:border-primary-200 hover:text-primary-600"><ChevronLeft className="h-3.5 w-3.5" /> Continue shopping</Link>
      </div>

      {hasUnavailable ? (
        <div className="flex items-start gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs text-amber-800"><Info className="mt-0.5 h-4 w-4 shrink-0" /><p><span className="font-bold">Cart update required.</span> Unavailable products are clearly marked and will be excluded when the order is validated.</p></div>
      ) : null}

      <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_360px] lg:gap-7">
        <section className="space-y-3">
          {lines.map((line) => <CartItemRow key={line.id} {...line} />)}
        </section>

        <aside className="space-y-3 lg:sticky lg:top-36">
          <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-[0_8px_30px_rgba(15,23,42,0.08)]">
            <div className="border-b border-slate-100 bg-slate-50 px-5 py-4">
              <h2 className="text-sm font-bold text-slate-900">Order summary</h2>
              <p className="mt-0.5 text-[10px] text-slate-500">{availableCount} orderable item{availableCount === 1 ? '' : 's'}</p>
            </div>
            <div className="space-y-3 p-5">
              <div className="flex justify-between text-xs text-slate-600"><span>Subtotal</span><span className="font-semibold text-slate-800">₹{subtotal.toFixed(2)}</span></div>
              <div className="flex justify-between text-xs text-slate-600"><span>GST</span><span className="font-semibold text-slate-800">₹{gstTotal.toFixed(2)}</span></div>
              <div className="flex justify-between border-t border-dashed border-slate-200 pt-4"><span className="text-sm font-bold text-slate-900">Order total</span><span className="text-xl font-bold tracking-tight text-slate-950">₹{grandTotal.toFixed(2)}</span></div>
              <p className="text-right text-[9px] text-slate-400">Inclusive of calculated GST</p>

              {availableCount > 0 ? (
                <Link href="/retailer/checkout" className="flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-primary-600 text-xs font-bold text-white shadow-sm transition hover:bg-primary-700">Proceed to checkout <ArrowRight className="h-4 w-4" /></Link>
              ) : (
                <span className="flex h-12 w-full cursor-not-allowed items-center justify-center rounded-xl bg-slate-200 text-xs font-bold text-slate-500">No orderable items</span>
              )}
              <div className="flex items-center justify-center gap-1.5 text-[9px] text-slate-400"><ShieldCheck className="h-3.5 w-3.5 text-emerald-600" /> Secure server-side validation</div>
            </div>
          </section>

          <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
            <div className="space-y-3">
              {[
                { icon: PackageCheck, title: 'MOQ verified', body: 'Every pack checked before order' },
                { icon: ReceiptText, title: 'GST transparent', body: 'Tax shown on every invoice' },
                { icon: Truck, title: 'Track fulfillment', body: 'Status updates after ordering' },
              ].map((item) => (
                <div key={item.title} className="flex items-start gap-2.5"><item.icon className="mt-0.5 h-4 w-4 shrink-0 text-primary-600" /><div><p className="text-[10px] font-bold text-slate-800">{item.title}</p><p className="mt-0.5 text-[9px] text-slate-400">{item.body}</p></div></div>
              ))}
            </div>
          </section>
        </aside>
      </div>
    </div>
  );
}
