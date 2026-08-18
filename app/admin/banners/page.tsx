import { Image as ImageIcon } from 'lucide-react';
import { StoredImage } from '@/components/media/stored-image';
import { createClient } from '@/lib/supabase/server';
import { Card, CardHeader, CardTitle } from '@/components/ui/card';
import { AdminEmptyState } from '@/components/admin/empty-state';
import { BannerForm } from '@/components/admin/banner-form';
import { BannerRowActions } from '@/components/admin/banner-row-actions';

interface BannerRow {
  id: string;
  title: string;
  image_url: string;
  link_url: string | null;
  area_id: string | null;
  sort_order: number;
  is_active: boolean;
  starts_at: string | null;
  ends_at: string | null;
}

export default async function BannersPage() {
  const supabase = createClient();

  // Separate queries rather than an embed — same reasoning as the fix
  // in app/admin/retailers/page.tsx.
  const [{ data: bannerRows }, { data: areaRows }] = await Promise.all([
    supabase
      .from('banners')
      .select('id, title, image_url, link_url, area_id, sort_order, is_active, starts_at, ends_at')
      .order('sort_order'),
    supabase.from('areas').select('id, name'),
  ]);

  const banners = (bannerRows ?? []) as unknown as BannerRow[];
  const areaById = new Map(((areaRows ?? []) as unknown as { id: string; name: string }[]).map((a) => [a.id, a.name]));

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-ink-950">Banners</h1>
        <p className="mt-1 text-sm text-ink-500">
          Promotional banners shown at the top of the retailer home screen.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Add a new banner</CardTitle>
        </CardHeader>
        <BannerForm areas={areaRows ?? []} />
      </Card>

      {banners.length === 0 ? (
        <AdminEmptyState
          icon={ImageIcon}
          title="No banners yet"
          body="Add your first banner above — it'll appear on the retailer home screen once active."
        />
      ) : (
        <Card className="overflow-hidden p-0">
          <table className="w-full text-sm">
            <thead className="border-b border-ink-100 bg-ink-50 text-left text-xs uppercase tracking-wide text-ink-500">
              <tr>
                <th className="px-5 py-3 font-medium">Preview</th>
                <th className="px-5 py-3 font-medium">Title</th>
                <th className="px-5 py-3 font-medium">Area</th>
                <th className="px-5 py-3 font-medium">Schedule</th>
                <th className="px-5 py-3 font-medium">Status</th>
                <th className="px-5 py-3 font-medium" />
              </tr>
            </thead>
            <tbody className="divide-y divide-ink-100">
              {banners.map((b, index) => (
                <tr key={b.id}>
                  <td className="px-5 py-3">
                    <div className="relative h-10 w-20 overflow-hidden rounded-lg border border-ink-100">
                      <StoredImage src={b.image_url} alt="" fill className="object-cover" />
                    </div>
                  </td>
                  <td className="px-5 py-3 font-medium text-ink-900">
                    {b.link_url ? (
                      <a href={b.link_url} target="_blank" rel="noreferrer" className="hover:text-primary-600">
                        {b.title}
                      </a>
                    ) : (
                      b.title
                    )}
                  </td>
                  <td className="px-5 py-3 text-ink-600">{b.area_id ? areaById.get(b.area_id) ?? '—' : 'All areas'}</td>
                  <td className="px-5 py-3 text-xs text-ink-500">
                    {b.starts_at ? new Date(b.starts_at).toLocaleDateString('en-IN') : 'Any time'}
                    {b.ends_at ? ` – ${new Date(b.ends_at).toLocaleDateString('en-IN')}` : ''}
                  </td>
                  <td className="px-5 py-3">
                    <span
                      className={`rounded-full px-2.5 py-1 text-xs font-medium ${
                        b.is_active ? 'bg-green-50 text-green-700' : 'bg-ink-100 text-ink-500'
                      }`}
                    >
                      {b.is_active ? 'Active' : 'Inactive'}
                    </span>
                  </td>
                  <td className="px-5 py-3">
                    <BannerRowActions
                      bannerId={b.id}
                      isActive={b.is_active}
                      isFirst={index === 0}
                      isLast={index === banners.length - 1}
                    />
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
