import { Route as RouteIcon } from 'lucide-react';
import { createClient } from '@/lib/supabase/server';
import { requireUser } from '@/lib/auth/session';
import { Card, CardHeader, CardTitle } from '@/components/ui/card';
import { RouteStopCard } from '@/components/salesman/route-stop-card';

interface RouteRow {
  id: string;
  name: string;
}

interface StopRow {
  id: string;
  route_id: string;
  retailer_id: string;
  sort_order: number;
  retailers: { shop_name: string; address: string | null } | null;
}

interface TodayVisitRow {
  id: string;
  retailer_id: string;
  status: string;
  check_in_at: string | null;
}

export default async function SalesmanRoutesPage() {
  const user = await requireUser();
  const supabase = createClient();

  const { data: routes } = await supabase
    .from('routes')
    .select('id, name')
    .eq('salesman_id', user.id)
    .eq('is_active', true)
    .order('name')
    .returns<RouteRow[]>();

  if (!routes || routes.length === 0) {
    return (
      <div className="space-y-5">
        <h1 className="text-xl font-semibold text-ink-950">Routes</h1>
        <Card className="flex flex-col items-center gap-2 py-12 text-center">
          <RouteIcon className="h-8 w-8 text-ink-300" />
          <p className="font-medium text-ink-700">No route assigned yet</p>
          <p className="text-sm text-ink-400">Your admin will set up your beat plan — it will appear here.</p>
        </Card>
      </div>
    );
  }

  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);

  const routeIds = routes.map((r) => r.id);
  const [{ data: stopData }, { data: visitData }] = await Promise.all([
    supabase
      .from('route_customers')
      .select('id, route_id, retailer_id, sort_order, retailers ( shop_name, address )')
      .in('route_id', routeIds)
      .order('sort_order')
      .returns<StopRow[]>(),
    supabase
      .from('visits')
      .select('id, retailer_id, status, check_in_at')
      .eq('salesman_id', user.id)
      .gte('created_at', todayStart.toISOString())
      .returns<TodayVisitRow[]>(),
  ]);

  const stops = stopData ?? [];
  const visitByRetailer = new Map((visitData ?? []).map((v) => [v.retailer_id, v]));

  return (
    <div className="space-y-5">
      <h1 className="text-xl font-semibold text-ink-950">Today&apos;s Route</h1>

      {stops.length === 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>No stops yet</CardTitle>
          </CardHeader>
          <p className="text-sm text-ink-500">Your admin hasn&apos;t added any retailers to your route yet.</p>
        </Card>
      ) : (
        <div className="space-y-2">
          {stops.map((stop, index) => (
            <RouteStopCard
              key={stop.id}
              routeId={stop.route_id}
              stopId={stop.id}
              retailerId={stop.retailer_id}
              shopName={stop.retailers?.shop_name ?? 'Unknown shop'}
              address={stop.retailers?.address ?? null}
              visit={visitByRetailer.get(stop.retailer_id) ?? null}
              isFirst={index === 0}
              isLast={index === stops.length - 1}
            />
          ))}
        </div>
      )}
    </div>
  );
          }
