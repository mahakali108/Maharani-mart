import { Warehouse } from 'lucide-react';
import { createClient } from '@/lib/supabase/server';
import { Card, CardHeader, CardTitle } from '@/components/ui/card';
import { WarehouseForm } from '@/components/admin/warehouse-form';
import { WarehouseRowActions } from '@/components/admin/warehouse-row-actions';
import { AdminEmptyState } from '@/components/admin/empty-state';

interface WarehouseRow {
  id: string;
  name: string;
  address: string | null;
  is_active: boolean;
  areas: { name: string } | null;
}

interface AreaOption {
  id: string;
  name: string;
}

export default async function WarehousesPage() {
  const supabase = createClient();

  const [{ data: warehouseData }, { data: areaData }] = await Promise.all([
    supabase
      .from('warehouses')
      .select('id, name, address, is_active, areas ( name )')
      .order('name'),
    supabase.from('areas').select('id, name').eq('is_active', true).order('name'),
  ]);

  const warehouses = (warehouseData ?? []) as unknown as WarehouseRow[];
  const areas = (areaData ?? []) as AreaOption[];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-ink-950">Warehouses</h1>
        <p className="mt-1 text-sm text-ink-500">Storage/dispatch locations used by inventory and orders.</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Add a new warehouse</CardTitle>
        </CardHeader>
        <WarehouseForm areas={areas} />
        {areas.length === 0 ? (
          <p className="mt-3 text-xs text-ink-400">Add an Area first if you want to link warehouses to one.</p>
        ) : null}
      </Card>

      {warehouses.length === 0 ? (
        <AdminEmptyState
          icon={Warehouse}
          title="No warehouses yet"
          body="Add your first warehouse above — inventory and orders need at least one warehouse to dispatch from."
        />
      ) : (
        <Card className="overflow-hidden p-0">
          <table className="w-full text-sm">
            <thead className="border-b border-ink-100 bg-ink-50 text-left text-xs uppercase tracking-wide text-ink-500">
              <tr>
                <th className="px-5 py-3 font-medium">Name</th>
                <th className="px-5 py-3 font-medium">Area</th>
                <th className="px-5 py-3 font-medium">Address</th>
                <th className="px-5 py-3 font-medium">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-ink-100">
              {warehouses.map((wh) => (
                <tr key={wh.id}>
                  <td className="px-5 py-3 font-medium text-ink-900">{wh.name}</td>
                  <td className="px-5 py-3 text-ink-600">{wh.areas?.name ?? '—'}</td>
                  <td className="px-5 py-3 text-ink-600">{wh.address ?? '—'}</td>
                  <td className="px-5 py-3">
                    <WarehouseRowActions id={wh.id} isActive={wh.is_active} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
    </div>
  );
}
