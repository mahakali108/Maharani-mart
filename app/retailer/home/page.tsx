import { Card, CardHeader, CardTitle } from '@/components/ui/card';

export default function RetailerHomePage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-ink-950">Welcome</h1>
        <p className="mt-1 text-sm text-ink-500">New launches, schemes, and offers for your shop.</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Catalog coming soon</CardTitle>
        </CardHeader>
        <p className="text-sm text-ink-500">
          Your distributor is setting up the product catalog. Check back shortly, or contact your
          assigned salesman for updates.
        </p>
      </Card>
    </div>
  );
}
