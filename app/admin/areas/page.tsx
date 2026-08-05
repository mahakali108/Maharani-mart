import { MapPin } from 'lucide-react';
import { createClient } from '@/lib/supabase/server';
import { Card, CardHeader, CardTitle } from '@/components/ui/card';
import { AreaForm } from '@/components/admin/area-form';
import { AreaRowActions } from '@/components/admin/area-row-actions';
import { AdminEmptyState } from '@/components/admin/empty-state';

interface AreaRow {
  id: string;
  name: string;
  district: string;
  is_active: boolean;
  created_at: string;
}

export default async function AreasPage() {
  const supabase = createClient();
  const { data } = await supabase.from('areas').select('id, name, district, is_active, created_at').order('name');
  const areas = (data ?? []) as AreaRow[];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-ink-950">Areas</h1>
        <p className="mt-1 text-sm text-ink-500">
          Delivery areas within Khagaria district. Retailers select their area at registration.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Add a new area</CardTitle>
        </CardHeader>
        <AreaForm />
      </Card>

      {areas.length === 0 ? (
        <AdminEmptyState
          icon={MapPin}
          title="No areas yet"
          body="Add your first area above — retailers can't register until at least one area exists."
        />
      ) : (
        <Card className="overflow-hidden p-0">
          <table className="w-full text-sm">
            <thead className="border-b border-ink-100 bg-ink-50 text-left text-xs uppercase tracking-wide text-ink-500">
              <tr>
                <th className="px-5 py-3 font-medium">Name</th>
                <th className="px-5 py-3 font-medium">District</th>
                <th className="px-5 py-3 font-medium">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-ink-100">
              {areas.map((area) => (
                <tr key={area.id}>
                  <td className="px-5 py-3 font-medium text-ink-900">{area.name}</td>
                  <td className="px-5 py-3 text-ink-600">{area.district}</td>
                  <td className="px-5 py-3">
                    <AreaRowActions id={area.id} isActive={area.is_active} />
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
