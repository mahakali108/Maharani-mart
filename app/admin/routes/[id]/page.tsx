import { notFound } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { Card, CardHeader, CardTitle } from '@/components/ui/card';
import { AddRouteStopForm } from '@/components/admin/add-route-stop-form';
import { RemoveRouteStopButton } from '@/components/admin/remove-route-stop-button';

const DAY_LABELS = ['', 'Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

interface RouteDetail {
  id: string;
  name: string;
  profiles: { full_name: string } | null;
}

interface StopRow {
  id: string;
  visit_day: number | null;
  retailers: { id: string; shop_name: string } | null;
}

interface RetailerOption {
  id: string;
  shop_name: string;
}

export default async function AdminRouteDetailPage({ params }: { params: { id: string } }) {
  const supabase = createClient();

  const [{ data: route }, { data: stopData }, { data: retailerData }] = await Promise.all([
    supabase.from('routes').select('id, name, profiles ( full_name )').eq('id', params.id).maybeSingle<RouteDetail>(),
    supabase
      .from('route_customers')
      .select('id, visit_day, retailers ( id, shop_name )')
      .eq('route_id', params.id)
      .order('sort_order'),
    supabase.from('retailers').select('id, shop_name').eq('status', 'active').order('shop_name'),
  ]);

  if (!route) notFound();

  const stops = (stopData ?? []) as unknown as StopRow[];
  const retailers = (retailerData ?? []) as RetailerOption[];
  const assignedIds = new Set(stops.map((s) => s.retailers?.id));
  const availableRetailers = retailers.filter((r) => !assignedIds.has(r.id));

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-ink-950">{route.name}</h1>
        <p className="mt-1 text-sm text-ink-500">Salesman: {route.profiles?.full_name ?? '—'}</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Add a retailer to this route</CardTitle>
        </CardHeader>
        {availableRetailers.length === 0 ? (
          <p className="text-sm text-ink-500">
            {retailers.length === 0
              ? 'No active retailers exist yet.'
              : 'All active retailers are already on this route.'}
          </p>
        ) : (
          <AddRouteStopForm routeId={route.id} retailers={availableRetailers} />
        )}
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Stops ({stops.length})</CardTitle>
        </CardHeader>
        {stops.length === 0 ? (
          <p className="text-sm text-ink-500">No retailers on this route yet.</p>
        ) : (
          <ul className="divide-y divide-ink-100">
            {stops.map((stop) => (
              <li key={stop.id} className="flex items-center justify-between py-2.5">
                <div>
                  <p className="text-sm font-medium text-ink-900">{stop.retailers?.shop_name ?? '—'}</p>
                  <p className="text-xs text-ink-400">{stop.visit_day ? DAY_LABELS[stop.visit_day] : 'Any day'}</p>
                </div>
                <RemoveRouteStopButton routeCustomerId={stop.id} routeId={route.id} />
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
