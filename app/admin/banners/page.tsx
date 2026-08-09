import { Image as ImageIcon } from 'lucide-react';
import { Card, CardHeader, CardTitle } from '@/components/ui/card';

export default function AdminBannersPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-ink-950">Banners</h1>
        <p className="mt-1 text-sm text-ink-500">Manage the promotional banners shown to retailers.</p>
      </div>

      <Card>
        <CardHeader className="flex flex-row items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary-50 text-primary-600">
            <ImageIcon className="h-5 w-5" />
          </div>
          <CardTitle>Not built yet</CardTitle>
        </CardHeader>
        <p className="text-sm text-ink-500">
          The banners table exists in the database, but there&apos;s no management screen for it
          yet. This page exists so the sidebar link opens something instead of a 404, not because
          the feature is ready.
        </p>
      </Card>
    </div>
  );
}
