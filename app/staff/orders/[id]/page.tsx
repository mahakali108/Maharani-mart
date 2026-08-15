import { notFound } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { requirePermission } from '@/lib/admin/guard';
import { Card, CardHeader, CardTitle } from '@/components/ui/card';
import { DispatchButton } from '@/components/staff/dispatch-button';

interface OrderRow {
  id: string;
  order_number: string;
  status: string;
  warehouse_id: string | null;
  grand_total: number;
  retailers: { shop_name: string; address: string | null } | null;
  warehouses: { name: string } | null;
}

interface OrderItemRow {
  id: string;
  quantity: number;
  products: { name: string; sku_code: string } | null;
  product_packs: { pack_name: string } | null;
}

export default async function StaffOrderDetailPage({ params }: { params: { id: string } }) {
  await requirePermission('orders.view.all');
  const supabase = createClient();

  const [{ data: order }, { data: itemData }] = await Promise.all([
    supabase
      .from('orders')
      .select('id, order_number, status, warehouse_id, grand_total, retailers ( shop_name, address ), warehouses ( name )')
      .eq('id', params.id)
      .maybeSingle<OrderRow>(),
    supabase
      .from('order_items')
      .select('id, quantity, products ( name, sku_code ), product_packs ( pack_name )')
      .eq('order_id', params.id),
  ]);

  if (!order) notFound();

  const items = (itemData ?? []) as unknown as OrderItemRow[];
  const canDispatch = ['confirmed', 'processing', 'packed'].includes(order.status) && !!order.warehouse_id;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-mono text-xl font-semibold text-ink-950">{order.order_number}</h1>
        <p className="text-sm text-ink-500">{order.retailers?.shop_name}</p>
        <p className="text-xs text-ink-400">{order.retailers?.address}</p>
      </div>

      <Card>
        <p className="text-sm text-ink-600">
          Warehouse: <span className="font-medium text-ink-900">{order.warehouses?.name ?? 'Not assigned'}</span>
        </p>
        <p className="text-sm text-ink-600">
          Status: <span className="font-medium text-ink-900">{order.status}</span>
        </p>
        {!order.warehouse_id ? (
          <p className="mt-2 text-xs text-primary-600">
            An admin must assign a warehouse before this order can be dispatched.
          </p>
        ) : null}
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Items to pack</CardTitle>
        </CardHeader>
        <ul className="space-y-2 text-sm">
          {items.map((item) => (
            <li key={item.id} className="flex justify-between">
              <span className="text-ink-700">{item.products?.name} ({item.product_packs?.pack_name})</span>
              <span className="font-semibold text-ink-900">× {item.quantity}</span>
            </li>
          ))}
        </ul>
      </Card>

      {canDispatch ? <DispatchButton orderId={order.id} /> : null}
    </div>
  );
      }
