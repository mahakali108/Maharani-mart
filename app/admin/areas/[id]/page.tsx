import { notFound } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { Card, CardHeader, CardTitle } from '@/components/ui/card';
import { AreaEditForm } from '@/components/admin/area-edit-form';

interface AreaDetail {
  id: string;
  name: string;
  district: string;
}

export default async function EditAreaPage({ params }: { params: { id: string } }) {
  const supabase = createClient();
  const { data: area } = await supabase
    .from('areas')
    .select('id, name, district')
    .eq('id', params.id)
    .single<AreaDetail>();

  if (!area) notFound();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-ink-950">Edit area</h1>
        <p className="mt-1 text-sm text-ink-500">{area!.name}</p>
      </div>
      <Card>
        <CardHeader>
          <CardTitle>Area details</CardTitle>
        </CardHeader>
        <AreaEditForm areaId={area!.id} name={area!.name} district={area!.district} />
      </Card>
    </div>
  );
}
