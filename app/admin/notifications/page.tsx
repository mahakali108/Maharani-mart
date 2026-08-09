import { Bell } from 'lucide-react';
import { Card, CardHeader, CardTitle } from '@/components/ui/card';

export default function AdminNotificationsPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-ink-950">Notifications</h1>
        <p className="mt-1 text-sm text-ink-500">Review notifications sent to retailers and staff.</p>
      </div>

      <Card>
        <CardHeader className="flex flex-row items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary-50 text-primary-600">
            <Bell className="h-5 w-5" />
          </div>
          <CardTitle>Not built yet</CardTitle>
        </CardHeader>
        <p className="text-sm text-ink-500">
          Notifications are already being generated in the background (order updates, dispatch
          alerts, etc.), but there&apos;s no admin screen to review them yet. This page exists so
          the sidebar link opens something instead of a 404, not because the feature is ready.
        </p>
      </Card>
    </div>
  );
}
