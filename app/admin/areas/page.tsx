import Link from 'next/link';
import { areasInDistrict, districtOptions } from '@/lib/areas/district';
import { Select } from '@/components/ui/select';
import { Button } from '@/components/ui/button';
import { MapPin } from 'lucide-react';
import { createClient } from '@/lib/supabase/server';
import { Card, CardHeader, CardTitle } from '@/components/ui/card';
import { AreaForm } from '@/components/admin/area-form';
import { AreaRowActions } from '@/components/admin/area-row-actions';
import { AdminEmptyState } from '@/components/admin/empty-state';
import { SERVICE_AREA_LABEL } from '@/lib/config/service-area';

interface AreaRow {
  id: string;
  name: string;
  district: string;
  is_active: boolean;
  created_at: string;
}

export default async function AreasPage({ searchParams }: { searchParams: { district?: string } }) {
  const supabase = createClient();
  const { data, error } = await supabase.from('areas').select('id, name, district, is_active, created_at').order('name');
  if (error) throw new Error('Service areas could not be loaded. Please retry.');
  const directory = (data ?? []) as AreaRow[];
  const district = searchParams.district ?? '';
  const districts = districtOptions(directory);
  const areas = areasInDistrict(directory, district);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-ink-950">Areas</h1>
        <p className="mt-1 text-sm text-ink-500">
          Default for new areas: {SERVICE_AREA_LABEL}. All configured districts remain supported. Retailers select a verified area at registration.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Add a new area</CardTitle>
        </CardHeader>
        <AreaForm districts={districts} />
      </Card>

      <form method="get" className="flex flex-wrap items-end gap-3 rounded-2xl border border-ink-100 bg-white p-4">
        <label className="min-w-0 flex-1 text-sm font-medium sm:max-w-sm">Service district
          <Select name="district" defaultValue={district} className="mt-2">
            <option value="">All districts</option>
            {district && !districts.includes(district) ? <option value={district}>{district} (not configured)</option> : null}
            {districts.map((name) => <option key={name} value={name}>{name}</option>)}
          </Select>
        </label>
        <Button type="submit">Filter areas</Button>
        <Link href="/admin/areas" className="inline-flex min-h-11 items-center text-sm underline">Clear</Link>
      </form>
      {areas.length === 0 ? (
        <AdminEmptyState
          icon={MapPin}
          title={district ? "No areas in this district" : "No areas yet"}
          body={district ? "Clear the district filter to see all configured areas, or add a verified area above." : "Add your first area above — retailers can't register until at least one area exists."}
        />
      ) : (
        <Card className="table-scroll p-0">
          <table className="w-full min-w-[560px] text-sm">
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
                  <td className="px-5 py-3 font-medium text-ink-900"><Link className="underline decoration-ink-200 underline-offset-4 hover:text-primary-600" href={`/admin/areas/${area.id}`}>{area.name}</Link></td>
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
