import Link from 'next/link';
import { notFound } from 'next/navigation';
import { PackageSearch, Warehouse } from 'lucide-react';
import { createClient } from '@/lib/supabase/server';
import { requirePermission } from '@/lib/admin/guard';
import { Card, CardHeader, CardTitle } from '@/components/ui/card';
import { AdminEmptyState } from '@/components/admin/empty-state';
import { AreaEditForm } from '@/components/admin/area-edit-form';
import { formatIndiaDateTime } from '@/lib/datetime/india';

interface AreaDetail {
  id: string;
  name: string;
  district: string;
}

interface AreaStockRow {
  product_id: string;
  product_name: string;
  quantity_on_hand: number;
  quantity_reserved: number;
  updated_at: string;
}

interface WarehouseRow {
  id: string;
  name: string;
  is_active: boolean;
}

interface ProductThresholdRow {
  id: string;
  reorder_level: number;
}

export default async function EditAreaPage({ params }: { params: { id: string } }) {
  await requirePermission('inventory.view');

  const supabase = createClient();
  const { data: area } = await supabase
    .from('areas')
    .select('id, name, district')
    .eq('id', params.id)
    .single<AreaDetail>();

  if (!area) notFound();

  // Area stock comes from the inventory_area_totals view (migration 0041):
  // stock across the area's ACTIVE warehouses, computed with the caller's
  // RLS — same visibility as querying inventory_stock directly.
  const [{ data: stockData }, { data: warehouseData }, { data: thresholdData }] = await Promise.all([
    supabase
      .from('inventory_area_totals')
      .select('product_id, product_name, quantity_on_hand, quantity_reserved, updated_at')
      .eq('area_id', params.id)
      .order('quantity_on_hand', { ascending: false })
      .limit(200)
      .returns<AreaStockRow[]>(),
    supabase.from('warehouses').select('id, name, is_active').eq('area_id', params.id).order('name'),
    supabase.from('products').select('id, reorder_level').returns<ProductThresholdRow[]>(),
  ]);

  const stock = stockData ?? [];
  const warehouses = (warehouseData ?? []) as WarehouseRow[];
  const reorderByProduct = new Map((thresholdData ?? []).map((p) => [p.id, p.reorder_level]));
  const lowStock = stock.filter((s) => {
    const reorder = reorderByProduct.get(s.product_id) ?? 0;
    return reorder > 0 && s.quantity_on_hand <= reorder;
  });
  const totalUnits = stock.reduce((sum, s) => sum + s.quantity_on_hand, 0);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-ink-950">Edit area</h1>
        <p className="mt-1 text-sm text-ink-500">{area.name}</p>
      </div>
      <Card>
        <CardHeader>
          <CardTitle>Area details</CardTitle>
        </CardHeader>
        <AreaEditForm areaId={area.id} name={area.name} district={area.district} />
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Warehouses in this area</CardTitle>
        </CardHeader>
        {warehouses.length === 0 ? (
          <p className="text-sm text-ink-500">
            No warehouses in this area yet — stock totals appear once a warehouse here holds stock.
          </p>
        ) : (
          <ul className="space-y-1.5 text-sm">
            {warehouses.map((w) => (
              <li key={w.id} className="flex items-center justify-between">
                <Link href={`/admin/warehouses/${w.id}`} className="font-medium text-primary-600 hover:text-primary-700">
                  {w.name}
                </Link>
                <span className={`text-xs ${w.is_active ? 'text-emerald-600' : 'text-ink-400'}`}>
                  {w.is_active ? 'Active' : 'Inactive'}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Warehouse className="h-4 w-4" />
            Stock across this area
          </CardTitle>
        </CardHeader>
        <p className="text-xs text-ink-400">
          Aggregated across active warehouses in {area.name} · {totalUnits.toLocaleString('en-IN')} units on hand
          {lowStock.length > 0 ? ` · ${lowStock.length} product${lowStock.length === 1 ? '' : 's'} at/below reorder level` : ''}
        </p>
        {stock.length === 0 ? (
          <AdminEmptyState
            icon={PackageSearch}
            title="No stock recorded in this area"
            body="Once a warehouse in this area receives stock through a GRN, area totals appear here."
          />
        ) : (
          <div className="table-scroll mt-4">
            <table className="w-full min-w-[560px] text-sm">
              <thead className="border-b border-ink-100 text-left text-xs uppercase tracking-wide text-ink-500">
                <tr>
                  <th className="py-2 pr-4 font-medium">Product</th>
                  <th className="py-2 pr-4 font-medium">On hand</th>
                  <th className="py-2 pr-4 font-medium">Reserved</th>
                  <th className="py-2 pr-4 font-medium">Available</th>
                  <th className="py-2 font-medium">Updated</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-ink-100">
                {stock.map((s) => {
                  const reorder = reorderByProduct.get(s.product_id) ?? 0;
                  const isLow = reorder > 0 && s.quantity_on_hand <= reorder;
                  return (
                    <tr key={s.product_id}>
                      <td className="py-2.5 pr-4 font-medium text-ink-900">
                        {s.product_name}
                        {isLow ? (
                          <span className="ml-2 rounded-full bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-700">Low</span>
                        ) : null}
                      </td>
                      <td className="py-2.5 pr-4 text-ink-600">{s.quantity_on_hand}</td>
                      <td className="py-2.5 pr-4 text-ink-600">{s.quantity_reserved}</td>
                      <td className="py-2.5 pr-4 text-ink-600">{s.quantity_on_hand - s.quantity_reserved}</td>
                      <td className="py-2.5 text-xs text-ink-400">{formatIndiaDateTime(s.updated_at)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
