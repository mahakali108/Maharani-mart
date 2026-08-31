import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ArrowLeft, ChevronRight, Info, RotateCcw, ShieldCheck } from 'lucide-react';
import { createClient } from '@/lib/supabase/server';
import { requireUser } from '@/lib/auth/session';
import { getProductPriceOverride, resolvePackPrice } from '@/lib/retailer/effective-price';
import { ReorderForm, type ReorderLineInput } from '@/components/retailer/reorder-form';

interface OrderRow {
  id: string;
  order_number: string;
  placed_at: string;
}

interface ReorderItemRow {
  id: string;
  pack_id: string | null;
  quantity: number;
  products: {
    id: string;
    name: string;
    gst_percent: number;
    is_active: boolean;
    product_images: { image_url: string }[];
  } | null;
  product_packs: {
    id: string;
    pack_name: string;
    base_price: number;
    ptr: number | null;
    case_price: number;
    moq: number;
    is_active: boolean;
  } | null;
}

export default async function ReorderPage({ params }: { params: { id: string } }) {
  const user = await requireUser();
  const supabase = createClient();

  const { data: order } = await supabase
    .from('orders')
    .select('id, order_number, placed_at')
    .eq('id', params.id)
    .eq('retailer_id', user.id)
    .maybeSingle<OrderRow>();
  if (!order) notFound();

  const [{ data: retailer }, { data: itemData }] = await Promise.all([
    supabase.from('retailers').select('area_id').eq('id', user.id).maybeSingle<{ area_id: string }>(),
    supabase
      .from('order_items')
      .select('id, pack_id, quantity, products ( id, name, gst_percent, is_active, product_images ( image_url ) ), product_packs ( id, pack_name, base_price, ptr, case_price, moq, is_active )')
      .eq('order_id', order.id),
  ]);

  const items = (itemData ?? []) as unknown as ReorderItemRow[];
  const overrideByProduct = new Map<string, number | null>();
  const distinctProductIds = [...new Set(items.map((item) => item.products?.id).filter((id): id is string => !!id))];
  const overrides = await Promise.all(
    distinctProductIds.map(async (productId) => [
      productId,
      await getProductPriceOverride(supabase, productId, user.id, retailer?.area_id ?? null),
    ] as const)
  );
  for (const [productId, override] of overrides) overrideByProduct.set(productId, override);

  const lines: ReorderLineInput[] = items
    .filter((item) => item.pack_id && item.product_packs)
    .map((item) => {
      const pack = item.product_packs!;
      const product = item.products;
      const currentUnitPrice = resolvePackPrice(pack, product ? overrideByProduct.get(product.id) ?? null : null);
      const unavailable = !pack.is_active || !product?.is_active;
      return {
        packId: item.pack_id!,
        productName: product?.name ?? 'Unknown product',
        packName: pack.pack_name,
        imageUrl: product?.product_images[0]?.image_url,
        previousQuantity: item.quantity,
        suggestedQuantity: Math.max(item.quantity, pack.moq),
        moq: pack.moq,
        gstPercent: product?.gst_percent ?? 0,
        currentUnitPrice,
        unavailable,
      };
    });

  return (
    <div className="space-y-5 sm:space-y-6">
      <nav className="flex items-center gap-1.5 text-[10px] font-semibold text-slate-500 sm:text-xs"><Link href="/retailer/orders" className="hover:text-primary-600">My orders</Link><ChevronRight className="h-3 w-3" /><Link href={`/retailer/orders/${order.id}`} className="font-mono hover:text-primary-600">{order.order_number}</Link><ChevronRight className="h-3 w-3" /><span className="text-slate-800">Reorder</span></nav>

      <section className="marketplace-grid relative overflow-hidden rounded-2xl bg-gradient-to-r from-primary-800 via-primary-700 to-slate-950 p-5 text-white shadow-lg sm:p-8">
        <RotateCcw className="absolute -bottom-8 -right-4 h-40 w-40 rotate-[-15deg] text-white/5 sm:h-52 sm:w-52" />
        <div className="relative"><p className="text-[10px] font-bold uppercase tracking-[0.2em] text-amber-300">Buy again</p><h1 className="mt-2 text-2xl font-bold tracking-tight sm:text-4xl">Review your reorder</h1><p className="mt-2 text-xs text-primary-100 sm:text-sm">From <span className="font-mono font-semibold text-white">{order.order_number}</span> · {new Date(order.placed_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}</p><Link href={`/retailer/orders/${order.id}`} className="mt-4 inline-flex items-center gap-1 text-[10px] font-bold text-white/80 hover:text-white"><ArrowLeft className="h-3.5 w-3.5" /> Back to order details</Link></div>
      </section>

      <div className="flex items-start gap-3 rounded-xl border border-blue-200 bg-blue-50 px-4 py-3 text-[10px] leading-4 text-blue-800 sm:text-xs"><Info className="mt-0.5 h-4 w-4 shrink-0" /><p><span className="font-bold">Current terms apply.</span> Edit quantities before adding. Prices, GST, availability and MOQ shown here are current and will be securely checked again at checkout.</p></div>

      <ReorderForm orderId={order.id} lines={lines} />
      <p className="flex items-center justify-center gap-1.5 text-[9px] text-slate-400"><ShieldCheck className="h-3.5 w-3.5 text-emerald-600" /> Original order pricing is never reused.</p>
    </div>
  );
}
