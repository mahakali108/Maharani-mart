import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ArrowLeft } from 'lucide-react';
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
    moq: number;
    is_active: boolean;
  } | null;
}

/**
 * Reorder review screen (Requirement B): shows the items of a past
 * order with their CURRENT pack data, current effective price, current
 * GST rate, and current MOQ — the retailer edits quantities here and
 * only then are valid lines merged into the existing cart. Old prices
 * and old MOQs are deliberately never consulted: price display uses
 * the same getProductPriceOverride/resolvePackPrice pair the cart and
 * checkout pages use, and line validation re-happens server-side in
 * addReorderLinesToCartAction at submit time.
 */
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
      .select(
        'id, pack_id, quantity, products ( id, name, gst_percent, is_active, product_images ( image_url ) ), product_packs ( id, pack_name, base_price, ptr, moq, is_active )'
      )
      .eq('order_id', order.id),
  ]);

  const items = (itemData ?? []) as unknown as ReorderItemRow[];

  // Resolve the CURRENT product-level override once per distinct
  // product — the exact same pricing rule cart/checkout resolve, so
  // the retailer can never be shown (or charged) yesterday's price.
  const overrideByProduct = new Map<string, number | null>();
  const distinctProductIds = [...new Set(items.map((i) => i.products?.id).filter((id): id is string => !!id))];
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
      const currentUnitPrice = resolvePackPrice(
        pack,
        product ? overrideByProduct.get(product.id) ?? null : null
      );
      const unavailable = !pack.is_active || !product?.is_active;
      const moq = pack.moq;
      return {
        packId: item.pack_id!,
        productName: product?.name ?? 'Unknown product',
        packName: pack.pack_name,
        imageUrl: product?.product_images[0]?.image_url,
        previousQuantity: item.quantity,
        suggestedQuantity: Math.max(item.quantity, moq),
        moq,
        gstPercent: product?.gst_percent ?? 0,
        currentUnitPrice,
        unavailable,
      };
    });

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-ink-950">Reorder</h1>
          <p className="mt-1 text-sm text-ink-500">
            From <span className="font-mono">{order.order_number}</span> ·{' '}
            {new Date(order.placed_at).toLocaleDateString('en-IN', {
              day: 'numeric',
              month: 'short',
              year: 'numeric',
            })}
          </p>
        </div>
        <Link
          href={`/retailer/orders/${order.id}`}
          className="flex items-center gap-1 text-sm font-medium text-primary-600 hover:text-primary-700"
        >
          <ArrowLeft className="h-4 w-4" />
          Back
        </Link>
      </div>

      <p className="rounded-xl border border-ink-100 bg-white px-4 py-3 text-sm text-ink-500">
        Quantities are editable. Prices, GST and minimum quantities shown are the current ones —
        totals are rechecked again at checkout.
      </p>

      <ReorderForm orderId={order.id} lines={lines} />
    </div>
  );
}
