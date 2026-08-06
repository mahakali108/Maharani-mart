import { notFound } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { Card, CardHeader, CardTitle } from '@/components/ui/card';
import { MarkDeliveredButton } from '@/components/salesman/mark-delivered-button';

interface OrderRow {
  id: string;
  order_number: string;
  status: string;
  grand_total: number;
  notes: string | null;
  retailers: { shop_name: string; address: string | null } | null;
}

interface OrderItemRow {
  id: string;
  quantity: number;
  products: { name: string } | null;
  product_packs: { pack_name: string } | null;
}

export default async function SalesmanOrderDetailPage({ params }: { params: { id: string } }) {
  const supabase = createClient();

  const [{ data: order }, { data: itemData }] = await Promise.all([
    supabase
      .from('orders')
      .select('id, order_number, status, grand_total, notes, retailers ( shop_name, address )')
      .eq('id', params.id)
      .maybeSingle<OrderRow>(),
    supabase
      .from('order_items')
      .select('id, quantity, products ( name ), product_packs ( pack_name )')
      .eq('order_id', params.id),
  ]);

  if (!order) notFound();

  const items = (itemData ?? []) as unknown as OrderItemRow[];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-mono text-lg font-semibold text-ink-950">{order.order_number}</h1>
        <p className="text-sm text-ink-500">{order.retailers?.shop_name}</p>
        <p className="text-xs text-ink-400">{order.retailers?.address}</p>
      </div>

      <Card>
        <p className="text-sm text-ink-600">
          Status: <span className="font-medium text-ink-900">{order.status}</span>
        </p>
        <p className="mt-1 text-lg font-semibold text-ink-950">₹{order.grand_total.toFixed(2)}</p>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Items</CardTitle>
        </CardHeader>
        <ul className="space-y-1.5 text-sm">
          {items.map((item) => (
            <li key={item.id} className="flex justify-between">
              <span className="text-ink-700">{item.products?.name} ({item.product_packs?.pack_name})</span>
              <span className="font-medium text-ink-900">× {item.quantity}</span>
            </li>
          ))}
        </ul>
      </Card>

      {order.notes ? (
        <Card>
          <CardHeader>
            <CardTitle>Delivery notes</CardTitle>
          </CardHeader>
          <p className="text-sm text-ink-600">{order.notes}</p>
        </Card>
      ) : null}

      {order.status === 'dispatched' ? <MarkDeliveredButton orderId={order.id} /> : null}
    </div>
  );
}
