import Link from 'next/link';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { requireUser } from '@/lib/auth/session';
import { Card } from '@/components/ui/card';
import { CheckoutForm } from '@/components/retailer/checkout-form';

interface CartItemDetail {
  id: string;
  quantity: number;
  product_id: string;
  product_packs: { pack_name: string; base_price: number; ptr: number | null; is_active: boolean } | null;
  products: { name: string; gst_percent: number; is_active: boolean } | null;
}

interface PriceOverrideRow {
  product_id: string;
  scope: 'retailer' | 'area';
  price: number;
}

export default async function CheckoutPage() {
  const user = await requireUser();
  const supabase = createClient();

  const { data: cartData } = await supabase
    .from('cart_items')
    .select(
      'id, quantity, product_id, product_packs ( pack_name, base_price, ptr, is_active ), products ( name, gst_percent, is_active )'
    )
    .eq('retailer_id', user.id)
    .order('updated_at', { ascending: false });

  const items = (cartData ?? []) as unknown as CartItemDetail[];

  // Nothing to check out — send them back to build a cart first,
  // rather than showing an empty/broken review screen.
  if (items.length === 0) {
    redirect('/retailer/cart');
  }

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
      lineTotal: lineSubtotal + lineGst,
    };
  });

  const grandTotal = subtotal + gstTotal;

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold text-ink-950">Checkout</h1>
        <Link href="/retailer/cart" className="text-sm font-medium text-primary-600 hover:text-primary-700">
          Edit cart
        </Link>
      </div>

      <Card className="space-y-3">
        {lines.map((line) => (
          <div key={line.id} className="flex items-center justify-between gap-3 text-sm">
            <div className="min-w-0">
              <p className="truncate font-medium text-ink-900">{line.productName}</p>
              <p className="text-xs text-ink-400">
                {line.packName} × {line.quantity}
              </p>
            </div>
            <p className="shrink-0 font-medium text-ink-900">₹{line.lineTotal.toFixed(2)}</p>
          </div>
        ))}
      </Card>

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
      </Card>

      <CheckoutForm />
    </div>
  );
}

