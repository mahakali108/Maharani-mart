import { notFound } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { Card, CardHeader, CardTitle } from '@/components/ui/card';
import { AdminOrderActions } from '@/components/admin/order-actions-panel';

interface OrderDetailRow {
  id: string;
  order_number: string;
  status: string;
  warehouse_id: string | null;
  subtotal: number;
  gst_total: number;
  grand_total: number;
  notes: string | null;
  cancelled_reason: string | null;
  placed_at: string;
  retailers: { shop_name: string; address: string | null } | null;
}

interface OrderItemRow {
  id: string;
  quantity: number;
  unit_price: number;
  line_total: number;
  products: { name: string; sku_code: string } | null;
  product_packs: { pack_name: string } | null;
}

interface HistoryRow {
  id: string;
  status: string;
  note: string | null;
  created_at: string;
}

interface WarehouseOption {
  id: string;
  name: string;
}

export default async function AdminOrderDetailPage({ params }: { params: { id: string } }) {
  const supabase = createClient();

  const [{ data: order }, { data: itemData }, { data: historyData }, { data: warehouseData }] = await Promise.all([
    supabase
      .from('orders')
      .select('id, order_number, status, warehouse_id, subtotal, gst_total, grand_total, notes, cancelled_reason, placed_at, retailers ( shop_name, address )')
      .eq('id', params.id)
      .maybeSingle<OrderDetailRow>(),
    supabase
      .from('order_items')
      .select('id, quantity, unit_price, line_total, products ( name, sku_code ), product_packs ( pack_name )')
      .eq('order_id', params.id),
    supabase.from('order_status_history').select('id, status, note, created_at').eq('order_id', params.id).order('created_at'),
    supabase.from('warehouses').select('id, name').eq('is_active', true).order('name'),
  ]);

  if (!order) notFound();

  const items = (itemData ?? []) as unknown as OrderItemRow[];
  const history = (historyData ?? []) as HistoryRow[];
  const warehouses = (warehouseData ?? []) as WarehouseOption[];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-mono text-xl font-semibold text-ink-950">{order.order_number}</h1>
        <p className="text-sm text-ink-500">{order.retailers?.shop_name}</p>
        <p className="text-xs text-ink-400">{new Date(order.placed_at).toLocaleString('en-IN')}</p>
      </div>

      <AdminOrderActions
        orderId={order.id}
        status={order.status}
        warehouseId={order.warehouse_id}
        warehouses={warehouses}
      />

      {order.cancelled_reason ? (
        <div className="rounded-xl border border-primary-200 bg-primary-50 px-4 py-3 text-sm text-primary-700">
          Cancelled: {order.cancelled_reason}
        </div>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>Items</CardTitle>
        </CardHeader>
        <div className="space-y-2">
          {items.map((item) => (
            <div key={item.id} className="flex justify-between text-sm">
              <span className="text-ink-700">
                {item.products?.name} ({item.product_packs?.pack_name}) × {item.quantity}
              </span>
              <span className="font-medium text-ink-900">₹{item.line_total.toFixed(2)}</span>
            </div>
          ))}
        </div>
        <div className="mt-3 flex justify-between border-t border-ink-100 pt-3 text-base font-semibold text-ink-950">
          <span>Total</span>
          <span>₹{order.grand_total.toFixed(2)}</span>
        </div>
      </Card>

      {history.length > 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>Status history</CardTitle>
          </CardHeader>
          <ul className="space-y-2 text-sm">
            {history.map((h) => (
              <li key={h.id} className="flex justify-between">
                <span className="text-ink-700">{h.status.charAt(0).toUpperCase() + h.status.slice(1)}</span>
                <span className="text-xs text-ink-400">{new Date(h.created_at).toLocaleString('en-IN')}</span>
              </li>
            ))}
          </ul>
        </Card>
      ) : null}
    </div>
  );
}
