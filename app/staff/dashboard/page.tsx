import { Card, CardHeader, CardTitle } from '@/components/ui/card';

export default function StaffDashboardPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-ink-950">Dashboard</h1>
        <p className="mt-1 text-sm text-ink-500">Today&apos;s operations overview.</p>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <Card>
          <p className="text-sm text-ink-500">Orders to Process</p>
          <p className="mt-1 text-2xl font-semibold text-ink-950">0</p>
        </Card>
        <Card>
          <p className="text-sm text-ink-500">Low Stock Alerts</p>
          <p className="mt-1 text-2xl font-semibold text-ink-950">0</p>
        </Card>
        <Card>
          <p className="text-sm text-ink-500">Pending Dispatches</p>
          <p className="mt-1 text-2xl font-semibold text-ink-950">0</p>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>No activity yet</CardTitle>
        </CardHeader>
        <p className="text-sm text-ink-500">
          Once products and orders start flowing through the system, they&apos;ll show up here.
        </p>
      </Card>
    </div>
  );
}
