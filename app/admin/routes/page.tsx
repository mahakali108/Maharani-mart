import Link from 'next/link';
import { Route as RouteIcon } from 'lucide-react';
import { createClient } from '@/lib/supabase/server';
import { Card, CardHeader, CardTitle } from '@/components/ui/card';
import { AdminEmptyState } from '@/components/admin/empty-state';
import { RouteCreateForm } from '@/components/admin/route-create-form';
import { RouteRowActions } from '@/components/admin/route-row-actions';

interface RouteRow {
  id: string;
  name: string;
  is_active: boolean;
  profiles: { full_name: string } | null;
  areas: { name: string } | null;
}

interface Option {
  id: string;
  full_name: string;
}

interface AreaOption {
  id: string;
  name: string;
}

export default async function AdminRoutesPage() {
  const supabase = createClient();

  const [{ data: routeData }, { data: salesmenData }, { data: areaData }] = await Promise.all([
    supabase
      .from('routes')
      .select('id, name, is_active, profiles ( full_name ), areas ( name )')
      .order('name'),
    supabase.from('profiles').select('id, full_name').eq('role', 'salesman').eq('is_active', true).order('full_name'),
    supabase.from('areas').select('id, name').eq('is_active', true).order('name'),
  ]);

  const routes = (routeData ?? []) as unknown as RouteRow[];
  const salesmen = (salesmenData ?? []) as Option[];
  const areas = (areaData ?? []) as AreaOption[];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-ink-950">Routes</h1>
        <p className="mt-1 text-sm text-ink-500">Assign retailers to a salesman&apos;s daily beat plan.</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Create a route</CardTitle>
        </CardHeader>
        {salesmen.length === 0 ? (
          <p className="text-sm text-ink-500">
            No salesman accounts exist yet. A super admin needs to create one before you can build a route.
          </p>
        ) : (
          <RouteCreateForm salesmen={salesmen} areas={areas} />
        )}
      </Card>

      {routes.length === 0 ? (
        <AdminEmptyState
          icon={RouteIcon}
          title="No routes yet"
          body="Create a route above, then add retailers to it."
        />
      ) : (
        <Card className="overflow-hidden p-0">
          <table className="w-full text-sm">
            <thead className="border-b border-ink-100 bg-ink-50 text-left text-xs uppercase tracking-wide text-ink-500">
              <tr>
                <th className="px-5 py-3 font-medium">Name</th>
                <th className="px-5 py-3 font-medium">Salesman</th>
                <th className="px-5 py-3 font-medium">Area</th>
                <th className="px-5 py-3 font-medium">Status</th>
                <th className="px-5 py-3 font-medium" />
              </tr>
            </thead>
            <tbody className="divide-y divide-ink-100">
              {routes.map((r) => (
                <tr key={r.id}>
                  <td className="px-5 py-3">
                    <Link href={`/admin/routes/${r.id}`} className="font-medium text-ink-900 hover:text-primary-600">
                      {r.name}
                    </Link>
                  </td>
                  <td className="px-5 py-3 text-ink-600">{r.profiles?.full_name ?? '—'}</td>
                  <td className="px-5 py-3 text-ink-600">{r.areas?.name ?? '—'}</td>
                  <td className="px-5 py-3">
                    <RouteRowActions id={r.id} isActive={r.is_active} />
                  </td>
                  <td className="px-5 py-3 text-right">
                    <Link href={`/admin/routes/${r.id}`} className="text-xs font-medium text-primary-600 hover:text-primary-700">
                      Manage stops
                    </Link>
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
