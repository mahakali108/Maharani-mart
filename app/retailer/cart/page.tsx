import Link from 'next/link';
import { ShoppingCart } from 'lucide-react';
import { createClient } from '@/lib/supabase/server';
import { requireUser } from '@/lib/auth/session';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
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
    product_images: { image_url: string }[];
  } | null;
}

interface PriceOverrideRow {
  product_id: string;
  scope: 'retailer' | 'area';
  price: number;
}

export default async function CartPage() {
  const user = await requireUser();
  const supabase = createClient();

  const { data: cartData } = await supabase
    .from('cart_items')
    .select(
      'id, quantity, pack_id, product_id, product_packs ( id, pack_name, base_price, ptr, moq, is_active ), products ( name, gst_percent, is_active, product_images ( image_url ) )'
    )
    .eq('retailer_id', user.id)
    .order('updated_at', { ascending: false });

  const items = (cartData ?? []) as unknown as CartItemDetail[];

  if (items.length === 0) {
    return (
      <div className="space-y-5">
        <h1 className="text-xl font-semibold text-ink-950">Cart</h1>
        <Card className="flex flex-col items-center gap-2 py-12 text-center">
          <ShoppingCart className="h-8 w-8 text-ink-300" />
          <p className="font-medium text-ink-700">Your cart is empty</p>
          <p className="text-sm text-ink-400">Browse the catalog and add products to order.</p>
          <Link href="/retailer/catalog">
            <Button className="mt-2">Browse catalog</Button>
          </Link>
        </Card>
      </div>
    );
  }

  // Batched price-override lookup for every distinct product in the cart.
  const productIds = [...new Set(items.map((i) => i.product_id))];
  const overrideByProduct = new Map<string, number>();
  const nowIso = new Date().toISOString();

  const { data: overrides } = await supabase
    .from('price_lists')
    .select('product_id, scope, price')
    .in('product_id', productIds)
    .in('scope', ['retailer', 'area'])
    .eq('is_active', true)
    .lte('valid_from', nowIso)
    .order('priority', { ascending: false })
    .returns<PriceOverrideRow[]>();

  for (const row of overrides ?? []) {
    const existing = overrideByProduct.get(row.product_id);
    if (existing === undefined || row.scope === 'retailer') {
      overrideByProduct.set(row.product_id, row.price);
    }
  }

  let subtotal = 0;
  let gstTotal = 0;
  const lines = items.map((item) => {
    const pack = item.product_packs;
    const product = item.products;
    const unitPrice = pack ? overrideByProduct.get(item.product_id) ?? pack.ptr ?? pack.base_price : 0;
    const lineSubtotal = unitPrice * item.quantity;
    const gstPercent = product?.gst_percent ?? 0;
    const lineGst = (lineSubtotal * gstPercent) / 100;
    subtotal += lineSubtotal;
    gstTotal += lineGst;

    return {
      id: item.id,
      quantity: item.quantity,
      packName: pack?.pack_name ?? 'Unknown pack',
      productName: product?.name ?? 'Unknown product',
      imageUrl: product?.product_images[0]?.image_url,
      unitPrice,
      lineTotal: lineSubtotal + lineGst,
      moq: pack?.moq ?? 1,
      isUnavailable: !pack?.is_active || !product?.is_active,
    };
  });

  const grandTotal = subtotal + gstTotal;
  const hasUnavailable = lines.some((l) => l.isUnavailable);

  return (
    <div className="space-y-5">
      <h1 className="text-xl font-semibold text-ink-950">Cart</h1>

      {hasUnavailable ? (
        <div className="rounded-xl border border-primary-200 bg-primary-50 px-4 py-3 text-sm text-primary-700">
          One or more items in your cart are no longer available and will be removed automatically at checkout.
        </div>
      ) : null}

      <div className="space-y-3">
        {lines.map((line) => (
          <CartItemRow key={line.id} {...line} />
        ))}
      </div>

      <Card className="space-y-2">
        <div className="flex justify-between text-sm text-ink-600">
          <span>Subtotal</span>
          <span>₹{subtotal.toFixed(2)}</span>
        </div>
        <div className="flex justify-between text-sm text-ink-600">
          <span>GST</span>
          <span>₹{gstTotal.toFixed(2)}</span>
        </div>
        <div className="flex justify-between border-t border-ink-100 pt-2 text-base font-semibold text-ink-950">
          <span>Total</span>
          <span>₹{grandTotal.toFixed(2)}</span>
        </div>
        <Link href="/retailer/checkout">
          <Button className="mt-2 w-full" disabled={lines.every((l) => l.isUnavailable)}>
            Proceed to checkout
          </Button>
        </Link>
      </Card>
    </div>
  );
                      }
