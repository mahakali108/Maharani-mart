import { notFound } from 'next/navigation';
import { formatQuantitySummary, groupOrderLines, type OrderItemUnit} from '@/lib/orders/item-display';
import { createClient } from '@/lib/supabase/server';
import { requireUser } from '@/lib/auth/session';
import { Card, CardHeader, CardTitle } from '@/components/ui/card';
import { MarkDeliveredButton } from '@/components/salesman/mark-delivered-button';

interface OrderRow {
  id: string;
  order_number: string;
  status: string;
  grand_total: number;
  notes: string | null;
  retailer_id: string;
  collected_by: string | null;
  retailers: { shop_name: string; address: string | null } | null;
}

interface OrderItemRow {
  id: string;
  product_id: string;
  pack_id: string | null;
  quantity: number;
  quantity_unit: OrderItemUnit | null;
  quantity_pieces: number | null;
  units_per_case: number | null;
  products: { name: string } | null;
  product_packs: { pack_name: string; units_per_case: number } | null;
}

export default async function SalesmanOrderDetailPage({ params }: { params: { id: string } }) {
  const user = await requireUser();
  const supabase = createClient();

  const { data: order } = await supabase
    .from('orders')
    .select('id, order_number, status, grand_total, notes, retailer_id, collected_by, retailers ( shop_name, address )')
    .eq('id', params.id)
    .maybeSingle<OrderRow>();

  if (!order) notFound();

  if (order.collected_by !== user.id) {
    const { data: assignment } = await supabase
      .from('retailers')
      .select('id')
      .eq('id', order.retailer_id)
      .eq('assigned_salesman_id', user.id)
      .maybeSingle<{ id: string }>();
    if (!assignment) notFound();
  }

  const { data: itemData } = await supabase
    .from('order_items')
    .select(
      'id, product_id, pack_id, quantity, quantity_unit, quantity_pieces, units_per_case, products ( name ), product_packs ( pack_name, units_per_case )'
    )
    .eq('order_id', params.id);
  const items = (itemData ?? []) as unknown as OrderItemRow[];
  const orderLines = groupOrderLines(items);

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
          {orderLines.map((line) => (
            <li key={line.key} className="flex justify-between">
              <span className="text-ink-700">
                {line.first.products?.name} ({line.first.product_packs?.pack_name})
              </span>
              <span className="font-medium text-ink-900">× {formatQuantitySummary(line.quantity)}</span>
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
