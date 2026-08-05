import Link from 'next/link';
import Image from 'next/image';
import { notFound } from 'next/navigation';
import { FileText, ImageOff } from 'lucide-react';
import { createClient } from '@/lib/supabase/server';
import { requireUser } from '@/lib/auth/session';
import { Card, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { RetailerOrderActions } from '@/components/retailer/order-actions-panel';

type OrderStatus = 'pending' | 'confirmed' | 'processing' | 'packed' | 'dispatched' | 'delivered' | 'cancelled' | 'returned';

const STATUS_STYLES: Record<OrderStatus, string> = {
  pending: 'bg-amber-50 text-amber-700',
  confirmed: 'bg-blue-50 text-blue-700',
  processing: 'bg-blue-50 text-blue-700',
  packed: 'bg-violet-50 text-violet-700',
  dispatched: 'bg-violet-50 text-violet-700',
  delivered: 'bg-green-50 text-green-700',
  cancelled: 'bg-primary-50 text-primary-700',
  returned: 'bg-primary-50 text-primary-700',
};

interface OrderDetailRow {
  id: string;
  order_number: string;
  status: OrderStatus;
  subtotal: number;
  gst_total: number;
  discount_total: number;
  grand_total: number;
  notes: string | null;
  placed_at: string;
}

interface OrderItemRow {
  id: string;
  quantity: number;
  unit_price: number;
  gst_percent: number;
  line_total: number;
  products: { name: string; product_images: { image_url: string }[] } | null;
  product_packs: { pack_name: string } | null;
}

interface HistoryRow {
  id: string;
  status: OrderStatus;
  note: string | null;
  created_at: string;
}

export default async function OrderDetailPage({ params }: { params: { id: string } }) {
  const user = await requireUser();
  const supabase = createClient();

  const [{ data: order }, { data: itemData }, { data: historyData }] = await Promise.all([
    supabase
      .from('orders')
      .select('id, order_number, status, subtotal, gst_total, discount_total, grand_total, notes, placed_at')
      .eq('id', params.id)
      .eq('retailer_id', user.id)
      .maybeSingle<OrderDetailRow>(),
    supabase
      .from('order_items')
      .select('id, quantity, unit_price, gst_percent, line_total, products ( name, product_images ( image_url ) ), product_packs ( pack_name )')
      .eq('order_id', params.id),
    supabase
      .from('order_status_history')
      .select('id, status, note, created_at')
      .eq('order_id', params.id)
      .order('created_at', { ascending: true }),
  ]);

  if (!order) notFound();

  const items = (itemData ?? []) as unknown as OrderItemRow[];
  const history = (historyData ?? []) as HistoryRow[];

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-mono text-lg font-semibold text-ink-950">{order.order_number}</h1>
          <p className="text-xs text-ink-400">
            {new Date(order.placed_at).toLocaleString('en-IN')}
          </p>
        </div>
        <Link href={`/retailer/orders/${order.id}/invoice`}>
          <Button variant="outline" size="sm">
            <FileText className="h-4 w-4" />
            Invoice
          </Button>
        </Link>
      </div>

      <span className={`inline-block rounded-full px-3 py-1 text-sm font-medium ${STATUS_STYLES[order.status]}`}>
        {order.status.charAt(0).toUpperCase() + order.status.slice(1)}
      </span>

      {history.length > 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>Status timeline</CardTitle>
          </CardHeader>
          <ol className="space-y-3">
            {history.map((h, index) => (
              <li key={h.id} className="flex gap-3 text-sm">
                <div className="flex flex-col items-center">
                  <span className={`h-2.5 w-2.5 rounded-full ${index === history.length - 1 ? 'bg-primary-600' : 'bg-ink-300'}`} />
                  {index < history.length - 1 ? <span className="mt-1 h-full w-px flex-1 bg-ink-100" /> : null}
                </div>
                <div className="pb-3">
                  <p className="font-medium text-ink-900">{h.status.charAt(0).toUpperCase() + h.status.slice(1)}</p>
                  <p className="text-xs text-ink-400">{new Date(h.created_at).toLocaleString('en-IN')}</p>
                  {h.note ? <p className="mt-0.5 text-xs text-ink-500">{h.note}</p> : null}
                </div>
              </li>
            ))}
          </ol>
        </Card>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>Items</CardTitle>
        </CardHeader>
        <div className="space-y-3">
          {items.map((item) => (
            <div key={item.id} className="flex items-center gap-3">
              <div className="relative h-12 w-12 shrink-0 overflow-hidden rounded-lg bg-ink-50">
                {item.products?.product_images[0]?.image_url ? (
                  <Image
                    src={item.products.product_images[0].image_url}
                    alt=""
                    fill
                    className="object-cover"
                    unoptimized
                  />
                ) : (
                  <div className="flex h-full w-full items-center justify-center text-ink-300">
                    <ImageOff className="h-4 w-4" />
                  </div>
                )}
              </div>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-ink-900">{item.products?.name ?? 'Unknown product'}</p>
                <p className="text-xs text-ink-400">
                  {item.product_packs?.pack_name} × {item.quantity} @ ₹{item.unit_price.toFixed(2)}
                </p>
              </div>
              <p className="text-sm font-semibold text-ink-900">₹{item.line_total.toFixed(2)}</p>
            </div>
          ))}
        </div>
      </Card>

      <Card className="space-y-1.5">
        <div className="flex justify-between text-sm text-ink-600">
          <span>Subtotal</span>
          <span>₹{order.subtotal.toFixed(2)}</span>
        </div>
        <div className="flex justify-between text-sm text-ink-600">
          <span>GST</span>
          <span>₹{order.gst_total.toFixed(2)}</span>
        </div>
        {order.discount_total > 0 ? (
          <div className="flex justify-between text-sm text-ink-600">
            <span>Discount</span>
            <span>-₹{order.discount_total.toFixed(2)}</span>
          </div>
        ) : null}
        <div className="flex justify-between border-t border-ink-100 pt-1.5 text-base font-semibold text-ink-950">
          <span>Total</span>
          <span>₹{order.grand_total.toFixed(2)}</span>
        </div>
      </Card>

      {order.notes ? (
        <Card>
          <CardHeader>
            <CardTitle>Delivery notes</CardTitle>
          </CardHeader>
          <p className="text-sm text-ink-600">{order.notes}</p>
        </Card>
      ) : null}

      <RetailerOrderActions orderId={order.id} status={order.status} />
    </div>
  );
}
