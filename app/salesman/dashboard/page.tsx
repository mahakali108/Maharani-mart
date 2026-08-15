import Link from 'next/link';
import { CalendarCheck, ClipboardList, Clock, MapPin, Route, ShoppingCart, Store, Users } from 'lucide-react';
import { createClient } from '@/lib/supabase/server';
import { requireUser } from '@/lib/auth/session';
import { Card, CardHeader, CardTitle } from '@/components/ui/card';

interface TodayOrder {
  grand_total: number;
}

export default async function SalesmanDashboardPage() {
  const user = await requireUser();
  const supabase = createClient();
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);
  const todayIso = todayStart.toISOString();

  const [
    { count: assignedRetailers },
    { data: todayOrderData },
    { count: todayVisits },
    { count: deliveries },
  ] = await Promise.all([
    supabase
      .from('retailers')
      .select('id', { count: 'exact', head: true })
      .eq('assigned_salesman_id', user.id)
      .eq('status', 'active'),
    supabase
      .from('orders')
      .select('grand_total')
      .eq('collected_by', user.id)
      .gte('placed_at', todayIso)
      .returns<TodayOrder[]>(),
    supabase
      .from('visits')
      .select('id', { count: 'exact', head: true })
      .eq('salesman_id', user.id)
      .gte('created_at', todayIso),
    supabase
      .from('orders')
      .select('id', { count: 'exact', head: true })
      .eq('status', 'dispatched'),
  ]);

  const todayOrders = todayOrderData ?? [];
  const todayValue = todayOrders.reduce((total, order) => total + order.grand_total, 0);

  const shortcuts = [
    { label: 'My Retailers', href: '/salesman/retailers', icon: Store },
    { label: 'Create Order', href: '/salesman/orders/new', icon: ShoppingCart },
    { label: 'Routes', href: '/salesman/routes', icon: Route },
    { label: 'Visits', href: '/salesman/visits', icon: MapPin },
    { label: 'Attendance', href: '/salesman/attendance', icon: Clock },
    { label: 'Daily Report', href: '/salesman/dcr', icon: CalendarCheck },
  ];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-ink-950">Today</h1>
        <p className="mt-1 text-sm text-ink-500">Your live retailer, visit, order, and delivery summary.</p>
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Card className="p-4">
          <Store className="h-5 w-5 text-primary-600" />
          <p className="mt-2 text-2xl font-semibold text-ink-950">{assignedRetailers ?? 0}</p>
          <p className="text-xs text-ink-500">Active Retailers</p>
        </Card>
        <Card className="p-4">
          <ClipboardList className="h-5 w-5 text-primary-600" />
          <p className="mt-2 text-2xl font-semibold text-ink-950">{todayOrders.length}</p>
          <p className="text-xs text-ink-500">Orders Collected</p>
        </Card>
        <Card className="p-4">
          <Users className="h-5 w-5 text-primary-600" />
          <p className="mt-2 text-2xl font-semibold text-ink-950">{todayVisits ?? 0}</p>
          <p className="text-xs text-ink-500">Visits Logged</p>
        </Card>
        <Card className="p-4">
          <ShoppingCart className="h-5 w-5 text-primary-600" />
          <p className="mt-2 text-2xl font-semibold text-ink-950">₹{todayValue.toFixed(0)}</p>
          <p className="text-xs text-ink-500">Order Value Today</p>
        </Card>
      </div>

      <Card>
        <CardHeader><CardTitle>Quick actions</CardTitle></CardHeader>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          {shortcuts.map((shortcut) => {
            const Icon = shortcut.icon;
            return (
              <Link key={shortcut.href} href={shortcut.href} className="flex items-center gap-2 rounded-xl bg-ink-50 p-3 text-sm font-medium text-ink-700 hover:bg-primary-50 hover:text-primary-700">
                <Icon className="h-4 w-4" /> {shortcut.label}
              </Link>
            );
          })}
        </div>
      </Card>

      <Card className="flex items-center justify-between">
        <div>
          <p className="text-sm text-ink-500">Orders awaiting delivery</p>
          <p className="mt-1 text-xl font-semibold text-ink-950">{deliveries ?? 0}</p>
        </div>
        <Link href="/salesman/orders" className="text-sm font-medium text-primary-600 hover:text-primary-700">View orders</Link>
      </Card>
    </div>
  );
}
