import { Card, CardHeader, CardTitle } from '@/components/ui/card';

export default function SalesmanDashboardPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-ink-950">Today</h1>
        <p className="mt-1 text-sm text-ink-500">Your route and visit summary.</p>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <Card>
          <p className="text-sm text-ink-500">Visits Planned</p>
          <p className="mt-1 text-2xl font-semibold text-ink-950">0</p>
        </Card>
        <Card>
          <p className="text-sm text-ink-500">Orders Collected</p>
          <p className="mt-1 text-2xl font-semibold text-ink-950">0</p>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>No route assigned yet</CardTitle>
        </CardHeader>
        <p className="text-sm text-ink-500">
          Your admin will assign a route and retailer beat plan — it will appear here once set up.
        </p>
      </Card>
    </div>
  );
}
