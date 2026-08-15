import { ClipboardCheck, ClipboardList, PackageCheck, Truck } from 'lucide-react';
import { createClient } from '@/lib/supabase/server';
import { requirePermission } from '@/lib/admin/guard';
import { Card } from '@/components/ui/card';

export default async function StaffDashboardPage() {
  await requirePermission('orders.view.all');
  const supabase = createClient();

  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);
  const todayIso = todayStart.toISOString();

  const [ordersToday, pendingOrders, dispatchQueue, dispatchedToday] = await Promise.all([
    supabase
      .from('orders')
      .select('id', { count: 'exact', head: true })
      .gte('placed_at', todayIso),
    supabase
      .from('orders')
      .select('id', { count: 'exact', head: true })
      .eq('status', 'pending'),
    supabase
      .from('orders')
      .select('id', { count: 'exact', head: true })
      .in('status', ['confirmed', 'processing', 'packed']),
    supabase
      .from('orders')
      .select('id', { count: 'exact', head: true })
      .gte('dispatched_at', todayIso),
  ]);

  const metrics = [
    !ordersToday.error
      ? { label: 'Orders Today', value: ordersToday.count ?? 0, icon: ClipboardList }
      : null,
    !pendingOrders.error
      ? { label: 'Pending Orders', value: pendingOrders.count ?? 0, icon: ClipboardCheck }
      : null,
    !dispatchQueue.error
      ? { label: 'Dispatch Queue', value: dispatchQueue.count ?? 0, icon: PackageCheck }
      : null,
    !dispatchedToday.error
      ? { label: 'Dispatched Today', value: dispatchedToday.count ?? 0, icon: Truck }
      : null,
  ].filter((metric): metric is NonNullable<typeof metric> => metric !== null);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-ink-950">Dashboard</h1>
        <p className="mt-1 text-sm text-ink-500">Live order and dispatch operations.</p>
      </div>

      {metrics.length > 0 ? (
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {metrics.map((metric) => {
            const Icon = metric.icon;
            return (
              <Card key={metric.label} className="p-4">
                <Icon className="h-5 w-5 text-primary-600" />
                <p className="mt-2 text-2xl font-semibold text-ink-950">{metric.value}</p>
                <p className="text-xs text-ink-500">{metric.label}</p>
              </Card>
            );
          })}
        </div>
      ) : (
        <Card>
          <p className="text-sm text-ink-500">Operational counts could not be loaded. Please try again.</p>
        </Card>
      )}
    </div>
  );
}
