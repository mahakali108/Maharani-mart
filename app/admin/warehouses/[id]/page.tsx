import { notFound } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { Card, CardHeader, CardTitle } from '@/components/ui/card';
import { WarehouseEditForm } from '@/components/admin/warehouse-edit-form';

interface WarehouseDetail {
  id: string;
  name: string;
  area_id: string | null;
  address: string | null;
}

export default async function EditWarehousePage({ params }: { params: { id: string } }) {
  const supabase = createClient();

  const [{ data: warehouse }, { data: areaData }] = await Promise.all([
    supabase.from('warehouses').select('id, name, area_id, address').eq('id', params.id).single<WarehouseDetail>(),
    supabase.from('areas').select('id, name').eq('is_active', true).order('name'),
  ]);

  if (!warehouse) notFound();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-ink-950">Edit warehouse</h1>
        <p className="mt-1 text-sm text-ink-500">{warehouse!.name}</p>
      </div>
      <Card>
        <CardHeader>
          <CardTitle>Warehouse details</CardTitle>
        </CardHeader>
        <WarehouseEditForm
          warehouseId={warehouse!.id}
          name={warehouse!.name}
          areaId={warehouse!.area_id}
          address={warehouse!.address}
          areas={areaData ?? []}
        />
      </Card>
    </div>
  );
}
